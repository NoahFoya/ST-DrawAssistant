/**
 * 宿主会话生命周期与消息资产管理服务 (SessionLifecycleManager)。
 *
 * 负责在宿主消息中记录图片插槽索引，并在会话切换时清理临时资源与取消未完成任务：
 * 1. 消息索引：在 chat[messageId].extra.drawings[swipeId][instructionIndex] 记录 imageId 与 imageUrl；
 * 2. 存储分工：宿主消息保存轻量索引，图片二进制数据由本地存储维护；
 * 3. 会话切换：切换会话时取消旧会话任务并释放临时 Object URL。
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
     * 任务入队时在宿主消息中记录插槽条目并持久化保存。
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
     * 更新指定消息楼层的插槽图片记录并持久化保存。
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

        // 重新生成新图时（imageId 变更），新图尚未转存服务端，不继承旧图的 imageUrl
        const isSameImage = Boolean(
            existingSlot?.imageId &&
            baseEntry.imageId &&
            existingSlot.imageId === baseEntry.imageId
        );

        const candidateEntry: DrawingSlotEntry = isSameImage
            ? { ...existingSlot, ...baseEntry }
            : { ...baseEntry };

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

        // 若用户已切换至其他分支，需同步更新目标分支的 swipe_info[swipeId].extra，避免被宿主快照覆盖
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
