/**
 * @module storage/chat-scanner
 * @description 聊天消息图片引用扫描器 (ChatScanner)
 *
 * 职责：
 * - 遍历 SillyTavern 宿主 getContext().chat 消息节点
 * - 收集当前聊天包含的所有有效 da_images 图片 UUID 引用
 * - 对比 IndexedDB 储存仓库，精确判定与清理无聊天引用的“孤立垃圾数据”
 *
 * 规范参考：
 * - .agents/Skills/browser-storage/SKILL.md §3 (存储配额与废弃垃圾清理策略)
 */


import { getContext } from '../core/context';
import { logger } from '../core/logger';
import { getDB, IMAGES_STORE_NAME, deleteImageFromDB } from './image-db';

/**
 * 扫描当前聊天面板中被引用的全部 UUID 集合
 */
export async function scanChatReferences(): Promise<Set<string>> {
    const referencedUuids = new Set<string>();

    try {
        const ctx = getContext();
        if (!ctx.chat || !Array.isArray(ctx.chat)) {
            return referencedUuids;
        }

        for (const msg of ctx.chat) {
            if (!msg || typeof msg !== 'object') continue;
            const extra = (msg as { extra?: Record<string, unknown> }).extra;
            if (!extra || typeof extra !== 'object') continue;

            const daImages = extra['da_images'] as Record<string | number, unknown> | undefined;
            if (!daImages || typeof daImages !== 'object') continue;

            // 遍历每个 Swipe 变体组或直接节点
            for (const swipeData of Object.values(daImages)) {
                if (typeof swipeData === 'object' && swipeData !== null) {
                    const directUuid = (swipeData as { uuid?: string }).uuid;
                    if (directUuid && typeof directUuid === 'string') {
                        referencedUuids.add(directUuid);
                    }
                    for (const imgItem of Object.values(swipeData as Record<string, unknown>)) {
                        if (typeof imgItem === 'object' && imgItem !== null) {
                            const uuid = (imgItem as { uuid?: string }).uuid;
                            if (uuid && typeof uuid === 'string') {
                                referencedUuids.add(uuid);
                            }
                        }
                    }
                }
            }
        }
    } catch (err) {
        logger.error('扫描聊天消息图片引用失败', err, 'ChatScanner');
    }

    return referencedUuids;
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
 * 一键清理删除所有孤立图片数据，释放无用磁盘占用
 */
export async function deleteIsolatedImages(): Promise<number> {
    const isolatedUuids = await findIsolatedImages();
    let deletedCount = 0;

    for (const uuid of isolatedUuids) {
        try {
            await deleteImageFromDB(uuid);
            deletedCount++;
        } catch (err) {
            logger.warn(`删除孤立图片失败: uuid=${uuid}`, err, 'ChatScanner');
        }
    }

    logger.info(`一键清理孤立数据完成，成功删除 ${deletedCount} 张孤立垃圾图片`);
    return deletedCount;
}
