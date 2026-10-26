/**
 * 本地图像资产存储与 Object URL 资源管理服务接口。
 *
 * @remarks
 * 图像资产与完整技术参数以本地 IndexedDB 为核心存储，保证画廊浏览与离线访问稳定性。
 * Object URL 统一管理创建与释放，避免内存泄漏。
 */

import type { StoredImageRecord, DrawingSlotEntry } from './st/chat';

/** 本地图像资产查询选项 */
export interface ImageQueryOptions {
    /** 返回结果最大数量限制 */
    readonly limit?: number;
    /** 分页偏移量 */
    readonly offset?: number;
    /** 按资产状态筛选 */
    readonly status?: 'ready' | 'generating' | 'failed';
    /** 按关联的会话标识符筛选 */
    readonly chatId?: string;
    /** 按关联的角色名称筛选 */
    readonly characterName?: string;
    /** 按标星收藏状态筛选 */
    readonly favorited?: boolean;
}

/** 图像资产持久化存储服务接口 */
export interface ImageStorageService {
    /** 保存图像二进制数据与对应资产记录到 IndexedDB */
    saveImage(record: StoredImageRecord, blob: Blob): Promise<void>;

    /**
     * 仅保存图像元数据记录（不含 Blob），status 通常为 'generating'。
     * 用于在生图任务开始时即建立可寻址的 imageId 占位，确保即使中途切换会话也能恢复关联。
     */
    saveImageMeta(record: StoredImageRecord): Promise<void>;

    /**
     * 完成图像保存：写入 Blob 数据并更新元数据字段（mimeType、byteSize、status、metadata）。
     * 配合 saveImageMeta 实现两阶段写入。
     */
    finalizeImage(
        imageId: string,
        blob: Blob,
        updates: Pick<StoredImageRecord, 'mimeType' | 'byteSize' | 'status' | 'metadata'>
    ): Promise<void>;

    /**
     * 局部更新图像资产元数据字段（如 status、remotePath、favorited）。
     * 不触碰 Blob 数据。
     */
    updateImageRecord(
        imageId: string,
        patch: Partial<Pick<StoredImageRecord, 'status' | 'remotePath' | 'favorited'>>
    ): Promise<void>;

    /** 切换指定图像资产的标星收藏状态，返回更新后的收藏状态 */
    toggleFavorite(imageId: string): Promise<boolean>;

    /** 根据 imageId 获取本地图像 Blob 二进制数据 */
    getImageBlob(imageId: string): Promise<Blob | undefined>;

    /** 根据 imageId 获取图像资产记录 */
    getImageRecord(imageId: string): Promise<StoredImageRecord | undefined>;

    /** 更新或标记删除指定图像资产 */
    deleteImage(imageId: string): Promise<void>;

    /** 查询本地图像资产记录列表，支持按条件筛选与分页 */
    listImages(options?: ImageQueryOptions): Promise<StoredImageRecord[]>;

    /** 获取本地存储中的图像资产总数，可指定状态筛选条件 */
    countImages(status?: 'ready' | 'generating' | 'failed'): Promise<number>;
}

/** Object URL 生命周期管理池接口 */
export interface ImageUrlPool {
    /** 为 Blob 创建 Object URL 并记录映射 */
    createUrl(key: string, blob: Blob): string;

    /** 根据 key 获取已缓存的 Object URL */
    getUrl(key: string): string | undefined;

    /** 释放指定 key 对应的 Object URL */
    revokeUrl(key: string): void;

    /** 释放管理池中记录的所有 Object URL */
    revokeAll(): void;
}

/**
 * 将展示索引记录解析为可渲染的图像 URL。
 *
 * @remarks
 * 解析优先级：imageUrl (服务端静态路径) > base64 (内嵌 Data URL) > imageId (读取本地 Blob 并生成临时 Object URL)。
 */
export type ImageSourceResolver = (entry: DrawingSlotEntry) => Promise<string | undefined>;
