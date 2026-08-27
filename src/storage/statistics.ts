/**
 * @module storage/statistics
 * @description 生图统计 IndexedDB 持久化存储模块 (StatisticsDB)
 *
 * 职责：
 * - 与图片存储共用数据库 ST_DrawAssistant_DB，存储仓库为 statistics
 * - 数据以单行格式 (id = 'main_stats') 进行读写与更新
 */


import { logger } from '../core/logger';
import { getDB, STATS_STORE_NAME } from './image-db';
import { createDefaultStatisticsRecord, type StatisticsRecord } from '../statistics';

const MAIN_STATS_KEY = 'main_stats';

/**
 * 从 IndexedDB 中读取生图统计记录
 * 若不存在或读取失败，返回默认初始化的 StatisticsRecord
 */
export async function loadStatisticsFromDB(): Promise<StatisticsRecord> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STATS_STORE_NAME, 'readonly');
            const store = tx.objectStore(STATS_STORE_NAME);
            const req = store.get(MAIN_STATS_KEY);

            req.onsuccess = () => {
                const res = req.result as StatisticsRecord | undefined;
                if (res && res.version === 1) {
                    resolve(res);
                } else {
                    const defaultRecord = createDefaultStatisticsRecord();
                    resolve(defaultRecord);
                }
            };

            req.onerror = () => {
                logger.warn('从 IndexedDB 获取统计数据失败，降级使用内存初始值', req.error);
                resolve(createDefaultStatisticsRecord());
            };
        });
    } catch (err) {
        logger.warn('获取 IndexedDB 统计数据抛出异常，使用默认初始值', err);
        return createDefaultStatisticsRecord();
    }
}

/**
 * 将生图统计记录保存至 IndexedDB
 */
export async function saveStatisticsToDB(record: StatisticsRecord): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STATS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(STATS_STORE_NAME);
            const req = store.put(record);

            req.onsuccess = () => {
                logger.debug('生图统计数据成功同步至 IndexedDB');
                resolve();
            };

            req.onerror = () => {
                logger.error('保存生图统计数据到 IndexedDB 失败', req.error);
                reject(req.error);
            };
        });
    } catch (err) {
        logger.error('保存生图统计抛出异常', err);
        throw err;
    }
}

/**
 * 重置并清空 IndexedDB 中的统计记录
 */
export async function resetStatisticsInDB(): Promise<StatisticsRecord> {
    const defaultRecord = createDefaultStatisticsRecord();
    try {
        await saveStatisticsToDB(defaultRecord);
        logger.info('生图统计数据在 IndexedDB 中已重置');
    } catch (err) {
        logger.error('在 IndexedDB 中重置生图统计失败', err);
    }
    return defaultRecord;
}
