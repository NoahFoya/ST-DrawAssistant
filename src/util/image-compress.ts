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

import type { ImageStorageQuality } from '../store/settings-store';

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

    try {
        if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
            const bitmap = await createImageBitmap(blob);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();
                return await canvas.convertToBlob({ type: 'image/webp', quality: qualityValue });
            }
            bitmap.close();
        } else if (typeof document !== 'undefined') {
            const img = document.createElement('img');
            const url = URL.createObjectURL(blob);
            try {
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = reject;
                    img.src = url;
                });
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    return await new Promise<Blob>((resolve) => {
                        canvas.toBlob(
                            (b) => resolve(b || blob),
                            'image/webp',
                            qualityValue
                        );
                    });
                }
            } finally {
                URL.revokeObjectURL(url);
            }
        }
    } catch {
        // 环境不支持或编码异常时安全保留原始无损 Blob
    }

    return blob;
}
