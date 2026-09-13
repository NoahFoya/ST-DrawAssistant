/**
 * @module src/ui/views/logs-and-stats-tab
 * @description 日志与生图统计选项卡 (LogsAndStatsTab)
 *
 * 遵循规范 (UI_LAYOUT_PREVIEW.md 第四节第 7 条 与 styles/controls/cards/stat-card.css / styles/features/terminal.css)：
 * 1. 顶部：4 栏核心指标卡片网格 (StatGrid)，展示总生图次数、成功率 %、平均生成耗时、已用存储；
 * 2. 中部：引擎生图频次分布与近期生图走势看板，附带导出报表与重置统计操作；
 * 3. 底部：实时日志终端 (LogTerminal)，支持实时滚屏、日志级别过滤 (DEBUG/INFO/WARN/ERROR)、一键复制与清空。
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

    // ==========================================
    // 1. 顶部 4 栏核心指标卡片 (StatGrid)
    // ==========================================
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
    root.appendChild(statGrid.element);

    // ==========================================
    // 2. 生图分析与各引擎频次分布看板
    // ==========================================
    const analyticsCard = createCard({
        title: '生图引擎分布与分析报表',
        iconSvg: getIconSvg('star'),
        collapsible: true
    });
    regDisposer(analyticsCard);

    const breakdownContainer = createElement('div', {
        className: 'da-engine-breakdown',
        attributes: { style: 'display: flex; flex-direction: column; gap: 10px; padding: 4px 0;' }
    });

    const breakdownBarsWrapper = createElement('div', {
        attributes: { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;' }
    });

    function renderBreakdownBars() {
        breakdownBarsWrapper.innerHTML = '';
        const engines = [
            { id: 'comfyui', name: 'ComfyUI', color: '#10b981' },
            { id: 'sdwebui', name: 'SD-WebUI / Forge', color: '#3b82f4' },
            { id: 'novelai', name: 'NovelAI', color: '#8b5cf6' },
            { id: 'openai', name: 'OpenAI 兼容模型', color: '#f59e0b' }
        ];

        const total = Math.max(1, stats.totalGenerations);

        for (const eng of engines) {
            const count = stats.engineBreakdown[eng.id] || 0;
            const pct = Math.round((count / total) * 100);

            const row = createElement('div', {
                attributes: {
                    style: 'background: var(--da-bg-primary); border: 1px solid var(--da-separator); border-radius: var(--da-radius-sm, 8px); padding: 10px 14px;'
                }
            });

            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                    <span>${eng.name}</span>
                    <span style="color: var(--da-text-secondary);">${count} 次 (${pct}%)</span>
                </div>
                <div style="height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 999px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${eng.color}; border-radius: 999px; transition: width 0.3s ease;"></div>
                </div>
            `;

            breakdownBarsWrapper.appendChild(row);
        }
    }
    renderBreakdownBars();
    breakdownContainer.appendChild(breakdownBarsWrapper);

    // 操作工具栏
    const actionsRow = createElement('div', {
        attributes: {
            style: 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; flex-wrap: wrap;'
        }
    });

    const exportStatsBtn: ButtonHandle = createButton({
        text: '导出统计报表 (JSON)',
        variant: 'secondary',
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
    actionsRow.appendChild(exportStatsBtn.element);

    const resetStatsBtn: ButtonHandle = createButton({
        text: '重置统计计数',
        variant: 'danger',
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
    actionsRow.appendChild(resetStatsBtn.element);

    breakdownContainer.appendChild(actionsRow);
    analyticsCard.append(breakdownContainer);
    root.appendChild(analyticsCard.element);

    // ==========================================
    // 3. 实时系统日志终端 (LogTerminal)
    // ==========================================
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
        renderBreakdownBars();
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
