/**
 * 生图统计系统核心单文件模块 (Statistics Module)
 *
 * 物理合并原 types, collector, aggregator, exporter 模块：
 * - 无缝订阅 TaskManager 生命周期事件，无侵入式采集生图指标
 * - 维护内存中的当前统计快照（零延迟 UI 读取）
 * - 惰性计算成功率、平均耗时、Top 5 偏好排名与日生图趋势
 * - 提供 JSON 与 CSV 格式文件导出支持
 */

import { logger } from '../core/logger';
import type { TaskManager } from '../task/manager';
import type { GenerateOptions, GenerateResult } from '../drivers/types';
import { loadStatisticsFromDB, saveStatisticsToDB, resetStatisticsInDB } from '../storage/statistics';

// ─── 1. 类型定义 ─────────────────────────────────────────────────────────────

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

interface PendingTaskInfo {
    params: GenerateOptions;
    driverName: string;
    submittedAt: number;
}

/**
 * 创建默认的生图统计初始对象
 */
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
            resolutions: {},
        },
        timeStats: {
            daily: {},
            hourly: hourlyDefault,
            firstTaskAt: 0,
            lastTaskAt: 0,
        },
    };
}

// ─── 2. 单例采集与聚合器 ──────────────────────────────────────────────────────

export class StatisticsCollector {
    private static _instance: StatisticsCollector | null = null;

    private _record: StatisticsRecord = createDefaultStatisticsRecord();
    private _pendingTasks: Map<string, PendingTaskInfo> = new Map();

    private _dirtyCount = 0;
    private _saveTimer: number | null = null;
    private _initialized = false;

    private constructor() {}

    static getInstance(): StatisticsCollector {
        if (!this._instance) {
            this._instance = new StatisticsCollector();
        }
        return this._instance;
    }

    /**
     * 初始化采集器并订阅 TaskManager 事件
     */
    async init(taskManager: TaskManager): Promise<void> {
        if (this._initialized) return;

        try {
            this._record = await loadStatisticsFromDB();
            this.cleanExpiredDailyStats(90);

            taskManager.on('submit', (taskId, params, driverName) => {
                this._handleSubmit(taskId, params, driverName);
            });
            taskManager.on('complete', (taskId, result) => {
                this._handleComplete(taskId, result);
            });
            taskManager.on('error', (taskId, error) => {
                this._handleError(taskId, error);
            });
            taskManager.on('cancelled', (taskId) => {
                this._handleCancelled(taskId);
            });

            this._initialized = true;
            logger.info('生图统计采集器 (StatisticsCollector) 初始化成功', {}, 'Statistics');
        } catch (err) {
            logger.error('初始化生图统计采集器失败', err, 'Statistics');
        }
    }

    /** 获取当前生图统计快照 */
    getSnapshot(): StatisticsRecord {
        return JSON.parse(JSON.stringify(this._record)) as StatisticsRecord;
    }

    /** 重置所有统计数据 */
    async reset(): Promise<void> {
        this._pendingTasks.clear();
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        this._dirtyCount = 0;
        this._record = await resetStatisticsInDB();
        logger.info('生图统计已成功重置', {}, 'Statistics');
    }

    // ─── 3. 惰性聚合计算辅助 Getter 方法 ────────────────────────────────────

    /** 计算总体成功率 (0 - 100) */
    getSuccessRate(): number {
        if (this._record.totalTasks <= 0) return 0;
        return Number(((this._record.successCount / this._record.totalTasks) * 100).toFixed(1));
    }

    /** 计算全局平均耗时 (ms) */
    getAverageDuration(): number {
        let totalDuration = 0;
        let totalSuccess = 0;
        for (const item of Object.values(this._record.engineStats)) {
            totalDuration += item.totalDurationMs || 0;
            totalSuccess += item.success || 0;
        }
        if (totalSuccess <= 0) return 0;
        return Math.round(totalDuration / totalSuccess);
    }

    /** 获取指定频次 Map 的 Top N 排名 */
    getTopItems(map: Record<string, number>, topN = 5): TopItem[] {
        const entries = Object.entries(map);
        if (entries.length === 0) return [];

        const totalCount = entries.reduce((acc, [, val]) => acc + val, 0);
        entries.sort((a, b) => b[1] - a[1]);

        return entries.slice(0, topN).map(([name, count]) => ({
            name,
            count,
            percentage: totalCount > 0 ? Number(((count / totalCount) * 100).toFixed(1)) : 0,
        }));
    }

    /** 获取最近 N 天的每日任务趋势 */
    getDailyTrend(days = 7): DailyTrendItem[] {
        const result: DailyTrendItem[] = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const count = this._record.timeStats.daily[dateStr] ?? 0;
            result.push({ date: dateStr, count });
        }
        return result;
    }

    /** 清理超过指定天数的过往日统计 */
    cleanExpiredDailyStats(maxDays = 90): void {
        const now = new Date();
        const cutoffMs = now.getTime() - maxDays * 24 * 60 * 60 * 1000;
        let modified = false;

        for (const dateStr of Object.keys(this._record.timeStats.daily)) {
            const [y, m, d] = dateStr.split('-').map(Number);
            if (y && m && d) {
                const dateObj = new Date(y, m - 1, d);
                if (dateObj.getTime() < cutoffMs) {
                    delete this._record.timeStats.daily[dateStr];
                    modified = true;
                }
            }
        }
        if (modified) this._markDirty();
    }

    // ─── 4. 事件处理内部逻辑 ───────────────────────────────────────────────

    private _handleSubmit(taskId: string, params: GenerateOptions, driverName: string): void {
        const now = Date.now();
        this._pendingTasks.set(taskId, { params, driverName, submittedAt: now });

        this._record.totalTasks++;
        this._ensureEngineStats(driverName);
        this._record.engineStats[driverName].total++;

        if (this._record.timeStats.firstTaskAt === 0) {
            this._record.timeStats.firstTaskAt = now;
        }
        this._record.timeStats.lastTaskAt = now;

        const nowDate = new Date(now);
        const dateKey = nowDate.toISOString().split('T')[0];
        const hourKey = nowDate.getHours();

        this._record.timeStats.daily[dateKey] = (this._record.timeStats.daily[dateKey] ?? 0) + 1;
        this._record.timeStats.hourly[hourKey] = (this._record.timeStats.hourly[hourKey] ?? 0) + 1;

        this._markDirty();
    }

    private _handleComplete(taskId: string, _result: GenerateResult): void {
        const pending = this._pendingTasks.get(taskId);
        if (!pending) return;

        const durationMs = Date.now() - pending.submittedAt;
        const { params, driverName } = pending;

        this._record.successCount++;
        if (this._record.minDurationMs === 0 || durationMs < this._record.minDurationMs) {
            this._record.minDurationMs = durationMs;
        }
        if (durationMs > this._record.maxDurationMs) {
            this._record.maxDurationMs = durationMs;
        }

        this._ensureEngineStats(driverName);
        const eng = this._record.engineStats[driverName];
        eng.success++;
        eng.totalDurationMs += durationMs;

        const ps = this._record.paramStats;
        this._updateParamRange(ps.steps, params.steps);
        this._updateParamRange(ps.cfgScale, params.cfgScale);
        this._updateParamRange(ps.width, params.width);
        this._updateParamRange(ps.height, params.height);

        if (params.ckptName) ps.models[params.ckptName] = (ps.models[params.ckptName] ?? 0) + 1;
        if (params.samplerName) ps.samplers[params.samplerName] = (ps.samplers[params.samplerName] ?? 0) + 1;
        const resKey = `${params.width}×${params.height}`;
        ps.resolutions[resKey] = (ps.resolutions[resKey] ?? 0) + 1;

        this._pendingTasks.delete(taskId);
        this._markDirty();
    }

    private _handleError(taskId: string, _error: Error): void {
        const pending = this._pendingTasks.get(taskId);
        if (!pending) return;

        this._record.errorCount++;
        this._ensureEngineStats(pending.driverName);
        this._record.engineStats[pending.driverName].error++;

        this._pendingTasks.delete(taskId);
        this._markDirty();
    }

    private _handleCancelled(taskId: string): void {
        const pending = this._pendingTasks.get(taskId);
        if (!pending) return;

        this._record.cancelledCount++;
        this._ensureEngineStats(pending.driverName);
        this._record.engineStats[pending.driverName].cancelled++;

        this._pendingTasks.delete(taskId);
        this._markDirty();
    }

    private _ensureEngineStats(driverName: string): void {
        if (!this._record.engineStats[driverName]) {
            this._record.engineStats[driverName] = { total: 0, success: 0, error: 0, cancelled: 0, totalDurationMs: 0 };
        }
    }

    private _updateParamRange(stat: { total: number; count: number; min: number; max: number }, val: number): void {
        if (typeof val !== 'number' || isNaN(val)) return;
        stat.total += val;
        stat.count++;
        if (val < stat.min) stat.min = val;
        if (val > stat.max) stat.max = val;
    }

    private _markDirty(): void {
        this._dirtyCount++;
        if (this._dirtyCount >= 10) {
            // 变更满 10 次时清除待执行的延迟 Timer 并立即刷盘
            if (this._saveTimer) {
                clearTimeout(this._saveTimer);
                this._saveTimer = null;
            }
            void this.flush();
            return;
        }
        if (!this._saveTimer) {
            this._saveTimer = window.setTimeout(() => { void this.flush(); }, 30_000);
        }
    }

    async flush(): Promise<void> {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (this._dirtyCount === 0) return;
        try {
            await saveStatisticsToDB(this._record);
            this._dirtyCount = 0;
        } catch (err) {
            logger.error('保存生图统计到 IndexedDB 失败', err, 'Statistics');
        }
    }
}

// ─── 5. 极简导出导出辅助函数 ──────────────────────────────────────────────

export function exportStatisticsJSON(record: StatisticsRecord): void {
    const payload = JSON.stringify(record, null, 2);
    downloadBlob(payload, `st_draw_assistant_stats_${new Date().toISOString().split('T')[0]}.json`, 'application/json;charset=utf-8;');
}

export function exportStatisticsCSV(_record: StatisticsRecord): void {
    const collector = StatisticsCollector.getInstance();
    const dailyTrend = collector.getDailyTrend(30);

    let csvContent = '\uFEFF日期 (Date),每日生图次数 (Count)\n';
    for (const item of dailyTrend) {
        csvContent += `${item.date},${item.count}\n`;
    }
    downloadBlob(csvContent, `st_draw_assistant_daily_stats_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv;charset=utf-8;');
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
