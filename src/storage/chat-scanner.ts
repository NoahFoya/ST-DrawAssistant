/**
 * @module storage/chat-scanner
 * @description 聊天记录图片引用与孤立文件清理分析器 (ChatScanner)
 *
 * 职责：
 * - 扫描宿主当前聊天消息中引用的所有图片 UUID 集合
 * - 响应宿主 CHAT_DELETED 事件（当且仅当用户开启 autoCleanupOnChatDelete 时执行即时物理擦除）
 * - 对比 IndexedDB 中的全量图片，找出未被任何消息引用的废弃图片并提供清理方法，释放存储空间
 */

import { getContext } from '../core/context';
import { logger } from '../core/logger';
import { loadSettings } from '../settings/manager';
import { getDB, IMAGES_STORE_NAME, deleteImagesBatchFromDB } from './image-db';

/**
 * 从消息列表中解析提取所有 da_images 图片 UUID 集合
 */
export function extractUuidsFromMessages(messages: unknown[]): Set<string> {
    const uuids = new Set<string>();
    if (!Array.isArray(messages)) return uuids;

    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;
        const extra = (msg as { extra?: Record<string, unknown> }).extra;
        if (!extra || typeof extra !== 'object') continue;

        const daImages = extra['da_images'] as Record<string | number, unknown> | undefined;
        if (!daImages || typeof daImages !== 'object') continue;

        for (const swipeData of Object.values(daImages)) {
            if (typeof swipeData === 'object' && swipeData !== null) {
                const directUuid = (swipeData as { uuid?: string }).uuid;
                if (directUuid && typeof directUuid === 'string') {
                    uuids.add(directUuid);
                }
                for (const imgItem of Object.values(swipeData as Record<string, unknown>)) {
                    if (typeof imgItem === 'object' && imgItem !== null) {
                        const uuid = (imgItem as { uuid?: string }).uuid;
                        if (uuid && typeof uuid === 'string') {
                            uuids.add(uuid);
                        }
                    }
                }
            }
        }
    }
    return uuids;
}

/**
 * 扫描当前聊天面板中被引用的全部 UUID 集合
 */
export async function scanChatReferences(): Promise<Set<string>> {
    try {
        const ctx = getContext();
        if (!ctx.chat || !Array.isArray(ctx.chat)) {
            return new Set<string>();
        }
        return extractUuidsFromMessages(ctx.chat);
    } catch (err) {
        logger.error('扫描聊天消息图片引用失败', err, 'ChatScanner');
        return new Set<string>();
    }
}

/**
 * 查询所有存储在 IndexedDB 中的图片 UUID 列表
 */
export async function getAllStoredUuids(): Promise<string[]> {
    const uuids: string[] = [];
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IMAGES_STORE_NAME, 'readonly');
            const store = tx.objectStore(IMAGES_STORE_NAME);
            const req = store.openKeyCursor();

            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursor>).result;
                if (cursor) {
                    uuids.push(String(cursor.primaryKey));
                    cursor.continue();
                } else {
                    resolve(uuids);
                }
            };
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        logger.error('获取 IndexedDB 所有 UUID 列表失败', err, 'ChatScanner');
        return [];
    }
}

/**
 * 精确计算所有在 IndexedDB 中但未被任何聊天消息引用的“孤立图片”UUID 列表
 */
export async function findIsolatedImages(): Promise<string[]> {
    const allUuids = await getAllStoredUuids();
    const referencedUuids = await scanChatReferences();

    const isolated = allUuids.filter(id => !referencedUuids.has(id));
    logger.info(`孤立数据扫描完成: 存储总计 ${allUuids.length} 张, 被引用 ${referencedUuids.size} 张, 孤立 ${isolated.length} 张`);

    return isolated;
}

/**
 * 一键清理删除所有孤立图片数据，释放无用磁盘占用 (单事务高效处理)
 */
export async function deleteIsolatedImages(): Promise<number> {
    const isolatedUuids = await findIsolatedImages();
    if (isolatedUuids.length === 0) return 0;

    try {
        const deletedCount = await deleteImagesBatchFromDB(isolatedUuids);
        logger.info(`一键清理孤立数据完成，成功单事务批量删除 ${deletedCount} 张孤立垃圾图片`);
        return deletedCount;
    } catch (err) {
        logger.error('清理孤立图片失败', err, 'ChatScanner');
        return 0;
    }
}

/**
 * 处理 CHAT_DELETED 宿主事件（仅在用户开启 autoCleanupOnChatDelete 配置时执行即时擦除）
 */
export async function handleChatDeleted(chatId: string, deletedMessages?: unknown[]): Promise<number> {
    const settings = loadSettings();
    if (!settings.autoCleanupOnChatDelete) {
        logger.debug(`CHAT_DELETED 触发 [chatId=${chatId}]，但 autoCleanupOnChatDelete 未开启，跳过自动删除。`);
        return 0;
    }

    if (!deletedMessages || !Array.isArray(deletedMessages)) {
        logger.debug(`CHAT_DELETED 触发 [chatId=${chatId}]，未提供 deletedMessages 数据，跳过清理。`);
        return 0;
    }

    const uuids = extractUuidsFromMessages(deletedMessages);
    if (uuids.size === 0) return 0;

    try {
        const deletedCount = await deleteImagesBatchFromDB(uuids);
        logger.info(`CHAT_DELETED 自动擦除完成: chatId=${chatId}, 单事务批量擦除图片 ${deletedCount} 张`);
        return deletedCount;
    } catch (err) {
        logger.error(`删除聊天废图失败: chatId=${chatId}`, err, 'ChatScanner');
        return 0;
    }
}
