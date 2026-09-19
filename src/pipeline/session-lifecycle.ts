/**
 * 宿主会话切换生命周期与楼层消息资产关联服务。
 *
 * @remarks
 * 负责监听 SillyTavern CHAT_CHANGED 事件以释放视图脱离后的临时 Object URL 资源，
 * 并提供符合宿主规范的楼层消息 extra.drawings 资产引用回写与持久化能力。
 */

import type { SlotMountTarget, DrawingSlotEntry } from '@types';
import { urlPool, type UrlPool } from '../store/url-pool';
import { logger } from '../util/logger';

/** 宿主上下文轻量抽象 */
export interface HostContextLike {
    chat?: Array<Record<string, any>>;
    chatId?: string;
    eventSource?: {
        on(event: string, handler: (...args: any[]) => void): void;
        removeListener(event: string, handler: (...args: any[]) => void): void;
        emit?(event: string, ...args: any[]): void;
    };
    eventTypes?: {
        CHAT_CHANGED?: string;
        MESSAGE_UPDATED?: string;
        APP_INITIALIZED?: string;
    };
    saveChat?(): Promise<void> | void;
}

/** 会话生命周期配置选项 */
export interface SessionLifecycleOptions {
    urlPoolInstance?: UrlPool;
    getContext?: () => HostContextLike | undefined;
}

/**
 * 宿主会话生命周期与资产写入管理器。
 */
export class SessionLifecycleManager {
    private readonly _urlPool: UrlPool;
    private readonly _getContext: () => HostContextLike | undefined;
    private readonly _cleanups: Array<() => void> = [];

    private _isBound = false;
    private _lastChatId?: string;

    public constructor(options: SessionLifecycleOptions = {}) {
        this._urlPool = options.urlPoolInstance ?? urlPool;
        this._getContext =
            options.getContext ??
            (() => {
                return (window as any).SillyTavern?.getContext?.();
            });
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
            logger.info(`检测到宿主会话变更 (${this._lastChatId ?? 'none'} -> ${newChatId ?? 'none'})`);
            this._lastChatId = newChatId ?? context.chatId;

            // 释放脱离视图的临时图片引用，避免内存泄漏
            this._urlPool.revokeAll();
        };

        context.eventSource.on(chatChangedEvent, onChatChanged);

        this._cleanups.push(() => {
            context.eventSource?.removeListener(chatChangedEvent, onChatChanged);
        });

        this._isBound = true;
        logger.info('已成功绑定宿主会话生命周期监听器');
    }

    /**
     * 向宿主指定消息楼层的 extra.drawings 中写入图像资产引用并持久化保存。
     *
     * @remarks
     * 1. 结构规范：message.extra.drawings[swipeId][instructionIndex] = DrawingSlotEntry；
     * 2. 轻量索引：只写入 imageId 及可选展示路径，完整元数据在 IndexedDB 分表存储，避免会话 JSON 膨胀；
     * 3. 触发 MESSAGE_UPDATED 局部重绘事件；
     * 4. 调用 context.saveChat() 进行持久化保存。
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

        const entry: DrawingSlotEntry =
            typeof slotEntryOrId === 'string'
                ? { imageId: slotEntryOrId }
                : slotEntryOrId;

        message.extra = message.extra ?? {};
        message.extra.drawings = message.extra.drawings ?? {};

        const swipeId = target.swipeId ?? 0;
        message.extra.drawings[swipeId] = message.extra.drawings[swipeId] ?? {};
        message.extra.drawings[swipeId][target.instructionIndex] = entry;

        // 1. 触发宿主消息局部更新事件
        if (context.eventSource?.emit && context.eventTypes?.MESSAGE_UPDATED) {
            context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, target.messageId);
        }

        // 2. 调用宿主保存方法
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
}

/** 全局默认单例会话生命周期管理器 */
export const sessionLifecycle = new SessionLifecycleManager();
