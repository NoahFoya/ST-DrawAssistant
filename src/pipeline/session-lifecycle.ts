/**
 * 宿主会话生命周期与楼层消息资产持久化服务 (SessionLifecycleManager)。
 *
 * @remarks
 * 架构考量与数据结构约定：
 * 1. 宿主数据结构约定：
 *    - 路径：`chat[messageId].extra.drawings[swipeId][instructionIndex] = DrawingSlotEntry`
 *    - 说明：支持多分支 (swipeId) 与单消息多指令 (instructionIndex) 复合定位。
 * 2. 轻量索引设计哲学：
 *    - 宿主会话 JSON 仅记录 `{ imageId, imageUrl }` 等轻量索引，不内嵌巨型 Base64 或元数据；
 *    - 高清 Blob 二进制和完整生成参数由本地 IndexedDB 分表维护，确保宿主会话文件极度轻量且读写极速。
 * 3. 会话切换 (CHAT_CHANGED) 生命周期：
 *    - 主动任务熔断：通过 setTaskCanceller 注册的委托取消旧会话中的未决排队与执行任务；
 *    - 内存释放：调用 UrlPool.revokeAll() 释放当前视图中创建的所有 Object URL，避免单页应用内存溢出。
 */

import type { SlotMountTarget, DrawingSlotEntry } from '@types';
import { urlPool, type UrlPool } from '../store/url-pool';
import { settingsStore, type SettingsStore } from '../store/settings-store';
import { logger } from '../util/logger';
import { serverStorageService } from './server-storage-service';

/** 宿主上下文轻量抽象 */
export interface HostContextLike {
    chat?: Array<Record<string, any>>;
    chatId?: string;
    characterId?: string | number;
    characters?: Array<{ name?: string }>;
    eventSource?: {
        on(event: string, handler: (...args: any[]) => void): void;
        off?(event: string, handler: (...args: any[]) => void): void;
        removeListener?(event: string, handler: (...args: any[]) => void): void;
        emit?(event: string, ...args: any[]): void;
    };
    eventTypes?: {
        CHAT_CHANGED?: string;
        MESSAGE_UPDATED?: string;
        APP_INITIALIZED?: string;
    };
    saveChat?(): Promise<void> | void;
    getRequestHeaders?(): Record<string, string>;
}

/** 会话生命周期配置选项 */
export interface SessionLifecycleOptions {
    urlPoolInstance?: UrlPool;
    getContext?: () => HostContextLike | undefined;
    cancelTasksByChat?: (chatId: string, reason?: string) => void;
    settingsStore?: SettingsStore;
}

/**
 * 宿主会话生命周期与资产写入管理器。
 */
export class SessionLifecycleManager {
    private readonly _urlPool: UrlPool;
    private readonly _getContext: () => HostContextLike | undefined;
    private readonly _settingsStore: SettingsStore;
    private readonly _cleanups: Array<() => void> = [];
    private _cancelTasksByChat?: (chatId: string, reason?: string) => void;

    private _isBound = false;
    private _lastChatId?: string;

    public constructor(options: SessionLifecycleOptions = {}) {
        this._urlPool = options.urlPoolInstance ?? urlPool;
        this._cancelTasksByChat = options.cancelTasksByChat;
        this._settingsStore = options.settingsStore ?? settingsStore;
        this._getContext =
            options.getContext ??
            (() => {
                return window.SillyTavern?.getContext?.();
            });
    }

    /**
     * 设置任务取消委托回调（用于与任务调度器解耦绑定）。
     *
     * @param canceller 取消委托函数
     */
    public setTaskCanceller(canceller: (chatId: string, reason?: string) => void): void {
        this._cancelTasksByChat = canceller;
    }

    /**
     * 当前绑定的上一次活跃会话标识。
     */
    public getLastChatId(): string | undefined {
        return this._lastChatId;
    }

    /**
     * 绑定宿主会话切换等全局事件。
     */
    public bindHostEvents(): void {
        if (this._isBound) {
            return;
        }

        const context = this._getContext();
        if (!context?.eventSource || !context.eventTypes) {
            logger.warn('宿主上下文或事件总线未就绪，推迟绑定会话生命周期事件');
            return;
        }

        this._lastChatId = context.chatId;
        const chatChangedEvent = context.eventTypes.CHAT_CHANGED ?? 'chat_id_changed';

        const onChatChanged = (newChatId?: string) => {
            const oldChatId = this._lastChatId;
            logger.info(`检测到宿主会话变更 (${oldChatId ?? 'none'} -> ${newChatId ?? 'none'})`);
            this._lastChatId = newChatId ?? context.chatId;

            // 1. 若配置开启了切换会话时自动取消任务 (cancelOnChatChange)，则中止旧会话未决任务
            const shouldCancel = (this._settingsStore ?? settingsStore).get('cancelOnChatChange') ?? false;
            if (shouldCancel && oldChatId && typeof this._cancelTasksByChat === 'function') {
                try {
                    this._cancelTasksByChat(oldChatId, '宿主会话已切换');
                } catch (err) {
                    logger.warn(`会话切换中止未决任务异常 [${oldChatId}]:`, err);
                }
            }

            // 2. 释放脱离视图的临时图片引用，避免内存泄漏
            this._urlPool.revokeAll();
        };

        context.eventSource.on(chatChangedEvent, onChatChanged);

        this._cleanups.push(() => {
            if (typeof context.eventSource?.off === 'function') {
                context.eventSource.off(chatChangedEvent, onChatChanged);
            } else if (typeof context.eventSource?.removeListener === 'function') {
                context.eventSource.removeListener(chatChangedEvent, onChatChanged);
            }
        });

        this._isBound = true;
        logger.info('已成功绑定宿主会话生命周期监听器');
    }

    /**
     * 初始记录插槽占位条目（单向任务分发时立即调用，解耦渲染层）。
     *
     * @remarks
     * 在生图任务进入队列阶段立即写入，并将宿主会话调用 saveChat 持久化。
     * 这样即使用户在出图期间切出会话或刷新页面，插槽已被预先占位，重载后能准确关联。
     *
     * @param target 目标插槽坐标
     * @param entry 初始插槽数据（携带 imageId 及 pending 状态）
     * @returns 是否成功写入宿主消息内存
     */
    public recordSlotEntry(target: SlotMountTarget, entry: DrawingSlotEntry): boolean {
        const context = this._getContext();
        if (!context || !Array.isArray(context.chat)) return false;
        if (context.chatId && context.chatId !== target.chatId) return false;

        const message = context.chat[target.messageId];
        if (!message) return false;

        const swipeId = target.swipeId ?? 0;
        message.extra = message.extra ?? {};
        message.extra.drawings = message.extra.drawings ?? {};
        message.extra.drawings[swipeId] = message.extra.drawings[swipeId] ?? {};
        message.extra.drawings[swipeId][target.instructionIndex] = {
            ...entry,
        };

        if (typeof context.saveChat === 'function') {
            void context.saveChat();
        }
        return true;
    }

    /**
     * 向宿主指定消息楼层的 extra.drawings 中回写图像资产引用并持久化保存。
     *
     * @remarks
     * 1. 结构规范：message.extra.drawings[swipeId][instructionIndex] = DrawingSlotEntry；
     * 2. 轻量索引：只写入 imageId 及可选展示路径 imageUrl，完整元数据在 IndexedDB 分表存储，保证会话 JSON 极轻；
     * 3. 会话保护：当前会话与任务所属会话不一致时跳过回写，防止误改不同会话数据；
     * 4. 触发 MESSAGE_UPDATED 局部重绘事件，并调用 context.saveChat() 持久化。
     *
     * @param target 插槽挂载目标定位坐标
     * @param slotEntryOrId 图像资产条目或图像标识符
     * @returns 是否成功写入并保存
     */
    public async updateMessageSlot(
        target: SlotMountTarget,
        slotEntryOrId: DrawingSlotEntry | string
    ): Promise<boolean> {
        const context = this._getContext();
        if (!context) {
            logger.warn('写入消息楼层失败：未获取到宿主上下文');
            return false;
        }

        // 当前宿主会话与目标任务所属会话不一致时跳过回写，避免误改其他会话数据
        if (context.chatId && context.chatId !== target.chatId) {
            logger.warn(
                `跳过楼层回写：当前宿主会话 (${context.chatId}) 与目标任务会话 (${target.chatId}) 不一致`
            );
            return false;
        }

        const chat = context.chat;
        if (!Array.isArray(chat) || target.messageId < 0 || target.messageId >= chat.length) {
            logger.warn(`写入消息楼层失败：消息索引 #${target.messageId} 超出有效范围`);
            return false;
        }

        const message = chat[target.messageId];
        if (!message) {
            logger.warn(`写入消息楼层失败：未定位到目标消息对象 (#${target.messageId})`);
            return false;
        }

        const baseEntry: DrawingSlotEntry =
            typeof slotEntryOrId === 'string'
                ? { imageId: slotEntryOrId }
                : slotEntryOrId;

        const swipeId = target.swipeId ?? 0;
        let existingSlot = message.extra?.drawings?.[swipeId]?.[target.instructionIndex];
        if (
            !existingSlot &&
            Array.isArray(message.swipe_info) &&
            message.swipe_info[swipeId]?.extra?.drawings?.[swipeId]?.[target.instructionIndex]
        ) {
            existingSlot = message.swipe_info[swipeId].extra.drawings[swipeId][target.instructionIndex];
        }

        // 1. 合并已有路径并通过 serverStorageService 统筹服务端转存
        const candidateEntry: DrawingSlotEntry = {
            ...existingSlot,
            ...baseEntry,
        };

        const charName = this.getCurrentCharacterName(context);
        const syncResult = await serverStorageService.syncSlotServerImage(candidateEntry, charName);
        const finalImageUrl = syncResult.imageUrl || candidateEntry.imageUrl;

        const entry: DrawingSlotEntry = {
            ...candidateEntry,
            ...(finalImageUrl ? { imageUrl: finalImageUrl } : {}),
        };

        message.extra = message.extra ?? {};
        message.extra.drawings = message.extra.drawings ?? {};

        message.extra.drawings[swipeId] = message.extra.drawings[swipeId] ?? {};
        message.extra.drawings[swipeId][target.instructionIndex] = entry;

        // 跨 swipe 异步回写防御：
        // SillyTavern 在切换 swipe 时会通过 syncMesToSwipe / syncSwipeToMes 在 message.extra 与
        // message.swipe_info[swipeId].extra 之间做完整快照拷贝。若生图完成时当前激活的 swipe 已被切走，
        // 必须同步回写到目标分支的 swipe_info[swipeId].extra 中，避免用户切回目标分支时被旧快照覆盖。
        if (Array.isArray(message.swipe_info) && message.swipe_info[swipeId]) {
            const targetSwipe = message.swipe_info[swipeId];
            targetSwipe.extra = targetSwipe.extra ?? {};
            targetSwipe.extra.drawings = targetSwipe.extra.drawings ?? {};
            targetSwipe.extra.drawings[swipeId] = targetSwipe.extra.drawings[swipeId] ?? {};
            targetSwipe.extra.drawings[swipeId][target.instructionIndex] = entry;
        }

        // 2. 触发宿主消息局部更新事件
        if (context.eventSource?.emit && context.eventTypes?.MESSAGE_UPDATED) {
            context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, target.messageId);
        }

        // 3. 调用宿主保存方法
        if (typeof context.saveChat === 'function') {
            try {
                await context.saveChat();
                logger.info(
                    `已成功回写楼层消息 (#${target.messageId}, 分支 ${swipeId}, 插槽 ${target.instructionIndex})`
                );
                return true;
            } catch (err) {
                logger.error(`保存宿主会话记录失败 (#${target.messageId})`, err);
                return false;
            }
        }

        return true;
    }

    /**
     * 确保指定消息插槽中的图像根据当前设置完成宿主服务端转存。
     *
     * @remarks
     * 仅在宿主实际渲染完成的楼层（CHARACTER_MESSAGE_RENDERED / USER_MESSAGE_RENDERED）中定位到图片时调用：
     * 若当前设置开启了 saveToServer 且尚未转存，自动在后台补齐服务端存储并持久化会话记录。
     *
     * @param target 插槽挂载目标定位坐标
     * @returns 是否执行了服务端转存并保存成功
     */
    public async ensureSlotServerImage(target: SlotMountTarget): Promise<boolean> {
        const context = this._getContext();
        if (!context || !Array.isArray(context.chat)) {
            return false;
        }

        const message = context.chat[target.messageId];
        const swipeId = target.swipeId ?? 0;
        const slot = message?.extra?.drawings?.[swipeId]?.[target.instructionIndex];
        if (!slot || !slot.imageId) {
            return false;
        }

        const settings = settingsStore.getSettings();
        if (!settings.saveToServer || slot.imageUrl) {
            return false;
        }

        const charName = this.getCurrentCharacterName(context);
        const syncResult = await serverStorageService.syncSlotServerImage(slot, charName);
        if (!syncResult.hasChanges || !syncResult.imageUrl) {
            return false;
        }

        return this.updateMessageSlot(target, {
            ...slot,
            imageUrl: syncResult.imageUrl,
        });
    }

    /**
     * 兼容别名：保留 ensureSlotBackups 避免旧调用破坏
     */
    public async ensureSlotBackups(target: SlotMountTarget): Promise<boolean> {
        return this.ensureSlotServerImage(target);
    }

    /**
     * 将图像上传至宿主服务器（后台非阻塞执行）。
     * 无论宿主当前处于哪一个活跃会话，均可安全独立执行，不依赖或修改前台活跃 chat 数组。
     *
     * @param imageId 图像唯一标识符
     * @param characterName 关联角色名称
     * @returns 成功转存后的服务端静态相对路径
     */
    public async uploadImageToServer(imageId: string, characterName?: string): Promise<string | undefined> {
        const settings = settingsStore.getSettings();
        if (!settings.saveToServer) {
            return undefined;
        }

        const resolvedCharName = characterName ?? this.getCurrentCharacterName(this._getContext());
        const syncResult = await serverStorageService.syncSlotServerImage({ imageId }, resolvedCharName);
        return syncResult.imageUrl;
    }

    /**
     * 兼容别名：保留 backupImageToServer 避免旧调用破坏
     */
    public async backupImageToServer(imageId: string, characterName?: string): Promise<string | undefined> {
        return this.uploadImageToServer(imageId, characterName);
    }

    /**
     * 解绑所有宿主监听器并重置状态。
     */
    public unbindHostEvents(): void {
        for (const cleanup of this._cleanups) {
            try {
                cleanup();
            } catch (err) {
                logger.warn('解绑宿主监听器发生异常:', err);
            }
        }
        this._cleanups.length = 0;
        this._isBound = false;
        logger.info('已解绑全部宿主会话生命周期监听器');
    }

    private getCurrentCharacterName(context?: HostContextLike): string | undefined {
        if (!context) {
            return undefined;
        }
        try {
            const charId = context.characterId;
            const characters = context.characters;
            const index =
               typeof charId === 'number'
                   ? charId
                   : typeof charId === 'string'
                   ? parseInt(charId, 10)
                   : NaN;
            if (!Number.isNaN(index) && Array.isArray(characters) && characters[index]) {
                return characters[index].name;
            }
        } catch (err) {
            logger.warn('解析当前角色名称异常:', err);
        }
        return undefined;
    }
}

/** 全局默认单例会话生命周期管理器 */
export const sessionLifecycle = new SessionLifecycleManager();
