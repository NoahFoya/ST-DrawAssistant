/**
 * @module storage/image-db
 * @description 图像 IndexedDB 存储管理器 (ImageDB)
 *
 * 职责：
 * - 将生图二进制/Base64 数据存储在 IndexedDB 中
 * - 宿主 chat.json 的 msg.extra.da_images 中仅保留轻量 UUID 引用
 * - 避免 chat.json 序列化膨胀，规避 100MB+ 磁盘卡顿与存储配额崩溃
 * - 提供缩略图 WebP 高效缓存表 (THUMBNAILS_STORE_NAME)
 *
 * 规范参考：
 * - .agents/Skills/browser-storage/SKILL.md §3 (IndexedDB 存储范式)
 */

import { logger } from '../core/logger';

const DB_NAME = 'ST_DrawAssistant_DB';
export const IMAGES_STORE_NAME = 'images';
export const STATS_STORE_NAME = 'statistics';
export const LOGS_STORE_NAME = 'logs';
export const THUMBNAILS_STORE_NAME = 'thumbnails';

export interface ThumbnailRecord {
    uuid: string;
    data: string; // Base64 WebP
    width: number;
    height: number;
    updatedAt: number;
}

export interface ImageMetadata {
    provider?: string;
    ckptName?: string;
    samplerName?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    negativePrompt?: string;
}

export interface StoredImageRecord {
    uuid: string;
    data: string; // Base64 数据串或 DataURL
    mime: string;
    prompt: string;
    timestamp: number;
    metadata?: ImageMetadata;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);

        req.onerror = (e) => {
            dbPromise = null;
            const err = (e.target as IDBOpenDBRequest).error;
            logger.error('IndexedDB 打开失败', err);
            reject(err);
        };

        req.onsuccess = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            let isValidSchema = false;

            if (
                db.objectStoreNames.contains(IMAGES_STORE_NAME) &&
                db.objectStoreNames.contains(STATS_STORE_NAME) &&
                db.objectStoreNames.contains(LOGS_STORE_NAME) &&
                db.objectStoreNames.contains(THUMBNAILS_STORE_NAME)
            ) {
                try {
                    const txImg = db.transaction(IMAGES_STORE_NAME, 'readonly');
                    const storeImg = txImg.objectStore(IMAGES_STORE_NAME);
                    const txStat = db.transaction(STATS_STORE_NAME, 'readonly');
                    const storeStat = txStat.objectStore(STATS_STORE_NAME);
                    const txLog = db.transaction(LOGS_STORE_NAME, 'readonly');
                    const storeLog = txLog.objectStore(LOGS_STORE_NAME);
                    const txThumb = db.transaction(THUMBNAILS_STORE_NAME, 'readonly');
                    const storeThumb = txThumb.objectStore(THUMBNAILS_STORE_NAME);

                    if (
                        storeImg.keyPath === 'uuid' &&
                        storeStat.keyPath === 'id' &&
                        storeLog.keyPath === 'id' &&
                        storeThumb.keyPath === 'uuid'
                    ) {
                        isValidSchema = true;
                    }
                } catch (err) {
                    logger.debug('IndexedDB Schema 预检检测到演进，准备升级版本重建', err);
                    isValidSchema = false;
                }
            }

            if (isValidSchema) {
                // 监听其他 Tab 发起的版本升级请求，主动关闭旧连接
                db.onversionchange = () => {
                    db.close();
                    dbPromise = null;
                    logger.warn('IndexedDB 版本被其他页面升级，已主动关闭旧连接，将在下次操作时重新打开');
                };
                resolve(db);
                return;
            }

            // Schema 不相符（不存在 images, statistics, logs 或 thumbnails 表）：关闭连接并升级版本重建
            const currentVer = db.version || 1;
            db.close();

            const nextVer = currentVer + 1;
            const upgradeReq = indexedDB.open(DB_NAME, nextVer);

            upgradeReq.onupgradeneeded = (upgradeEvent) => {
                const upgradeDb = (upgradeEvent.target as IDBOpenDBRequest).result;
                if (!upgradeDb.objectStoreNames.contains(IMAGES_STORE_NAME)) {
                    const newStore = upgradeDb.createObjectStore(IMAGES_STORE_NAME, { keyPath: 'uuid' });
                    newStore.createIndex('by_timestamp', 'timestamp', { unique: false });
                }
                if (!upgradeDb.objectStoreNames.contains(STATS_STORE_NAME)) {
                    upgradeDb.createObjectStore(STATS_STORE_NAME, { keyPath: 'id' });
                }
                if (!upgradeDb.objectStoreNames.contains(LOGS_STORE_NAME)) {
                    const logStore = upgradeDb.createObjectStore(LOGS_STORE_NAME, { keyPath: 'id' });
                    logStore.createIndex('by_timestamp', 'timestamp', { unique: false });
                }
                if (!upgradeDb.objectStoreNames.contains(THUMBNAILS_STORE_NAME)) {
                    upgradeDb.createObjectStore(THUMBNAILS_STORE_NAME, { keyPath: 'uuid' });
                }
                logger.info('IndexedDB 数据表 (images / statistics / logs / thumbnails) 重建升级完成');
            };

            upgradeReq.onsuccess = (upgradeEvent) => {
                const upgradeDb = (upgradeEvent.target as IDBOpenDBRequest).result;
                // 升级后的新连接同样需要监听 versionchange
                upgradeDb.onversionchange = () => {
                    upgradeDb.close();
                    dbPromise = null;
                    logger.warn('IndexedDB 版本被其他页面升级，已主动关闭连接');
                };
                resolve(upgradeDb);
            };

            upgradeReq.onerror = (upgradeEvent) => {
                dbPromise = null;
                const err = (upgradeEvent.target as IDBOpenDBRequest).error;
                logger.error('IndexedDB 升级重置失败', err);
                reject(err);
            };

            // 处理升级被阅塞的情况（其他 Tab 没有响应 onversionchange 并关闭连接）
            upgradeReq.onblocked = () => {
                dbPromise = null;
                logger.error('IndexedDB 版本升级被其他页面阻塞，请关闭其他 SillyTavern 标签页后刷新');
                reject(new Error('IndexedDB 升级被阻塞'));
            };
        };
    });

    return dbPromise;
}

/**
 * 将图像数据存储至 IndexedDB (支持元数据)
 */
export async function saveImageToDB(
    uuid: string,
    data: string,
    mime: string,
    prompt: string,
    metadata?: ImageMetadata
): Promise<string> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGES_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IMAGES_STORE_NAME);

        const record: StoredImageRecord = {
            uuid,
            data,
            mime,
            prompt,
            timestamp: Date.now(),
            metadata,
        };

        const req = store.put(record);
        req.onsuccess = () => {
            logger.info(`图像数据成功保存至 IndexedDB: uuid=${uuid}`);
            resolve(uuid);
        };
        req.onerror = () => {
            logger.error(`保存图像到 IndexedDB 失败: uuid=${uuid}`, req.error);
            reject(req.error);
        };
    });
}

/**
 * 根据 UUID 从 IndexedDB 获取图像记录
 */
export async function getImageFromDB(uuid: string): Promise<StoredImageRecord | null> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IMAGES_STORE_NAME, 'readonly');
            const store = tx.objectStore(IMAGES_STORE_NAME);
            const req = store.get(uuid);

            req.onsuccess = () => {
                resolve((req.result as StoredImageRecord) || null);
            };
            req.onerror = () => {
                logger.error(`从 IndexedDB 查询图像记录失败: uuid=${uuid}`, req.error);
                reject(req.error);
            };
        });
    } catch (err) {
        logger.error(`从 IndexedDB 获取图像记录抛出致命异常 (uuid=${uuid})`, err);
        throw err;
    }
}

/**
 * 删除指定 UUID 的图像 (同时删除对应的缩略图)
 */
export async function deleteImageFromDB(uuid: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([IMAGES_STORE_NAME, THUMBNAILS_STORE_NAME], 'readwrite');
            const storeImg = tx.objectStore(IMAGES_STORE_NAME);
            const storeThumb = tx.objectStore(THUMBNAILS_STORE_NAME);

            storeImg.delete(uuid);
            storeThumb.delete(uuid);

            tx.oncomplete = () => {
                logger.info(`已从 IndexedDB 成功删除图像及缩略图: uuid=${uuid}`);
                resolve();
            };
            tx.onerror = () => {
                logger.error(`从 IndexedDB 删除图像失败: uuid=${uuid}`, tx.error);
                reject(tx.error);
            };
        });
    } catch (err) {
        logger.error(`从 IndexedDB 删除图像失败 (uuid=${uuid})`, err);
        throw err;
    }
}

/**
 * 保存 WebP 缩略图至 IndexedDB
 */
export async function saveThumbnailToDB(record: ThumbnailRecord): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(THUMBNAILS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(THUMBNAILS_STORE_NAME);
            const req = store.put(record);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        logger.warn(`保存 WebP 缩略图失败: uuid=${record.uuid}`, err);
    }
}

/**
 * 获取 WebP 缩略图
 */
export async function getThumbnailFromDB(uuid: string): Promise<ThumbnailRecord | null> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const tx = db.transaction(THUMBNAILS_STORE_NAME, 'readonly');
            const store = tx.objectStore(THUMBNAILS_STORE_NAME);
            const req = store.get(uuid);

            req.onsuccess = () => resolve((req.result as ThumbnailRecord) || null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

/**
 * 获取图库总览统计与配额
 */
export async function getGalleryStats(): Promise<{
    totalCount: number;
    totalSizeBytes: number;
    usageBytes: number;
    quotaBytes: number;
}> {
    try {
        const db = await getDB();
        let totalCount = 0;
        let totalSizeBytes = 0;

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(IMAGES_STORE_NAME, 'readonly');
            const store = tx.objectStore(IMAGES_STORE_NAME);
            const req = store.openCursor();

            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                    totalCount++;
                    const rec = cursor.value as StoredImageRecord;
                    if (rec.data) {
                        // 剥离 DataURL 前缀 (如 data:image/png;base64,) 后精确估算二进制字节数
                        const base64Str = rec.data.includes(',') ? rec.data.split(',')[1] ?? rec.data : rec.data;
                        totalSizeBytes += base64Str.length * 0.75;
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            req.onerror = () => reject(req.error);
        });

        let usageBytes = totalSizeBytes;
        let quotaBytes = 2 * 1024 * 1024 * 1024; // 默认 2GB 估算

        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            if (estimate.usage) usageBytes = estimate.usage;
            if (estimate.quota) quotaBytes = estimate.quota;
        }

        return {
            totalCount,
            totalSizeBytes: Math.round(totalSizeBytes),
            usageBytes,
            quotaBytes,
        };
    } catch (err) {
        logger.error('获取图库统计失败', err);
        return { totalCount: 0, totalSizeBytes: 0, usageBytes: 0, quotaBytes: 2 * 1024 * 1024 * 1024 };
    }
}

/**
 * 获取图库图片列表（带搜索过滤、排序与分页）
 */
export async function getGalleryImages(options: {
    limit?: number;
    offset?: number;
    searchText?: string;
    sortBy?: 'timestamp' | 'prompt';
    sortOrder?: 'asc' | 'desc';
}): Promise<{ items: StoredImageRecord[]; total: number }> {
    try {
        const db = await getDB();
        const allRecords: StoredImageRecord[] = [];

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(IMAGES_STORE_NAME, 'readonly');
            const store = tx.objectStore(IMAGES_STORE_NAME);
            const req = store.openCursor();

            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                    allRecords.push(cursor.value as StoredImageRecord);
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            req.onerror = () => reject(req.error);
        });

        let filtered = allRecords;

        // 关键词过滤
        if (options.searchText) {
            const kw = options.searchText.trim().toLowerCase();
            filtered = filtered.filter(r =>
                r.prompt.toLowerCase().includes(kw) ||
                r.uuid.toLowerCase().includes(kw) ||
                (r.metadata?.ckptName && r.metadata.ckptName.toLowerCase().includes(kw)) ||
                (r.metadata?.samplerName && r.metadata.samplerName.toLowerCase().includes(kw))
            );
        }

        // 排序
        const orderMult = (options.sortOrder ?? 'desc') === 'desc' ? -1 : 1;
        filtered.sort((a, b) => {
            if (options.sortBy === 'prompt') {
                return a.prompt.localeCompare(b.prompt) * orderMult;
            }
            return (a.timestamp - b.timestamp) * orderMult;
        });

        const total = filtered.length;
        const offset = options.offset ?? 0;
        const limit = options.limit ?? 24;
        const items = filtered.slice(offset, offset + limit);

        return { items, total };
    } catch (err) {
        logger.error('获取图库分页列表失败', err);
        return { items: [], total: 0 };
    }
}

/**
 * 物理清空 IndexedDB 中的全量生成图片与缩略图
 */
export async function clearAllImagesFromDB(): Promise<void> {
    try {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([IMAGES_STORE_NAME, THUMBNAILS_STORE_NAME], 'readwrite');
            tx.objectStore(IMAGES_STORE_NAME).clear();
            tx.objectStore(THUMBNAILS_STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        logger.info('已成功物理清空图库与缩略图 IndexedDB 数据库');
    } catch (err) {
        logger.error('物理清空图库数据库失败', err);
        throw err;
    }
}
