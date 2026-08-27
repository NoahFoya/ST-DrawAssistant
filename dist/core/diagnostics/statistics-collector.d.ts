/**
 * @module core/diagnostics/statistics-collector
 * @description 生图性能指标聚合统计与导出 (支持 JSON / CSV 导出与 LocalStorage 持久化)
 */
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
export declare function createDefaultStatisticsRecord(): StatisticsRecord;
/** 生图性能与使用频次统计器 (单例) */
export declare class StatisticsCollector {
    private static _instance;
    private readonly _logger;
    private _record;
    private _pendingTasks;
    private constructor();
    static getInstance(): StatisticsCollector;
    private loadFromStorage;
    private saveToStorage;
    /** 登记新提交的任务元信息 */
    recordTaskSubmit(taskId: string, info: {
        model?: string;
        sampler?: string;
        engine?: string;
    }): void;
    /** 记录任务成功完成指标并累加耗时与频次分布 */
    recordTaskSuccess(taskId: string, durationMs?: number): void;
    /** 记录任务失败或主动取消 */
    recordTaskFailure(taskId: string, isCancelled?: boolean): void;
    getSnapshot(): StatisticsRecord;
    getSuccessRate(): number;
    getAverageDuration(): number;
    /** 提取频次字典前 N 热门项及占比 */
    getTopItems(dict: Record<string, number>, limit?: number): TopItem[];
    /** 获取近 N 天每日生图任务趋势 */
    getDailyTrend(days?: number): DailyTrendItem[];
    reset(): Promise<void>;
}
/** 导出生图统计为 JSON 文件 */
export declare function exportStatisticsJSON(record: StatisticsRecord): void;
/** 导出生图日趋势为 CSV 文件 */
export declare function exportStatisticsCSV(record: StatisticsRecord): void;
//# sourceMappingURL=statistics-collector.d.ts.map