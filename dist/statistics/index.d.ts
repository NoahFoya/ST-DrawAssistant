/**
 * 生图统计系统核心单文件模块 (Statistics Module)
 *
 * 物理合并原 types, collector, aggregator, exporter 模块：
 * - 无缝订阅 TaskManager 生命周期事件，无侵入式采集生图指标
 * - 维护内存中的当前统计快照（零延迟 UI 读取）
 * - 惰性计算成功率、平均耗时、Top 5 偏好排名与日生图趋势
 * - 提供 JSON 与 CSV 格式文件导出支持
 */
import type { TaskManager } from '../task/manager';
export interface EngineStatItem {
    total: number;
    success: number;
    error: number;
    cancelled: number;
    totalDurationMs: number;
}
export interface ParamRangeStat {
    total: number;
    count: number;
    min: number;
    max: number;
}
export interface ParamStats {
    steps: ParamRangeStat;
    cfgScale: ParamRangeStat;
    width: ParamRangeStat;
    height: ParamRangeStat;
    models: Record<string, number>;
    samplers: Record<string, number>;
    resolutions: Record<string, number>;
}
export interface TimeStats {
    daily: Record<string, number>;
    hourly: Record<number, number>;
    firstTaskAt: number;
    lastTaskAt: number;
}
export interface StatisticsRecord {
    id: 'main_stats';
    version: 1;
    totalTasks: number;
    successCount: number;
    errorCount: number;
    cancelledCount: number;
    minDurationMs: number;
    maxDurationMs: number;
    engineStats: Record<string, EngineStatItem>;
    paramStats: ParamStats;
    timeStats: TimeStats;
}
export interface TopItem {
    name: string;
    count: number;
    percentage: number;
}
export interface DailyTrendItem {
    date: string;
    count: number;
}
/**
 * 创建默认的生图统计初始对象
 */
export declare function createDefaultStatisticsRecord(): StatisticsRecord;
export declare class StatisticsCollector {
    private static _instance;
    private _record;
    private _pendingTasks;
    private _dirtyCount;
    private _saveTimer;
    private _initialized;
    private constructor();
    static getInstance(): StatisticsCollector;
    /**
     * 初始化采集器并订阅 TaskManager 事件
     */
    init(taskManager: TaskManager): Promise<void>;
    /** 获取当前生图统计快照 */
    getSnapshot(): StatisticsRecord;
    /** 重置所有统计数据 */
    reset(): Promise<void>;
    /** 计算总体成功率 (0 - 100) */
    getSuccessRate(): number;
    /** 计算全局平均耗时 (ms) */
    getAverageDuration(): number;
    /** 获取指定频次 Map 的 Top N 排名 */
    getTopItems(map: Record<string, number>, topN?: number): TopItem[];
    /** 获取最近 N 天的每日任务趋势 */
    getDailyTrend(days?: number): DailyTrendItem[];
    /** 清理超过指定天数的过往日统计 */
    cleanExpiredDailyStats(maxDays?: number): void;
    private _handleSubmit;
    private _handleComplete;
    private _handleError;
    private _handleCancelled;
    private _ensureEngineStats;
    private _updateParamRange;
    private _markDirty;
    flush(): Promise<void>;
}
export declare function exportStatisticsJSON(record: StatisticsRecord): void;
export declare function exportStatisticsCSV(_record: StatisticsRecord): void;
//# sourceMappingURL=index.d.ts.map