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
    createPreactSettingsView,
    CardView,
    type StatefulSettingsView,
} from '../framework';
import {
    StatCard,
    StorageBar,
    LogTerminal,
} from '../composite';
import { LogsStatsState } from '../state';
import { ConfirmDialog } from '../feedback/confirm-dialog';

export function LogsStatsTab(props: { vm: LogsStatsState }): VNode {
    const { vm } = props;
    const statsData = vm.statsData.value;
    const storageData = vm.storageSummary.value;
    const isLoading = vm.isLoading.value;

    return (
        <>
            <div className="da-logs-stats-grid">
                <StatCard
                    title="运行数据统计"
                    data={statsData}
                    loading={isLoading}
                    onRefresh={() => vm.refreshMetrics()}
                />

                <StorageBar
                    title="本地存储空间"
                    className="da-storage-bar"
                    data={storageData}
                    confirmHandler={(msg) => ConfirmDialog.confirm(msg)}
                    onRefresh={() => vm.refreshMetrics()}
                    onCleanFailed={() => vm.cleanFailedRecords()}
                    onCleanUnfavorited={() => vm.cleanUnfavoritedRecords()}
                    onClearAll={() => vm.clearAllImageRecords()}
                />
            </div>

            <CardView
                title="实时运行与排障日志"
                subtitle="捕获生图任务状态流转、后端网络请求与异常诊断详情"
                className="da-card--padded da-terminal-card"
            >
                <LogTerminal
                    maxLines={400}
                    filterMode="all"
                    autoSubscribeGlobalLogger={true}
                />
            </CardView>
        </>
    );
}

export function createLogsStatsTabView(): StatefulSettingsView<LogsStatsState> {
    const vm = new LogsStatsState();
    return createPreactSettingsView<LogsStatsState>({
        id: 'logs',
        title: '日志与统计',
        className: 'da-tab-pane da-view-logs-stats',
        state: vm,
        render: () => <LogsStatsTab vm={vm} />,
        onActivate: () => vm.activate(),
        onDeactivate: () => vm.deactivate(),
        onDispose: () => vm.dispose(),
    });
}
