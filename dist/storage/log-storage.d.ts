/**
 * @module storage/log-storage
 * @description 结构化日志 IndexedDB 持久化模块 (LogStorage)
 *
 * 职责：
 * - 将结构化日志异步转存至 IndexedDB 的 logs 对象仓库
 * - 支持按时间清理超过 7 天的过往日志，防止过多存储占用
 */
import { type StructuredLogEntry } from '../core/logger';
/**
 * 异步保存一条结构化日志到 IndexedDB
 */
export declare function saveLogToDB(entry: StructuredLogEntry): Promise<void>;
/**
 * 从 IndexedDB 查询历史日志
 */
export declare function loadLogsFromDB(limit?: number): Promise<StructuredLogEntry[]>;
/**
 * 清理超过 maxDays 天数 (默认 7 天) 的旧日志
 */
export declare function cleanExpiredLogsInDB(maxDays?: number): Promise<void>;
/**
 * 清空所有 IndexedDB 中的日志
 */
export declare function clearLogsInDB(): Promise<void>;
//# sourceMappingURL=log-storage.d.ts.map