/**
 * 日志与统计专属选项卡主视图 (LogsAndStatsTabView)。
 *
 * @remarks
 * 为绘图助手提供运行效能监控、本地存储配额感知与实时排障能力：
 * 1. 运行效能统计看板 (StatCard)：基于 IndexedDB 图像资产记录实时派生累计出图量、今日出图量、生成成功率与平均耗时；
 * 2. 本地存储空间监控 (StorageBar)：展示浏览器 IndexedDB 水位线与资产分布，支持失败记录清理、草稿清理与分级维护；
 * 3. 实时排障终端 (LogTerminal)：集成控制台日志流实时推送、级别过滤、关键词模糊检索与诊断堆栈复制。
 */

import type { SettingsView, Disposable } from '../types';
import {
    StatCard,
    StorageBar,
    LogTerminal,
    type GenerationStatsData,
    type StorageSummaryData,
} from '../composite';
import { imageStorage } from '../../store/image-storage';
import { logger } from '../../util/logger';
import { eventBus } from '../../util/event-bus';
import { ConfirmDialog } from '../feedback/confirm-dialog';

export class LogsAndStatsTabView implements SettingsView {
    public readonly id = 'logs';
    public readonly title = '日志与统计';
    public readonly element: HTMLElement;

    // 复合组件成员
    private statCard!: StatCard;
    private storageBar!: StorageBar;
    private logTerminal!: LogTerminal;

    private readonly disposables: Disposable[] = [];
    private unlistenTaskStatus?: () => void;

    public constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane da-view-logs-stats';

        this.buildLayout();
    }

    // 1. 视图结构装配

    private buildLayout(): void {
        // (1) 顶部双列统计看板网格容器
        const topGrid = document.createElement('div');
        topGrid.className = 'da-logs-stats-grid';
        topGrid.style.display = 'grid';
        topGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(320px, 1fr))';
        topGrid.style.gap = '12px';
        topGrid.style.marginBottom = '12px';

        // 1. 运行数据统计看板 (StatCard)
        this.statCard = new StatCard({
            title: '运行数据统计',
            subtitle: '基于本地图像资产记录实时汇总生图吞吐量与平均耗时',
            onRefresh: async () => {
                this.statCard.setLoading(true);
                try {
                    await this.refreshMetrics();
                } finally {
                    this.statCard.setLoading(false);
                }
            },
            onReset: async () => {
                const confirmed = await ConfirmDialog.confirm({
                    title: '清理失败记录',
                    message: '确定要清理失败记录并重新计算运行统计数据吗？',
                    isDanger: true,
                });
                if (!confirmed) return;

                await this.cleanFailedRecords();
                await this.refreshMetrics();
            },
        });
        topGrid.appendChild(this.statCard.element);
        this.disposables.push(this.statCard);

        // 2. 本地存储空间监控卡片 (StorageBar)
        this.storageBar = new StorageBar({
            title: '本地存储空间 (IndexedDB)',
            subtitle: '监控浏览器存储水位线并支持分级安全维护',
            className: 'da-storage-bar',
            confirmHandler: (msg) => ConfirmDialog.confirm(msg),
            onRefresh: async () => {
                await this.refreshMetrics();
            },
            onCleanFailed: async () => {
                await this.cleanFailedRecords();
                await this.refreshMetrics();
            },
            onCleanUnfavorited: async () => {
                await this.cleanUnfavoritedRecords();
                await this.refreshMetrics();
            },
            onClearAll: async () => {
                await this.clearAllImageRecords();
                await this.refreshMetrics();
            },
        });
        topGrid.appendChild(this.storageBar.element);
        this.disposables.push(this.storageBar);

        this.element.appendChild(topGrid);

        // (2) 下方全宽实时排障日志终端 (LogTerminal)
        this.logTerminal = new LogTerminal({
            maxLines: 400,
            filterMode: 'all',
        });
        this.element.appendChild(this.logTerminal.element);
        this.disposables.push(this.logTerminal);

        // 预载内存中已有的最近历史日志并建立实时订阅
        const recentLogs = logger.getRecentLogs(200);
        for (const entry of recentLogs) {
            this.logTerminal.append({
                timestamp: entry.timestamp,
                level: entry.level,
                message: entry.message,
                details: entry.details,
            });
        }
        this.logTerminal.subscribeLogger(logger);
    }

    // 2. 数据派生与指标聚合 (SSOT)

    /**
     * 从本地 IndexedDB 存储服务实时汇总生图效能与存储占用指标。
     */
    public async refreshMetrics(): Promise<void> {
        try {
            // 1. 查询全部图像资产元数据记录
            const allRecords = await imageStorage.listImages({ limit: 10000 });

            // 2. 统计生图运行效能指标
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

            let todayCount = 0;
            let successCount = 0;
            let failedCount = 0;
            let totalDurationMs = 0;
            let durationSampleCount = 0;

            let favoritedCount = 0;
            let unfavoritedCount = 0;

            for (const r of allRecords) {
                if (r.createdAt >= startOfToday) {
                    todayCount++;
                }

                if (r.status === 'ready') {
                    successCount++;
                    if (r.favorited) {
                        favoritedCount++;
                    } else {
                        unfavoritedCount++;
                    }
                } else if (r.status === 'failed') {
                    failedCount++;
                }

                // 统计有效耗时样本
                const duration = r.metadata?.durationMs;
                if (typeof duration === 'number' && duration > 0) {
                    totalDurationMs += duration;
                    durationSampleCount++;
                }
            }

            const totalFinished = successCount + failedCount;
            const successRate = totalFinished > 0 ? (successCount / totalFinished) * 100 : 100;
            const averageDurationSec =
                durationSampleCount > 0 ? totalDurationMs / durationSampleCount / 1000 : 0;

            const statsData: GenerationStatsData = {
                totalCount: totalFinished,
                todayCount,
                successCount,
                failedCount,
                successRate,
                averageDurationSec,
            };
            this.statCard.updateStats(statsData);

            // 3. 统计存储配额与空间占用
            const estimate = await imageStorage.getStorageEstimate();
            const totalBytes = estimate?.quotaBytes || 1024 * 1024 * 1024; // 缺省 1GB
            const usedBytes = estimate?.usageBytes || 0;
            const usagePercentage = estimate?.usagePercent || 0;

            const storageData: StorageSummaryData = {
                usedBytes,
                totalBytes,
                usagePercentage,
                totalImages: allRecords.filter((r) => r.status === 'ready').length,
                favoritedImages: favoritedCount,
                unfavoritedImages: unfavoritedCount,
                failedCount,
            };
            this.storageBar.update(storageData);
        } catch (err) {
            logger.warn('[LogsAndStatsTabView] 汇总指标数据异常:', err);
        }
    }

    // 3. 存储分级维护操作

    /**
     * 清理所有生成失败的元数据记录。
     */
    private async cleanFailedRecords(): Promise<void> {
        const records = await imageStorage.listImages({ status: 'failed', limit: 5000 });
        for (const r of records) {
            await imageStorage.deleteImage(r.imageId);
        }
        logger.info(`[LogsAndStatsTabView] 已清理 ${records.length} 条生成失败记录`);
    }

    /**
     * 清理所有未标星收藏的日常草稿图片。
     */
    private async cleanUnfavoritedRecords(): Promise<void> {
        const records = await imageStorage.listImages({ status: 'ready', limit: 5000 });
        let deleted = 0;
        for (const r of records) {
            if (!r.favorited) {
                await imageStorage.deleteImage(r.imageId);
                deleted++;
            }
        }
        logger.info(`[LogsAndStatsTabView] 已清理 ${deleted} 张未收藏草稿图片`);
    }

    /**
     * 清空全部存储中的图像数据。
     */
    private async clearAllImageRecords(): Promise<void> {
        const records = await imageStorage.listImages({ limit: 10000 });
        for (const r of records) {
            await imageStorage.deleteImage(r.imageId);
        }
        logger.info(`[LogsAndStatsTabView] 已清空全部本地图像资产 (共 ${records.length} 条)`);
    }

    // 4. 视图生命周期控制

    public activate(): void {
        // 激活时即时刷新统计与存储指标
        void this.refreshMetrics();

        // 订阅调度任务状态变动，任务完成后自动重新计算效能指标
        if (!this.unlistenTaskStatus) {
            this.unlistenTaskStatus = eventBus.on('task:status', (payload) => {
                if (payload.status === 'completed' || payload.status === 'failed' || payload.status === 'cancelled') {
                    void this.refreshMetrics();
                }
            });
        }
    }

    public deactivate(): void {
        if (this.unlistenTaskStatus) {
            this.unlistenTaskStatus();
            this.unlistenTaskStatus = undefined;
        }
    }

    public dispose(): void {
        this.deactivate();
        for (const item of this.disposables) {
            item.dispose();
        }
        this.disposables.length = 0;
        this.element.innerHTML = '';
        this.element.remove();
    }
}
