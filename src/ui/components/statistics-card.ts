/**
 * @module ui/components/statistics-card
 * @description 绘图统计仪表板组件 (StatisticsCard)
 *
 * 职责：
 * - 呈现 2×2 规范 KPI 概览表格 (总任务、成功率、平均耗时、失败/取消)
 * - 支持【日 (24h) / 周 (7天) / 月 (30天) / 季 (90天)】极简 Sparkline 趋势动态切换
 * - 提供多色彩 (五色调色盘) 区分的 Top 5 常用模型、采样器与分辨率横向进度条
 * - 提供数据刷新、导出 (JSON/CSV) 和二次确认重置功能
 */

import { StatisticsCollector, exportStatisticsJSON, exportStatisticsCSV } from '../../statistics';
import { loadSettings } from '../../settings/manager';

/** 五色绚丽调色盘，用于对比区分 Top 5 各条目 */
const VIBRANT_PALETTE = [
    '#3b82f6', // 极客蓝
    '#8b5cf6', // 梦幻紫
    '#ec4899', // 霓虹粉
    '#f59e0b', // 琥珀金
    '#10b981', // 翡翠绿
];

export type TimeRangeMode = 'day' | 'week' | 'month' | 'quarter';

export function renderStatisticsCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'da-section-card da-statistics-card';

    let currentRangeMode: TimeRangeMode = 'week';

    const refreshDashboard = () => {
        card.innerHTML = '';
        const collector = StatisticsCollector.getInstance();
        const record = collector.getSnapshot();
        const settings = loadSettings();
        const providerName = (settings.provider ?? 'ComfyUI').toUpperCase();

        // ── 1. 卡片头部标题与工具按钮 ──────────────────────────────────────────
        const header = document.createElement('div');
        header.className = 'da-section-header';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.flexWrap = 'wrap';
        header.style.gap = '10px';

        const titleBox = document.createElement('div');
        titleBox.style.display = 'flex';
        titleBox.style.alignItems = 'center';
        titleBox.style.gap = '10px';

        const titleText = document.createElement('div');
        titleText.innerHTML = `
            <span class="da-section-title">生图统计仪表板</span>
            <span class="da-section-desc">生图使用分布、成功率、平均耗时与参数偏好概览</span>
        `;

        const modeBadge = document.createElement('span');
        modeBadge.style.fontSize = '0.75em';
        modeBadge.style.padding = '2px 8px';
        modeBadge.style.borderRadius = '10px';
        modeBadge.style.fontWeight = '600';
        modeBadge.style.color = 'var(--da-accent-color, #4f46e5)';
        modeBadge.style.background = 'rgba(var(--da-accent-rgb, 79,70,229), 0.15)';
        modeBadge.style.border = '1px solid var(--da-border-color)';
        modeBadge.textContent = `${providerName} 驱动`;

        titleBox.appendChild(titleText);
        titleBox.appendChild(modeBadge);

        const actionBox = document.createElement('div');
        actionBox.style.display = 'flex';
        actionBox.style.gap = '8px';
        actionBox.style.alignItems = 'center';

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'da-btn secondary';
        refreshBtn.style.padding = '4px 8px';
        refreshBtn.style.fontSize = '0.85em';
        refreshBtn.textContent = '刷新';
        refreshBtn.addEventListener('click', () => refreshDashboard());

        const exportJsonBtn = document.createElement('button');
        exportJsonBtn.className = 'da-btn secondary';
        exportJsonBtn.style.padding = '4px 8px';
        exportJsonBtn.style.fontSize = '0.85em';
        exportJsonBtn.textContent = '导出 JSON';
        exportJsonBtn.addEventListener('click', () => exportStatisticsJSON(record));

        const exportCsvBtn = document.createElement('button');
        exportCsvBtn.className = 'da-btn secondary';
        exportCsvBtn.style.padding = '4px 8px';
        exportCsvBtn.style.fontSize = '0.85em';
        exportCsvBtn.textContent = '导出 CSV';
        exportCsvBtn.addEventListener('click', () => exportStatisticsCSV(record));

        const resetBtn = document.createElement('button');
        resetBtn.className = 'da-btn danger';
        resetBtn.style.padding = '4px 8px';
        resetBtn.style.fontSize = '0.85em';
        resetBtn.textContent = '重置';
        resetBtn.addEventListener('click', async () => {
            if (confirm('确认清空所有历史生图统计数据吗？此操作不可撤销。')) {
                await collector.reset();
                refreshDashboard();
            }
        });

        actionBox.appendChild(refreshBtn);
        actionBox.appendChild(exportJsonBtn);
        actionBox.appendChild(exportCsvBtn);
        actionBox.appendChild(resetBtn);

        header.appendChild(titleBox);
        header.appendChild(actionBox);
        card.appendChild(header);

        // ── 2. 核心 KPI 2×2 标准规范表格 ─────────────────────────────────────────
        const successRate = collector.getSuccessRate();
        const avgDurationMs = collector.getAverageDuration();
        const avgDurationSec = (avgDurationMs / 1000).toFixed(1);

        const kpiGrid = document.createElement('div');
        kpiGrid.style.display = 'grid';
        kpiGrid.style.gridTemplateColumns = '1fr 1fr';
        kpiGrid.style.gap = '12px';
        kpiGrid.style.margin = '15px 0';

        kpiGrid.appendChild(createKpiBox('总生图任务数', `${record.totalTasks} 次`, 'var(--da-text-primary)'));
        kpiGrid.appendChild(createKpiBox('生图成功率', `${successRate}%`, successRate >= 80 ? '#10b981' : (successRate > 0 ? '#f59e0b' : 'var(--da-text-secondary)')));
        kpiGrid.appendChild(createKpiBox('平均渲染耗时', `${avgDurationSec} 秒`, 'var(--da-text-primary)'));
        kpiGrid.appendChild(createKpiBox('失败 / 取消任务', `${record.errorCount} / ${record.cancelledCount}`, record.errorCount > 0 ? '#ff5f56' : 'var(--da-text-secondary)'));

        card.appendChild(kpiGrid);

        if (record.totalTasks === 0) {
            const emptyHint = document.createElement('div');
            emptyHint.style.textAlign = 'center';
            emptyHint.style.padding = '25px 15px';
            emptyHint.style.background = 'var(--da-bg-input)';
            emptyHint.style.borderRadius = '8px';
            emptyHint.style.color = 'var(--da-text-secondary)';
            emptyHint.style.fontSize = '0.9em';
            emptyHint.textContent = '暂无统计数据，发起首次生图后将在此自动积累概览与分析。';
            card.appendChild(emptyHint);
            return;
        }

        // ── 3. 极简 趋势 Sparkline 盒 (带【日 / 周 / 月 / 季】动态切换) ─────────────
        const trendHeader = document.createElement('div');
        trendHeader.style.display = 'flex';
        trendHeader.style.justifyContent = 'space-between';
        trendHeader.style.alignItems = 'center';
        trendHeader.style.margin = '16px 0 10px 0';

        const trendTitle = document.createElement('span');
        trendTitle.style.fontWeight = 'bold';
        trendTitle.style.fontSize = '0.88em';
        trendTitle.style.color = 'var(--da-text-primary)';
        trendTitle.textContent = '生图历史趋势分析';

        // 日/周/月/季 Tab 切换控件
        const tabGroup = document.createElement('div');
        tabGroup.style.display = 'flex';
        tabGroup.style.gap = '4px';
        tabGroup.style.background = 'rgba(255,255,255,0.05)';
        tabGroup.style.padding = '2px';
        tabGroup.style.borderRadius = '6px';

        const ranges: Array<{ mode: TimeRangeMode; label: string }> = [
            { mode: 'day', label: '日(24h)' },
            { mode: 'week', label: '周(7天)' },
            { mode: 'month', label: '月(30天)' },
            { mode: 'quarter', label: '季(90天)' },
        ];

        const trendChartContainer = document.createElement('div');

        const updateTrendChart = (mode: TimeRangeMode) => {
            currentRangeMode = mode;
            // 更新按钮激活态
            tabGroup.querySelectorAll('button').forEach(btn => {
                const btnMode = btn.getAttribute('data-mode');
                if (btnMode === mode) {
                    btn.style.background = 'var(--da-accent-color, #4f46e5)';
                    btn.style.color = '#fff';
                    btn.style.fontWeight = '600';
                } else {
                    btn.style.background = 'transparent';
                    btn.style.color = 'var(--da-text-secondary)';
                    btn.style.fontWeight = 'normal';
                }
            });

            // 渲染 Sparkline 图表
            trendChartContainer.innerHTML = '';
            trendChartContainer.appendChild(renderSparklineChart(collector, mode));
        };

        ranges.forEach(r => {
            const btn = document.createElement('button');
            btn.setAttribute('data-mode', r.mode);
            btn.style.border = 'none';
            btn.style.fontSize = '0.75em';
            btn.style.padding = '2px 8px';
            btn.style.borderRadius = '4px';
            btn.style.cursor = 'pointer';
            btn.style.transition = 'all 0.15s ease';
            btn.textContent = r.label;

            btn.addEventListener('click', () => updateTrendChart(r.mode));
            tabGroup.appendChild(btn);
        });

        trendHeader.appendChild(trendTitle);
        trendHeader.appendChild(tabGroup);
        card.appendChild(trendHeader);

        card.appendChild(trendChartContainer);
        updateTrendChart(currentRangeMode);

        // ── 4. 多色彩 Top 5 偏好排名 (要求：均为横向条形图) ────────────────────────
        const detailsGrid = document.createElement('div');
        detailsGrid.style.display = 'grid';
        detailsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
        detailsGrid.style.gap = '15px';
        detailsGrid.style.marginTop = '16px';

        // 4.1 常用模型 Top 5 (横向 + 多色彩)
        const topModels = collector.getTopItems(record.paramStats.models, 5);
        detailsGrid.appendChild(renderColoredHorizontalTopSection('常用模型 Top 5', topModels));

        // 4.2 常用采样器 Top 5 (横向 + 多色彩)
        const topSamplers = collector.getTopItems(record.paramStats.samplers, 5);
        detailsGrid.appendChild(renderColoredHorizontalTopSection('常用采样器 Top 5', topSamplers));

        // 4.3 常用分辨率 Top 5 (横向 + 多色彩)
        const topRes = collector.getTopItems(record.paramStats.resolutions, 5);
        detailsGrid.appendChild(renderColoredHorizontalTopSection('常用分辨率 Top 5', topRes));

        card.appendChild(detailsGrid);
    };

    refreshDashboard();
    return card;
}

/** 辅助函数：创建 KPI 方块 */
function createKpiBox(label: string, value: string, color: string): HTMLElement {
    const box = document.createElement('div');
    box.style.background = 'var(--da-bg-input)';
    box.style.padding = '12px 14px';
    box.style.borderRadius = '8px';
    box.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.08))';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';

    const lbl = document.createElement('span');
    lbl.style.fontSize = '0.78em';
    lbl.style.color = 'var(--da-text-secondary)';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.style.fontSize = '1.3em';
    val.style.fontWeight = 'bold';
    val.style.color = color;
    val.style.marginTop = '6px';
    val.textContent = value;

    box.appendChild(lbl);
    box.appendChild(val);
    return box;
}

/** 辅助函数：渲染极简 Sparkline 趋势 SVG (支持日/周/月/季) */
function renderSparklineChart(collector: StatisticsCollector, mode: TimeRangeMode): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.background = 'var(--da-bg-input)';
    wrapper.style.padding = '12px 16px';
    wrapper.style.borderRadius = '8px';

    let dataItems: Array<{ label: string; count: number }> = [];

    if (mode === 'day') {
        // 当天 24 小时分布
        const snapshot = collector.getSnapshot();
        const hourly = snapshot.timeStats.hourly ?? {};
        for (let i = 0; i < 24; i++) {
            dataItems.push({ label: `${i}时`, count: hourly[i] ?? 0 });
        }
    } else {
        const days = mode === 'week' ? 7 : (mode === 'month' ? 30 : 90);
        const raw = collector.getDailyTrend(days);
        dataItems = raw.map(d => ({
            label: d.date.length >= 10 ? d.date.substring(5) : d.date,
            count: d.count,
        }));
    }

    const maxVal = Math.max(...dataItems.map(d => d.count), 1);

    // 原生 Mini SVG Sparkline 柱形条
    const height = 64;
    const count = dataItems.length;
    const barGapPct = count > 30 ? 0.1 : 0.25;
    const colWidthPct = 100 / count;

    let barsHtml = '';
    dataItems.forEach((item, idx) => {
        const barHeight = item.count > 0 ? Math.max((item.count / maxVal) * (height - 18), 3) : 1;
        const y = height - 16 - barHeight;
        const x = idx * colWidthPct + colWidthPct * (barGapPct / 2);
        const width = colWidthPct * (1 - barGapPct);

        const fill = item.count > 0 ? 'var(--da-accent-color, #3b82f6)' : 'rgba(255,255,255,0.08)';

        barsHtml += `
            <rect x="${x}%" y="${y}" width="${width}%" height="${barHeight}" fill="${fill}" rx="1">
                <title>${item.label}: ${item.count} 次</title>
            </rect>
        `;
    });

    // 绘制底部首尾/关键时间文本
    const startLabel = dataItems[0]?.label ?? '';
    const endLabel = dataItems[dataItems.length - 1]?.label ?? '';

    wrapper.innerHTML = `
        <svg width="100%" height="${height}" style="overflow: visible; display: block;">
            <line x1="0" y1="${height - 16}" x2="100%" y2="${height - 16}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
            ${barsHtml}
            <text x="0" y="${height - 2}" font-size="10" fill="var(--da-text-secondary)">${startLabel}</text>
            <text x="100%" y="${height - 2}" font-size="10" text-anchor="end" fill="var(--da-text-secondary)">${endLabel}</text>
        </svg>
    `;

    return wrapper;
}

/** 辅助函数：渲染多色彩对比 Top 5 横向条形图 */
function renderColoredHorizontalTopSection(
    title: string,
    items: Array<{ name: string; count: number; percentage: number }>
): HTMLElement {
    const section = document.createElement('div');
    section.style.background = 'var(--da-bg-input)';
    section.style.padding = '14px 16px';
    section.style.borderRadius = '8px';

    const head = document.createElement('div');
    head.style.fontWeight = 'bold';
    head.style.fontSize = '0.85em';
    head.style.marginBottom = '12px';
    head.style.color = 'var(--da-text-primary)';
    head.textContent = title;
    section.appendChild(head);

    if (items.length === 0) {
        const none = document.createElement('div');
        none.style.fontSize = '0.8em';
        none.style.color = 'var(--da-text-secondary)';
        none.textContent = '暂无记录';
        section.appendChild(none);
        return section;
    }

    const maxCount = Math.max(...items.map(i => i.count), 1);

    items.forEach((item, index) => {
        const itemColor = VIBRANT_PALETTE[index % VIBRANT_PALETTE.length];

        const row = document.createElement('div');
        row.style.marginBottom = '10px';

        const infoRow = document.createElement('div');
        infoRow.style.display = 'flex';
        infoRow.style.justifyContent = 'space-between';
        infoRow.style.fontSize = '0.78em';
        infoRow.style.color = 'var(--da-text-primary)';
        infoRow.style.marginBottom = '3px';

        const nameSpan = document.createElement('span');
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.maxWidth = '170px';
        nameSpan.title = item.name;
        nameSpan.textContent = `${index + 1}. ${item.name}`;

        const countSpan = document.createElement('span');
        countSpan.style.color = 'var(--da-text-secondary)';
        countSpan.textContent = `${item.count} 次 (${item.percentage}%)`;

        infoRow.appendChild(nameSpan);
        infoRow.appendChild(countSpan);
        row.appendChild(infoRow);

        const barBg = document.createElement('div');
        barBg.style.height = '6px';
        barBg.style.background = 'rgba(255,255,255,0.06)';
        barBg.style.borderRadius = '3px';
        barBg.style.overflow = 'hidden';

        const barFill = document.createElement('div');
        barFill.style.height = '100%';
        barFill.style.width = `${(item.count / maxCount) * 100}%`;
        barFill.style.background = itemColor;
        barFill.style.borderRadius = '3px';
        barFill.style.transition = 'width 0.3s ease';

        barBg.appendChild(barFill);
        row.appendChild(barBg);
        section.appendChild(row);
    });

    return section;
}
