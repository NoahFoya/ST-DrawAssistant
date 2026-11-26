/**
 * 运行效能与数据统计看板卡片 (StatCard)。
 *
 * @remarks
 * 基于 Preact JSX 声明式呈现生图统计指标监控：
 * 1. 4 项核心指标：累计生成总数、今日出图量、近 7 天出图总量、生成成功率（附失败数）；
 * 2. 近 7 天双指标复合 SVG 微图表：柱状呈现每日出图量，折线呈现平均耗时；
 * 3. 最近生成任务流水明细表（自动由 JSX 进行安全文本转义）。
 */

import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { ButtonControl, CardView } from '../framework/controls';

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

/** 统计看板组件属性 */
export interface StatCardProps {
    /** 卡片主标题，默认 '运行数据统计' */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 统计数据 */
    data?: GenerationStatsData;
    /** 外部加载中状态 */
    loading?: boolean;
    /** 刷新数据回调函数 */
    onRefresh?: () => void | Promise<void>;
    /** 重置统计数据回调函数 */
    onReset?: () => void | Promise<void>;
    /** 附加 CSS 类名 */
    className?: string;
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

function formatTaskTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StatCard(props: StatCardProps): VNode {
    const [isRefreshing, setIsRefreshing] = useState(false);

    const data = props.data ?? DEFAULT_STATS;
    const rate = Math.max(0, Math.min(100, data.successRate));
    const rateVariantClass =
        data.totalCount === 0 || rate >= 95
            ? 'da-stat-card--success'
            : rate >= 85
              ? 'da-stat-card--warn'
              : 'da-stat-card--danger';

    const trends = data.dailyTrends || [];
    const recentTasks = data.recentTasks || [];

    // SVG 尺寸与坐标预计算
    const width = 560;
    const height = 126;
    const padLeft = 32;
    const padRight = 32;
    const padTop = 18;
    const padBottom = 24;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const maxCount = Math.max(1, ...trends.map((t) => t.count));
    const maxDuration = Math.max(1, ...trends.map((t) => t.avgDurationSec));
    const slotW = trends.length > 0 ? chartW / trends.length : chartW;
    const barW = Math.max(8, Math.min(22, slotW * 0.45));

    const trendPoints = trends.map((t, i) => {
        const centerX = padLeft + i * slotW + slotW / 2;
        const barH = (t.count / maxCount) * chartH;
        const barX = centerX - barW / 2;
        const barY = padTop + (chartH - barH);
        const durY = padTop + chartH - (t.avgDurationSec / maxDuration) * chartH;
        return {
            item: t,
            centerX,
            barX,
            barY,
            barH,
            durY,
        };
    });

    const polylinePoints = trendPoints.map((p) => `${p.centerX},${p.durY}`).join(' ');

    const headerActions =
        props.onRefresh || props.onReset ? (
            <>
                {props.onRefresh && (
                    <ButtonControl
                        label="刷新"
                        variant="ghost"
                        size="sm"
                        loading={Boolean(props.loading || isRefreshing)}
                        onClick={async () => {
                            try {
                                setIsRefreshing(true);
                                await props.onRefresh?.();
                            } finally {
                                setIsRefreshing(false);
                            }
                        }}
                    />
                )}
                {props.onReset && (
                    <ButtonControl
                        label="重置"
                        variant="ghost"
                        size="sm"
                        onClick={() => void props.onReset?.()}
                    />
                )}
            </>
        ) : undefined;

    const rootClass = ['da-stat-card-panel', 'da-card--padded', props.className || '']
        .filter(Boolean)
        .join(' ');

    return (
        <CardView
            title={props.title ?? '运行数据统计'}
            subtitle={props.subtitle ?? '生图任务吞吐量、近 7 天走势与执行流水监控'}
            className={rootClass}
            actions={headerActions}
        >
            <div className="da-stat-grid">
                <div className="da-stat-card">
                    <div className="da-stat-card__label">累计生成</div>
                    <div className="da-stat-card__val">{`${data.totalCount.toLocaleString()} 张`}</div>
                </div>
                <div className="da-stat-card">
                    <div className="da-stat-card__label">今日出图</div>
                    <div className="da-stat-card__val">{`${data.todayCount.toLocaleString()} 张`}</div>
                </div>
                <div className="da-stat-card">
                    <div className="da-stat-card__label">近 7 日出图</div>
                    <div className="da-stat-card__val">{`${data.sevenDaysTotalCount.toLocaleString()} 张`}</div>
                </div>
                <div className={`da-stat-card ${rateVariantClass}`}>
                    <div className="da-stat-card__label">成功率</div>
                    <div className="da-stat-card__val">{`${rate.toFixed(1)}%`}</div>
                    <div className="da-stat-card__sub">{`失败 ${data.failedCount} 次`}</div>
                </div>
            </div>

            <div className="da-stat-chart-container">
                <div className="da-stat-section-header">
                    <div className="da-stat-section-title">近 7 天出图走势</div>
                    <div className="da-stat-legend">
                        <span className="da-stat-legend-item">
                            <i className="da-stat-legend-dot da-stat-legend-dot--bar" />
                            出图数量
                        </span>
                        <span className="da-stat-legend-item">
                            <i className="da-stat-legend-dot da-stat-legend-dot--line" />
                            平均耗时
                        </span>
                    </div>
                </div>

                {trends.length === 0 ? (
                    <div className="da-stat-empty">暂无近 7 天出图记录</div>
                ) : (
                    <svg viewBox={`0 0 ${width} ${height}`} className="da-stat-chart-svg">
                        <g className="da-stat-grid-lines">
                            {[0, 0.5, 1].map((frac) => {
                                const y = padTop + chartH * frac;
                                return (
                                    <line
                                        key={frac}
                                        x1={String(padLeft)}
                                        y1={String(y)}
                                        x2={String(width - padRight)}
                                        y2={String(y)}
                                        stroke="var(--da-border-color, rgba(255,255,255,0.06))"
                                        stroke-dasharray="3 3"
                                    />
                                );
                            })}
                        </g>

                        <g className="da-stat-bars">
                            {trendPoints.map((pt) => (
                                <g key={pt.item.dateLabel}>
                                    <rect
                                        x={String(pt.barX)}
                                        y={String(pt.barY)}
                                        width={String(barW)}
                                        height={String(Math.max(2, pt.barH))}
                                        rx="3"
                                        ry="3"
                                        fill="var(--da-accent-color, #6366f1)"
                                        opacity={pt.item.count > 0 ? '0.85' : '0.2'}
                                    >
                                        <title>
                                            {`${pt.item.dateLabel}：出图 ${pt.item.count} 张，平均耗时 ${pt.item.avgDurationSec.toFixed(1)} 秒`}
                                        </title>
                                    </rect>
                                    {pt.item.count > 0 && pt.barH > 14 && (
                                        <text
                                            x={String(pt.centerX)}
                                            y={String(pt.barY - 4)}
                                            text-anchor="middle"
                                            font-size="10"
                                            fill="var(--da-text-secondary, rgba(255,255,255,0.6))"
                                        >
                                            {String(pt.item.count)}
                                        </text>
                                    )}
                                    <text
                                        x={String(pt.centerX)}
                                        y={String(height - 6)}
                                        text-anchor="middle"
                                        font-size="10"
                                        fill="var(--da-text-muted, rgba(255,255,255,0.45))"
                                    >
                                        {pt.item.dateLabel}
                                    </text>
                                </g>
                            ))}
                        </g>

                        {trendPoints.length > 1 && (
                            <polyline
                                points={polylinePoints}
                                fill="none"
                                stroke="var(--da-accent-secondary, #38bdf8)"
                                stroke-width="2"
                                stroke-linejoin="round"
                                stroke-linecap="round"
                            />
                        )}

                        {trendPoints.map((pt) =>
                            pt.item.avgDurationSec > 0 ? (
                                <circle
                                    key={`dot-${pt.item.dateLabel}`}
                                    cx={String(pt.centerX)}
                                    cy={String(pt.durY)}
                                    r="3"
                                    fill="var(--da-bg-modal, #18191f)"
                                    stroke="var(--da-accent-secondary, #38bdf8)"
                                    stroke-width="2"
                                >
                                    <title>
                                        {`${pt.item.dateLabel} 平均耗时: ${pt.item.avgDurationSec.toFixed(1)} 秒`}
                                    </title>
                                </circle>
                            ) : null
                        )}
                    </svg>
                )}
            </div>

            <div className="da-stat-tasks-container">
                <div className="da-stat-section-header">
                    <div className="da-stat-section-title">最近生成记录</div>
                </div>

                {recentTasks.length === 0 ? (
                    <div className="da-stat-empty">暂无历史生图记录</div>
                ) : (
                    <div className="da-stat-table-wrapper">
                        <table className="da-stat-table">
                            <thead>
                                <tr>
                                    <th>时间</th>
                                    <th>服务后端</th>
                                    <th>模型 / 工作流</th>
                                    <th>分辨率</th>
                                    <th>耗时</th>
                                    <th>状态</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentTasks.map((item) => {
                                    const isSuccess = item.status === 'ready';
                                    return (
                                        <tr key={item.id}>
                                            <td className="da-stat-td-time">
                                                {formatTaskTime(item.createdAt)}
                                            </td>
                                            <td>
                                                <span className="da-stat-tag">{item.backend}</span>
                                            </td>
                                            <td className="da-stat-td-model" title={item.model}>
                                                {item.model}
                                            </td>
                                            <td className="da-stat-td-dim">{item.dimension}</td>
                                            <td className="da-stat-td-dur">
                                                {item.durationSec > 0
                                                    ? `${item.durationSec.toFixed(1)}s`
                                                    : '--'}
                                            </td>
                                            <td>
                                                <span
                                                    className={
                                                        isSuccess
                                                            ? 'da-badge da-badge--success'
                                                            : 'da-badge da-badge--danger'
                                                    }
                                                    title={
                                                        isSuccess
                                                            ? undefined
                                                            : item.errorMsg || '任务异常失败'
                                                    }
                                                >
                                                    {isSuccess ? '成功' : '失败'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </CardView>
    );
}
