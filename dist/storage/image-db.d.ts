/**
 * @module storage/image-db
 * @description 图像 IndexedDB 存储管理器 (ImageDB)
 *
 * 职责：
 * - 将生图二进制/Base64 数据存储在 IndexedDB 中
 * - 宿主 chat.json 的 msg.extra.da_images 中仅保留轻量 UUID 引用
 * - 避免 chat.json 序列化膨胀，规避 100MB+ 磁盘卡顿与存储配额崩溃
 * - 提供缩略图 WebP 高效缓存表 (THUMBNAILS_STORE_NAME)
 *
 * 规范参考：
 * - .agents/Skills/browser-storage/SKILL.md §3 (IndexedDB 存储范式)
 */
export declare const IMAGES_STORE_NAME = "images";
export declare const STATS_STORE_NAME = "statistics";
export declare const LOGS_STORE_NAME = "logs";
export declare const THUMBNAILS_STORE_NAME = "thumbnails";
export interface ThumbnailRecord {
    uuid: string;
    data: string;
    width: number;
    height: number;
    updatedAt: number;
}
export interface ImageMetadata {
    provider?: string;
    ckptName?: string;
    samplerName?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    negativePrompt?: string;
}
export interface StoredImageRecord {
    uuid: string;
    data: string;
    mime: string;
    prompt: string;
    timestamp: number;
    metadata?: ImageMetadata;
}
export declare function getDB(): Promise<IDBDatabase>;
/**
 * 将图像数据存储至 IndexedDB (支持元数据)
 */
export declare function saveImageToDB(uuid: string, data: string, mime: string, prompt: string, metadata?: ImageMetadata): Promise<string>;
/**
 * 根据 UUID 从 IndexedDB 获取图像记录
 */
export declare function getImageFromDB(uuid: string): Promise<StoredImageRecord | null>;
/**
 * 删除指定 UUID 的图像 (同时删除对应的缩略图)
 */
export declare function deleteImageFromDB(uuid: string): Promise<void>;
/**
 * 保存 WebP 缩略图至 IndexedDB
 */
export declare function saveThumbnailToDB(record: ThumbnailRecord): Promise<void>;
/**
 * 获取 WebP 缩略图
 */
export declare function getThumbnailFromDB(uuid: string): Promise<ThumbnailRecord | null>;
/**
 * 获取图库总览统计与配额
 */
export declare function getGalleryStats(): Promise<{
    totalCount: number;
    totalSizeBytes: number;
    usageBytes: number;
    quotaBytes: number;
}>;
/**
 * 获取图库图片列表（带搜索过滤、排序与分页）
 */
export declare function getGalleryImages(options: {
    limit?: number;
    offset?: number;
    searchText?: string;
    sortBy?: 'timestamp' | 'prompt';
    sortOrder?: 'asc' | 'desc';
}): Promise<{
    items: StoredImageRecord[];
    total: number;
}>;
/**
 * 物理清空 IndexedDB 中的全量生成图片与缩略图
 */
export declare function clearAllImagesFromDB(): Promise<void>;
//# sourceMappingURL=image-db.d.ts.map