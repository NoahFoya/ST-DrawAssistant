/**
 * 日志与运行统计视图模型 (LogsStatsViewModel)。
 *
 * @remarks
 * 从视图层抽离生图运行效能指标聚合（累计出图、今日出图、成功率、平均耗时）、
 * 本地存储空间水位计算、任务状态变更自动刷新以及分级存储清理动作。
 */

import { signal, type Signal } from '@preact/signals';
import type { Disposable } from '../types';
import type { GenerationStatsData } from '../composite/stat-card';
import type { StorageSummaryData } from '../composite/storage-bar';
import { StorageMaintenanceService } from './storage-maintenance';
import { imageStorage } from '../../store/image-storage';
import { eventBus } from '../../util/event-bus';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

export class LogsStatsViewModel implements Disposable {
    /** 生图运行统计看板数据信号 */
    public readonly statsData: Signal<GenerationStatsData>;
    /** 本地存储空间摘要信号 */
    public readonly storageSummary: Signal<StorageSummaryData>;
    /** 是否正在刷新统计数据 */
    public readonly isLoading: Signal<boolean>;

    private unlistenTaskStatus: (() => void) | null = null;

    public constructor() {
        this.statsData = signal<GenerationStatsData>({
            totalCount: 0,
            todayCount: 0,
            successCount: 0,
            failedCount: 0,
            successRate: 100,
            averageDurationSec: 0,
        });

        this.storageSummary = signal<StorageSummaryData>({
            usedBytes: 0,
            totalBytes: 1024 * 1024 * 1024,
            usagePercentage: 0,
            totalImages: 0,
            favoritedImages: 0,
            unfavoritedImages: 0,
            failedCount: 0,
        });

        this.isLoading = signal<boolean>(false);
    }

    /**
     * 从本地 IndexedDB 汇总生图效能与存储占用指标。
     */
    public async refreshMetrics(): Promise<void> {
        this.isLoading.value = true;
        try {
            const allRecords = await imageStorage.listImages({ limit: 10000 });

            const now = new Date();
            const startOfToday = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate()
            ).getTime();

            let todayCount = 0;
            let successCount = 0;
            let failedCount = 0;
            let totalDurationMs = 0;
            let durationSampleCount = 0;

            for (const r of allRecords) {
                if (r.createdAt >= startOfToday) {
                    todayCount++;
                }

                if (r.status === 'ready') {
                    successCount++;
                } else if (r.status === 'failed') {
                    failedCount++;
                }

                const duration = r.metadata?.durationMs;
                if (typeof duration === 'number' && duration > 0) {
                    totalDurationMs += duration;
                    durationSampleCount++;
                }
            }

            const totalFinished = successCount + failedCount;
            const successRate =
                totalFinished > 0 ? (successCount / totalFinished) * 100 : 100;
            const averageDurationSec =
                durationSampleCount > 0
                    ? totalDurationMs / durationSampleCount / 1000
                    : 0;

            this.statsData.value = {
                totalCount: totalFinished,
                todayCount,
                successCount,
                failedCount,
                successRate,
                averageDurationSec,
            };

            this.storageSummary.value =
                await StorageMaintenanceService.computeStorageSummary(allRecords);
        } catch (err) {
            logger.warn('[LogsStatsViewModel] 汇总指标数据异常:', err);
        } finally {
            this.isLoading.value = false;
        }
    }

    public async resetFailedAndRefresh(): Promise<void> {
        const confirmed = await ConfirmDialog.confirm({
            title: '清理失败记录',
            message: '确定要清理失败记录并重新计算运行统计数据吗？',
            isDanger: true,
        });
        if (!confirmed) return;

        const count = await StorageMaintenanceService.cleanFailedRecords();
        await this.refreshMetrics();
        Toast.success(`已重置并清理 ${count} 条失败记录`);
    }

    public async cleanFailedRecords(): Promise<void> {
        const count = await StorageMaintenanceService.cleanFailedRecords();
        await this.refreshMetrics();
        Toast.success(`已清理 ${count} 条失败记录`);
    }

    public async cleanUnfavoritedRecords(): Promise<void> {
        const count = await StorageMaintenanceService.cleanUnfavoritedRecords();
        await this.refreshMetrics();
        Toast.success(`已安全清理 ${count} 张未标星草稿图片`);
    }

    public async clearAllImageRecords(): Promise<void> {
        const count = await StorageMaintenanceService.clearAllRecords(false);
        await this.refreshMetrics();
        Toast.success(`已清理 ${count} 条本地图像记录`);
    }

    public activate(): void {
        void this.refreshMetrics();

        if (!this.unlistenTaskStatus) {
            this.unlistenTaskStatus = eventBus.on('task:status', (payload) => {
                if (
                    payload.status === 'completed' ||
                    payload.status === 'failed' ||
                    payload.status === 'cancelled'
                ) {
                    void this.refreshMetrics();
                }
            });
        }
    }

    public deactivate(): void {
        if (this.unlistenTaskStatus) {
            this.unlistenTaskStatus();
            this.unlistenTaskStatus = null;
        }
    }

    public dispose(): void {
        this.deactivate();
    }
}
