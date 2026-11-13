/**
 * 日志与统计专属选项卡视图 (LogsStatsTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 LogsStatsViewModel 声明式构建：
 * 1. 运行数据统计看板 (StatCardView)；
 * 2. 本地存储空间监控与分级清理卡片 (StorageBarView)；
 * 3. 实时运行与排障终端卡片 (CardView + LogTerminalView)。
 */

import type { VNode } from 'preact';
import {
    PreactSettingsView,
    CardView,
    StatCardView,
    StorageBarView,
    LogTerminalView,
} from '../framework';
import { LogsStatsViewModel } from '../viewmodels';
import { ConfirmDialog } from '../feedback/confirm-dialog';

export class LogsStatsTabView extends PreactSettingsView {
    public readonly id = 'logs';
    public readonly title = '日志与统计';

    public readonly vm: LogsStatsViewModel;

    public constructor() {
        super('da-tab-pane da-view-logs-stats');
        this.vm = new LogsStatsViewModel();
        this.mountPreact();
    }

    /**
     * 从本地 IndexedDB 汇总生图效能与存储占用指标。
     */
    public async refreshMetrics(): Promise<void> {
        await this.vm.refreshMetrics();
    }

    protected renderContent(): VNode {
        const statsData = this.vm.statsData.value;
        const storageData = this.vm.storageSummary.value;
        const isLoading = this.vm.isLoading.value;

        return (
            <>
                <div className="da-logs-stats-grid">
                    <StatCardView
                        title="运行数据统计"
                        data={statsData}
                        loading={isLoading}
                        onRefresh={() => this.vm.refreshMetrics()}
                    />

                    <StorageBarView
                        title="本地存储空间"
                        className="da-storage-bar"
                        data={storageData}
                        confirmHandler={(msg) => ConfirmDialog.confirm(msg)}
                        onRefresh={() => this.vm.refreshMetrics()}
                        onCleanFailed={() => this.vm.cleanFailedRecords()}
                        onCleanUnfavorited={() => this.vm.cleanUnfavoritedRecords()}
                        onClearAll={() => this.vm.clearAllImageRecords()}
                    />
                </div>

                <CardView
                    title="实时运行与排障日志"
                    subtitle="捕获生图任务状态流转、后端网络请求与异常诊断详情"
                    className="da-card--padded da-terminal-card"
                >
                    <LogTerminalView
                        maxLines={400}
                        filterMode="all"
                        autoSubscribeGlobalLogger={true}
                    />
                </CardView>
            </>
        );
    }

    public override activate(): void {
        this.vm.activate();
    }

    public override deactivate(): void {
        this.vm.deactivate();
    }

    public override dispose(): void {
        this.vm.dispose();
        super.dispose();
    }
}
