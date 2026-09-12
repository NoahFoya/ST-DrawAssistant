/**
 * 本地存储服务
 * 整合 IndexedDB 本地持久化与 ImageUrlPool 临时链接引用管理。
 * 会话切换或图片删除时统一注销对应的 Object URL，避免内存泄漏。
 */

import { StoredImageRecord, IDisposable } from '../types';
import { IndexedDbStore } from './database';
import { ImageUrlPool } from './url-pool';

export class StorageService implements IDisposable {
    public readonly db: IndexedDbStore;
    public readonly urlPool: ImageUrlPool;

    constructor(options?: { releaseDelayMs?: number }) {
        this.db = new IndexedDbStore();
        this.urlPool = new ImageUrlPool(options);
    }

    /**
     * 初始化本地数据库
     */
    public async init(): Promise<void> {
        await this.db.init();
    }

    /**
     * 保存图片记录并返回图片 ID
     */
    public async saveImage(
        record: StoredImageRecord,
        options?: { deduplicate?: boolean; maxStoredImages?: number }
    ): Promise<string> {
        return await this.db.save(record, options);
    }


    /**
     * 根据资产 ID 查询单条完整图像记录
     */
    public async getImage(id: string): Promise<StoredImageRecord | null> {
        return await this.db.get(id);
    }


    /**
     * 删除图片记录，并同步释放内存中的 Object URL
     */
    public async deleteImage(id: string): Promise<boolean> {
        this.urlPool.revoke(id);
        return await this.db.delete(id);
    }


    /**
     * 清理所有未标星收藏的本地生图缓存
     */
    public async clearUnfavorited(): Promise<number> {
        const all = await this.db.list(10000, 0);
        let cleaned = 0;
        for (const record of all) {
            if (!record.isFavorite) {
                await this.deleteImage(record.id);
                cleaned++;
            }
        }
        return cleaned;
    }

    /**
     * 切换指定图片的标星收藏状态
     */
    public async toggleFavorite(id: string): Promise<boolean> {
        return await this.db.toggleFavorite(id);
    }

    /**
     * 批量删除图片记录并释放对应的 Object URL
     */
    public async deleteImages(ids: string[]): Promise<number> {
        for (const id of ids) {
            this.urlPool.revoke(id);
        }
        return await this.db.deleteImages(ids);
    }

    /**
     * 清理所有未引用的孤立图片缓存
     * 标星收藏受到保护，绝不清除。
     */
    public async cleanIsolatedImages(referencedIds: Set<string>): Promise<number> {
        const all = await this.db.list(10000, 0);
        const toDelete: string[] = [];
        for (const record of all) {
            if (!record.isFavorite && !referencedIds.has(record.id)) {
                toDelete.push(record.id);
            }
        }
        if (toDelete.length > 0) {
            return await this.deleteImages(toDelete);
        }
        return 0;
    }

    /**
     * 获取本地图库统计指标
     */
    public async getStorageStats(referencedIds: Set<string> = new Set()): Promise<{
        totalCount: number;
        favoriteCount: number;
        isolatedCount: number;
    }> {
        const all = await this.db.list(10000, 0);
        let favoriteCount = 0;
        let isolatedCount = 0;

        for (const record of all) {
            if (record.isFavorite) {
                favoriteCount++;
            } else if (!referencedIds.has(record.id)) {
                isolatedCount++;
            }
        }

        return {
            totalCount: all.length,
            favoriteCount,
            isolatedCount
        };
    }

    /**
     * 清空全部本地图库数据
     */
    public async clearAll(): Promise<void> {
        this.urlPool.revokeAll();
        await this.db.clearAll();
    }

    /**
     * 分页查询已存储的图像资产记录
     */
    public async listImages(limit = 50, offset = 0): Promise<StoredImageRecord[]> {
        return await this.db.list(limit, offset);
    }


    /** 获取本地存储中的图像总数 */
    public async count(): Promise<number> {
        return await this.db.count();
    }

    /**
     * 获取指定图片的临时访问链接 (Object URL) 并递增视图引用计数
     */
    public async getImageUrl(id: string): Promise<string | null> {
        return await this.urlPool.acquire(id, async () => {
            const record = await this.db.get(id);
            return record?.originalBlob || null;
        });
    }

    /**
     * 释放指定图片的视图引用计数
     */
    public releaseImageUrl(id: string): void {
        this.urlPool.release(id);
    }

    /**
     * 撤销当前全部活跃的临时访问链接
     */
    public revokeAllUrls(): void {
        this.urlPool.revokeAll();
    }

    public dispose(): void {
        this.urlPool.dispose();
        this.db.dispose();
    }
}
