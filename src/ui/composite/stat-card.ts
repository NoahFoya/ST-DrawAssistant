/**
 * 运行效能与数据统计看板卡片 (StatCard)。
 *
 * @remarks
 * 负责呈现生图统计指标监控：
 * 1. 标准化装配 Card 基础容器组件，支持折叠与头部统一操作；
 * 2. 聚合 4 项核心指标：累计生成总数、今日出图量、生成成功率（附失败数）、平均耗时；
 * 3. 状态感知健康变体：按成功率阈值显示状态色彩（绿色、黄色、红色）；
 * 4. 局部文本更新机制，提供数据刷新与重置回调。
 */

import type { UIComponent } from '../types';
import { Card } from '../components/card';
import { Button } from '../components/button';

/** 生图运行核心统计数据模型 */
export interface GenerationStatsData {
    /** 累计出图总数 */
    readonly totalCount: number;
    /** 今日出图数量 */
    readonly todayCount: number;
    /** 成功生成次数 */
    readonly successCount: number;
    /** 失败异常次数 */
    readonly failedCount: number;
    /** 成功率百分比 (0 ~ 100) */
    readonly successRate: number;
    /** 平均生成耗时（秒） */
    readonly averageDurationSec: number;
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
    rateElements: StatItemElements;
    durationElements: StatItemElements;
}

const DEFAULT_STATS: GenerationStatsData = {
    totalCount: 0,
    todayCount: 0,
    successCount: 0,
    failedCount: 0,
    successRate: 100,
    averageDurationSec: 0,
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
    private readonly rateElements: StatItemElements;
    private readonly durationElements: StatItemElements;

    private currentData: GenerationStatsData;

    public constructor(options: StatCardOptions = {}) {
        this.currentData = options.initialData ?? DEFAULT_STATS;

        // 1. 初始化标准 Card 容器
        this.card = new Card({
            title: options.title ?? '运行数据统计',
            subtitle: options.subtitle ?? '生图任务吞吐量、平均耗时与运行稳定性监控',
            collapsible: true,
            defaultCollapsed: false,
        });

        this.element = this.card.element;
        if (options.className) {
            this.element.classList.add(options.className);
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
        this.rateElements = metrics.rateElements;
        this.durationElements = metrics.durationElements;

        // 4. 初始数据渲染
        this.updateStats(this.currentData);
    }

    /**
     * 动态局部更新统计指标数值与色彩修饰。
     *
     * @param data 统计数据
     */
    public updateStats(data: GenerationStatsData): void {
        this.currentData = data;

        // 1. 累计出图总量
        this.totalElements.valEl.textContent = `${data.totalCount.toLocaleString()} 张`;

        // 2. 今日出图量
        this.todayElements.valEl.textContent = `${data.todayCount.toLocaleString()} 张`;

        // 3. 成功率与失败小副标
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

        // 4. 平均耗时
        const dur = Math.max(0, data.averageDurationSec);
        this.durationElements.valEl.textContent = dur > 0 ? `${dur.toFixed(1)} 秒` : '--';
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

    // ─────────────────────────────────────────────────────────────
    // 私有辅助方法
    // ─────────────────────────────────────────────────────────────

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

        // 3. 成功率卡片
        const rateElements = this.createMetricCard('成功率', '100.0%', '失败 0 次');
        grid.appendChild(rateElements.cardEl);

        // 4. 平均耗时卡片
        const durationElements = this.createMetricCard('平均耗时', '--');
        grid.appendChild(durationElements.cardEl);

        body.appendChild(grid);

        return {
            totalElements,
            todayElements,
            rateElements,
            durationElements,
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
}
