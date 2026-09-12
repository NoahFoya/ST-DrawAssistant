/**
 * 本地持久化存储服务模块
 * 职责：基于 localforage (IndexedDB) 进行生图资产二进制 Blob 存取、
 * 双模内容哈希去重 (SHA-256 / 局域网 FNV-1a)、LRU 配额防爆淘汰与标星收藏保护。
 */

import localforage from 'localforage';
import type { StoredImageRecord } from '@types';
import { IDisposable } from '../util/event-bus';
import { DB_NAME, DB_STORE_NAME } from '../constants';

export interface PersistentStorageOptions {
    dbName?: string;
    storeName?: string;
    customForageInstance?: LocalForage;
}

export class PersistentStorage implements IDisposable {
    private readonly _db: LocalForage;
    private _isInitialized = false;
    private _isDisposed = false;

    constructor(options?: PersistentStorageOptions) {
        if (options?.customForageInstance) {
            this._db = options.customForageInstance;
        } else {
            this._db = localforage.createInstance({
                name: options?.dbName ?? DB_NAME,
                storeName: options?.storeName ?? DB_STORE_NAME,
                driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
                description: 'ST-DrawAssistant 插件出图资产与元数据持久化存储'
            });
        }
    }

    /**
     * 初始化存储数据库实例
     */
    public async init(): Promise<void> {
        if (this._isInitialized) return;
        try {
            await this._db.ready();
            this._isInitialized = true;
        } catch {
            this._isInitialized = true;
        }
    }

    /**
     * 计算图片的特征哈希值 (用于内容去重)
     * 优先使用标准 crypto.subtle 计算 SHA-256；在局域网 HTTP 非安全上下文中降级为 FNV-1a 算法，确保无 HTTPS 环境下的计算可用性。
     */
    public async calculateHash(blob: Blob): Promise<string> {
        const buffer = await blob.arrayBuffer();

        if (typeof crypto !== 'undefined' && crypto.subtle) {
            try {
                const digest = await crypto.subtle.digest('SHA-256', buffer);
                return Array.from(new Uint8Array(digest))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            } catch {
                // 运行环境 subtle 执行异常时回退降级
            }
        }

        // 局域网 HTTP / 非安全上下文 FNV-1a 降级实现
        let hash = 0x811c9dc5;
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) {
            hash ^= bytes[i];
            hash = Math.imul(hash, 0x01000193);
        }
        return `fnv_${(hash >>> 0).toString(16)}_${bytes.length}`;
    }

    /**
     * 根据内容哈希检索已存在的图片记录 (用于去重复用)
     */
    public async getImageByHash(hash: string): Promise<StoredImageRecord | null> {
        if (!hash) return null;
        await this.init();

        let found: StoredImageRecord | null = null;
        await this._db.iterate((record: StoredImageRecord) => {
            if (record && record.hash === hash) {
                found = record;
                return record; // 命中则终止遍历
            }
            return undefined;
        });

        return found;
    }

    /**
     * 持久化保存图片资产与元数据
     * @param record 待持久化的图片记录
     * @param options 可选去重配置与配额限制
     * @returns 最终持久化的唯一资产 ID (命中去重时返回已有资产 ID)
     */
    public async saveImage(
        record: StoredImageRecord,
        options?: { deduplicate?: boolean; maxStoredImages?: number }
    ): Promise<string> {
        if (this._isDisposed) {
            throw new Error('PersistentStorage 已被销毁');
        }
        await this.init();

        const shouldDedup = options?.deduplicate !== false;
        let finalId = record.id;

        if (shouldDedup && record.originalBlob) {
            const hash = await this.calculateHash(record.originalBlob);
            record.hash = hash;

            const existing = await this.getImageByHash(hash);
            if (existing && existing.id) {
                // 命中去重：更新既有记录的访问时间并复用资产 ID，避免重复写入二进制 Blob
                existing.lastAccessedAt = Date.now();
                await this._db.setItem(existing.id, existing);
                return existing.id;
            }
        }

        record.lastAccessedAt = Date.now();
        await this._db.setItem(record.id, record);

        // 配额防爆检查：仅在记录数量达到上限阈值时触发 LRU 淘汰扫描，避免每张图都进行全表扫描
        const maxImages = options?.maxStoredImages;
        if (maxImages && maxImages > 0) {
            const total = await this._db.length();
            if (total > maxImages) {
                await this.ensureStorageQuota(maxImages);
            }
        }

        return finalId;
    }

    /**
     * 读取指定 ID 的图片记录，并刷新其最近访问时间 (LRU 保活)
     */
    public async getRecord(id: string): Promise<StoredImageRecord | null> {
        if (!id || this._isDisposed) return null;
        await this.init();

        const record = await this._db.getItem<StoredImageRecord>(id);
        if (record) {
            record.lastAccessedAt = Date.now();
            await this._db.setItem(id, record);
        }
        return record || null;
    }

    /**
     * 直接获取图片的原始二进制 Blob
     */
    public async getImageBlob(id: string): Promise<Blob | null> {
        const record = await this.getRecord(id);
        return record?.originalBlob || null;
    }

    /**
     * 设置图片的标星收藏状态
     * 标星收藏资产受永久保留策略约束，在存储配额溢出清理时受保护不被淘汰。
     */
    public async setFavorite(id: string, isFavorite: boolean): Promise<boolean> {
        if (!id || this._isDisposed) return false;
        await this.init();

        const record = await this._db.getItem<StoredImageRecord>(id);
        if (!record) return false;

        record.isFavorite = Boolean(isFavorite);
        record.lastAccessedAt = Date.now();
        await this._db.setItem(id, record);
        return true;
    }

    /**
     * 删除指定资产
     */
    public async deleteImage(id: string): Promise<boolean> {
        if (!id || this._isDisposed) return false;
        await this.init();

        const exists = await this._db.getItem(id);
        if (!exists) return false;

        await this._db.removeItem(id);
        return true;
    }

    /**
     * 检查并执行存储配额淘汰
     * 策略：按 lastAccessedAt 升序淘汰最久未访问的图片，标星收藏资产受保护保留。
     * @param maxStoredImages 最大允许保留的记录数量
     * @returns 实际被淘汰清理的记录条数
     */
    public async ensureStorageQuota(maxStoredImages = 500): Promise<number> {
        if (maxStoredImages <= 0 || this._isDisposed) return 0;
        await this.init();

        const total = await this._db.length();
        if (total <= maxStoredImages) return 0;

        const candidates: { id: string; lastAccessedAt: number; isFavorite: boolean }[] = [];
        await this._db.iterate((record: StoredImageRecord) => {
            if (record && record.id) {
                candidates.push({
                    id: record.id,
                    lastAccessedAt: record.lastAccessedAt || record.metadata?.createdAt || 0,
                    isFavorite: Boolean(record.isFavorite)
                });
            }
        });

        // 仅处理未收藏项
        const unFavorites = candidates.filter(item => !item.isFavorite);
        const overLimit = total - maxStoredImages;
        if (unFavorites.length === 0 || overLimit <= 0) return 0;

        // 按最后访问时间升序排序 (最久未访问在前)
        unFavorites.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

        const deleteCount = Math.min(overLimit, unFavorites.length);
        for (let i = 0; i < deleteCount; i++) {
            await this._db.removeItem(unFavorites[i].id);
        }

        return deleteCount;
    }

    /**
     * 分页查询元数据列表 (时间倒序)
     */
    public async listRecords(limit = 50, offset = 0): Promise<StoredImageRecord[]> {
        await this.init();
        const records: StoredImageRecord[] = [];

        await this._db.iterate((record: StoredImageRecord) => {
            if (record && record.id) {
                records.push(record);
            }
        });

        // 按创建时间倒序排列
        records.sort((a, b) => (b.metadata?.createdAt || 0) - (a.metadata?.createdAt || 0));

        return records.slice(offset, offset + limit);
    }

    /**
     * 销毁实例
     */
    public dispose(): void {
        this._isDisposed = true;
    }
}
