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
import type { ThumbnailRecord } from '../storage/image-db';
/**
 * 格式化字节大小为可读字符串 (B / KB / MB / GB / TB)
 *
 * @param bytes 字节数
 * @param decimals 小数保留位数，默认为 1
 * @returns 格式化后的字符串 (如 "1.5 MB")
 */
export declare function formatBytes(bytes: number, decimals?: number): string;
/**
 * 将完整的 Base64 数据串或 DataURL 异步加载为 HTMLImageElement
 *
 * @param dataUrl 图像 Base64 数据或 DataURL 字符串
 * @returns 加载成功的 HTMLImageElement 实例 Promise
 * @throws {Error} 图像加载失败时 reject 抛出异常
 */
export declare function loadImageElement(dataUrl: string): Promise<HTMLImageElement>;
/**
 * 生成最长边限制的 WebP 格式缩略图记录
 *
 * @param uuid 图像对应的全局唯一 ID
 * @param base64Data 原始图像 Base64 字符串
 * @param mimeType 图像 MIME 类型 (如 'image/png')
 * @param maxSize 缩略图最长边像素限制，默认为 200px
 * @returns 包含 WebP 缩略图 Base64 数据的 ThumbnailRecord 对象 Promise
 */
export declare function generateThumbnail(uuid: string, base64Data: string, mimeType: string, maxSize?: number): Promise<ThumbnailRecord>;
//# sourceMappingURL=image-utils.d.ts.map