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
import { Logger } from '../diagnostics/logger';
import { DB_NAME } from '../constants';

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
export async function createThumbnail(
    blob: Blob,
    maxWidth = 256,
    maxHeight = 256
): Promise<Blob> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return blob;
    }
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        let isSettled = false;

        const cleanupAndResolve = (resultBlob: Blob) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                URL.revokeObjectURL(url);
                resolve(resultBlob);
            }
        };

        const timer = setTimeout(() => {
            cleanupAndResolve(blob);
        }, 5000);

        img.onload = () => {
            try {
                let width = img.naturalWidth || img.width || 256;
                let height = img.naturalHeight || img.height || 256;
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, width);
                canvas.height = Math.max(1, height);
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(
                        (thumbBlob) => {
                            cleanupAndResolve(thumbBlob || blob);
                        },
                        'image/webp',
                        0.85
                    );
                    return;
                }
            } catch {
                // 绘制异常降级返回原图
            }
            cleanupAndResolve(blob);
        };

        img.onerror = () => {
            cleanupAndResolve(blob);
        };

        img.src = url;
    });
}


/**
 * 图像本地持久化存储适配器接口
 */
export interface IStorageAdapter extends IDisposable {
    /** 初始化数据库连接与 ObjectStore 迁移 */
    init(): Promise<void>;
    /** 保存图像记录并返回生成的或指定的 UUID */
    saveImage(record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & { hash?: string }, maxStoredImages?: number): Promise<string>;
    /** 根据 UUID 获取单张图像数据快照 */
    getImage(id: string): Promise<StoredImageRecord | null>;
    /** 根据内容哈希检索已存在的去重图像 */
    getImageByHash(hash: string): Promise<StoredImageRecord | null>;
    /** 获取本地图库所有图像列表 (按时间降序排列) */
    getAllImages(): Promise<StoredImageRecord[]>;
    /** 根据 UUID 删除指定图像记录 */
    deleteImage(id: string): Promise<void>;
    /** 批量删除指定 ID 列表的图像记录 */
    deleteImages(ids: string[]): Promise<number>;
    /** 切换图像的收藏状态 (Star) */
    toggleFavorite(id: string): Promise<boolean>;
    /** 清空所有存储的图像记录 */
    clear(): Promise<void>;
    /** 清理指定天数之前的非收藏历史图片并返回清理数量 */
    cleanOldImages(retentionDays: number): Promise<number>;
    /** 清理所有非收藏历史图片并返回清理数量 */
    cleanNonFavorites(): Promise<number>;
    /** 清理未被当前引用的非收藏孤立图片并返回清理数量 */
    cleanIsolatedImages(referencedIds: Set<string>): Promise<number>;
    /** 获取图库统计指标（总数、收藏数、孤立数） */
    getStorageStats(referencedIds?: Set<string>): Promise<{ totalCount: number; favoriteCount: number; isolatedCount: number }>;
    /** 计算图像二进制数据或 Base64 的 SHA-256 哈希值 */
    calculateHash(data: string | Blob | ArrayBuffer): Promise<string>;
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

    /**
     * 计算图像数据的确定性内容哈希 (用于存储去重)
     * 
     * 机制说明：
     * 1. 优先使用标准 WebCrypto API 计算 SHA-256 摘要；
     * 2. 在非安全上下文 (如 HTTP 环境) 或单测 Mock 环境中，平滑回退到确定性的 FNV-1a 32位二进制哈希算法，
     *    避免退化为常数哈希导致不同图片被错误去重覆盖。
     */
    public async calculateHash(data: string | Blob | ArrayBuffer): Promise<string> {
        let binaryBuffer: Uint8Array;

        try {
            if (data instanceof ArrayBuffer) {
                binaryBuffer = new Uint8Array(data);
            } else if (data instanceof Blob) {
                const ab = await data.arrayBuffer();
                binaryBuffer = new Uint8Array(ab);
            } else if (typeof data === 'string') {
                if (data.startsWith('data:')) {
                    const commaIdx = data.indexOf(',');
                    const b64 = commaIdx >= 0 ? data.slice(commaIdx + 1) : data;
                    const binStr = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
                    binaryBuffer = new Uint8Array(binStr.length);
                    for (let i = 0; i < binStr.length; i++) {
                        binaryBuffer[i] = binStr.charCodeAt(i);
                    }
                } else {
                    binaryBuffer = new TextEncoder().encode(data);
                }
            } else {
                binaryBuffer = new Uint8Array(0);
            }

            if (typeof crypto !== 'undefined' && crypto.subtle) {
                const digest = await crypto.subtle.digest('SHA-256', binaryBuffer.buffer as ArrayBuffer);
                return Array.from(new Uint8Array(digest))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');
            }
        } catch {
            binaryBuffer = new Uint8Array(0);
        }

        // 确定性纯二进制 FNV-1a 32位哈希回退 (防止非安全环境或无 WebCrypto 时退化为常数哈希)
        let fnv = 0x811c9dc5;
        for (let i = 0; i < binaryBuffer.length; i++) {
            fnv ^= binaryBuffer[i];
            fnv = Math.imul(fnv, 0x01000193);
        }
        return `fnv_${(fnv >>> 0).toString(16).padStart(8, '0')}_len_${binaryBuffer.length}`;
    }


    public async saveImage(
        record: Omit<StoredImageRecord, 'hash' | 'timestamp'> & { hash?: string },
        maxStoredImages?: number
    ): Promise<string> {
        await this.init();

        const hash = record.hash || (await this.calculateHash(record.data));

        // 1. 哈希去重：若已存在相同哈希的图片记录，更新访问时间并复用已有 ID
        const existing = await this.getImageByHash(hash);
        if (existing) {
            existing.lastAccessedAt = Date.now();
            await this.updateRecord(existing);
            this._logger.info(`命中图片哈希去重 (${hash.substring(0, 8)}...)，复用已有图片记录: ${existing.id}`);
            return existing.id;
        }

        // 2. 检查存储配额并在需要时执行 LRU 自动容量清理
        await this.ensureStorageQuota(maxStoredImages);

        // 3. 若未附带缩略图且数据为 Blob，自动异步生成 256x256 缩略图
        let thumbnailData = record.thumbnailData;
        if (!thumbnailData && record.data instanceof Blob) {
            try {
                thumbnailData = await createThumbnail(record.data, 256, 256);
            } catch {
                // fallback
            }
        }

        const fullRecord: StoredImageRecord = {
            ...record,
            thumbnailData,
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

    public async clear(): Promise<void> {
        await this.init();
        this._memoryStore.clear();
        if (!this._db) return;

        return new Promise<void>((resolve) => {
            const tx = this._db!.transaction(IndexedDBStorageAdapter.STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(IndexedDBStorageAdapter.STORE_IMAGES);
            const req = store.clear();
            req.onsuccess = () => {
                this._logger.info('已成功清空 IndexedDB 中的全部图像缓存');
                resolve();
            };
            req.onerror = () => resolve();
        });
    }

    /**
     * 清理指定保留天数之前的非收藏历史图片
     *
     * @param retentionDays 保留天数 (例如 7, 30, 90；<= 0 表示不执行基于时间的清理)
     * @returns 实际清理删除的图片数量
     */
    public async cleanOldImages(retentionDays: number): Promise<number> {
        if (!retentionDays || retentionDays <= 0) return 0;
        await this.init();

        const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const all = await this.getAllImages();
        const toDelete = all.filter((img) => !img.isFavorite && (img.timestamp < cutoffTime || (img.lastAccessedAt && img.lastAccessedAt < cutoffTime)));

        for (const img of toDelete) {
            await this.deleteImage(img.id);
        }

        if (toDelete.length > 0) {
            this._logger.info(`已按过期淘汰策略清理 ${toDelete.length} 张 ${retentionDays} 天前的历史图片`);
        }

        return toDelete.length;
    }

    /**
     * 批量删除指定 ID 的图像记录
     */
    public async deleteImages(ids: string[]): Promise<number> {
        if (!ids || ids.length === 0) return 0;
        await this.init();
        let deleted = 0;
        for (const id of ids) {
            try {
                await this.deleteImage(id);
                deleted++;
            } catch {
                // 忽略单张删除失败
            }
        }
        return deleted;
    }

    /**
     * 清理所有未标星收藏的历史图片缓存
     */
    public async cleanNonFavorites(): Promise<number> {
        await this.init();
        const all = await this.getAllImages();
        const toDelete = all.filter((img) => !img.isFavorite);
        for (const img of toDelete) {
            await this.deleteImage(img.id);
        }
        if (toDelete.length > 0) {
            this._logger.info(`已清空全部非收藏历史图片缓存，共释放 ${toDelete.length} 张图片`);
        }
        return toDelete.length;
    }

    /**
     * 清理未被当前引用的非收藏孤立历史图片
     */
    public async cleanIsolatedImages(referencedIds: Set<string>): Promise<number> {
        await this.init();
        const all = await this.getAllImages();
        const toDelete = all.filter((img) => !img.isFavorite && !referencedIds.has(img.id));
        for (const img of toDelete) {
            await this.deleteImage(img.id);
        }
        if (toDelete.length > 0) {
            this._logger.info(`已清理未引用的孤立历史图片，共清理 ${toDelete.length} 张图片`);
        }
        return toDelete.length;
    }

    /**
     * 获取图库统计指标
     */
    public async getStorageStats(referencedIds?: Set<string>): Promise<{ totalCount: number; favoriteCount: number; isolatedCount: number }> {
        await this.init();
        const all = await this.getAllImages();
        const totalCount = all.length;
        let favoriteCount = 0;
        let isolatedCount = 0;

        for (const img of all) {
            if (img.isFavorite) {
                favoriteCount++;
            } else if (referencedIds && !referencedIds.has(img.id)) {
                isolatedCount++;
            }
        }

        return { totalCount, favoriteCount, isolatedCount };
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

    /**
     * 自动执行存储配额检查与淘汰清理 (LRU 策略)
     *
     * 保护与淘汰规则：
     * 1. 保护收藏图片：严格过滤排除 isFavorite 为 true 的图片记录，防止珍贵生图被系统误删；
     * 2. 按访问时间排序：优先淘汰最早生成或最久未被点击查看的历史图片；
     * 3. 双重触发条件：当图片总数达到 maxStoredImages 上限，或浏览器存储配额使用率超过 90% 时触发。
     */
    private async ensureStorageQuota(maxStoredImages?: number): Promise<void> {
        let shouldEvict = false;
        let evictCount = 0;

        const all = await this.getAllImages();
        const evictable = all.filter((img) => !img.isFavorite);
        evictable.sort((a, b) => (a.lastAccessedAt || a.timestamp) - (b.lastAccessedAt || b.timestamp));

        // 1. 检查用户配置的最大图片数量上限 (maxStoredImages)
        if (typeof maxStoredImages === 'number' && maxStoredImages > 0 && all.length >= maxStoredImages) {
            shouldEvict = true;
            evictCount = Math.max(1, all.length - maxStoredImages + 1);
        }

        // 2. 检查浏览器 Storage Quota 使用比例 (ratio > 0.9)
        try {
            if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
                const estimate = await navigator.storage.estimate();
                if (estimate.usage && estimate.quota) {
                    const ratio = estimate.usage / estimate.quota;
                    if (ratio > 0.9) {
                        shouldEvict = true;
                        evictCount = Math.max(evictCount, 20);
                        this._logger.warn(`存储配额使用率达 ${(ratio * 100).toFixed(1)}%，触发 LRU 自动清理`);
                    }
                }
            }
        } catch {
            // 忽略配额查询异常
        }

        if (!shouldEvict || evictCount <= 0 || evictable.length === 0) return;

        const count = Math.min(evictCount, evictable.length);
        for (let i = 0; i < count; i++) {
            await this.deleteImage(evictable[i].id);
        }
        this._logger.info(`存储配额保护已自动清理 ${count} 张非收藏历史图片`);
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
