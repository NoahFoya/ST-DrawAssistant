/**
 * SillyTavern 宿主事件桥接器 (`HostEventBridge`)。
 *
 * @remarks
 * 统一接管宿主 `eventSource` 监听绑定、消息事件参数规范化、
 * `MESSAGE_EDITED -> MESSAGE_UPDATED` 同帧合批去重与全量解绑，
 * 使插件主入口与上层协调器无需直接操作宿主事件 API 或维护散落的定时清理器。
 */

import type { Disposable } from '@types';
import { getHostContext } from './host-context';

export interface HostEventCallbacks {
    onMessageReceived?(payload: { readonly messageId: number; readonly type?: unknown }): void;
    onCharacterMessageRendered?(payload: {
        readonly messageId: number;
        readonly type?: unknown;
    }): Promise<void> | void;
    onUserMessageRendered?(payload: { readonly messageId: number }): void;
    onMessageSent?(): void;
    onGenerationStarted?(): void;
    onGenerationEnded?(): void;
    onGenerationStopped?(): void;
    onBeforeCombinedPrompts?(): void;
    onMessageSwiped?(payload: { readonly messageId: number; readonly swipeId?: number }): void;
    onMessageSwipeDeleted?(payload: {
        readonly messageId: number;
        readonly swipeId?: number;
        readonly newSwipeId?: number;
    }): void;
    onMessageEdited?(payload: { readonly messageId: number; readonly source: 'edited' | 'updated' }): void;
    onMessageDeleted?(payload: {
        readonly deletedIndex?: number;
        readonly remainingCount?: number;
        readonly rawData: unknown;
    }): void;
    onChatChanged?(): void;
    onChatLoaded?(): void;
    onMoreMessagesLoaded?(): void;
    onAppReady?(): void;
}

/** 将宿主事件中的消息/分支下标字段规范化为非负整数 */
export function parseHostIndex(val: unknown): number | undefined {
    if (typeof val === 'number') {
        return Number.isInteger(val) && val >= 0 ? val : undefined;
    }
    if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
        return Number(val.trim());
    }
    return undefined;
}

/** 从宿主事件负载中提取消息索引 (`number` 或 `{ messageId, id }`) */
export function extractHostMessageId(data: unknown): number | undefined {
    const direct = parseHostIndex(data);
    if (direct !== undefined) return direct;
    if (data && typeof data === 'object') {
        const rec = data as Record<string, unknown>;
        return parseHostIndex(rec.messageId) ?? parseHostIndex(rec.id);
    }
    return undefined;
}

export class HostEventBridge implements Disposable {
    private readonly cleanups: Array<() => void> = [];
    private readonly pendingEditFallbackTimers = new Map<number, ReturnType<typeof setTimeout>>();
    private generation = 0;
    private isDisposed = false;

    /**
     * 绑定 SillyTavern 宿主事件总线监听器。
     * 重复绑定会先清理既有监听器，保证幂等安全。
     */
    public bind(callbacks: HostEventCallbacks): boolean {
        this.dispose();
        this.isDisposed = false;
        this.generation += 1;
        const bindGen = this.generation;

        const hostContext = getHostContext();
        const eventSource = hostContext?.eventSource;
        if (!eventSource) {
            return false;
        }
        const eventTypes = hostContext.eventTypes || {};

        const listen = (eventType: string, handler: (...args: unknown[]) => void) => {
            eventSource.on(eventType, handler);
            this.cleanups.push(() => {
                const source = eventSource as {
                    off?: (t: string, h: (...args: unknown[]) => void) => void;
                    removeListener?: (t: string, h: (...args: unknown[]) => void) => void;
                };
                if (typeof source.off === 'function') {
                    source.off(eventType, handler);
                } else if (typeof source.removeListener === 'function') {
                    source.removeListener(eventType, handler);
                }
            });
        };

        const msgReceivedEvent = eventTypes.MESSAGE_RECEIVED || 'message_received';
        listen(msgReceivedEvent, (data: unknown, type?: unknown) => {
            const messageId = extractHostMessageId(data);
            if (messageId === undefined) return;
            callbacks.onMessageReceived?.({ messageId, type });
        });

        const genStoppedEvent = eventTypes.GENERATION_STOPPED || 'generation_stopped';
        listen(genStoppedEvent, () => {
            callbacks.onGenerationStopped?.();
        });

        const genEndedEvent = eventTypes.GENERATION_ENDED || 'generation_ended';
        listen(genEndedEvent, () => {
            callbacks.onGenerationEnded?.();
        });

        const charRenderedEvent =
            eventTypes.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        listen(charRenderedEvent, (data: unknown, type?: unknown) => {
            const messageId = extractHostMessageId(data);
            if (messageId === undefined) return;
            return callbacks.onCharacterMessageRendered?.({ messageId, type });
        });

        const userRenderedEvent =
            eventTypes.USER_MESSAGE_RENDERED || 'user_message_rendered';
        listen(userRenderedEvent, (data: unknown) => {
            const messageId = extractHostMessageId(data);
            if (messageId === undefined) return;
            callbacks.onUserMessageRendered?.({ messageId });
        });

        const msgSentEvent = eventTypes.MESSAGE_SENT || 'message_sent';
        listen(msgSentEvent, () => {
            callbacks.onMessageSent?.();
        });

        const genStartedEvent = eventTypes.GENERATION_STARTED || 'generation_started';
        listen(genStartedEvent, () => {
            callbacks.onGenerationStarted?.();
        });

        const beforeCombinedEvent =
            eventTypes.GENERATE_BEFORE_COMBINED_PROMPTS || 'generate_before_combined_prompts';
        listen(beforeCombinedEvent, () => {
            callbacks.onBeforeCombinedPrompts?.();
        });

        const swipeEvent = eventTypes.MESSAGE_SWIPED || 'message_swiped';
        listen(swipeEvent, (data: unknown) => {
            const messageId = extractHostMessageId(data);
            if (messageId === undefined) return;
            this.cancelPendingEditFallback(messageId);
            const swipeId =
                data && typeof data === 'object' && 'swipeId' in data
                    ? parseHostIndex((data as { swipeId?: unknown }).swipeId)
                    : undefined;
            callbacks.onMessageSwiped?.({ messageId, swipeId });
        });

        const swipeDeletedEvent =
            eventTypes.MESSAGE_SWIPE_DELETED || 'message_swipe_deleted';
        listen(swipeDeletedEvent, (data: unknown) => {
            if (!data || typeof data !== 'object') return;
            const payload = data as {
                messageId?: unknown;
                swipeId?: unknown;
                newSwipeId?: unknown;
            };
            const messageId = extractHostMessageId(payload);
            if (messageId === undefined) return;
            callbacks.onMessageSwipeDeleted?.({
                messageId,
                swipeId: parseHostIndex(payload.swipeId),
                newSwipeId: parseHostIndex(payload.newSwipeId),
            });
        });

        // 宿主先发 MESSAGE_EDITED 后重建 .mes_text 再发 MESSAGE_UPDATED；优先由 UPDATED 立即触发，EDITED 保留 0ms 回退合批
        const msgUpdatedEvent: string = eventTypes.MESSAGE_UPDATED || 'message_updated';
        listen(msgUpdatedEvent, (data: unknown) => {
            const messageId = extractHostMessageId(data);
            if (messageId === undefined) return;
            this.cancelPendingEditFallback(messageId);
            callbacks.onMessageEdited?.({ messageId, source: 'updated' });
        });

        const msgEditedEvent: string = eventTypes.MESSAGE_EDITED || 'message_edited';
        if (msgEditedEvent !== msgUpdatedEvent) {
            listen(msgEditedEvent, (data: unknown) => {
                const messageId = extractHostMessageId(data);
                if (messageId === undefined) return;
                this.cancelPendingEditFallback(messageId);
                const timer = setTimeout(() => {
                    this.pendingEditFallbackTimers.delete(messageId);
                    if (this.isDisposed || this.generation !== bindGen) {
                        return;
                    }
                    callbacks.onMessageEdited?.({ messageId, source: 'edited' });
                }, 0);
                this.pendingEditFallbackTimers.set(messageId, timer);
            });
        }

        const msgDeletedEvent = eventTypes.MESSAGE_DELETED || 'message_deleted';
        listen(msgDeletedEvent, (data: unknown) => {
            this.clearPendingEditFallbackTimers();
            const deletedIndex =
                data && typeof data === 'object' ? extractHostMessageId(data) : undefined;
            const remainingCount = parseHostIndex(data);
            callbacks.onMessageDeleted?.({
                deletedIndex,
                remainingCount,
                rawData: data,
            });
        });

        const chatChangedEvent = eventTypes.CHAT_CHANGED || 'chat_id_changed';
        listen(chatChangedEvent, () => {
            this.clearPendingEditFallbackTimers();
            callbacks.onChatChanged?.();
        });

        const chatLoadedEvent = eventTypes.CHAT_LOADED || 'chatLoaded';
        listen(chatLoadedEvent, () => {
            this.clearPendingEditFallbackTimers();
            callbacks.onChatLoaded?.();
        });

        const moreLoadedEvent = eventTypes.MORE_MESSAGES_LOADED || 'more_messages_loaded';
        listen(moreLoadedEvent, () => {
            callbacks.onMoreMessagesLoaded?.();
        });

        for (const readyEvt of [
            eventTypes.APP_INITIALIZED || 'app_initialized',
            eventTypes.APP_READY || 'app_ready',
        ]) {
            listen(readyEvt, () => {
                callbacks.onAppReady?.();
            });
        }

        return true;
    }

    /** 取消指定楼层的 0ms 编辑回退定时器 */
    public cancelPendingEditFallback(messageId: number): void {
        const timer = this.pendingEditFallbackTimers.get(messageId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.pendingEditFallbackTimers.delete(messageId);
        }
    }

    /** 清理全部待触发的编辑回退定时器 */
    public clearPendingEditFallbackTimers(): void {
        for (const timer of this.pendingEditFallbackTimers.values()) {
            clearTimeout(timer);
        }
        this.pendingEditFallbackTimers.clear();
    }

    /** 解绑全部宿主事件监听器并清理合批定时器 */
    public dispose(): void {
        this.isDisposed = true;
        this.generation += 1;
        this.clearPendingEditFallbackTimers();
        for (const cleanup of this.cleanups) {
            try {
                cleanup();
            } catch {
                // 忽略宿主监听器卸载异常
            }
        }
        this.cleanups.length = 0;
    }
}
