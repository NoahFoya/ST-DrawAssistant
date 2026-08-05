/**
 * @module core/performance
 * @description ST-DrawAssistant 性能指标打点收集器 (PerformanceCollector)
 *
 * 职责：
 * - 极简耗时打点（基于 performance.now() 闭包 Timer）
 * - 记录与聚合生图链路各环节耗时（WS 握手、任务提交、采样执行、图像取回）
 * - 零内存负担保留 segment 均值与近 20 次任务总耗时趋势表
 */


import { logger } from './logger';

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
    recentTasks: Array<{ taskId: string; totalDurationMs: number; timestamp: number }>;
    segments: Record<string, SegmentMetric>;
    totalMeasuredSpans: number;
}

interface RawSegmentAccumulator {
    totalMs: number;
    count: number;
    minMs: number;
    maxMs: number;
}

export class PerformanceCollector {
    private static _instance: PerformanceCollector | null = null;

    private _segments: Record<string, RawSegmentAccumulator> = {};
    private _recentTasks: Array<{ taskId: string; totalDurationMs: number; timestamp: number }> = [];
    private _totalMeasuredCount = 0;

    private constructor() {}

    static getInstance(): PerformanceCollector {
        if (!this._instance) {
            this._instance = new PerformanceCollector();
        }
        return this._instance;
    }

    /**
     * 开始段落计时打点，返回直接结束计时的回调闭包
     */
    startTimer(name: string, taskId?: string): () => number {
        const start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        return () => {
            const end = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            const durationMs = Math.round(end - start);
            this.recordSegment(name, durationMs);
            if (taskId) {
                logger.trace(`[Performance] ${name} (taskId=${taskId}): ${durationMs}ms`, {}, 'Performance');
            }
            return durationMs;
        };
    }

    /** 兼容性方法：开始 Span */
    startSpan(name: string, taskId?: string, _attributes?: Record<string, unknown>): PerformanceSpan {
        const id = `span_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const startTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        return { id, name, startTime, taskId };
    }

    /** 兼容性方法：结束 Span */
    endSpan(span: PerformanceSpan, _extraAttributes?: Record<string, unknown>): void {
        const endTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const durationMs = Math.round(endTime - span.startTime);
        this.recordSegment(span.name, durationMs);
    }

    /**
     * 记录 segment 耗时
     */
    recordSegment(name: string, durationMs: number): void {
        this._totalMeasuredCount++;
        let seg = this._segments[name];
        if (!seg) {
            seg = { totalMs: durationMs, count: 1, minMs: durationMs, maxMs: durationMs };
            this._segments[name] = seg;
        } else {
            seg.totalMs += durationMs;
            seg.count += 1;
            if (durationMs < seg.minMs) seg.minMs = durationMs;
            if (durationMs > seg.maxMs) seg.maxMs = durationMs;
        }
    }

    /**
     * 记录一次完整生图任务的总体耗时
     */
    recordTaskDuration(taskId: string, durationMs: number): void {
        this._recentTasks.push({
            taskId,
            totalDurationMs: durationMs,
            timestamp: Date.now(),
        });
        if (this._recentTasks.length > 20) {
            this._recentTasks.shift();
        }
    }

    /**
     * 获取性能指标的聚合摘要
     */
    getSummary(): PerformanceSummary {
        const formattedSegments: Record<string, SegmentMetric> = {};

        for (const [name, seg] of Object.entries(this._segments)) {
            formattedSegments[name] = {
                name,
                averageMs: Math.round(seg.totalMs / seg.count),
                count: seg.count,
                minMs: seg.minMs,
                maxMs: seg.maxMs,
            };
        }

        return {
            recentTasks: [...this._recentTasks],
            segments: formattedSegments,
            totalMeasuredSpans: this._totalMeasuredCount,
        };
    }

    /**
     * 重置所有性能记录
     */
    reset(): void {
        this._segments = {};
        this._recentTasks = [];
        this._totalMeasuredCount = 0;
    }
}
