/**
 * @module core/performance
 * @description ST-DrawAssistant 性能指标打点收集器 (PerformanceCollector)
 *
 * 职责：
 * - 极简耗时打点（基于 performance.now() 闭包 Timer）
 * - 记录与聚合生图链路各环节耗时（WS 握手、任务提交、采样执行、图像取回）
 * - 零内存负担保留 segment 均值与近 20 次任务总耗时趋势表
 */
export interface PerformanceSpan {
    id: string;
    name: string;
    startTime: number;
    taskId?: string;
}
export interface SegmentMetric {
    name: string;
    averageMs: number;
    count: number;
    minMs: number;
    maxMs: number;
}
export interface PerformanceSummary {
    recentTasks: Array<{
        taskId: string;
        totalDurationMs: number;
        timestamp: number;
    }>;
    segments: Record<string, SegmentMetric>;
    totalMeasuredSpans: number;
}
export declare class PerformanceCollector {
    private static _instance;
    private _segments;
    private _recentTasks;
    private _totalMeasuredCount;
    private constructor();
    static getInstance(): PerformanceCollector;
    /**
     * 开始段落计时打点，返回直接结束计时的回调闭包
     */
    startTimer(name: string, taskId?: string): () => number;
    /** 兼容性方法：开始 Span */
    startSpan(name: string, taskId?: string, _attributes?: Record<string, unknown>): PerformanceSpan;
    /** 兼容性方法：结束 Span */
    endSpan(span: PerformanceSpan, _extraAttributes?: Record<string, unknown>): void;
    /**
     * 记录 segment 耗时
     */
    recordSegment(name: string, durationMs: number): void;
    /**
     * 记录一次完整生图任务的总体耗时
     */
    recordTaskDuration(taskId: string, durationMs: number): void;
    /**
     * 获取性能指标的聚合摘要
     */
    getSummary(): PerformanceSummary;
    /**
     * 重置所有性能记录
     */
    reset(): void;
}
//# sourceMappingURL=performance.d.ts.map