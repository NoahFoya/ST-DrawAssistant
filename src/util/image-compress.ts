/**
 * 图像格式与存储画质压缩处理函数。
 *
 * @remarks
 * 支持将原始 Blob 转码为 WebP 格式：
 * - 'original': 返回原始 Blob，不执行二次编码；
 * - 'webp-high': 转码为高质量 WebP (quality: 0.9)，保持高保真度同时压缩 60%-75% 空间；
 * - 'webp-medium': 转码为平衡 WebP (quality: 0.8)，适合磁盘配额敏感场景。
 * 优先采用 OffscreenCanvas 与 createImageBitmap 在无 DOM 干扰下高效率转码；
 * 当环境不支持 OffscreenCanvas 时降级为 HTMLCanvasElement 或在异常时安全回退原始 Blob。
 */

import type { ImageStorageQuality } from '@types';

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
 * 内部共用的 Canvas WebP 转码与可选等比缩放实现。
 */
async function encodeWebpWithCanvas(
    blob: Blob,
    options: { quality: number; maxEdge?: number }
): Promise<Blob> {
    const { quality, maxEdge } = options;

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
                    if (width === bitmap.width && height === bitmap.height) {
                        ctx.drawImage(bitmap, 0, 0);
                    } else {
                        ctx.drawImage(bitmap, 0, 0, width, height);
                    }
                    const converted = await canvas.convertToBlob({ type: 'image/webp', quality });
                    return converted && converted.size > 0 && converted.type === 'image/webp'
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
                    if (width === sourceW && height === sourceH) {
                        ctx.drawImage(img, 0, 0);
                    } else {
                        ctx.drawImage(img, 0, 0, width, height);
                    }
                    return await new Promise<Blob>((resolve) => {
                        canvas.toBlob(
                            (b) =>
                                resolve(
                                    b && b.size > 0 && b.type === 'image/webp' ? b : blob
                                ),
                            'image/webp',
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

    const qualityValue = quality === 'webp-high' ? 0.9 : 0.8;
    return encodeWebpWithCanvas(blob, { quality: qualityValue });
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
    return encodeWebpWithCanvas(blob, { quality: 0.86, maxEdge });
}
