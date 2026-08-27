/**
 * @module storage/image-db
 * @description 图像数据库存储与图库服务 (ImageDB)
 *
 * 职责：
 * - 将生图 Base64 数据与 WebP 缩略图存储在 IndexedDB 中，宿主聊天记录仅保留 UUID 引用，防止聊天文件膨胀导致卡顿
 * - 提供图库数据的查询、分页、检索、导出与物理清理方法
 */

import { logger } from '../core/logger';
import { globalEventBus, DA_EVENTS } from '../core/event-bus';
import { FeedbackService } from '../ui/feedback-service';

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
    clipName?: string;
    vaeName?: string;
    samplerName?: string;
    scheduler?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    fullPositivePrompt?: string;
    fullNegativePrompt?: string;
    negativePrompt?: string;
    seed?: number;
    denoise?: number;
    maskBlur?: number;
    growMaskBy?: number;
}

export interface StoredImageRecord {
    uuid: string;
    data: string; // Base64 数据串或 DataURL
    mime: string;
    prompt: string; // 原生正向词 (rawPositive)
    rawNegativePrompt?: string; // 原生反向词 (rawNegative，无则为空)
    timestamp: number;
    seed?: number;
    metadata?: ImageMetadata;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function setupObjectStores(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(IMAGES_STORE_NAME)) {
        const newStore = db.createObjectStore(IMAGES_STORE_NAME, { keyPath: 'uuid' });
        newStore.createIndex('by_timestamp', 'timestamp', { unique: false });
    }
    if (!db.objectStoreNames.contains(STATS_STORE_NAME)) {
        db.createObjectStore(STATS_STORE_NAME, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(LOGS_STORE_NAME)) {
        const logStore = db.createObjectStore(LOGS_STORE_NAME, { keyPath: 'id' });
        logStore.createIndex('by_timestamp', 'timestamp', { unique: false });
    }
    if (!db.objectStoreNames.contains(THUMBNAILS_STORE_NAME)) {
        db.createObjectStore(THUMBNAILS_STORE_NAME, { keyPath: 'uuid' });
    }
}

export function getDB(): Promise<IDBDatabase> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB 在当前无 DOM 环境 (Node.js/Vitest) 不可用'));
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        // 不指定版本号，打开存量数据库的既有版本 (若不存在则默认以 Version 1 创建)
        const req = indexedDB.open(DB_NAME);

        req.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            setupObjectStores(db);
            logger.info('IndexedDB 数据表 (images / statistics / logs / thumbnails) 初始化建表/升级完成');
        };

        req.onerror = (e) => {
            dbPromise = null;
            const err = (e.target as IDBOpenDBRequest).error;
            logger.error('IndexedDB 打开失败', err);
            reject(err);
        };

        req.onblocked = () => {
            dbPromise = null;
            logger.error('IndexedDB 打开被其他页面阻塞');
            FeedbackService.toastWarning('数据库打开被其他酒馆页签阻塞，请关闭多余标签页后刷新', '数据库锁定');
            reject(new Error('IndexedDB 被阻塞'));
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
                isValidSchema = true;
            }

            if (isValidSchema) {
                db.onversionchange = () => {
                    db.close();
                    dbPromise = null;
                    logger.warn('IndexedDB 版本被其他页面升级，已主动关闭旧连接，将在下次操作时重新打开');
                };
                resolve(db);
                return;
            }

            // 若已有数据库缺少建表，关闭连接并以 currentVer + 1 递增升级
            const currentVer = db.version || 1;
            db.close();

            const nextVer = currentVer + 1;
            const upgradeReq = indexedDB.open(DB_NAME, nextVer);

            upgradeReq.onupgradeneeded = (upgradeEvent) => {
                const upgradeDb = (upgradeEvent.target as IDBOpenDBRequest).result;
                setupObjectStores(upgradeDb);
            };

            upgradeReq.onsuccess = (upgradeEvent) => {
                const upgradeDb = (upgradeEvent.target as IDBOpenDBRequest).result;
                upgradeDb.onversionchange = () => {
                    upgradeDb.close();
                    dbPromise = null;
                };
                resolve(upgradeDb);
            };

            upgradeReq.onerror = (upgradeEvent) => {
                dbPromise = null;
                const err = (upgradeEvent.target as IDBOpenDBRequest).error;
                logger.error('IndexedDB 升级失败', err);
                reject(err);
            };

            upgradeReq.onblocked = () => {
                dbPromise = null;
                logger.error('IndexedDB 升级被其他页面阻塞');
                FeedbackService.toastWarning('数据库升级被其他酒馆页签阻塞，请关闭多余标签页后刷新', '数据库锁定');
                reject(new Error('IndexedDB 升级被阻塞'));
            };
        };
    });

    return dbPromise;
}

/**
 * 将图像数据存储至 IndexedDB (支持元数据与配额溢出处理)
 */
export async function saveImageToDB(
    uuid: string,
    data: string,
    mime: string,
    prompt: string,
    metadata?: ImageMetadata,
    rawNegativePrompt?: string
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
            rawNegativePrompt,
            timestamp: Date.now(),
            seed: metadata?.seed,
            metadata,
        };

        const req = store.put(record);
        req.onsuccess = () => {
            logger.info(`图像数据成功保存至 IndexedDB: uuid=${uuid}`);
            globalEventBus.emit(DA_EVENTS.GALLERY_CHANGED);
            resolve(uuid);
        };
        req.onerror = () => {
            const err = req.error;
            if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
                FeedbackService.toastError('浏览器存储配额已满，图像无法保存！请清理历史图库或孤立图片。', '存储空间不足');
            }
            logger.error(`保存图像到 IndexedDB 失败: uuid=${uuid}`, err);
            reject(err);
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
 * 批量高效删除指定 UUID 列表的图像及缩略图 (在单个 readwrite 事务内完成)
 */
export async function deleteImagesBatchFromDB(uuids: Iterable<string>): Promise<number> {
    const uuidList = Array.from(uuids);
    if (uuidList.length === 0) return 0;

    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([IMAGES_STORE_NAME, THUMBNAILS_STORE_NAME], 'readwrite');
            const storeImg = tx.objectStore(IMAGES_STORE_NAME);
            const storeThumb = tx.objectStore(THUMBNAILS_STORE_NAME);

            for (const uuid of uuidList) {
                storeImg.delete(uuid);
                storeThumb.delete(uuid);
            }

            tx.oncomplete = () => {
                logger.info(`已从 IndexedDB 成功单事务批量删除 ${uuidList.length} 张图像及缩略图`);
                resolve(uuidList.length);
            };
            tx.onerror = () => {
                logger.error('从 IndexedDB 批量删除图像失败', tx.error);
                reject(tx.error);
            };
        });
    } catch (err) {
        logger.error('从 IndexedDB 批量删除图像抛出致命异常', err);
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
        throw err;
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

// ─── 图库门面服务（原 gallery-service.ts，已合并）────────────────────────────
//
// 所有图库高层操作通过此区块暴露，内部自动广播 DA_EVENTS.GALLERY_CHANGED 通知 UI 刷新。
// 导入路径：import { galleryDeleteImage, galleryGetStats, ... } from './image-db';

/**
 * 订阅图库数据变动
 * @returns unsubscribe 函数，配合 DisposableBag 使用
 */
export function subscribeGalleryChange(listener: () => void): () => void {
    return globalEventBus.on(DA_EVENTS.GALLERY_CHANGED, listener);
}

/**
 * 获取当前 IndexedDB 存储空间与图片数量统计
 */
export async function galleryGetStats() {
    return getGalleryStats();
}

/**
 * 删除指定 UUID 的单张图像并广播变更通知
 */
export async function galleryDeleteImage(uuid: string): Promise<void> {
    await deleteImageFromDB(uuid);
    logger.info(`图库: 成功物理删除图像 [${uuid}]`);
    globalEventBus.emit(DA_EVENTS.GALLERY_CHANGED);
}

/**
 * 批量删除图像并广播变更通知
 */
export async function galleryDeleteBatch(uuids: Iterable<string>): Promise<number> {
    const count = await deleteImagesBatchFromDB(uuids);
    logger.info(`图库: 成功批量物理删除 ${count} 张图像`);
    globalEventBus.emit(DA_EVENTS.GALLERY_CHANGED);
    return count;
}

/**
 * 扫描全库未被聊天引用的孤立废图
 */
export async function galleryScanIsolated(): Promise<string[]> {
    const { findIsolatedImages } = await import('./chat-scanner');
    return findIsolatedImages();
}

/**
 * 物理清理全库孤立废图并广播变更通知
 */
export async function galleryCleanIsolated(): Promise<number> {
    const { deleteIsolatedImages } = await import('./chat-scanner');
    const count = await deleteIsolatedImages();
    logger.info(`图库: 成功彻底清理 ${count} 张孤立废图`);
    globalEventBus.emit(DA_EVENTS.GALLERY_CHANGED);
    return count;
}

/**
 * 物理重置并清空所有存储的图像数据，广播变更通知
 */
export async function galleryResetAllStorage(): Promise<void> {
    await clearAllImagesFromDB();
    logger.info('图库: 已清空 IndexedDB 中的所有图库数据');
    globalEventBus.emit(DA_EVENTS.GALLERY_CHANGED);
}
