/**
 * 日志与运行统计视图模型 (LogsStatsViewModel)。
 *
 * @remarks
 * 从视图层抽离生图运行效能指标聚合（累计出图、今日出图、近 7 天走势、最近任务流水、成功率）、
 * 本地存储空间占用计算、任务状态变更自动刷新以及分级存储清理动作。
 */

import { signal, type Signal } from '@preact/signals';
import type { Disposable } from '../types';
import type { GenerationStatsData, DailyTrendItem, RecentTaskItem } from '../composite/stat-card';
import type { StorageSummaryData } from '../composite/storage-bar';
import { StorageMaintenanceService } from './storage-maintenance';
import { imageStorage } from '../../store/image-storage';
import { eventBus } from '../../util/event-bus';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

function formatBackendLabel(engine: string): string {
    const lower = (engine || '').toLowerCase();
    if (lower.includes('comfy')) return 'ComfyUI';
    if (lower.includes('novel')) return 'NovelAI';
    if (lower.includes('forge')) return 'Forge';
    if (lower.includes('sd') || lower.includes('webui') || lower.includes('a1111')) return 'SD-WebUI';
    if (lower.includes('openai') || lower.includes('dall')) return 'OpenAI';
    return engine || '其他';
}

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
            sevenDaysTotalCount: 0,
            successCount: 0,
            failedCount: 0,
            successRate: 100,
            dailyTrends: [],
            recentTasks: [],
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

            // 构造过去 7 天的分桶容器（从 T-6 到 T-0）
            const dayBuckets: {
                dateLabel: string;
                start: number;
                end: number;
                count: number;
                totalDurMs: number;
                durCount: number;
            }[] = [];

            for (let i = 6; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
                const start = d.getTime();
                const end = start + 86400000;
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dayBuckets.push({
                    dateLabel: `${month}-${day}`,
                    start,
                    end,
                    count: 0,
                    totalDurMs: 0,
                    durCount: 0,
                });
            }

            const sevenDaysStart = dayBuckets[0].start;
            const sevenDaysEnd = dayBuckets[dayBuckets.length - 1].end;

            let todayCount = 0;
            let successCount = 0;
            let failedCount = 0;

            for (const r of allRecords) {
                if (r.createdAt >= startOfToday) {
                    todayCount++;
                }

                if (r.status === 'ready') {
                    successCount++;
                } else if (r.status === 'failed') {
                    failedCount++;
                }

                // 统计近 7 天每日趋势
                if (r.createdAt >= sevenDaysStart && r.createdAt < sevenDaysEnd) {
                    const bucket = dayBuckets.find((b) => r.createdAt >= b.start && r.createdAt < b.end);
                    if (bucket) {
                        bucket.count++;
                        const duration = r.metadata?.durationMs;
                        if (r.status === 'ready' && typeof duration === 'number' && duration > 0) {
                            bucket.totalDurMs += duration;
                            bucket.durCount++;
                        }
                    }
                }
            }

            const totalFinished = successCount + failedCount;
            const successRate = totalFinished > 0 ? (successCount / totalFinished) * 100 : 100;

            const dailyTrends: DailyTrendItem[] = dayBuckets.map((b) => ({
                dateLabel: b.dateLabel,
                count: b.count,
                avgDurationSec: b.durCount > 0 ? Number((b.totalDurMs / b.durCount / 1000).toFixed(1)) : 0,
            }));

            const sevenDaysTotalCount = dayBuckets.reduce((sum, b) => sum + b.count, 0);

            // 提取最近 15 次生图流水
            const sortedRecords = [...allRecords]
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 15);

            const recentTasks: RecentTaskItem[] = sortedRecords.map((r) => {
                const w = r.width ?? r.metadata?.width;
                const h = r.height ?? r.metadata?.height;
                const isInpaint = r.metadata?.mode === 'inpaint';
                const baseDim = w && h ? `${w}×${h}` : '--';
                const dimText = isInpaint ? `${baseDim} [重绘]` : baseDim;
                const durMs = r.metadata?.durationMs;
                const durSec = typeof durMs === 'number' && durMs > 0 ? Number((durMs / 1000).toFixed(1)) : 0;
                const rawEngine = (r.metadata?.engine || r.metadata?.provider || '默认') as string;
                const backend = formatBackendLabel(rawEngine);
                const model = (r.metadata?.modelName || r.metadata?.baseModel || '--') as string;
                const status = r.status === 'ready' ? 'ready' : 'failed';
                const errorMsg =
                    typeof r.metadata?.errorMessage === 'string'
                        ? r.metadata.errorMessage
                        : undefined;

                return {
                    id: r.imageId,
                    createdAt: r.createdAt,
                    backend,
                    model,
                    dimension: dimText,
                    durationSec: durSec,
                    status,
                    errorMsg,
                };
            });

            this.statsData.value = {
                totalCount: totalFinished,
                todayCount,
                sevenDaysTotalCount,
                successCount,
                failedCount,
                successRate,
                dailyTrends,
                recentTasks,
            };

            this.storageSummary.value =
                await StorageMaintenanceService.computeStorageSummary(allRecords);
        } catch (err) {
            logger.warn('[LogsStatsViewModel] 汇总指标数据异常:', err);
        } finally {
            this.isLoading.value = false;
        }
    }

    public async cleanFailedRecords(): Promise<void> {
        const count = await StorageMaintenanceService.cleanFailedRecords();
        await this.refreshMetrics();
        Toast.success(`已清理 ${count} 条失败记录`);
    }

    public async cleanUnfavoritedRecords(): Promise<void> {
        const count = await StorageMaintenanceService.cleanUnfavoritedRecords();
        await this.refreshMetrics();
        Toast.success(`已安全清理 ${count} 张未收藏草稿图片`);
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
