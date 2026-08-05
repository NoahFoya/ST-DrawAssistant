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
export type TimeRangeMode = 'day' | 'week' | 'month' | 'quarter';
export declare function renderStatisticsCard(): HTMLElement;
//# sourceMappingURL=statistics-card.d.ts.map