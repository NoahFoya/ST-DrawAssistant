/**
 * @module core/storage/storage-service
 * @description 本地存储与图片内存缓存服务
 */

import { StoredImageRecord, IDisposable } from '../types';
import { IndexedDbStore } from './database';
import { ImageUrlPool } from './url-pool';

/**
 * 图像存储服务
 *
 * 职责：
 * 1. 整合本地数据库（IndexedDB）与图片临时链接（Object URL）的管理；
 * 2. 图片删除或切换会话时，撤销对应的 Object URL，避免内存泄漏；
 * 3. 图片数据保存在本地数据库，页面显示所用的链接由 ImageUrlPool 管理与复用。
 */
export class StorageService implements IDisposable {
    public readonly db: IndexedDbStore;
    public readonly urlPool: ImageUrlPool;

    constructor(options?: { releaseDelayMs?: number }) {
        this.db = new IndexedDbStore();
        this.urlPool = new ImageUrlPool(options);
    }

    /**
     * 初始化本地数据库
     * 若未手动调用，初次读写时会自动初始化
     */
    public async init(): Promise<void> {
        await this.db.init();
    }

    /**
     * 保存图片记录并返回图片 ID
     *
     * @param record 待存储的图像与元数据记录
     * @param options 存储选项
     * @param options.deduplicate 是否启用 SHA-256 哈希去重 (命中时复用已有图片并更新访问时间)
     * @param options.maxStoredImages 存储数量上限 (超出时按最近访问时间清理未收藏的历史图片)
     * @returns 图片 ID (若去重命中则返回已有图片的 ID)
     */
    public async saveImage(
        record: StoredImageRecord,
        options?: { deduplicate?: boolean; maxStoredImages?: number }
    ): Promise<string> {
        return await this.db.save(record, options);
    }

    /** 保存图片记录便捷别名 */
    public async save(
        record: StoredImageRecord,
        options?: { deduplicate?: boolean; maxStoredImages?: number }
    ): Promise<string> {
        return await this.saveImage(record, options);
    }

    /**
     * 根据资产 ID 查询单条完整图像记录
     *
     * @param id 资产唯一标识 (UUID/assetId)
     * @returns 图像记录对象，若不存在则返回 null
     */
    public async getImage(id: string): Promise<StoredImageRecord | null> {
        return await this.db.get(id);
    }

    /** 查询单条图像记录便捷别名 */
    public async get(id: string): Promise<StoredImageRecord | null> {
        return await this.getImage(id);
    }

    /**
     * 删除图片记录，并同步释放内存中的 Object URL
     * 先撤销内存链接，再从数据库删除，避免界面继续引用失效的链接
     *
     * @param id 图片 ID
     * @returns 是否成功从数据库删除
     */
    public async deleteImage(id: string): Promise<boolean> {
        this.urlPool.revoke(id);
        return await this.db.delete(id);
    }

    /** 删除图片记录便捷别名 */
    public async delete(id: string): Promise<boolean> {
        return await this.deleteImage(id);
    }

    /**
     * 分页查询已存储的图像资产记录
     *
     * @param limit 单页最大返回条数，默认 50
     * @param offset 分页偏移量，默认 0
     */
    public async listImages(limit = 50, offset = 0): Promise<StoredImageRecord[]> {
        return await this.db.list(limit, offset);
    }

    /** 获取所有或分页图像记录便捷别名 */
    public async getAll(limit = 100, offset = 0): Promise<StoredImageRecord[]> {
        return await this.listImages(limit, offset);
    }

    /** 获取本地存储中的图像总数 */
    public async count(): Promise<number> {
        return await this.db.count();
    }

    /**
     * 获取指定图片的临时访问链接 (Object URL) 并自动递增视图引用计数
     *
     * 处理步骤：
     * 1. 优先检查 ImageUrlPool 内存缓存，若命中且有效则直接复用；
     * 2. 若当前正处于加载中，则复用该 Promise，避免列表滚动时对同一图片重复查询数据库；
     * 3. 若未命中则从 IndexedDB 读取 Blob 并生成 Object URL 加入引用池。
     *
     * @param id 图片资产 ID
     * @returns 可供 <img> 或 CSS 渲染的临时 URL 字符串，若资产不存在则返回 null
     */
    public async getImageUrl(id: string): Promise<string | null> {
        return await this.urlPool.acquire(id, async () => {
            const record = await this.db.get(id);
            return record?.originalBlob || null;
        });
    }

    /**
     * 释放指定图片的视图引用计数
     * 计数归零后延迟释放，如果在延迟时间内再次被引用则取消释放，避免画廊往返滚动闪烁
     *
     * @param id 图片资产 ID
     */
    public releaseImageUrl(id: string): void {
        this.urlPool.release(id);
    }

    /**
     * 撤销当前池中全部活跃的临时访问链接并释放其内存占用
     * 通常在酒馆切换会话 (chat:changed) 或扩展上下文卸载时调用
     */
    public revokeAllUrls(): void {
        this.urlPool.revokeAll();
    }

    /**
     * 释放存储服务持有的全部资源
     */
    public dispose(): void {
        this.urlPool.dispose();
        this.db.dispose();
    }
}
