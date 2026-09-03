/**
 * @module core/storage/storage-service
 * @description 本地存储与图片内存缓存服务
 */

import { StoredImageRecord, IDisposable } from '../types';
import { IndexedDbStore } from './database';
import { ImageUrlPool } from './url-pool';

/**
 * 图像存储统一服务
 * 封装底层的本地数据库持久化与内存访问链接管理
 */
export class StorageService implements IDisposable {
    public readonly db: IndexedDbStore;
    public readonly urlPool: ImageUrlPool;

    constructor(options?: { releaseDelayMs?: number }) {
        this.db = new IndexedDbStore();
        this.urlPool = new ImageUrlPool(options);
    }

    /** 初始化底层数据库 */
    public async init(): Promise<void> {
        await this.db.init();
    }

    /** 保存图片记录 */
    public async saveImage(record: StoredImageRecord): Promise<void> {
        await this.db.save(record);
    }

    /** 根据 ID 读取图像记录 */
    public async getImage(id: string): Promise<StoredImageRecord | null> {
        return await this.db.get(id);
    }

    /** 根据 ID 删除图片记录并释放其临时访问链接 */
    public async deleteImage(id: string): Promise<boolean> {
        this.urlPool.revoke(id);
        return await this.db.delete(id);
    }

    /** 分页列出图像记录 */
    public async listImages(limit = 50, offset = 0): Promise<StoredImageRecord[]> {
        return await this.db.list(limit, offset);
    }

    /**
     * 获取指定图片的临时访问链接 (Object URL) 并增加引用计数
     * 内部自动处理“内存命中 -> 若无则查数据库 -> 生成链接”的过程
     */
    public async getImageUrl(id: string): Promise<string | null> {
        return await this.urlPool.acquire(id, async () => {
            const record = await this.db.get(id);
            return record?.originalBlob || null;
        });
    }

    /** 释放指定图片的引用计数 */
    public releaseImageUrl(id: string): void {
        this.urlPool.release(id);
    }

    /** 撤销全部活跃的临时访问链接 */
    public revokeAllUrls(): void {
        this.urlPool.revokeAll();
    }

    public dispose(): void {
        this.urlPool.dispose();
        this.db.dispose();
    }
}
