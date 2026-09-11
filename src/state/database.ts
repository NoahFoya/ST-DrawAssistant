/**
 * 基于 IndexedDB 的生图资产本地持久化存储
 * 负责二进制图片存取、哈希索引去重与存储上限管理
 */

import localforage from 'localforage';
import { StoredImageRecord, IDisposable } from '../types';
import { Logger } from '../utils/logger';
import { DB_NAME, DB_STORE_NAME } from '../constants';

export class IndexedDbStore implements IDisposable {
    private readonly _db: LocalForage;
    private readonly _logger = new Logger('IndexedDbStore');
    private _isInitialized = false;

    constructor() {
        this._db = localforage.createInstance({
            name: DB_NAME,
            storeName: DB_STORE_NAME,
            driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
            description: 'ST-DrawAssistant 生图资产与元数据持久化存储'
        });
    }

    /** 初始化数据库实例 */
    public async init(): Promise<void> {
        if (this._isInitialized) return;
        try {
            await this._db.ready();
            this._isInitialized = true;
            this._logger.info('IndexedDB 本地存储已就绪');
        } catch (err) {
            this._logger.error('初始化 IndexedDB 失败', err);
            throw err;
        }
    }

    /**
     * 计算图片的哈希值 (用于图片去重)
     * 优先使用标准 crypto.subtle 计算 SHA-256。
     * 在局域网非安全上下文 (HTTP) 环境下，浏览器不暴露 crypto.subtle，
     * 降级为 FNV-1a 哈希算法，确保局域网部署环境下图片去重依然可用。
     */
    public async calculateHash(blob: Blob): Promise<string> {
        try {
            const buffer = await blob.arrayBuffer();
            if (typeof crypto !== 'undefined' && crypto.subtle) {
                const digest = await crypto.subtle.digest('SHA-256', buffer);
                return Array.from(new Uint8Array(digest))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            }
            let hash = 0x811c9dc5;
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.length; i++) {
                hash ^= bytes[i];
                hash = Math.imul(hash, 0x01000193);
            }
            return `fnv_${(hash >>> 0).toString(16)}_${bytes.length}`;
        } catch (err) {
            this._logger.error('计算图像哈希失败，数据可能已损坏或读取被终止', err);
            throw err;
        }
    }

    /**
     * 根据图片哈希检索已存在的图片记录 (用于去重复用)
     */
    public async getImageByHash(hash: string): Promise<StoredImageRecord | null> {
        if (!hash) return null;
        await this.init();
        let found: StoredImageRecord | null = null;
        await this._db.iterate((record: StoredImageRecord) => {
            if (record && record.hash === hash) {
                found = record;
                return record;
            }
            return undefined;
        });
        return found;
    }

    /**
     * 检查并确保本地图片记录数量处于配额上限内
     * 采用 LRU 策略淘汰最久未访问的未收藏图片，已收藏的图片受保护不被清理。
     */
    public async ensureStorageQuota(maxStoredImages = 500): Promise<void> {
        if (maxStoredImages <= 0) return;
        await this.init();
        const total = await this._db.length();
        if (total < maxStoredImages) return;

        const items: { id: string; lastAccessedAt: number; isFavorite: boolean }[] = [];
        await this._db.iterate((record: StoredImageRecord) => {
            if (record && record.id) {
                items.push({
                    id: record.id,
                    lastAccessedAt: record.lastAccessedAt || record.metadata?.createdAt || 0,
                    isFavorite: Boolean(record.isFavorite)
                });
            }
            return undefined;
        });

        const candidates = items
            .filter(item => !item.isFavorite)
            .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

        // 预留额外 1 个槽位，避免临界值频繁触发全表遍历
        const deleteCount = Math.max(0, total - maxStoredImages + 1);
        const toDelete = candidates.slice(0, deleteCount);

        for (const item of toDelete) {
            await this._db.removeItem(item.id);
            this._logger.info(`达到存储配额上限 (${maxStoredImages})，已清理旧记录: ${item.id}`);
        }
    }

    /** 保存图片记录 */
    public async save(
        record: StoredImageRecord,
        options?: { deduplicate?: boolean; maxStoredImages?: number }
    ): Promise<string> {
        await this.init();

        const shouldDeduplicate = options?.deduplicate !== false;
        const maxStored = options?.maxStoredImages ?? 0;

        let finalHash = record.hash;
        if (!finalHash && shouldDeduplicate && record.originalBlob) {
            try {
                finalHash = await this.calculateHash(record.originalBlob);
            } catch (hashErr) {
                this._logger.warn('图片哈希计算失败，本次跳过去重检索', hashErr);
            }
        }

        if (finalHash && shouldDeduplicate) {
            const existing = await this.getImageByHash(finalHash);
            if (existing) {
                existing.lastAccessedAt = Date.now();
                await this._db.setItem(existing.id, existing);
                this._logger.info(`图片哈希去重命中 (${finalHash.slice(0, 8)}...)，复用已有资产: ${existing.id}`);
                return existing.id;
            }
        }

        if (maxStored > 0) {
            await this.ensureStorageQuota(maxStored);
        }

        const toSave: StoredImageRecord = {
            ...record,
            hash: finalHash,
            lastAccessedAt: Date.now()
        };

        await this._db.setItem(toSave.id, toSave);
        return toSave.id;
    }

    /** 根据 ID 获取图像记录 */
    public async get(id: string): Promise<StoredImageRecord | null> {
        await this.init();
        return await this._db.getItem<StoredImageRecord>(id);
    }

    /** 根据 ID 删除图像记录 */
    public async delete(id: string): Promise<boolean> {
        await this.init();
        await this._db.removeItem(id);
        return true;
    }

    /**
     * 按创建时间倒序分页获取图片记录
     */
    public async list(limit = 50, offset = 0): Promise<StoredImageRecord[]> {
        await this.init();

        const indexList: { id: string; createdAt: number }[] = [];
        await this._db.iterate((value: StoredImageRecord) => {
            if (value && value.id) {
                indexList.push({
                    id: value.id,
                    createdAt: value.metadata?.createdAt || 0
                });
            }
        });

        indexList.sort((a, b) => b.createdAt - a.createdAt);
        const pagedIndexes = indexList.slice(offset, offset + limit);

        const records = await Promise.all(
            pagedIndexes.map(async (item) => {
                return await this._db.getItem<StoredImageRecord>(item.id);
            })
        );

        return records.filter((r): r is StoredImageRecord => r !== null);
    }

    /** 获取记录总数 */
    public async count(): Promise<number> {
        await this.init();
        return await this._db.length();
    }

    /**
     * 切换指定图片的标星收藏状态
     */
    public async toggleFavorite(id: string): Promise<boolean> {
        await this.init();
        const record = await this._db.getItem<StoredImageRecord>(id);
        if (!record) return false;

        record.isFavorite = !record.isFavorite;
        record.lastAccessedAt = Date.now();
        await this._db.setItem(id, record);
        return record.isFavorite;
    }

    /**
     * 批量删除图片记录
     */
    public async deleteImages(ids: string[]): Promise<number> {
        await this.init();
        let deleted = 0;
        for (const id of ids) {
            try {
                await this._db.removeItem(id);
                deleted++;
            } catch (err) {
                this._logger.warn(`删除图片记录失败: ${id}`, err);
            }
        }
        return deleted;
    }

    /** 清空本地全部图片记录 */
    public async clearAll(): Promise<void> {
        await this.init();
        await this._db.clear();
        this._logger.info('已清空本地数据库全部图片记录');
    }

    public dispose(): void {
        this._isInitialized = false;
    }
}
