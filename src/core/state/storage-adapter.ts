/**
 * @module core/state/storage-adapter
 * @description IndexedDB 持久化适配器 (支持 SHA-256 内容寻址去重、LRU 水位熔断与 Storage Quota 保护)
 */

import { IDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';
import { DB_NAME } from '../constants';

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
    saveImage(record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & { hash?: string }): Promise<string>;
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

export class IndexedDBStorageAdapter implements IStorageAdapter {
    private static readonly DB_NAME = DB_NAME;
    private static readonly DB_VERSION = 2;
    private static readonly STORE_IMAGES = 'images';

    private _db: IDBDatabase | null = null;
    private _isInitialized = false;
    private readonly _logger = new Logger('IndexedDBStorage');
    private readonly _memoryStore = new Map<string, StoredImageRecord>();

    public async init(): Promise<void> {
        if (this._isInitialized) return;

        if (typeof indexedDB === 'undefined') {
            this._logger.warn('当前运行环境不支持 IndexedDB，降级为内存存储');
            this._isInitialized = true;
            return;
        }

        return new Promise<void>((resolve) => {
            const request = indexedDB.open(IndexedDBStorageAdapter.DB_NAME, IndexedDBStorageAdapter.DB_VERSION);

            request.onerror = () => {
                this._logger.error('打开 IndexedDB 数据库失败', request.error);
                this._isInitialized = true;
                resolve();
            };

            request.onsuccess = () => {
                this._db = request.result;
                this._isInitialized = true;
                this._logger.info('IndexedDB 存储层初始化就绪');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(IndexedDBStorageAdapter.STORE_IMAGES)) {
                    const store = db.createObjectStore(IndexedDBStorageAdapter.STORE_IMAGES, { keyPath: 'id' });
                    store.createIndex('hash', 'hash', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
                }
            };
        });
    }

    public async calculateHash(data: string | Blob): Promise<string> {
        try {
            if (typeof crypto !== 'undefined' && crypto.subtle) {
                let buffer: ArrayBuffer;
                if (typeof data === 'string') {
                    buffer = new TextEncoder().encode(data).buffer;
                } else {
                    buffer = await data.arrayBuffer();
                }
                const digest = await crypto.subtle.digest('SHA-256', buffer);
                return Array.from(new Uint8Array(digest))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');
            }
        } catch {
            // fallback
        }
        let hash = 0;
        const str = typeof data === 'string' ? data : 'blob_hash';
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return `hash_${Math.abs(hash).toString(16)}`;
    }

    public async saveImage(
        record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & { hash?: string }
    ): Promise<string> {
        await this.init();

        const hash = record.hash || (await this.calculateHash(record.data));

        // 1. 内容寻址去重：若已存在相同 SHA-256 哈希，直接更新访问时间并复用已有 ID
        const existing = await this.getImageByHash(hash);
        if (existing) {
            existing.lastAccessedAt = Date.now();
            await this.updateRecord(existing);
            this._logger.info(`命中 SHA-256 去重索引 (${hash.substring(0, 8)}...)，复用已有图片记录: ${existing.id}`);
            return existing.id;
        }

        // 2. LRU 容量熔断检查
        await this.ensureStorageQuota();

        const fullRecord: StoredImageRecord = {
            ...record,
            hash,
            timestamp: Date.now(),
            lastAccessedAt: Date.now(),
            isFavorite: record.isFavorite ?? false
        };

        if (!this._db) {
            this._memoryStore.set(fullRecord.id, fullRecord);
            return fullRecord.id;
        }

        return new Promise<string>((resolve, reject) => {
            const tx = this._db!.transaction(IndexedDBStorageAdapter.STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(IndexedDBStorageAdapter.STORE_IMAGES);
            const req = store.put(fullRecord);

            req.onsuccess = () => resolve(fullRecord.id);
            req.onerror = () => reject(req.error);
        });
    }

    public async getImage(id: string): Promise<StoredImageRecord | null> {
        await this.init();
        if (!this._db) {
            return this._memoryStore.get(id) || null;
        }

        return new Promise<StoredImageRecord | null>((resolve) => {
            const tx = this._db!.transaction(IndexedDBStorageAdapter.STORE_IMAGES, 'readonly');
            const store = tx.objectStore(IndexedDBStorageAdapter.STORE_IMAGES);
            const req = store.get(id);

            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    public async getImageByHash(hash: string): Promise<StoredImageRecord | null> {
        await this.init();
        if (!this._db) {
            for (const item of this._memoryStore.values()) {
                if (item.hash === hash) return item;
            }
            return null;
        }

        return new Promise<StoredImageRecord | null>((resolve) => {
            const tx = this._db!.transaction(IndexedDBStorageAdapter.STORE_IMAGES, 'readonly');
            const store = tx.objectStore(IndexedDBStorageAdapter.STORE_IMAGES);
            const index = store.index('hash');
            const req = index.get(hash);

            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    public async getAllImages(): Promise<StoredImageRecord[]> {
        await this.init();
        if (!this._db) {
            return Array.from(this._memoryStore.values()).sort((a, b) => b.timestamp - a.timestamp);
        }

        return new Promise<StoredImageRecord[]>((resolve) => {
            const tx = this._db!.transaction(IndexedDBStorageAdapter.STORE_IMAGES, 'readonly');
            const store = tx.objectStore(IndexedDBStorageAdapter.STORE_IMAGES);
            const req = store.getAll();

            req.onsuccess = () => {
                const list = (req.result || []) as StoredImageRecord[];
                list.sort((a, b) => b.timestamp - a.timestamp);
                resolve(list);
            };
            req.onerror = () => resolve([]);
        });
    }

    public async deleteImage(id: string): Promise<void> {
        await this.init();
        if (!this._db) {
            this._memoryStore.delete(id);
            return;
        }

        return new Promise<void>((resolve) => {
            const tx = this._db!.transaction(IndexedDBStorageAdapter.STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(IndexedDBStorageAdapter.STORE_IMAGES);
            const req = store.delete(id);

            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        });
    }

    public async toggleFavorite(id: string): Promise<boolean> {
        const item = await this.getImage(id);
        if (!item) return false;
        item.isFavorite = !item.isFavorite;
        await this.updateRecord(item);
        return item.isFavorite;
    }

    private async updateRecord(record: StoredImageRecord): Promise<void> {
        if (!this._db) {
            this._memoryStore.set(record.id, record);
            return;
        }

        return new Promise<void>((resolve) => {
            const tx = this._db!.transaction(IndexedDBStorageAdapter.STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(IndexedDBStorageAdapter.STORE_IMAGES);
            const req = store.put(record);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        });
    }

    private async ensureStorageQuota(): Promise<void> {
        let shouldEvict = false;
        try {
            if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
                const estimate = await navigator.storage.estimate();
                if (estimate.usage && estimate.quota) {
                    const ratio = estimate.usage / estimate.quota;
                    if (ratio > 0.9) {
                        shouldEvict = true;
                        this._logger.warn(`Storage Quota 使用率达 ${(ratio * 100).toFixed(1)}%，触发 LRU 自动淘汰`);
                    }
                }
            }
        } catch {
            // ignore
        }

        if (!shouldEvict) return;

        const all = await this.getAllImages();
        const evictable = all.filter((img) => !img.isFavorite);
        evictable.sort((a, b) => (a.lastAccessedAt || a.timestamp) - (b.lastAccessedAt || b.timestamp));

        const evictCount = Math.min(20, evictable.length);
        for (let i = 0; i < evictCount; i++) {
            await this.deleteImage(evictable[i].id);
        }
        this._logger.info(`LRU 熔断已淘汰 ${evictCount} 张非收藏历史图片`);
    }

    public dispose(): void {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
        this._memoryStore.clear();
        this._isInitialized = false;
    }
}
