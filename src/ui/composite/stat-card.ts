/**
 * 运行效能与数据统计看板卡片 (StatCard)。
 *
 * @remarks
 * 负责呈现生图统计指标监控：
 * 1. 标准化装配 Card 基础容器组件，支持折叠与头部统一操作；
 * 2. 聚合 4 项核心指标：累计生成总数、今日出图量、近 7 天出图总量、生成成功率（附失败数）；
 * 3. 近 7 天双轨轻量 SVG 微图表：柱状呈现每日出图量，折线呈现平均耗时；
 * 4. 最近生成任务流水明细：展示时间、引擎、模型、尺寸与模式、耗时与执行状态；
 * 5. 状态感知健康变体：按成功率阈值显示状态色彩（绿色、黄色、红色）。
 */

import type { UIComponent } from '../types';
import { Card } from '../components/card';
import { Button } from '../components/button';

/** 近 7 天每日趋势条目 */
export interface DailyTrendItem {
    /** 日期文本，格式形如 '11-06' */
    readonly dateLabel: string;
    /** 该日生成任务数 */
    readonly count: number;
    /** 该日成功出图平均耗时（秒，若无出图则为 0） */
    readonly avgDurationSec: number;
}

/** 最近生图任务记录条目 */
export interface RecentTaskItem {
    /** 记录唯一标识符 */
    readonly id: string;
    /** 创建时间戳 */
    readonly createdAt: number;
    /** 执行引擎 (如 'ComfyUI', 'SD-WebUI', 'NovelAI', 'OpenAI') */
    readonly backend: string;
    /** 模型名称或工作流名称 */
    readonly model: string;
    /** 出图尺寸或模式 (如 '832×1216 (文生图)') */
    readonly dimension: string;
    /** 生成耗时 (秒) */
    readonly durationSec: number;
    /** 任务状态 ('ready' | 'failed') */
    readonly status: 'ready' | 'failed';
    /** 失败原因（若失败） */
    readonly errorMsg?: string;
}

/** 生图运行核心统计数据模型 */
export interface GenerationStatsData {
    /** 累计出图总数 */
    readonly totalCount: number;
    /** 今日出图数量 */
    readonly todayCount: number;
    /** 近 7 天出图总量 */
    readonly sevenDaysTotalCount: number;
    /** 成功生成次数 */
    readonly successCount: number;
    /** 失败异常次数 */
    readonly failedCount: number;
    /** 成功率百分比 (0 ~ 100) */
    readonly successRate: number;
    /** 近 7 天每日趋势 */
    readonly dailyTrends: DailyTrendItem[];
    /** 最近任务流水 (近 15 条) */
    readonly recentTasks: RecentTaskItem[];
}

/** 统计看板选项 */
export interface StatCardOptions {
    /** 卡片主标题，默认 '运行数据统计' */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 初始统计数据 */
    initialData?: GenerationStatsData;
    /** 刷新数据回调函数 */
    onRefresh?: () => void | Promise<void>;
    /** 重置统计数据回调函数 */
    onReset?: () => void | Promise<void>;
    /** 附加 CSS 类名 */
    className?: string;
}

interface StatItemElements {
    cardEl: HTMLElement;
    valEl: HTMLElement;
    subEl?: HTMLElement;
}

interface MetricsElementsGroup {
    totalElements: StatItemElements;
    todayElements: StatItemElements;
    sevenDaysElements: StatItemElements;
    rateElements: StatItemElements;
}

const DEFAULT_STATS: GenerationStatsData = {
    totalCount: 0,
    todayCount: 0,
    sevenDaysTotalCount: 0,
    successCount: 0,
    failedCount: 0,
    successRate: 100,
    dailyTrends: [],
    recentTasks: [],
};

/**
 * 运行效能与数据统计看板卡片实现类。
 */
export class StatCard implements UIComponent {
    public readonly element: HTMLElement;
    private readonly card: Card;

    private readonly refreshBtn?: Button;
    private readonly resetBtn?: Button;

    private readonly totalElements: StatItemElements;
    private readonly todayElements: StatItemElements;
    private readonly sevenDaysElements: StatItemElements;
    private readonly rateElements: StatItemElements;

    private readonly chartContainer: HTMLElement;
    private readonly tasksContainer: HTMLElement;

    private currentData: GenerationStatsData;

    public constructor(options: StatCardOptions = {}) {
        this.currentData = options.initialData ?? DEFAULT_STATS;

        // 1. 初始化标准 Card 容器
        this.card = new Card({
            title: options.title ?? '运行数据统计',
            subtitle: options.subtitle ?? '生图任务吞吐量、近 7 天走势与执行流水监控',
        });

        this.element = this.card.element;
        this.element.classList.add('da-stat-card-panel', 'da-card--padded');
        if (options.className) {
            this.element.classList.add(...options.className.trim().split(/\s+/).filter(Boolean));
        }

        // 2. 头部右上角操作按钮区
        const headerActions: HTMLElement[] = [];
        if (options.onRefresh) {
            this.refreshBtn = new Button({
                label: '刷新',
                variant: 'ghost',
                size: 'sm',
                onClick: async () => {
                    try {
                        this.setLoading(true);
                        await options.onRefresh?.();
                    } finally {
                        this.setLoading(false);
                    }
                },
            });
            headerActions.push(this.refreshBtn.element);
        }

        if (options.onReset) {
            this.resetBtn = new Button({
                label: '重置',
                variant: 'ghost',
                size: 'sm',
                onClick: async () => {
                    await options.onReset?.();
                },
            });
            headerActions.push(this.resetBtn.element);
        }

        if (headerActions.length > 0) {
            this.card.setHeaderActions(headerActions);
        }

        // 3. 构建 4 项核心指标自适应网格
        const metrics = this.buildMetricsGrid();
        this.totalElements = metrics.totalElements;
        this.todayElements = metrics.todayElements;
        this.sevenDaysElements = metrics.sevenDaysElements;
        this.rateElements = metrics.rateElements;

        // 4. 构建近 7 天趋势微图表容器与流水表容器
        const body = this.card.getBodyElement();

        this.chartContainer = document.createElement('div');
        this.chartContainer.className = 'da-stat-chart-container';
        body.appendChild(this.chartContainer);

        this.tasksContainer = document.createElement('div');
        this.tasksContainer.className = 'da-stat-tasks-container';
        body.appendChild(this.tasksContainer);

        // 5. 初始数据渲染
        this.updateStats(this.currentData);
    }

    /**
     * 动态局部更新统计指标数值与图表、流水明细。
     *
     * @param data 统计数据
     */
    public updateStats(data: GenerationStatsData): void {
        this.currentData = data;

        // 1. 累计出图总量
        this.totalElements.valEl.textContent = `${data.totalCount.toLocaleString()} 张`;

        // 2. 今日出图量
        this.todayElements.valEl.textContent = `${data.todayCount.toLocaleString()} 张`;

        // 3. 近 7 天总量
        this.sevenDaysElements.valEl.textContent = `${data.sevenDaysTotalCount.toLocaleString()} 张`;

        // 4. 成功率与失败小副标
        const rate = Math.max(0, Math.min(100, data.successRate));
        this.rateElements.valEl.textContent = `${rate.toFixed(1)}%`;
        if (this.rateElements.subEl) {
            this.rateElements.subEl.textContent = `失败 ${data.failedCount} 次`;
        }

        // 成功率健康色彩变体控制
        this.rateElements.cardEl.classList.remove('da-stat-card--success', 'da-stat-card--warn', 'da-stat-card--danger');
        if (data.totalCount === 0 || rate >= 95) {
            this.rateElements.cardEl.classList.add('da-stat-card--success');
        } else if (rate >= 85) {
            this.rateElements.cardEl.classList.add('da-stat-card--warn');
        } else {
            this.rateElements.cardEl.classList.add('da-stat-card--danger');
        }

        // 5. 渲染近 7 天 SVG 双轨图表
        this.renderTrendsChart(data.dailyTrends);

        // 6. 渲染最近生成任务流水表
        this.renderRecentTasksTable(data.recentTasks);
    }

    /**
     * 设置刷新按钮的加载中状态。
     *
     * @param loading 是否处于刷新中
     */
    public setLoading(loading: boolean): void {
        this.refreshBtn?.setLoading(loading);
    }

    /**
     * 获取当前呈现的统计数据快照。
     */
    public getData(): GenerationStatsData {
        return { ...this.currentData };
    }

    /**
     * 销毁组件与内部子控件。
     */
    public dispose(): void {
        this.refreshBtn?.dispose();
        this.resetBtn?.dispose();
        this.card.dispose();
    }

    // 私有辅助方法

    private buildMetricsGrid(): MetricsElementsGroup {
        const body = this.card.getBodyElement();
        const grid = document.createElement('div');
        grid.className = 'da-stat-grid';

        // 1. 累计出图总量卡片
        const totalElements = this.createMetricCard('累计生成', '0 张');
        grid.appendChild(totalElements.cardEl);

        // 2. 今日出图量卡片
        const todayElements = this.createMetricCard('今日出图', '0 张');
        grid.appendChild(todayElements.cardEl);

        // 3. 近 7 天出图总量卡片
        const sevenDaysElements = this.createMetricCard('近 7 日出图', '0 张');
        grid.appendChild(sevenDaysElements.cardEl);

        // 4. 成功率卡片
        const rateElements = this.createMetricCard('成功率', '100.0%', '失败 0 次');
        grid.appendChild(rateElements.cardEl);

        body.appendChild(grid);

        return {
            totalElements,
            todayElements,
            sevenDaysElements,
            rateElements,
        };
    }

    private createMetricCard(label: string, defaultVal: string, subHint?: string): StatItemElements {
        const cardEl = document.createElement('div');
        cardEl.className = 'da-stat-card';

        const labelEl = document.createElement('div');
        labelEl.className = 'da-stat-card__label';
        labelEl.textContent = label;
        cardEl.appendChild(labelEl);

        const valEl = document.createElement('div');
        valEl.className = 'da-stat-card__val';
        valEl.textContent = defaultVal;
        cardEl.appendChild(valEl);

        let subEl: HTMLElement | undefined;
        if (subHint !== undefined) {
            subEl = document.createElement('div');
            subEl.className = 'da-stat-card__sub';
            subEl.textContent = subHint;
            cardEl.appendChild(subEl);
        }

        return { cardEl, valEl, subEl };
    }

    private renderTrendsChart(trends: DailyTrendItem[]): void {
        this.chartContainer.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'da-stat-section-header';

        const title = document.createElement('div');
        title.className = 'da-stat-section-title';
        title.textContent = '近 7 天出图走势';
        header.appendChild(title);

        const legend = document.createElement('div');
        legend.className = 'da-stat-legend';
        legend.innerHTML = `
            <span class="da-stat-legend-item"><i class="da-stat-legend-dot da-stat-legend-dot--bar"></i>出图数量</span>
            <span class="da-stat-legend-item"><i class="da-stat-legend-dot da-stat-legend-dot--line"></i>平均耗时</span>
        `;
        header.appendChild(legend);
        this.chartContainer.appendChild(header);

        if (!trends || trends.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-stat-empty';
            emptyEl.textContent = '暂无近 7 天出图记录';
            this.chartContainer.appendChild(emptyEl);
            return;
        }

        // SVG 图表尺寸与边距
        const width = 560;
        const height = 126;
        const padLeft = 32;
        const padRight = 32;
        const padTop = 18;
        const padBottom = 24;
        const chartW = width - padLeft - padRight;
        const chartH = height - padTop - padBottom;

        // 计算最大值
        const maxCount = Math.max(1, ...trends.map((t) => t.count));
        const maxDuration = Math.max(1, ...trends.map((t) => t.avgDurationSec));

        const n = trends.length;
        const slotW = chartW / n;
        const barW = Math.max(8, Math.min(22, slotW * 0.45));

        // 构建 SVG 元素
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('class', 'da-stat-chart-svg');

        // 参考基准虚线 (顶、中、底)
        const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gridGroup.setAttribute('class', 'da-stat-grid-lines');
        for (const frac of [0, 0.5, 1]) {
            const y = padTop + chartH * frac;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(padLeft));
            line.setAttribute('y1', String(y));
            line.setAttribute('x2', String(width - padRight));
            line.setAttribute('y2', String(y));
            line.setAttribute('stroke', 'var(--da-border-color, rgba(255,255,255,0.06))');
            line.setAttribute('stroke-dasharray', '3 3');
            gridGroup.appendChild(line);
        }
        svg.appendChild(gridGroup);

        // 柱状图群组
        const barsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        barsGroup.setAttribute('class', 'da-stat-bars');

        // 折线图点位
        const linePoints: { x: number; y: number; dur: number }[] = [];

        trends.forEach((t, i) => {
            const centerX = padLeft + i * slotW + slotW / 2;

            // 柱高计算
            const barH = (t.count / maxCount) * chartH;
            const barX = centerX - barW / 2;
            const barY = padTop + (chartH - barH);

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', String(barX));
            rect.setAttribute('y', String(barY));
            rect.setAttribute('width', String(barW));
            rect.setAttribute('height', String(Math.max(2, barH)));
            rect.setAttribute('rx', '3');
            rect.setAttribute('ry', '3');
            rect.setAttribute('fill', 'var(--da-accent-color, #6366f1)');
            rect.setAttribute('opacity', t.count > 0 ? '0.85' : '0.2');

            const titleTip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleTip.textContent = `${t.dateLabel}：出图 ${t.count} 张，平均耗时 ${t.avgDurationSec.toFixed(1)} 秒`;
            rect.appendChild(titleTip);
            barsGroup.appendChild(rect);

            // 柱顶文字 (若出图大于 0 且柱顶有充裕空间)
            if (t.count > 0 && barH > 14) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', String(centerX));
                text.setAttribute('y', String(barY - 4));
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('font-size', '10');
                text.setAttribute('fill', 'var(--da-text-secondary, rgba(255,255,255,0.6))');
                text.textContent = String(t.count);
                barsGroup.appendChild(text);
            }

            // X 轴日期文本
            const dateText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            dateText.setAttribute('x', String(centerX));
            dateText.setAttribute('y', String(height - 6));
            dateText.setAttribute('text-anchor', 'middle');
            dateText.setAttribute('font-size', '10');
            dateText.setAttribute('fill', 'var(--da-text-muted, rgba(255,255,255,0.45))');
            dateText.textContent = t.dateLabel;
            barsGroup.appendChild(dateText);

            // 折线 Y 坐标计算
            const durY = padTop + chartH - (t.avgDurationSec / maxDuration) * chartH;
            linePoints.push({ x: centerX, y: durY, dur: t.avgDurationSec });
        });

        svg.appendChild(barsGroup);

        // 绘制折线
        if (linePoints.length > 1) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            const pts = linePoints.map((p) => `${p.x},${p.y}`).join(' ');
            line.setAttribute('points', pts);
            line.setAttribute('fill', 'none');
            line.setAttribute('stroke', 'var(--da-accent-secondary, #38bdf8)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-linejoin', 'round');
            line.setAttribute('stroke-linecap', 'round');
            svg.appendChild(line);

            // 绘制折线圆点
            linePoints.forEach((p, idx) => {
                if (p.dur > 0) {
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', String(p.x));
                    circle.setAttribute('cy', String(p.y));
                    circle.setAttribute('r', '3');
                    circle.setAttribute('fill', 'var(--da-bg-modal, #18191f)');
                    circle.setAttribute('stroke', 'var(--da-accent-secondary, #38bdf8)');
                    circle.setAttribute('stroke-width', '2');

                    const circleTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                    circleTitle.textContent = `${trends[idx].dateLabel} 平均耗时: ${p.dur.toFixed(1)} 秒`;
                    circle.appendChild(circleTitle);
                    svg.appendChild(circle);
                }
            });
        }

        this.chartContainer.appendChild(svg);
    }

    private renderRecentTasksTable(tasks: RecentTaskItem[]): void {
        this.tasksContainer.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'da-stat-section-header';

        const title = document.createElement('div');
        title.className = 'da-stat-section-title';
        title.textContent = '最近生成记录';
        header.appendChild(title);

        this.tasksContainer.appendChild(header);

        if (!tasks || tasks.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-stat-empty';
            emptyEl.textContent = '暂无历史生图记录';
            this.tasksContainer.appendChild(emptyEl);
            return;
        }

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'da-stat-table-wrapper';

        const table = document.createElement('table');
        table.className = 'da-stat-table';

        // 表头
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>时间</th>
                <th>服务后端</th>
                <th>模型 / 工作流</th>
                <th>分辨率</th>
                <th>耗时</th>
                <th>状态</th>
            </tr>
        `;
        table.appendChild(thead);

        // 表身
        const tbody = document.createElement('tbody');
        tasks.forEach((item) => {
            const tr = document.createElement('tr');

            // 格式化时间 (MM-dd HH:mm)
            const d = new Date(item.createdAt);
            const timeStr = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

            const isSuccess = item.status === 'ready';
            const statusBadge = isSuccess
                ? '<span class="da-badge da-badge--success">成功</span>'
                : `<span class="da-badge da-badge--danger" title="${item.errorMsg || '任务异常失败'}">失败</span>`;

            tr.innerHTML = `
                <td class="da-stat-td-time">${timeStr}</td>
                <td><span class="da-stat-tag">${item.backend}</span></td>
                <td class="da-stat-td-model" title="${item.model}">${item.model}</td>
                <td class="da-stat-td-dim">${item.dimension}</td>
                <td class="da-stat-td-dur">${item.durationSec > 0 ? `${item.durationSec.toFixed(1)}s` : '--'}</td>
                <td>${statusBadge}</td>
            `;

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        tableWrapper.appendChild(table);
        this.tasksContainer.appendChild(tableWrapper);
    }
}

