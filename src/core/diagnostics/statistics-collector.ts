/**
 * @module core/diagnostics/statistics-collector
 * @description 生图性能指标聚合统计与导出 (支持 JSON / CSV 导出与 LocalStorage 持久化)
 */

import { Logger } from './logger';

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

const STORAGE_KEY = 'st_drawassistant_statistics_data';

export function createDefaultStatisticsRecord(): StatisticsRecord {
    const hourlyDefault: Record<number, number> = {};
    for (let i = 0; i < 24; i++) {
        hourlyDefault[i] = 0;
    }

    return {
        id: 'main_stats',
        version: 1,
        totalTasks: 0,
        successCount: 0,
        errorCount: 0,
        cancelledCount: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        engineStats: {},
        paramStats: {
            steps: { total: 0, count: 0, min: Infinity, max: -Infinity },
            cfgScale: { total: 0, count: 0, min: Infinity, max: -Infinity },
            width: { total: 0, count: 0, min: Infinity, max: -Infinity },
            height: { total: 0, count: 0, min: Infinity, max: -Infinity },
            models: {},
            samplers: {},
            resolutions: {}
        },
        timeStats: {
            daily: {},
            hourly: hourlyDefault,
            firstTaskAt: 0,
            lastTaskAt: 0
        }
    };
}

/** 生图性能与使用频次统计器 (单例) */
export class StatisticsCollector {
    private static _instance: StatisticsCollector | null = null;
    private readonly _logger = new Logger('StatisticsCollector');

    private _record: StatisticsRecord = createDefaultStatisticsRecord();
    private _pendingTasks = new Map<string, { startTime: number; model?: string; sampler?: string; engine?: string }>();

    private constructor() {
        this.loadFromStorage();
    }

    public static getInstance(): StatisticsCollector {
        if (!this._instance) {
            this._instance = new StatisticsCollector();
        }
        return this._instance;
    }

    private loadFromStorage(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed.totalTasks === 'number') {
                        this._record = { ...createDefaultStatisticsRecord(), ...parsed };
                    }
                }
            }
        } catch (e) {
            this._logger.warn('从本地读取生图统计数据失败', e);
        }
    }

    private saveToStorage(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this._record));
            }
        } catch (e) {
            this._logger.warn('持久化生图统计数据失败', e);
        }
    }

    /** 登记新提交的任务元信息 */
    public recordTaskSubmit(taskId: string, info: { model?: string; sampler?: string; engine?: string }): void {
        this._pendingTasks.set(taskId, {
            startTime: Date.now(),
            model: info.model,
            sampler: info.sampler,
            engine: info.engine || 'comfyui'
        });
        this._record.totalTasks++;
        this.saveToStorage();
    }

    /** 记录任务成功完成指标并累加耗时与频次分布 */
    public recordTaskSuccess(taskId: string, durationMs?: number): void {
        const pending = this._pendingTasks.get(taskId);
        const actualDuration = durationMs || (pending ? Date.now() - pending.startTime : 1000);
        this._pendingTasks.delete(taskId);

        this._record.successCount++;

        if (this._record.minDurationMs === 0 || actualDuration < this._record.minDurationMs) {
            this._record.minDurationMs = actualDuration;
        }
        if (actualDuration > this._record.maxDurationMs) {
            this._record.maxDurationMs = actualDuration;
        }

        const now = Date.now();
        this._record.timeStats.lastTaskAt = now;
        if (this._record.timeStats.firstTaskAt === 0) {
            this._record.timeStats.firstTaskAt = now;
        }

        const today = new Date().toISOString().split('T')[0];
        this._record.timeStats.daily[today] = (this._record.timeStats.daily[today] || 0) + 1;

        const hour = new Date().getHours();
        this._record.timeStats.hourly[hour] = (this._record.timeStats.hourly[hour] || 0) + 1;

        if (pending?.model) {
            this._record.paramStats.models[pending.model] = (this._record.paramStats.models[pending.model] || 0) + 1;
        }
        if (pending?.sampler) {
            this._record.paramStats.samplers[pending.sampler] = (this._record.paramStats.samplers[pending.sampler] || 0) + 1;
        }

        const engineKey = pending?.engine || 'default';
        if (!this._record.engineStats[engineKey]) {
            this._record.engineStats[engineKey] = { total: 0, success: 0, error: 0, cancelled: 0, totalDurationMs: 0 };
        }
        const eng = this._record.engineStats[engineKey];
        eng.total++;
        eng.success++;
        eng.totalDurationMs += actualDuration;

        this.saveToStorage();
    }

    /** 记录任务失败或主动取消 */
    public recordTaskFailure(taskId: string, isCancelled = false): void {
        const pending = this._pendingTasks.get(taskId);
        this._pendingTasks.delete(taskId);

        if (isCancelled) {
            this._record.cancelledCount++;
        } else {
            this._record.errorCount++;
        }

        const engineKey = pending?.engine || 'default';
        if (!this._record.engineStats[engineKey]) {
            this._record.engineStats[engineKey] = { total: 0, success: 0, error: 0, cancelled: 0, totalDurationMs: 0 };
        }
        const eng = this._record.engineStats[engineKey];
        eng.total++;
        if (isCancelled) eng.cancelled++;
        else eng.error++;

        this.saveToStorage();
    }

    public getSnapshot(): StatisticsRecord {
        return JSON.parse(JSON.stringify(this._record));
    }

    public getSuccessRate(): number {
        if (this._record.totalTasks === 0) return 100;
        return Math.round((this._record.successCount / this._record.totalTasks) * 100);
    }

    public getAverageDuration(): number {
        let totalMs = 0;
        let successCount = 0;
        for (const eng of Object.values(this._record.engineStats)) {
            totalMs += eng.totalDurationMs;
            successCount += eng.success;
        }
        if (successCount === 0) return 0;
        return Math.round(totalMs / successCount);
    }

    /** 提取频次字典前 N 热门项及占比 */
    public getTopItems(dict: Record<string, number>, limit = 3): TopItem[] {
        const entries = Object.entries(dict);
        const total = entries.reduce((sum, [, count]) => sum + count, 0);
        if (total === 0) return [];

        return entries
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([name, count]) => ({
                name,
                count,
                percentage: Math.round((count / total) * 100)
            }));
    }

    /** 获取近 N 天每日生图任务趋势 */
    public getDailyTrend(days = 7): DailyTrendItem[] {
        const result: DailyTrendItem[] = [];
        const now = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            result.push({
                date: dateStr,
                count: this._record.timeStats.daily[dateStr] || 0
            });
        }

        return result;
    }

    public async reset(): Promise<void> {
        this._record = createDefaultStatisticsRecord();
        this._pendingTasks.clear();
        this.saveToStorage();
    }
}

/** 导出生图统计为 JSON 文件 */
export function exportStatisticsJSON(record: StatisticsRecord): void {
    const jsonStr = JSON.stringify(record, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st-drawassistant-stats-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/** 导出生图日趋势为 CSV 文件 */
export function exportStatisticsCSV(record: StatisticsRecord): void {
    const rows = ['Date,Count'];
    for (const [date, count] of Object.entries(record.timeStats.daily)) {
        rows.push(`${date},${count}`);
    }
    const csvStr = rows.join('\n');
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st-drawassistant-trend-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
