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
 * 一键清理删除所有孤立图片数据，释放无用磁盘占用
 */
export declare function deleteIsolatedImages(): Promise<number>;
//# sourceMappingURL=chat-scanner.d.ts.map