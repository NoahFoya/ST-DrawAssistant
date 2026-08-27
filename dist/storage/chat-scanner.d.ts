/**
 * @module storage/chat-scanner
 * @description 聊天记录图片引用与孤立文件清理分析器 (ChatScanner)
 *
 * 职责：
 * - 扫描宿主当前聊天消息中引用的所有图片 UUID 集合
 * - 响应宿主 CHAT_DELETED 事件（当且仅当用户开启 autoCleanupOnChatDelete 时执行即时物理擦除）
 * - 对比 IndexedDB 中的全量图片，找出未被任何消息引用的废弃图片并提供清理方法，释放存储空间
 */
/**
 * 从消息列表中解析提取所有 da_images 图片 UUID 集合
 */
export declare function extractUuidsFromMessages(messages: unknown[]): Set<string>;
/**
 * 扫描当前聊天面板中被引用的全部 UUID 集合
 */
export declare function scanChatReferences(): Promise<Set<string>>;
/**
 * 查询所有存储在 IndexedDB 中的图片 UUID 列表
 */
export declare function getAllStoredUuids(): Promise<string[]>;
/**
 * 精确计算所有在 IndexedDB 中但未被任何聊天消息引用的“孤立图片”UUID 列表
 */
export declare function findIsolatedImages(): Promise<string[]>;
/**
 * 一键清理删除所有孤立图片数据，释放无用磁盘占用 (单事务高效处理)
 */
export declare function deleteIsolatedImages(): Promise<number>;
/**
 * 处理 CHAT_DELETED 宿主事件（仅在用户开启 autoCleanupOnChatDelete 配置时执行即时擦除）
 */
export declare function handleChatDeleted(chatId: string, deletedMessages?: unknown[]): Promise<number>;
//# sourceMappingURL=chat-scanner.d.ts.map