/**
 * 本地 IndexedDB 图像资产存储服务实现。
 *
 * @remarks
 * 基于 localforage 封装独立的本地存储空间 st_draw_assistant_images。
 * 采用元数据表 metadata 与原始二进制数据表 blobs 双表隔离存储设计，
 * 避免画廊列表查询与条件检索时将大体积二进制数据载入内存。
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
     * 元数据与二进制数据拆分存储，避免画廊检索索引时加载庞大的二进制流进内存。
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
     * 标记删除指定图像资产，并释放对应二进制数据所占存储空间。
     * @param imageId 图像全局唯一标识符
     */
    public async deleteImage(imageId: string): Promise<void> {
        const record = await this.getImageRecord(imageId);
        if (!record) {
            logger.warn(`删除图像资产记录未找到指定目标 (imageId: ${imageId})`);
            return;
        }

        const updated: StoredImageRecord = {
            ...record,
            status: 'deleted',
        };

        await this._metaStore.setItem(imageId, updated);
        await this._blobStore.removeItem(imageId);
    }

    /**
     * 查询本地图像资产元数据列表，支持按会话、角色和状态筛选及分页。
     * @param options 筛选与分页查询参数
     */
    public async listImages(options: ImageQueryOptions = {}): Promise<StoredImageRecord[]> {
        const { limit = 50, offset = 0, status, chatId, characterName } = options;
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
    public async countImages(status?: 'ready' | 'deleted'): Promise<number> {
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
