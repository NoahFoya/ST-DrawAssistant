/**
 * @module storage/statistics
 * @description 生图统计 IndexedDB 持久化存储模块 (StatisticsDB)
 *
 * 职责：
 * - 与图片存储共用数据库 ST_DrawAssistant_DB，存储仓库为 statistics
 * - 数据以单行格式 (id = 'main_stats') 进行读写与更新
 */
import { type StatisticsRecord } from '../statistics';
/**
 * 从 IndexedDB 中读取生图统计记录
 * 若不存在或读取失败，返回默认初始化的 StatisticsRecord
 */
export declare function loadStatisticsFromDB(): Promise<StatisticsRecord>;
/**
 * 将生图统计记录保存至 IndexedDB
 */
export declare function saveStatisticsToDB(record: StatisticsRecord): Promise<void>;
/**
 * 重置并清空 IndexedDB 中的统计记录
 */
export declare function resetStatisticsInDB(): Promise<StatisticsRecord>;
//# sourceMappingURL=statistics.d.ts.map