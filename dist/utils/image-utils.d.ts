/**
 * @module utils/image-utils
 * @description 图像处理工具模块 (ImageUtils)
 *
 * 职责：
 * - 将 Base64 原始生图高效压缩并转换为 WebP 格式的 200px 缩略图
 * - 提供文件大小格式化与 Base64 解码转换辅助
 *
 * 规范参考：
 * - .agents/Skills/browser-storage/SKILL.md §5 (WebP 缩略图生成与转码)
 */
import type { ThumbnailRecord } from '../storage/image-db';
/**
 * 格式化字节大小为 KB / MB / GB
 */
export declare function formatBytes(bytes: number, decimals?: number): string;
/**
 * 将完整的 Base64 数据串或 DataURL 转化为 ImageElement
 */
export declare function loadImageElement(dataUrl: string): Promise<HTMLImageElement>;
/**
 * 生成 200px 最长边的 WebP 高效缩略图
 */
export declare function generateThumbnail(uuid: string, base64Data: string, mimeType: string, maxSize?: number): Promise<ThumbnailRecord>;
//# sourceMappingURL=image-utils.d.ts.map