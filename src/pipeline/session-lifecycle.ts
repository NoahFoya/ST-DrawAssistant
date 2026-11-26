/**
 * 宿主会话生命周期与消息资产管理服务 (SessionLifecycleManager)。
 *
 * 负责在宿主消息中记录楼层图片索引，并在会话切换时清理临时资源与取消未完成任务：
 * 1. 消息索引：在 chat[messageId].extra.drawings[instructionIndex]（及 swipe_info[swipeId].extra.drawings[instructionIndex]）记录 imageId 与 imageUrl；
 * 2. 存储分工：宿主消息保存轻量索引，图片二进制数据由本地存储维护；
 * 3. 会话切换：默认取消旧会话未决任务（`cancelOnChatChange = true`）；关闭该选项后允许后台平稳生成并仅存入本地图库，不向已离开的会话楼层回写。
 */

import type { SlotMountTarget, DrawingSlotEntry, ChatMessage, Disposable } from '@types';
import { urlPool, type UrlPool } from '../store/url-pool';
import { settingsStore, type SettingsStore } from '../store/settings-store';
import { logger } from '../util/logger';
import { serverStorageService } from './server-storage-service';
import { promptPipeline } from './prompt-pipeline';

/** 宿主上下文轻量抽象 */
export interface HostContextLike {
    chat?: Array<ChatMessage>;
    chatId?: string;
    characterId?: string | number;
    characters?: Array<{ name?: string }>;
    groupId?: string;
    groups?: Array<{ id?: string; name?: string }>;
    eventSource?: {
        on(event: string, handler: (...args: unknown[]) => void): void;
        off?(event: string, handler: (...args: unknown[]) => void): void;
        removeListener?(event: string, handler: (...args: unknown[]) => void): void;
        emit?(event: string, ...args: unknown[]): void;
    };
    eventTypes?: {
        CHAT_CHANGED?: string;
    };
    saveChat?(): Promise<void> | void;
}

/** 会话生命周期配置选项 */
export interface SessionLifecycleOptions {
    urlPoolInstance?: UrlPool;
    getContext?: () => HostContextLike | undefined;
    cancelTasksByChat?: (chatId: string, reason?: string) => void;
    settingsStore?: SettingsStore;
    validateImageExists?: (imageId: string) => Promise<boolean>;
}

/**
 * 宿主会话生命周期与资产写入管理器。
 */
export class SessionLifecycleManager implements Disposable {
    private readonly _urlPool: UrlPool;
    private readonly _getContext: () => HostContextLike | undefined;
    private readonly _settingsStore: SettingsStore;
    private readonly _cleanups: Array<() => void> = [];
    private _cancelTasksByChat?: (chatId: string, reason?: string) => void;
    private _validateImageExists?: (imageId: string) => Promise<boolean>;

    private _isBound = false;
    private _lastChatId?: string;

    public constructor(options: SessionLifecycleOptions = {}) {
        this._urlPool = options.urlPoolInstance ?? urlPool;
        this._cancelTasksByChat = options.cancelTasksByChat;
        this._settingsStore = options.settingsStore ?? settingsStore;
        this._validateImageExists = options.validateImageExists;
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

        const onChatChanged = (...args: unknown[]) => {
            const oldChatId = this._lastChatId;
            const newChatId = typeof args[0] === 'string' ? args[0] : undefined;
            const targetChatId = newChatId ?? this._getContext()?.chatId;
            if (oldChatId && targetChatId && oldChatId === targetChatId) {
                return;
            }

            logger.info(`检测到宿主会话变更 (${oldChatId ?? 'none'} -> ${targetChatId ?? 'none'})`);
            this._lastChatId = targetChatId;

            // 1. 默认开启切出会话取消未决任务 (cancelOnChatChange = true)；仅当用户主动关闭该开关时允许后台继续出图并仅存本地图库
            const shouldCancel = this._settingsStore.get('cancelOnChatChange') ?? true;
            if (shouldCancel && oldChatId && typeof this._cancelTasksByChat === 'function') {
                try {
                    this._cancelTasksByChat(oldChatId, '宿主会话已切换');
                } catch (err) {
                    logger.warn(`会话切换中止未决任务异常 [${oldChatId}]:`, err);
                }
            }

            // 2. 释放脱离视图的临时楼层图片引用，避免内存泄漏
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
     * 读取指定楼层与分支下保存的楼层生图记录字典（优先按当前激活分支读取 `message.extra.drawings`）。
     */
    public getSwipeDrawings(
        messageId: number,
        swipeId?: number
    ): Record<number, DrawingSlotEntry> | undefined {
        const context = this._getContext();
        if (!context || !Array.isArray(context.chat)) {
            return undefined;
        }
        const message = context.chat[messageId];
        if (!message) {
            return undefined;
        }

        const resolvedSwipeId = swipeId ?? message.swipe_id ?? 0;
        const hasSwipeInfo = Array.isArray(message.swipe_info);
        const activeSwipeId = message.swipe_id ?? 0;
        const isActiveSwipe =
            !hasSwipeInfo || message.swipe_id === undefined || activeSwipeId === resolvedSwipeId;

        if (isActiveSwipe && message.extra?.drawings) {
            return message.extra.drawings;
        }

        if (hasSwipeInfo && message.swipe_info[resolvedSwipeId]?.extra?.drawings) {
            return message.swipe_info[resolvedSwipeId].extra!.drawings;
        }

        return undefined;
    }

    /**
     * 读取指定楼层图片的展示记录。
     *
     * @remarks
     * 委托 {@link getSwipeDrawings} 统一解析当前激活分支或历史 `swipe_info` 快照上的生图索引。
     *
     * @param target 目标楼层位置坐标
     * @returns 匹配的图片记录条目，不存在时返回 undefined
     */
    public getSlotEntry(target: SlotMountTarget): DrawingSlotEntry | undefined {
        return this.getSwipeDrawings(target.messageId, target.swipeId)?.[target.instructionIndex];
    }

    /**
     * 在宿主触发 `MESSAGE_SWIPED` 时同步当前消息分支的 `extra.drawings` 状态。
     *
     * @remarks
     * SillyTavern 在向右滑出新分支（Overswipe）时，先执行 `syncMesToSwipe` 将旧分支 `extra` 存入 `swipe_info[oldSwipeId]`，
     * 随后递增 `swipe_id` 并调用 `clearMessageData(message)`；但宿主的 `clearMessageData` 不会清理扩展自定义的 `extra.drawings`。
     * 因此当检测到新 `swipe_id` 尚无对应的 `swipe_info[swipeId]` 快照时，需主动清除 `message.extra.drawings` 残留，
     * 防止新生成的分支误继承上一分支的图片记录。
     *
     * @param messageId 触发分支切换的消息楼层序号
     */
    public syncSwipeState(messageId: number): void {
        const context = this._getContext();
        if (!context || !Array.isArray(context.chat)) {
            return;
        }
        const message = context.chat[messageId];
        if (!message || !Array.isArray(message.swipe_info)) {
            return;
        }

        const swipeId = message.swipe_id ?? 0;
        const targetSwipe = message.swipe_info[swipeId];

        if (!targetSwipe) {
            if (message.extra?.drawings) {
                delete message.extra.drawings;
            }
            return;
        }

        if (targetSwipe.extra?.drawings) {
            message.extra = message.extra ?? {};
            message.extra.drawings = { ...targetSwipe.extra.drawings };
        } else if (message.extra?.drawings) {
            delete message.extra.drawings;
        }
    }

    /**
     * 将图片记录写入消息的当前激活分支与对应的 `swipe_info` 快照。
     */
    private writeSlotToMessage(
        message: ChatMessage,
        swipeId: number,
        instructionIndex: number,
        entry: DrawingSlotEntry
    ): void {
        const hasSwipeInfo = Array.isArray(message.swipe_info);
        const activeSwipeId = message.swipe_id ?? 0;
        const isActiveSwipe = !hasSwipeInfo || message.swipe_id === undefined || activeSwipeId === swipeId;

        if (isActiveSwipe) {
            message.extra = message.extra ?? {};
            message.extra.drawings = message.extra.drawings ?? {};
            message.extra.drawings[instructionIndex] = { ...entry };
        }

        if (hasSwipeInfo && message.swipe_info[swipeId]) {
            const targetSwipe = message.swipe_info[swipeId];
            targetSwipe.extra = targetSwipe.extra ?? {};
            targetSwipe.extra.drawings = targetSwipe.extra.drawings ?? {};
            targetSwipe.extra.drawings[instructionIndex] = { ...entry };
        }
    }

    /**
     * 清理指定消息当前激活分支（及对应的 swipe_info 快照）上的全部楼层生图记录。
     *
     * @param messageId 目标消息楼层数字索引
     * @returns 是否检测到并清理了楼层生图记录（有变更时异步触发 saveChat）
     */
    public clearMessageSlotDrawings(messageId: number): boolean {
        const context = this._getContext();
        if (!context || !Array.isArray(context.chat)) {
            return false;
        }
        const message = context.chat[messageId];
        if (!message) {
            return false;
        }

        let hasChanged = false;
        if (message.extra?.drawings) {
            delete message.extra.drawings;
            hasChanged = true;
        }

        const swipeId = message.swipe_id ?? 0;
        if (Array.isArray(message.swipe_info) && message.swipe_info[swipeId]?.extra?.drawings) {
            delete message.swipe_info[swipeId].extra!.drawings;
            hasChanged = true;
        }

        if (hasChanged) {
            if (typeof context.saveChat === 'function') {
                void context.saveChat();
            }
        }
        return hasChanged;
    }

    /**
     * 更新指定消息楼层的图片记录并持久化保存。
     *
     * @param target 目标楼层挂载定位坐标
     * @param slotEntryOrId 图像资产条目或图像标识符
     * @param options 可选控制项（如中止回写的 signal）
     * @returns 是否成功写入并保存
     */
    public async updateMessageSlot(
        target: SlotMountTarget,
        slotEntryOrId: DrawingSlotEntry | string,
        options?: { signal?: AbortSignal }
    ): Promise<boolean> {
        const context = this._getContext();
        if (!context) {
            logger.warn('写入消息楼层失败：未获取到宿主上下文');
            return false;
        }

        // 宿主环境单活跃会话隔离：若当前无激活会话或会话标识不匹配，跳过楼层回写，仅保留至本地图库
        if (!context.chatId || context.chatId !== target.chatId) {
            logger.info(
                `[SessionLifecycle] 当前宿主会话 (${context.chatId ?? 'none'}) 与目标任务会话 (${target.chatId}) 不一致，跳过楼层回写`
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

        if (target.instructionIndex < 0) {
            logger.warn(`写入消息楼层跳过：目标指令序号 (${target.instructionIndex}) 非法`);
            return false;
        }

        const swipeId = target.swipeId ?? 0;
        const resolveMessageText = (msg: typeof message): string | undefined => {
            if (Array.isArray(msg.swipes) && typeof msg.swipes[swipeId] === 'string') {
                return msg.swipes[swipeId] as string;
            }
            return typeof msg.mes === 'string' ? msg.mes : undefined;
        };

        // 校验正文指令：若正文不含任何有效指令或目标序号超出实际提取数量，跳过回写
        const initialText = resolveMessageText(message);
        if (typeof initialText === 'string') {
            const commands = promptPipeline.extractCommands(initialText);
            if (commands.length === 0 || target.instructionIndex >= commands.length) {
                logger.warn(
                    `写入消息楼层跳过：目标消息 (#${target.messageId}) 指令序号 (${target.instructionIndex}) 与正文指令数量 (${commands.length}) 不匹配`
                );
                return false;
            }
        }

        const baseEntry: DrawingSlotEntry =
            typeof slotEntryOrId === 'string'
                ? { imageId: slotEntryOrId }
                : slotEntryOrId;
        const existingSlot = this.getSlotEntry(target);

        // 重新生成新图时（imageId 变更），新图尚未转存服务端，不继承旧图的 imageUrl，
        // 同时将旧 imageId 按时间顺序追加至 history（去重并受保留上限约束）
        const isSameImage = Boolean(
            existingSlot?.imageId &&
            baseEntry.imageId &&
            existingSlot.imageId === baseEntry.imageId
        );

        let resolvedHistory: string[] | undefined;
        if (isSameImage) {
            resolvedHistory = Array.isArray(baseEntry.history)
                ? this.normalizeSlotHistory(baseEntry.history, baseEntry.imageId)
                : existingSlot?.history
                  ? this.normalizeSlotHistory(existingSlot.history, baseEntry.imageId)
                  : undefined;
        } else if (Array.isArray(baseEntry.history)) {
            resolvedHistory = this.normalizeSlotHistory(baseEntry.history, baseEntry.imageId);
        } else if (existingSlot?.imageId) {
            const rawPrevHistory = Array.isArray(existingSlot.history) ? existingSlot.history : [];
            const filteredPrevHistory: string[] = [];
            for (const histId of rawPrevHistory) {
                if (!histId || histId === baseEntry.imageId || histId === existingSlot.imageId) {
                    continue;
                }
                if (this._validateImageExists) {
                    const exists = await this._validateImageExists(histId).catch(() => false);
                    if (!exists) continue;
                }
                filteredPrevHistory.push(histId);
            }
            filteredPrevHistory.push(existingSlot.imageId);
            resolvedHistory = this.normalizeSlotHistory(filteredPrevHistory, baseEntry.imageId);
        }

        const candidateEntry: DrawingSlotEntry = isSameImage
            ? {
                  ...existingSlot,
                  ...baseEntry,
                  ...(resolvedHistory && resolvedHistory.length > 0 ? { history: resolvedHistory } : {}),
              }
            : {
                  ...baseEntry,
                  ...(resolvedHistory && resolvedHistory.length > 0 ? { history: resolvedHistory } : {}),
              };
        if ((!resolvedHistory || resolvedHistory.length === 0) && 'history' in candidateEntry) {
            delete (candidateEntry as { history?: string[] }).history;
        }

        const charName = this.getCurrentCharacterName(context);
        const targetMessageObj = message;
        const syncResult = await serverStorageService.syncSlotServerImage(
            candidateEntry,
            charName,
            options?.signal
        );
        if (options?.signal?.aborted) {
            logger.info(`楼层资产回写已取消 (#${target.messageId})`);
            return false;
        }

        const latestContext = this._getContext();
        const latestMessage = latestContext?.chat?.[target.messageId];
        if (
            !latestContext?.chatId ||
            latestContext.chatId !== target.chatId ||
            latestMessage !== targetMessageObj
        ) {
            logger.warn(
                `写入消息楼层跳过：目标会话或楼层消息已变更/删除 (#${target.messageId})，图像仍保留于图库`
            );
            return false;
        }

        const latestText = resolveMessageText(latestMessage);
        if (typeof latestText === 'string') {
            const latestCommands = promptPipeline.extractCommands(latestText);
            if (latestCommands.length === 0 || target.instructionIndex >= latestCommands.length) {
                logger.warn(
                    `写入消息楼层跳过：转存等待期间目标消息指令结构已变更 (#${target.messageId})，图像仍保留于图库`
                );
                return false;
            }
        }

        const hasSwipeInfo = Array.isArray(latestMessage.swipe_info);
        const activeSwipe = latestMessage.swipe_id ?? 0;
        const hasTargetSwipe =
            !hasSwipeInfo ||
            latestMessage.swipe_id === undefined ||
            activeSwipe === swipeId ||
            (swipeId >= 0 && swipeId < latestMessage.swipe_info!.length);
        if (!hasTargetSwipe) {
            logger.warn(
                `写入消息楼层跳过：目标分支 (#${target.messageId}, 分支 ${swipeId}) 已不存在，图像仍保留于图库`
            );
            return false;
        }

        const finalImageUrl = syncResult.imageUrl || candidateEntry.imageUrl;

        const entry: DrawingSlotEntry = {
            ...candidateEntry,
            ...(finalImageUrl ? { imageUrl: finalImageUrl } : {}),
        };

        // 1. 回写图片数据至消息对象及其分支快照
        this.writeSlotToMessage(latestMessage, swipeId, target.instructionIndex, entry);

        // 2. 调用宿主保存方法持久化（不触发 MESSAGE_UPDATED 事件，避免自身消息编辑监听器造成死循环或重复渲染）
        const saveChatFn = latestContext.saveChat ?? context.saveChat;
        if (typeof saveChatFn === 'function') {
            try {
                await saveChatFn.call(latestContext);
                logger.info(
                    `已成功回写楼层消息 (#${target.messageId}, 分支 ${swipeId}, 序号 ${target.instructionIndex})`
                );
                return true;
            } catch (err) {
                logger.error(`保存宿主会话记录失败 (#${target.messageId})`, err);
                return false;
            }
        }

        return true;
    }

    private resolveHistoryLimit(): number {
        const raw = this._settingsStore.get('ui')?.lightbox?.historyLimit;
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            return Math.max(0, Math.min(50, Math.round(raw)));
        }
        return 10;
    }

    private normalizeSlotHistory(rawHistory: readonly string[], currentImageId: string): string[] | undefined {
        const limit = this.resolveHistoryLimit();
        if (limit <= 0) {
            return undefined;
        }
        const deduped: string[] = [];
        const seen = new Set<string>();
        for (let i = rawHistory.length - 1; i >= 0; i--) {
            const id = rawHistory[i];
            if (!id || id === currentImageId || seen.has(id)) {
                continue;
            }
            seen.add(id);
            deduped.unshift(id);
            if (deduped.length >= limit) {
                break;
            }
        }
        return deduped.length > 0 ? deduped : undefined;
    }

    /**
     * 将指定历史图像设为楼层插槽当前展示图，原当前图保留至 history（仅变更索引关系，不删除图像资产）。
     */
    public async switchSlotToHistoryImage(
        target: SlotMountTarget,
        historyImageId: string,
        options?: { imageUrl?: string }
    ): Promise<DrawingSlotEntry | null> {
        const context = this._getContext();
        if (!context || !context.chatId || context.chatId !== target.chatId || !Array.isArray(context.chat)) {
            return null;
        }
        const message = context.chat[target.messageId];
        if (!message || target.instructionIndex < 0) {
            return null;
        }

        const swipeId = target.swipeId ?? message.swipe_id ?? 0;
        const existingSlot = this.getSwipeDrawings(target.messageId, swipeId)?.[target.instructionIndex];
        if (!existingSlot || !existingSlot.imageId) {
            return null;
        }
        if (existingSlot.imageId === historyImageId) {
            return existingSlot;
        }

        const prevHistory = Array.isArray(existingSlot.history) ? existingSlot.history : [];
        if (!prevHistory.includes(historyImageId)) {
            return null;
        }

        const nextHistoryRaw = prevHistory.filter((id) => id !== historyImageId);
        nextHistoryRaw.push(existingSlot.imageId);
        const normalizedHistory = this.normalizeSlotHistory(nextHistoryRaw, historyImageId);

        const nextEntry: DrawingSlotEntry = {
            imageId: historyImageId,
            ...(options?.imageUrl ? { imageUrl: options.imageUrl } : {}),
            ...(normalizedHistory && normalizedHistory.length > 0 ? { history: normalizedHistory } : {}),
        };

        this.writeSlotToMessage(message, swipeId, target.instructionIndex, nextEntry);

        const saveChatFn = context.saveChat;
        if (typeof saveChatFn === 'function') {
            try {
                await saveChatFn.call(context);
            } catch (err) {
                logger.error(`切换历史图后保存会话失败 (#${target.messageId})`, err);
            }
        }
        return nextEntry;
    }

    /**
     * 从指定楼层插槽的 history 引用中移除已不存在的图像 ID。
     */
    public async pruneSlotHistory(
        target: SlotMountTarget,
        invalidImageIds: ReadonlySet<string>
    ): Promise<boolean> {
        if (invalidImageIds.size === 0) {
            return false;
        }
        const context = this._getContext();
        if (!context || !context.chatId || context.chatId !== target.chatId || !Array.isArray(context.chat)) {
            return false;
        }
        const message = context.chat[target.messageId];
        if (!message) {
            return false;
        }

        const swipeId = target.swipeId ?? message.swipe_id ?? 0;
        const existingSlot = this.getSwipeDrawings(target.messageId, swipeId)?.[target.instructionIndex];
        if (!existingSlot || !Array.isArray(existingSlot.history) || existingSlot.history.length === 0) {
            return false;
        }

        const filtered = existingSlot.history.filter((id) => !invalidImageIds.has(id));
        if (filtered.length === existingSlot.history.length) {
            return false;
        }

        const nextEntry: DrawingSlotEntry = {
            imageId: existingSlot.imageId,
            ...(existingSlot.imageUrl ? { imageUrl: existingSlot.imageUrl } : {}),
            ...(filtered.length > 0 ? { history: filtered } : {}),
        };
        this.writeSlotToMessage(message, swipeId, target.instructionIndex, nextEntry);

        const saveChatFn = context.saveChat;
        if (typeof saveChatFn === 'function') {
            try {
                await saveChatFn.call(context);
            } catch (err) {
                logger.warn(`清理失效历史引用后保存会话失败 (#${target.messageId})`, err);
            }
        }
        return true;
    }

    /**
     * 当图库删除某张图片时，同步清理当前会话各楼层分支 history 中的悬空引用。
     */
    public pruneHistoryImageIdFromChat(imageId: string): boolean {
        if (!imageId) {
            return false;
        }
        const context = this._getContext();
        if (!context || !Array.isArray(context.chat)) {
            return false;
        }

        let changed = false;
        const pruneMap = (drawings?: Record<number, DrawingSlotEntry>) => {
            if (!drawings) return;
            for (const [idxKey, entry] of Object.entries(drawings)) {
                if (!entry || !Array.isArray(entry.history) || !entry.history.includes(imageId)) {
                    continue;
                }
                const nextHistory = entry.history.filter((id) => id !== imageId);
                const nextEntry: DrawingSlotEntry = {
                    imageId: entry.imageId,
                    ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
                    ...(nextHistory.length > 0 ? { history: nextHistory } : {}),
                };
                drawings[Number(idxKey)] = nextEntry;
                changed = true;
            }
        };

        for (const msg of context.chat) {
            if (!msg) continue;
            pruneMap(msg.extra?.drawings);
            if (Array.isArray(msg.swipe_info)) {
                for (const sw of msg.swipe_info) {
                    pruneMap(sw?.extra?.drawings);
                }
            }
        }

        if (changed && typeof context.saveChat === 'function') {
            void context.saveChat();
        }
        return changed;
    }

    /**
     * 确保指定楼层图片根据当前设置完成宿主服务端转存。
     *
     * @remarks
     * 仅在宿主实际渲染完成的楼层（CHARACTER_MESSAGE_RENDERED / USER_MESSAGE_RENDERED）中定位到图片时调用：
     * 若当前设置开启了 saveToServer 且尚未转存，自动在后台补齐服务端存储并持久化会话记录。
     *
     * @param target 目标楼层挂载定位坐标
     * @returns 是否执行了服务端转存并保存成功
     */
    public async ensureSlotServerImage(target: SlotMountTarget): Promise<boolean> {
        const context = this._getContext();
        if (!context || !context.chatId || context.chatId !== target.chatId || !Array.isArray(context.chat)) {
            return false;
        }

        const slot = this.getSlotEntry(target);
        if (!slot || !slot.imageId) {
            return false;
        }

        const saveToServer = this._settingsStore.get('saveToServer') ?? false;
        if (!saveToServer || slot.imageUrl) {
            return false;
        }

        const charName = this.getCurrentCharacterName(context);
        const syncResult = await serverStorageService.syncSlotServerImage(slot, charName);
        if (!syncResult.hasChanges || !syncResult.imageUrl) {
            return false;
        }

        // 转存结束后二次核对会话与目标记录归属，防止异步期间该记录已被重新生成为其他 imageId
        const latestContext = this._getContext();
        const latestMessage = latestContext?.chat?.[target.messageId];
        if (!latestContext?.chatId || latestContext.chatId !== target.chatId || !latestMessage) {
            return false;
        }
        const latestSlot = this.getSlotEntry(target);
        if (!latestSlot || latestSlot.imageId !== slot.imageId || latestSlot.imageUrl) {
            return false;
        }

        const swipeId = target.swipeId ?? 0;
        this.writeSlotToMessage(latestMessage, swipeId, target.instructionIndex, {
            ...latestSlot,
            imageUrl: syncResult.imageUrl,
        });

        const saveChatFn = latestContext.saveChat ?? context.saveChat;
        if (typeof saveChatFn === 'function') {
            try {
                await saveChatFn.call(latestContext);
                return true;
            } catch (err) {
                logger.error(`补存服务端路径后保存会话失败 (#${target.messageId})`, err);
                return false;
            }
        }
        return true;
    }

    /**
     * 释放生命周期资源，解绑宿主监听器。
     */
    public dispose(): void {
        this.unbindHostEvents();
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
        this._lastChatId = undefined;
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
                const charName = characters[index].name?.trim();
                if (charName) {
                    return charName;
                }
            }

            if (context.groupId) {
                const matchedGroup = Array.isArray(context.groups)
                    ? context.groups.find((g) => g?.id === context.groupId)
                    : undefined;
                const groupName = matchedGroup?.name?.trim();
                return groupName || 'group_chats';
            }

            // 无活跃单聊角色时（如群聊或无卡会话）统一保存至独立目录，避免上传请求缺失 ch_name
            return 'group_chats';
        } catch (err) {
            logger.warn('解析当前角色名称异常:', err);
        }
        return 'group_chats';
    }
}

/** 全局默认单例会话生命周期管理器 */
export const sessionLifecycle = new SessionLifecycleManager();
