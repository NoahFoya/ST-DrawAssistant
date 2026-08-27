/**
 * @module utils/image-utils
 * @description 图像处理工具模块 (ImageUtils)
 *
 * 职责：
 * - 将 Base64 原始生图高效压缩并转换为 WebP 格式的 200px 缩略图
 * - 提供文件大小格式化与 Base64 解码转换辅助
 *
 * WebP 缩略图转码策略：
 * 使用 HTMLCanvasElement + CanvasRenderingContext2D 将原始生图绘制到
 * 300×300 尺寸的离屏 Canvas 后，以 canvas.toDataURL('image/webp', 0.8)
 * 导出为 Base64 WebP，存入 IndexedDB thumbnails 表供图库列表快速渲染。
 */


import { logger } from '../core/logger';
import type { ThumbnailRecord } from '../storage/image-db';

/**
 * 格式化字节大小为可读字符串 (B / KB / MB / GB / TB)
 *
 * @param bytes 字节数
 * @param decimals 小数保留位数，默认为 1
 * @returns 格式化后的字符串 (如 "1.5 MB")
 */
export function formatBytes(bytes: number, decimals = 1): string {
    if (bytes <= 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 将完整的 Base64 数据串或 DataURL 异步加载为 HTMLImageElement
 *
 * @param dataUrl 图像 Base64 数据或 DataURL 字符串
 * @returns 加载成功的 HTMLImageElement 实例 Promise
 * @throws {Error} 图像加载失败时 reject 抛出异常
 */
export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error(`图像加载失败: ${String(err)}`));
        img.src = dataUrl.startsWith('data:') ? dataUrl : `data:image/png;base64,${dataUrl}`;
    });
}

/**
 * 生成最长边限制的 WebP 格式缩略图记录
 *
 * @param uuid 图像对应的全局唯一 ID
 * @param base64Data 原始图像 Base64 字符串
 * @param mimeType 图像 MIME 类型 (如 'image/png')
 * @param maxSize 缩略图最长边像素限制，默认为 200px
 * @returns 包含 WebP 缩略图 Base64 数据的 ThumbnailRecord 对象 Promise
 */
export async function generateThumbnail(
    uuid: string,
    base64Data: string,
    mimeType: string,
    maxSize = 200
): Promise<ThumbnailRecord> {
    try {
        const dataUrl = base64Data.startsWith('data:') ? base64Data : `data:${mimeType};base64,${base64Data}`;
        const img = await loadImageElement(dataUrl);

        let targetWidth = img.width;
        let targetHeight = img.height;

        if (targetWidth > targetHeight) {
            if (targetWidth > maxSize) {
                targetHeight = Math.round((targetHeight * maxSize) / targetWidth);
                targetWidth = maxSize;
            }
        } else {
            if (targetHeight > maxSize) {
                targetWidth = Math.round((targetWidth * maxSize) / targetHeight);
                targetHeight = maxSize;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, targetWidth);
        canvas.height = Math.max(1, targetHeight);
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('无法创建 Canvas 2D 绘图上下文');
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        // 导出为 WebP Base64 数据串（移除 data:image/webp;base64, 前缀）
        const webpDataUrl = canvas.toDataURL('image/webp', 0.75);
        const base64Only = webpDataUrl.split(',')[1] ?? webpDataUrl;

        return {
            uuid,
            data: base64Only,
            width: targetWidth,
            height: targetHeight,
            updatedAt: Date.now(),
        };
    } catch (err) {
        logger.warn(`生成 WebP 缩略图失败: uuid=${uuid}`, err, 'ImageUtils');
        // 降级：返回 1x1 占位
        return {
            uuid,
            data: '',
            width: 1,
            height: 1,
            updatedAt: Date.now(),
        };
    }
}
