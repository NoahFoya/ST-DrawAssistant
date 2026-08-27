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
 * 异步保存一条结构化日志记录到 IndexedDB
 *
 * @param entry 日志对象
 * @returns 保存完成 Promise
 */
export declare function saveLogToDB(entry: StructuredLogEntry): Promise<void>;
/**
 * 从 IndexedDB 查询历史日志列表
 *
 * @param limit 最多返回的日志条数，默认为 200
 * @returns 日志数组 Promise
 */
export declare function loadLogsFromDB(limit?: number): Promise<StructuredLogEntry[]>;
/**
 * 清理早于指定天数的历史日志记录
 *
 * @param maxDays 日志保留的最大天数，默认为 7 天
 * @returns 清理完成 Promise
 */
export declare function cleanExpiredLogsInDB(maxDays?: number): Promise<void>;
/**
 * 清空所有 IndexedDB 中的日志
 */
export declare function clearLogsInDB(): Promise<void>;
//# sourceMappingURL=log-storage.d.ts.map