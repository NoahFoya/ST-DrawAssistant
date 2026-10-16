/**
 * 日志与统计专属选项卡视图 (LogsAndStatsTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 LogsStatsViewModel 声明式构建：
 * 1. 运行数据统计看板 (StatCardView)；
 * 2. 本地存储空间监控卡片 (StorageBarView)；
 * 3. 实时排障终端 (LogTerminalView)。
 */

import type { VNode } from 'preact';
import {
    PreactSettingsView,
    StatCardView,
    StorageBarView,
    LogTerminalView,
} from '../framework';
import { LogsStatsViewModel } from '../viewmodels';
import { ConfirmDialog } from '../feedback/confirm-dialog';

export class LogsAndStatsTabView extends PreactSettingsView {
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
                <div
                    className="da-logs-stats-grid"
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                        gap: '12px',
                        marginBottom: '12px',
                    }}
                >
                    <StatCardView
                        title="运行数据统计"
                        data={statsData}
                        loading={isLoading}
                        onRefresh={() => this.vm.refreshMetrics()}
                        onReset={() => this.vm.resetFailedAndRefresh()}
                    />

                    <StorageBarView
                        title="本地存储空间 (IndexedDB)"
                        className="da-storage-bar"
                        data={storageData}
                        confirmHandler={(msg) => ConfirmDialog.confirm(msg)}
                        onRefresh={() => this.vm.refreshMetrics()}
                        onCleanFailed={() => this.vm.cleanFailedRecords()}
                        onCleanUnfavorited={() => this.vm.cleanUnfavoritedRecords()}
                        onClearAll={() => this.vm.clearAllImageRecords()}
                    />
                </div>

                <LogTerminalView
                    maxLines={400}
                    filterMode="all"
                    autoSubscribeGlobalLogger={true}
                />
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
