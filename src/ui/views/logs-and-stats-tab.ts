/**
 * @module src/ui/views/logs-and-stats-tab
 * @description 运行日志与生图统计面板 (LogsAndStatsTab)
 *
 * 核心功能：
 * 1. 汇总展示核心生图指标（累计次数、成功率、平均耗时与存储占用情况）；
 * 2. 提供插件运行时日志控制台，支持按日志级别过滤、关键词搜索与日志导出；
 * 3. 动态捕获并滚动呈现各模块运行记录，辅助用户与开发者排查网络或配置异常；
 * 4. 提供日志快速清理与重置功能，释放长时间运行占用的内存资源。
 *
 * 注意事项：
 * 1. 控制台日志条数应受最大行数上限限制，防止长时间挂机导致浏览器内存泄漏；
 * 2. 统计重置与日志清空需具备防误触保护。
 */

import { createElement, formatBytes } from '../../util/dom';
import { createCard } from '../components/form-field';
import { createStatGrid, StatGridHandle } from '../composite/stat-card';
import { createLogTerminal, LogTerminalHandle } from '../composite/log-terminal';
import { createButton, ButtonHandle } from '../components/button';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';
import type { SettingsStore } from '../../store/settings';
import type { TerminalLogLevel } from '@types';

export interface LogsAndStatsTabOptions {
    settingsStore?: SettingsStore;
    initialStats?: {
        totalGenerations?: number;
        successGenerations?: number;
        failedGenerations?: number;
        totalDurationMs?: number;
        storageBytes?: number;
        engineBreakdown?: Record<string, number>;
    };
    onResetStats?: () => void;
}

export interface LogsAndStatsTabHandle {
    readonly element: HTMLElement;
    readonly logTerminal: LogTerminalHandle;
    appendLog(message: string, level?: TerminalLogLevel): void;
    updateStats(stats: Partial<NonNullable<LogsAndStatsTabOptions['initialStats']>>): void;
    dispose(): void;
}

export function renderLogsAndStatsTab(options: LogsAndStatsTabOptions = {}): LogsAndStatsTabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    let stats = {
        totalGenerations: options.initialStats?.totalGenerations ?? 0,
        successGenerations: options.initialStats?.successGenerations ?? 0,
        failedGenerations: options.initialStats?.failedGenerations ?? 0,
        totalDurationMs: options.initialStats?.totalDurationMs ?? 0,
        storageBytes: options.initialStats?.storageBytes ?? 0,
        engineBreakdown: options.initialStats?.engineBreakdown ?? {
            comfyui: 0,
            sdwebui: 0,
            novelai: 0,
            openai: 0
        }
    };

    // 1. 顶部 4 栏核心指标卡片 (StatGrid)
    const successRate = stats.totalGenerations > 0
        ? Math.round((stats.successGenerations / stats.totalGenerations) * 100)
        : 100;

    const avgDuration = stats.successGenerations > 0
        ? `${(stats.totalDurationMs / stats.successGenerations / 1000).toFixed(1)}s`
        : '--';

    const statGrid: StatGridHandle = createStatGrid(
        [
            {
                label: '历史生图总数',
                value: String(stats.totalGenerations),
                hint: '累计出图尝试总次数'
            },
            {
                label: '出图成功率',
                value: `${successRate}%`,
                variant: successRate >= 90 ? 'success' : successRate >= 75 ? 'info' : 'error',
                hint: '任务完成且无故障交付'
            },
            {
                label: '平均出图耗时',
                value: avgDuration,
                hint: '成功任务单张耗时'
            },
            {
                label: '画廊存储占用',
                value: formatBytes(stats.storageBytes),
                hint: 'IndexedDB 缓存体积'
            }
        ],
        4
    );
    regDisposer(statGrid);

    // 2. 卡片头部快捷操作按钮 (报表导出与计数清零)
    const headerActions = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; align-items: center;' }
    });

    const exportStatsBtn: ButtonHandle = createButton({
        text: '导出统计报表 (JSON)',
        variant: 'secondary',
        size: 'sm',
        icon: 'download',
        onClick: () => {
            const dataStr = JSON.stringify(
                {
                    exportedAt: new Date().toISOString(),
                    stats
                },
                null,
                2
            );
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st_draw_stats_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            Toast.success('统计报表已导出');
        }
    });
    regDisposer(exportStatsBtn);
    headerActions.appendChild(exportStatsBtn.element);

    const resetStatsBtn: ButtonHandle = createButton({
        text: '重置统计计数',
        variant: 'danger',
        size: 'sm',
        icon: 'trash',
        onClick: () => {
            if (!confirm('确定要清零所有生图统计计数吗？该操作不可恢复！')) return;
            stats.totalGenerations = 0;
            stats.successGenerations = 0;
            stats.failedGenerations = 0;
            stats.totalDurationMs = 0;
            stats.engineBreakdown = { comfyui: 0, sdwebui: 0, novelai: 0, openai: 0 };
            updateAllViews();
            options.onResetStats?.();
            Toast.success('生图统计计数已重置');
        }
    });
    regDisposer(resetStatsBtn);
    headerActions.appendChild(resetStatsBtn.element);

    // Card 1: 生图数据总览看板 (高内聚整合核心指标与各引擎分段分布)
    const dashboardCard = createCard({
        title: '生图数据统计看板',
        iconSvg: getIconSvg('star'),
        collapsible: true,
        headerActions
    });
    regDisposer(dashboardCard);

    // 看板内容区容器
    const dashboardBody = createElement('div', {
        attributes: { style: 'display: flex; flex-direction: column; gap: 14px; width: 100%;' }
    });

    dashboardBody.appendChild(statGrid.element);

    // 分隔线
    const divider = createElement('div', {
        attributes: { style: 'height: 1px; background: var(--da-separator); width: 100%; margin: 2px 0;' }
    });
    dashboardBody.appendChild(divider);

    // 各引擎分段比例条与图例
    const breakdownSection = createElement('div', {
        className: 'da-engine-breakdown',
        attributes: { style: 'display: flex; flex-direction: column; gap: 8px;' }
    });

    const breakdownTitle = createElement('div', {
        attributes: { style: 'font-size: 13px; font-weight: 600; color: var(--da-text-secondary);' },
        textContent: '各引擎生成分布:'
    });
    breakdownSection.appendChild(breakdownTitle);

    const segmentedTrack = createElement('div', {
        className: 'da-segmented-track',
        attributes: {
            style: 'display: flex; width: 100%; height: 8px; border-radius: 999px; overflow: hidden; background: var(--da-bg-input, rgba(255, 255, 255, 0.08)); border: 1px solid var(--da-separator);'
        }
    });
    breakdownSection.appendChild(segmentedTrack);

    const legendContainer = createElement('div', {
        className: 'da-engine-legend-row',
        attributes: {
            style: 'display: flex; gap: 16px; flex-wrap: wrap; margin-top: 4px;'
        }
    });
    breakdownSection.appendChild(legendContainer);

    function renderBreakdown() {
        const engines = [
            { id: 'comfyui', name: 'ComfyUI', color: '#10b981' },
            { id: 'sdwebui', name: 'SD-WebUI / Forge', color: '#3b82f4' },
            { id: 'novelai', name: 'NovelAI', color: '#8b5cf6' },
            { id: 'openai', name: 'OpenAI 兼容模型', color: '#f59e0b' }
        ];

        const total = Math.max(1, stats.totalGenerations);
        segmentedTrack.innerHTML = '';
        legendContainer.innerHTML = '';

        for (const eng of engines) {
            const count = stats.engineBreakdown[eng.id] || 0;
            const pct = Math.round((count / total) * 100);

            if (count > 0) {
                const seg = createElement('div', {
                    attributes: {
                        style: `width: ${pct}%; height: 100%; background: ${eng.color}; transition: width 0.3s ease;`,
                        title: `${eng.name}: ${count} 次 (${pct}%)`
                    }
                });
                segmentedTrack.appendChild(seg);
            }

            const legendItem = createElement('div', {
                attributes: {
                    style: 'display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--da-text-secondary);'
                }
            });
            legendItem.innerHTML = `
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${eng.color}; flex-shrink: 0;"></span>
                <span style="color: var(--da-text-primary); font-weight: 500;">${eng.name}</span>
                <span>${count} 次 (${pct}%)</span>
            `;
            legendContainer.appendChild(legendItem);
        }

        if (stats.totalGenerations === 0) {
            const emptySeg = createElement('div', {
                attributes: {
                    style: 'width: 100%; height: 100%; background: var(--da-bg-input, rgba(255, 255, 255, 0.08)); opacity: 0.4;'
                }
            });
            segmentedTrack.appendChild(emptySeg);
        }
    }
    renderBreakdown();

    dashboardBody.appendChild(breakdownSection);
    dashboardCard.append(dashboardBody);
    root.appendChild(dashboardCard.element);

    // 3. 实时系统日志终端 (LogTerminal)
    const logCard = createCard({
        title: '实时运行日志与调试控制台',
        iconSvg: getIconSvg('settings'),
        collapsible: true
    });
    regDisposer(logCard);

    const terminal: LogTerminalHandle = createLogTerminal({
        maxLines: 400,
        autoScroll: true,
        showToolbar: true
    });
    regDisposer(terminal);

    terminal.append({
        level: 'info',
        message: 'ST-DrawAssistant 绘画助手前端服务初始化就绪',
        timestamp: Date.now()
    });
    terminal.append({
        level: 'debug',
        message: '日志终端监听器已就绪，已启用级别过滤与自动滚屏锁定',
        timestamp: Date.now()
    });

    logCard.append(terminal.element);
    root.appendChild(logCard.element);

    function updateAllViews() {
        statGrid.updateItem(0, String(stats.totalGenerations));

        const rate = stats.totalGenerations > 0
            ? Math.round((stats.successGenerations / stats.totalGenerations) * 100)
            : 100;
        statGrid.updateItem(1, `${rate}%`);

        const avg = stats.successGenerations > 0
            ? `${(stats.totalDurationMs / stats.successGenerations / 1000).toFixed(1)}s`
            : '--';
        statGrid.updateItem(2, avg);

        statGrid.updateItem(3, formatBytes(stats.storageBytes));
        renderBreakdown();
    }

    return {
        element: root,
        logTerminal: terminal,
        appendLog(message: string, level: TerminalLogLevel = 'info'): void {
            terminal.append({
                level,
                message,
                timestamp: Date.now()
            });
        },
        updateStats(newStats): void {
            if (typeof newStats.totalGenerations === 'number') stats.totalGenerations = newStats.totalGenerations;
            if (typeof newStats.successGenerations === 'number') stats.successGenerations = newStats.successGenerations;
            if (typeof newStats.failedGenerations === 'number') stats.failedGenerations = newStats.failedGenerations;
            if (typeof newStats.totalDurationMs === 'number') stats.totalDurationMs = newStats.totalDurationMs;
            if (typeof newStats.storageBytes === 'number') stats.storageBytes = newStats.storageBytes;
            if (newStats.engineBreakdown) {
                stats.engineBreakdown = { ...stats.engineBreakdown, ...newStats.engineBreakdown };
            }
            updateAllViews();
        },
        dispose(): void {
            for (const d of disposers) {
                d();
            }
        }
    };
}
