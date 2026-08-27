/**
 * @module storage/log-storage
 * @description 结构化日志 IndexedDB 持久化模块 (LogStorage)
 *
 * 职责：
 * - 将结构化日志异步转存至 IndexedDB 的 logs 对象仓库
 * - 支持按时间清理超过 7 天的过往日志，防止过多存储占用
 */


import { logger, type StructuredLogEntry } from '../core/logger';
import { getDB, LOGS_STORE_NAME } from './image-db';

/**
 * 异步保存一条结构化日志记录到 IndexedDB
 *
 * @param entry 日志对象
 * @returns 保存完成 Promise
 */
export async function saveLogToDB(entry: StructuredLogEntry): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(LOGS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(LOGS_STORE_NAME);
            const req = store.put(entry);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        // 保存日志错误仅做控制台警告，避免二次调用 logger.error 产生死循环
        console.warn('[ST-DA] 结构化日志保存到 IndexedDB 失败:', err);
    }
}

/**
 * 从 IndexedDB 查询历史日志列表
 *
 * @param limit 最多返回的日志条数，默认为 200
 * @returns 日志数组 Promise
 */
export async function loadLogsFromDB(limit = 200): Promise<StructuredLogEntry[]> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(LOGS_STORE_NAME, 'readonly');
            const store = tx.objectStore(LOGS_STORE_NAME);
            const req = store.getAll();

            req.onsuccess = () => {
                const res = (req.result as StructuredLogEntry[]) || [];
                if (limit > 0 && res.length > limit) {
                    resolve(res.slice(-limit));
                } else {
                    resolve(res);
                }
            };

            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        logger.warn('从 IndexedDB 读取日志失败', err);
        return [];
    }
}

/**
 * 清理早于指定天数的历史日志记录
 *
 * @param maxDays 日志保留的最大天数，默认为 7 天
 * @returns 清理完成 Promise
 */
export async function cleanExpiredLogsInDB(maxDays = 7): Promise<void> {
    try {
        const db = await getDB();
        const cutoffMs = Date.now() - maxDays * 24 * 60 * 60 * 1000;

        return new Promise((resolve, reject) => {
            const tx = db.transaction(LOGS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(LOGS_STORE_NAME);
            const req = store.openCursor();

            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                    const entry = cursor.value as StructuredLogEntry;
                    const logTime = new Date(entry.timestamp).getTime();
                    if (!isNaN(logTime) && logTime < cutoffMs) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };

            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        logger.warn('清理 IndexedDB 过期日志失败', err);
    }
}

/**
 * 清空所有 IndexedDB 中的日志
 */
export async function clearLogsInDB(): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(LOGS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(LOGS_STORE_NAME);
            const req = store.clear();

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        logger.warn('清空 IndexedDB 中的日志失败', err);
    }
}
