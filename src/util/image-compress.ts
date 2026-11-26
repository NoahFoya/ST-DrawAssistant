/**
 * 图像格式与存储画质压缩处理函数。
 *
 * @remarks
 * 支持六档图像存储格式处理：
 * - 'original': 返回原始 Blob，不执行图像重编码；
 * - 'png': 统一为无损 PNG（原图已是 PNG 时直接原样返回，非 PNG 时转为 PNG）；
 * - 'webp-high': 转码为高质量 WebP (quality: 0.9)；
 * - 'webp-medium': 转码为平衡 WebP (quality: 0.8)；
 * - 'jpeg-high': 转码为高质量 JPEG (quality: 0.92，自动纯白铺底)；
 * - 'jpeg-medium': 转码为平衡 JPEG (quality: 0.85，自动纯白铺底)。
 * 优先采用 OffscreenCanvas 与 createImageBitmap 在无 DOM 干扰下高效率转码；
 * 当环境不支持 OffscreenCanvas 时降级为 HTMLCanvasElement 或在异常时安全回退原始 Blob。
 */

import type { ImageStorageQuality } from '@types';
import { detectImageMimeFromHeader } from './image-metadata';

function computeScaledDimensions(
    width: number,
    height: number,
    maxEdge?: number
): { width: number; height: number } {
    if (!maxEdge || (width <= maxEdge && height <= maxEdge)) {
        return { width, height };
    }
    const ratio = Math.min(maxEdge / width, maxEdge / height);
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
    };
}

/**
 * 内部共用的 Canvas 图像格式转码与可选等比缩放实现。
 */
async function encodeImageWithCanvas(
    blob: Blob,
    options: {
        targetMime: 'image/png' | 'image/webp' | 'image/jpeg';
        quality?: number;
        maxEdge?: number;
        fillOpaqueBackground?: boolean;
    }
): Promise<Blob> {
    const { targetMime, quality, maxEdge, fillOpaqueBackground } = options;

    try {
        if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
            const bitmap = await createImageBitmap(blob);
            try {
                const { width, height } = computeScaledDimensions(
                    bitmap.width,
                    bitmap.height,
                    maxEdge
                );
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    if (fillOpaqueBackground) {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, width, height);
                    }
                    if (width === bitmap.width && height === bitmap.height) {
                        ctx.drawImage(bitmap, 0, 0);
                    } else {
                        ctx.drawImage(bitmap, 0, 0, width, height);
                    }
                    const converted = await canvas.convertToBlob({
                        type: targetMime,
                        ...(quality !== undefined ? { quality } : {}),
                    });
                    return converted && converted.size > 0 && converted.type === targetMime
                        ? converted
                        : blob;
                }
            } finally {
                bitmap.close();
            }
        } else if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const img = document.createElement('img');
            const url = URL.createObjectURL(blob);
            try {
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = reject;
                    img.src = url;
                });
                const sourceW = img.naturalWidth || 512;
                const sourceH = img.naturalHeight || 512;
                const { width, height } = computeScaledDimensions(sourceW, sourceH, maxEdge);
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (ctx && typeof canvas.toBlob === 'function') {
                    if (fillOpaqueBackground) {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, width, height);
                    }
                    if (width === sourceW && height === sourceH) {
                        ctx.drawImage(img, 0, 0);
                    } else {
                        ctx.drawImage(img, 0, 0, width, height);
                    }
                    return await new Promise<Blob>((resolve) => {
                        canvas.toBlob(
                            (b) =>
                                resolve(
                                    b && b.size > 0 && b.type === targetMime ? b : blob
                                ),
                            targetMime,
                            quality
                        );
                    });
                }
            } finally {
                URL.revokeObjectURL(url);
            }
        }
    } catch {
        // 环境不支持或编码异常时保留原始 Blob
    }

    return blob;
}

/**
 * 依据配置策略处理图像 Blob 存储画质与格式。
 *
 * @param blob 原始图像二进制数据
 * @param quality 存储画质策略
 * @returns 转码压缩后或原始的 Blob 数据
 */
export async function applyImageStorageQuality(
    blob: Blob,
    quality: ImageStorageQuality = 'original'
): Promise<Blob> {
    if (quality === 'original' || !blob) {
        return blob;
    }

    if (quality === 'png') {
        let isAlreadyPng = blob.type === 'image/png';
        if (!isAlreadyPng && typeof blob.arrayBuffer === 'function') {
            try {
                const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
                isAlreadyPng = detectImageMimeFromHeader(header) === 'image/png';
            } catch {
                // 忽略魔数读取异常
            }
        }
        if (isAlreadyPng) {
            return blob;
        }
        return encodeImageWithCanvas(blob, { targetMime: 'image/png' });
    }

    if (quality === 'jpeg-high' || quality === 'jpeg-medium') {
        const qualityValue = quality === 'jpeg-high' ? 0.92 : 0.85;
        return encodeImageWithCanvas(blob, {
            targetMime: 'image/jpeg',
            quality: qualityValue,
            fillOpaqueBackground: true,
        });
    }

    const qualityValue = quality === 'webp-high' ? 0.9 : 0.8;
    return encodeImageWithCanvas(blob, { targetMime: 'image/webp', quality: qualityValue });
}

/**
 * 将上传的素材预览图等比缩放至最大边长限制并转码为高画质 WebP Blob。
 *
 * @param blob 原始图片 Blob
 * @param maxEdge 允许的最大边长（像素），默认 1024
 */
export async function compressMaterialAvatar(blob: Blob, maxEdge = 1024): Promise<Blob> {
    if (!blob) {
        return blob;
    }
    return encodeImageWithCanvas(blob, {
        targetMime: 'image/webp',
        quality: 0.86,
        maxEdge,
    });
}
