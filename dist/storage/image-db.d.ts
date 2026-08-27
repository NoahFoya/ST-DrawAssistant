/**
 * @module storage/image-db
 * @description 图像数据库存储与图库服务 (ImageDB)
 *
 * 职责：
 * - 将生图 Base64 数据与 WebP 缩略图存储在 IndexedDB 中，宿主聊天记录仅保留 UUID 引用，防止聊天文件膨胀导致卡顿
 * - 提供图库数据的查询、分页、检索、导出与物理清理方法
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
    clipName?: string;
    vaeName?: string;
    samplerName?: string;
    scheduler?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    fullPositivePrompt?: string;
    fullNegativePrompt?: string;
    negativePrompt?: string;
    seed?: number;
    denoise?: number;
    maskBlur?: number;
    growMaskBy?: number;
}
export interface StoredImageRecord {
    uuid: string;
    data: string;
    mime: string;
    prompt: string;
    rawNegativePrompt?: string;
    timestamp: number;
    seed?: number;
    metadata?: ImageMetadata;
}
export declare function getDB(): Promise<IDBDatabase>;
/**
 * 将图像数据存储至 IndexedDB (支持元数据与配额溢出处理)
 */
export declare function saveImageToDB(uuid: string, data: string, mime: string, prompt: string, metadata?: ImageMetadata, rawNegativePrompt?: string): Promise<string>;
/**
 * 根据 UUID 从 IndexedDB 获取图像记录
 */
export declare function getImageFromDB(uuid: string): Promise<StoredImageRecord | null>;
/**
 * 删除指定 UUID 的图像 (同时删除对应的缩略图)
 */
export declare function deleteImageFromDB(uuid: string): Promise<void>;
/**
 * 批量高效删除指定 UUID 列表的图像及缩略图 (在单个 readwrite 事务内完成)
 */
export declare function deleteImagesBatchFromDB(uuids: Iterable<string>): Promise<number>;
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
/**
 * 订阅图库数据变动
 * @returns unsubscribe 函数，配合 DisposableBag 使用
 */
export declare function subscribeGalleryChange(listener: () => void): () => void;
/**
 * 获取当前 IndexedDB 存储空间与图片数量统计
 */
export declare function galleryGetStats(): Promise<{
    totalCount: number;
    totalSizeBytes: number;
    usageBytes: number;
    quotaBytes: number;
}>;
/**
 * 删除指定 UUID 的单张图像并广播变更通知
 */
export declare function galleryDeleteImage(uuid: string): Promise<void>;
/**
 * 批量删除图像并广播变更通知
 */
export declare function galleryDeleteBatch(uuids: Iterable<string>): Promise<number>;
/**
 * 扫描全库未被聊天引用的孤立废图
 */
export declare function galleryScanIsolated(): Promise<string[]>;
/**
 * 物理清理全库孤立废图并广播变更通知
 */
export declare function galleryCleanIsolated(): Promise<number>;
/**
 * 物理重置并清空所有存储的图像数据，广播变更通知
 */
export declare function galleryResetAllStorage(): Promise<void>;
//# sourceMappingURL=image-db.d.ts.map