/**
 * @module core/state/storage-adapter
 * @description IndexedDB 持久化适配器 (支持 SHA-256 内容寻址去重、LRU 水位熔断与 Storage Quota 保护)
 */
import { IDisposable } from '../foundation/disposable';
export interface StoredImageRecord {
    readonly id: string;
    readonly hash: string;
    readonly prompt: string;
    readonly data: string;
    readonly timestamp: number;
    readonly metadata?: Record<string, unknown>;
    isFavorite?: boolean;
    lastAccessedAt?: number;
}
/**
 * 图像本地持久化存储适配器接口
 */
export interface IStorageAdapter extends IDisposable {
    /** 初始化数据库连接与 ObjectStore 迁移 */
    init(): Promise<void>;
    /** 保存图像记录并返回生成的或指定的 UUID */
    saveImage(record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & {
        hash?: string;
    }): Promise<string>;
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
    /** 计算图像二进制数据或 Base64 的 SHA-256 哈希值 */
    calculateHash(data: string | Blob): Promise<string>;
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
    calculateHash(data: string | Blob): Promise<string>;
    saveImage(record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & {
        hash?: string;
    }): Promise<string>;
    getImage(id: string): Promise<StoredImageRecord | null>;
    getImageByHash(hash: string): Promise<StoredImageRecord | null>;
    getAllImages(): Promise<StoredImageRecord[]>;
    deleteImage(id: string): Promise<void>;
    toggleFavorite(id: string): Promise<boolean>;
    private updateRecord;
    private ensureStorageQuota;
    dispose(): void;
}
//# sourceMappingURL=storage-adapter.d.ts.map