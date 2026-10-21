/**
 * 本地图像资产存储分级维护与配额统计服务 (StorageMaintenanceService)。
 *
 * @remarks
 * 统一封装画廊视图 (GalleryTabView) 与日志统计视图 (LogsStatsTabView) 共享的
 * IndexedDB 存储水位计算、失败记录清理、未收藏草稿清理及全量清理逻辑。
 */

import type { StoredImageRecord } from '@types';
import type { StorageSummaryData } from '../composite/storage-bar';
import { imageStorage } from '../../store/image-storage';
import { logger } from '../../util/logger';

export class StorageMaintenanceService {
    /**
     * 基于给定的图像记录列表与浏览器配额估算，计算 StorageBar 所需的统计摘要。
     */
    public static async computeStorageSummary(
        records: StoredImageRecord[]
    ): Promise<StorageSummaryData> {
        let favoritedCount = 0;
        let unfavoritedCount = 0;
        let failedCount = 0;
        let readyCount = 0;

        for (const r of records) {
            if (r.status === 'ready') {
                readyCount++;
                if (r.favorited) {
                    favoritedCount++;
                } else {
                    unfavoritedCount++;
                }
            } else if (r.status === 'failed') {
                failedCount++;
            }
        }

        const estimate = await imageStorage.getStorageEstimate();
        const totalBytes = estimate?.quotaBytes || 1024 * 1024 * 1024;
        const usedBytes = estimate?.usageBytes || 0;
        const usagePercentage = estimate?.usagePercent || 0;

        return {
            usedBytes,
            totalBytes,
            usagePercentage,
            totalImages: readyCount,
            favoritedImages: favoritedCount,
            unfavoritedImages: unfavoritedCount,
            failedCount,
        };
    }

    /**
     * 清理所有生成失败 (status === 'failed') 的元数据记录。
     */
    public static async cleanFailedRecords(records?: StoredImageRecord[]): Promise<number> {
        const list =
            records ?? (await imageStorage.listImages({ status: 'failed', limit: 5000 }));
        let count = 0;
        for (const r of list) {
            if (r.status === 'failed') {
                await imageStorage.deleteImage(r.imageId);
                count++;
            }
        }
        logger.info(`[StorageMaintenanceService] 已清理 ${count} 条生成失败记录`);
        return count;
    }

    /**
     * 清理所有未标星收藏的日常草稿图片 (status === 'ready' && !favorited)。
     */
    public static async cleanUnfavoritedRecords(records?: StoredImageRecord[]): Promise<number> {
        const list =
            records ?? (await imageStorage.listImages({ status: 'ready', limit: 5000 }));
        let count = 0;
        for (const r of list) {
            if (r.status === 'ready' && !r.favorited) {
                await imageStorage.deleteImage(r.imageId);
                count++;
            }
        }
        logger.info(`[StorageMaintenanceService] 已清理 ${count} 张未收藏草稿图片`);
        return count;
    }

    /**
     * 清空存储中的图像记录。
     *
     * @param protectFavorited 是否保护已标星收藏的图片不被删除
     */
    public static async clearAllRecords(
        protectFavorited = false,
        records?: StoredImageRecord[]
    ): Promise<number> {
        const list = records ?? (await imageStorage.listImages({ limit: 10000 }));
        let count = 0;
        for (const r of list) {
            if (r.status === 'deleted') {
                continue;
            }
            if (protectFavorited && r.favorited) {
                continue;
            }
            await imageStorage.deleteImage(r.imageId);
            count++;
        }
        logger.info(`[StorageMaintenanceService] 已清理 ${count} 条本地图像记录`);
        return count;
    }
}
