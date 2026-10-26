/**
 * 本地 IndexedDB 图像资产存储服务 (ImageStorage)。
 *
 * @remarks
 * 图像资产持久化存储实现：
 * 1. 分表存储：
 *    - metadata 表：存储轻量索引记录（imageId、taskId、chatId、status、byteSize、prompt 等）；
 *    - blobs 表：存储原始高清图片二进制（Blob）；
 *    - 列表查询与筛选仅反序列化 metadata，避免非必要二进制加载；
 * 2. 状态写入：
 *    - 开始任务时调用 saveImageMeta 写入 generating 状态占位；
 *    - 生成完成后调用 finalizeImage 写入 Blob 并将元数据状态更新为 ready；
 * 3. 存储配额：配合 navigator.storage.estimate 查询浏览器存储使用情况。
 */

import localforage from 'localforage';
import type { ImageStorageService, StoredImageRecord, ImageQueryOptions } from '@types';
import { logger } from '../util/logger';

/** 浏览器存储配额统计估值 */
export interface StorageEstimateInfo {
    /** 已用存储空间，单位字节 */
    readonly usageBytes: number;
    /** 总配额上限，单位字节 */
    readonly quotaBytes: number;
    /** 配额占用百分比，范围 0 到 100 */
    readonly usagePercent: number;
}

/**
 * 图像资产持久化存储服务实现类。
 */
export class ImageStorage implements ImageStorageService {
    private readonly _metaStore: LocalForage;
    private readonly _blobStore: LocalForage;

    public constructor() {
        this._metaStore = localforage.createInstance({
            name: 'st_draw_assistant_images',
            storeName: 'metadata',
            description: 'ST-DrawAssistant 图像元数据索引表',
        });

        this._blobStore = localforage.createInstance({
            name: 'st_draw_assistant_images',
            storeName: 'blobs',
            description: 'ST-DrawAssistant 图像二进制原始数据表',
        });
    }

    /**
     * 将图像元数据与二进制 Blob 保存至本地数据库。
     *
     * @remarks
     * 元数据与二进制数据分表存储，避免列表检索时读取二进制数据。
     * @param record 图像元数据资产记录
     * @param blob 图像二进制数据
     */
    public async saveImage(record: StoredImageRecord, blob: Blob): Promise<void> {
        await Promise.all([
            this._metaStore.setItem(record.imageId, record),
            this._blobStore.setItem(record.imageId, blob),
        ]);
    }

    /**
     * 仅保存图像元数据记录（不含 Blob）。
     *
     * @remarks
     * 在任务开始时写入状态占位（status: 'generating'），
     * 生图完成后再通过 finalizeImage 写入 Blob 并更新为 ready。
     * @param record 图像元数据资产记录（byteSize 可为 0）
     */
    public async saveImageMeta(record: StoredImageRecord): Promise<void> {
        await this._metaStore.setItem(record.imageId, record);
    }

    /**
     * 完成图像保存：写入 Blob 数据并更新元数据字段。
     *
     * @param imageId 图像全局唯一标识符
     * @param blob 图像二进制数据
     * @param updates 需要更新的字段（mimeType、byteSize、status、metadata）
     */
    public async finalizeImage(
        imageId: string,
        blob: Blob,
        updates: Pick<StoredImageRecord, 'mimeType' | 'byteSize' | 'status' | 'metadata'>
    ): Promise<void> {
        const existing = await this._metaStore.getItem<StoredImageRecord>(imageId);
        if (!existing) {
            logger.warn(`finalizeImage: 未找到 imageId=${imageId} 的元数据记录，执行全量写入`);
            // 元数据丢失时使用 updates 可用字段构造默认记录写入
            const defaultRecord = { imageId, chatId: undefined, createdAt: Date.now(), ...updates } as StoredImageRecord;
            await Promise.all([
                this._metaStore.setItem(imageId, defaultRecord),
                this._blobStore.setItem(imageId, blob),
            ]);
            return;
        }
        const updated: StoredImageRecord = { ...existing, ...updates };
        await Promise.all([
            this._metaStore.setItem(imageId, updated),
            this._blobStore.setItem(imageId, blob),
        ]);
    }

    /**
     * 局部更新图像资产元数据字段（如 status、remotePath、favorited）。
     *
     * @param imageId 图像全局唯一标识符
     * @param patch 需要更新的字段（允许 status、remotePath 与 favorited）
     */
    public async updateImageRecord(
        imageId: string,
        patch: Partial<Pick<StoredImageRecord, 'status' | 'remotePath' | 'favorited'>>
    ): Promise<void> {
        const existing = await this._metaStore.getItem<StoredImageRecord>(imageId);
        if (!existing) {
            logger.warn(`updateImageRecord: 未找到 imageId=${imageId} 的元数据记录`);
            return;
        }
        const updated: StoredImageRecord = { ...existing, ...patch };
        await this._metaStore.setItem(imageId, updated);
    }

    /**
     * 切换指定图像资产的标星收藏状态。
     *
     * @param imageId 图像全局唯一标识符
     * @returns 更新后的标星收藏状态（true 为已收藏，false 为未收藏）
     */
    public async toggleFavorite(imageId: string): Promise<boolean> {
        const existing = await this._metaStore.getItem<StoredImageRecord>(imageId);
        if (!existing) {
            logger.warn(`toggleFavorite: 未找到 imageId=${imageId} 的元数据记录`);
            return false;
        }
        const newFavorited = !existing.favorited;
        const updated: StoredImageRecord = { ...existing, favorited: newFavorited };
        await this._metaStore.setItem(imageId, updated);
        return newFavorited;
    }

    /**
     * 根据图像标识获取图像原始二进制 Blob。
     * @param imageId 图像全局唯一标识符
     */
    public async getImageBlob(imageId: string): Promise<Blob | undefined> {
        const blob = await this._blobStore.getItem<Blob>(imageId);
        return blob ?? undefined;
    }

    /**
     * 根据图像标识获取图像元数据记录。
     * @param imageId 图像全局唯一标识符
     */
    public async getImageRecord(imageId: string): Promise<StoredImageRecord | undefined> {
        const record = await this._metaStore.getItem<StoredImageRecord>(imageId);
        return record ?? undefined;
    }

    /**
     * 物理删除指定图像资产，同步清除元数据索引与二进制数据所占存储空间。
     * @param imageId 图像全局唯一标识符
     */
    public async deleteImage(imageId: string): Promise<void> {
        await Promise.all([
            this._metaStore.removeItem(imageId),
            this._blobStore.removeItem(imageId),
        ]);
    }

    /**
     * 查询本地图像资产元数据列表，支持按会话、角色、状态及标星筛选并分页。
     * @param options 筛选与分页查询参数
     */
    public async listImages(options: ImageQueryOptions = {}): Promise<StoredImageRecord[]> {
        const { limit = 50, offset = 0, status, chatId, characterName, favorited } = options;
        const allRecords: StoredImageRecord[] = [];

        await this._metaStore.iterate<StoredImageRecord, void>((record) => {
            // 状态筛选
            if (status && record.status !== status) {
                return;
            }

            // 会话筛选
            if (chatId && record.chatId !== chatId) {
                return;
            }

            // 角色名称筛选
            if (characterName && record.characterName !== characterName) {
                return;
            }

            // 标星收藏筛选
            if (favorited !== undefined && Boolean(record.favorited) !== favorited) {
                return;
            }

            allRecords.push(record);
        });

        // 按创建时间降序排列
        allRecords.sort((a, b) => b.createdAt - a.createdAt);

        return allRecords.slice(offset, offset + limit);
    }

    /**
     * 统计本地存储中的图像资产总数。
     * @param status 资产状态筛选条件，缺省统计全部资产
     */
    public async countImages(status?: 'ready' | 'generating' | 'failed'): Promise<number> {
        let count = 0;
        await this._metaStore.iterate<StoredImageRecord, void>((record) => {
            if (!status || record.status === status) {
                count++;
            }
        });
        return count;
    }

    /**
     * 获取当前宿主环境的存储配额估算信息。
     */
    public async getStorageEstimate(): Promise<StorageEstimateInfo | undefined> {
        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const usage = estimate.usage ?? 0;
                const quota = estimate.quota ?? 0;
                const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;

                return {
                    usageBytes: usage,
                    quotaBytes: quota,
                    usagePercent: Math.round(usagePercent * 10) / 10,
                };
            } catch (err) {
                logger.warn('获取浏览器存储配额估值异常:', err);
                return undefined;
            }
        }
        return undefined;
    }
}

/** 全局默认单例图像持久化存储服务 */
export const imageStorage = new ImageStorage();
