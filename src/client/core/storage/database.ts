/**
 * @module core/storage/database
 * @description 基于 IndexedDB 的生图资产持久化存储服务
 */

import localforage from 'localforage';
import { StoredImageRecord, IDisposable } from '../types';
import { Logger } from '../logger';
import { DB_NAME, DB_STORE_NAME } from '../constants';

/**
 * 本地图片与元数据持久化存储
 */
export class IndexedDbStore implements IDisposable {
    private readonly _db: LocalForage;
    private readonly _logger = new Logger('IndexedDbStore');
    private _isInitialized = false;

    constructor() {
        this._db = localforage.createInstance({
            name: DB_NAME,
            storeName: DB_STORE_NAME,
            driver: localforage.INDEXEDDB,
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
     *
     * 说明：
     * 1. 优先使用标准 crypto.subtle 计算 SHA-256 哈希；
     * 2. 在局域网非 HTTPS 环境下，浏览器出于安全限制不暴露 crypto.subtle，
     *    自动降级为 FNV-1a 哈希算法，确保图片去重功能在局域网内依然可用。
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
            // 局域网非 HTTPS 环境下的降级哈希
            let hash = 0x811c9dc5;
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.length; i++) {
                hash ^= bytes[i];
                hash = Math.imul(hash, 0x01000193);
            }
            return `fnv_${(hash >>> 0).toString(16)}_${bytes.length}`;
        } catch {
            return `blob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
    }

    /**
     * 根据图片哈希检索已存在的图片记录 (用于去重复用)
     *
     * @param hash 图片内容哈希
     * @returns 已存在的图片记录或 null
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
     * 确保存储图片数量在限制范围内
     *
     * 说明：
     * 1. 保护收藏图片：已收藏的图片（isFavorite 为 true）绝不会被自动清理；
     * 2. 优先清理旧图：按最近访问时间升序排序，优先删除最久未使用的未收藏图片；
     * 3. 释放空间：总数量达到上限时，至少清理出 1 张空间以存放新图片。
     *
     * @param maxStoredImages 最大允许保存的图片数量，<= 0 表示不限制
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

        // 仅淘汰未收藏的项目，按最近访问时间升序排序（最旧的排前面）
        const candidates = items
            .filter(item => !item.isFavorite)
            .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

        const deleteCount = Math.max(0, total - maxStoredImages + 1);
        const toDelete = candidates.slice(0, deleteCount);

        for (const item of toDelete) {
            await this._db.removeItem(item.id);
            this._logger.info(`存储达到上限 (${maxStoredImages})，已自动清理历史记录: ${item.id}`);
        }
    }

    /** 保存图片记录 (支持可选的去重与容量配额检查) */
    public async save(
        record: StoredImageRecord,
        options?: { deduplicate?: boolean; maxStoredImages?: number }
    ): Promise<string> {
        await this.init();

        const shouldDeduplicate = options?.deduplicate !== false;
        const maxStored = options?.maxStoredImages ?? 0;

        // 1. 哈希去重检查
        let finalHash = record.hash;
        if (!finalHash && shouldDeduplicate && record.originalBlob) {
            finalHash = await this.calculateHash(record.originalBlob);
        }

        if (finalHash && shouldDeduplicate) {
            const existing = await this.getImageByHash(finalHash);
            if (existing) {
                existing.lastAccessedAt = Date.now();
                await this._db.setItem(existing.id, existing);
                this._logger.info(`命中图片哈希去重 (${finalHash.slice(0, 8)}...)，复用已有资产: ${existing.id}`);
                return existing.id;
            }
        }

        // 2. 容量配额检查
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
     *
     * 先收集时间与 ID 进行分页，再按需读取对应页的图片数据，
     * 避免在内存中一次性加载所有大图导致浏览器内存溢出。
     *
     * @param limit 每页记录数
     * @param offset 起始位置
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

    public dispose(): void {
        this._isInitialized = false;
    }
}
