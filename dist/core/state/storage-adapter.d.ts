/**
 * @module core/state/storage-adapter
 * @description 本地图像数据库存储适配器 (基于浏览器 IndexedDB)
 *
 * 图文解耦存储机制：
 * 1. 图片二进制数据（WebP/PNG Blob）体积较大，统一持久化保存在浏览器本地的 IndexedDB 中；
 * 2. SillyTavern 的聊天记录文本 (jsonl) 中仅保存轻量级的图片 UUID 与提示词元数据；
 * 3. 消息重新渲染时，通过 UUID 从 IndexedDB 异步读取 Blob 并生成临时 Object URL 供 <img> 标签展示；
 * 4. 支持基于 SHA-256 / FNV 哈希的图片去重，以及超出上限时的 LRU (最近最少访问) 自动淘汰策略（收藏图片受到保护不被自动清理）。
 */
import { IDisposable } from '../foundation/disposable';
/** 本地存储的生图历史记录数据结构 */
export interface StoredImageRecord {
    /** 图像全局唯一标识符 (UUID) */
    readonly id: string;
    /** 图像二进制内容哈希 (用于避免重复存入相同图片) */
    readonly hash: string;
    /** 生图提示词正文 */
    readonly prompt: string;
    /** 图像实际二进制数据 (Blob) 或 Base64 字符串 */
    readonly data: string | Blob;
    /** 缩略图 Blob (用于画廊面板快速网格展示，降低内存压力) */
    readonly thumbnailData?: Blob;
    /** 生成完成的时间戳 (毫秒) */
    readonly timestamp: number;
    /** 生图参数快照（模型、采样步数、CFG、种子等） */
    readonly metadata?: Record<string, unknown>;
    /** 是否已被用户收藏标星 (收藏项不会被 LRU 缓存淘汰策略自动清除) */
    isFavorite?: boolean;
    /** 最近一次被点击或查看的时间戳 */
    lastAccessedAt?: number;
}
/**
 * 生成指定最大尺寸的轻量缩略图 Blob
 *
 * @param blob 原图 Blob 数据
 * @param maxWidth 缩略图最大宽度 (默认 256)
 * @param maxHeight 缩略图最大高度 (默认 256)
 * @returns 缩略图 Blob
 */
export declare function createThumbnail(blob: Blob, maxWidth?: number, maxHeight?: number): Promise<Blob>;
/**
 * 图像本地持久化存储适配器接口
 */
export interface IStorageAdapter extends IDisposable {
    /** 初始化数据库连接与 ObjectStore 迁移 */
    init(): Promise<void>;
    /** 保存图像记录并返回生成的或指定的 UUID */
    saveImage(record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & {
        hash?: string;
    }, maxStoredImages?: number): Promise<string>;
    /** 根据 UUID 获取单张图像数据快照 */
    getImage(id: string): Promise<StoredImageRecord | null>;
    /** 根据内容哈希检索已存在的去重图像 */
    getImageByHash(hash: string): Promise<StoredImageRecord | null>;
    /** 获取本地图库所有图像列表 (按时间降序排列) */
    getAllImages(): Promise<StoredImageRecord[]>;
    /** 根据 UUID 删除指定图像记录 */
    deleteImage(id: string): Promise<void>;
    /** 切换图像的收藏状态 (Star) */
    toggleFavorite(id: string): Promise<boolean>;
    /** 清空所有存储的图像记录 */
    clear(): Promise<void>;
    /** 计算图像二进制数据或 Base64 的 SHA-256 哈希值 */
    calculateHash(data: string | Blob | ArrayBuffer): Promise<string>;
}
export declare class IndexedDBStorageAdapter implements IStorageAdapter {
    private static readonly DB_NAME;
    private static readonly DB_VERSION;
    private static readonly STORE_IMAGES;
    private _db;
    private _isInitialized;
    private readonly _logger;
    private readonly _memoryStore;
    init(): Promise<void>;
    calculateHash(data: string | Blob | ArrayBuffer): Promise<string>;
    saveImage(record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & {
        hash?: string;
    }, maxStoredImages?: number): Promise<string>;
    getImage(id: string): Promise<StoredImageRecord | null>;
    getImageByHash(hash: string): Promise<StoredImageRecord | null>;
    getAllImages(): Promise<StoredImageRecord[]>;
    deleteImage(id: string): Promise<void>;
    toggleFavorite(id: string): Promise<boolean>;
    clear(): Promise<void>;
    private updateRecord;
    private ensureStorageQuota;
    dispose(): void;
}
//# sourceMappingURL=storage-adapter.d.ts.map