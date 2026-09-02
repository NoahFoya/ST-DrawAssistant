/**
 * @module core/host/host-facade
 * @description SillyTavern 宿主环境接口代理
 */

import { IDisposable, toDisposable } from '../types';
import { Logger } from '../logging/logger';
import {
    EXTENSION_NAME,
    DEFAULT_HOST_READY_TIMEOUT_MS,
    DEFAULT_HOST_READY_POLL_INTERVAL_MS
} from '../constants';

export interface HostMessageEvent {
    readonly messageId: number;
    readonly chatId: string;
    readonly isUser: boolean;
    readonly rawText: string;
    readonly swipeId?: number;
    readonly element?: HTMLElement;
}

interface SillyTavernContext {
    chat?: Array<{
        mes?: string;
        text?: string;
        swipe_id?: number;
        extra?: Record<string, any>;
    }>;
    chatId?: string;
    characterId?: number | string;
    characters?: Record<string | number, { name?: string; avatar?: string; description?: string }>;
    eventSource?: {
        on: (event: string, fn: (...args: any[]) => void) => void;
        off?: (event: string, fn: (...args: any[]) => void) => void;
        removeListener?: (event: string, fn: (...args: any[]) => void) => void;
        emit?: (event: string, ...args: any[]) => void;
    };
    event_types?: Record<string, string>;
    extensionSettings?: Record<string, unknown>;
    saveChatDebounced?: () => void;
    saveSettingsDebounced?: () => void;
    getCurrentChatId?: () => string;
    getRequestHeaders?: () => Record<string, string>;
}

/**
 * 宿主环境代理门面
 * 封装酒馆就绪检测、消息事件监听、角色信息读取与扩展数据防抖存盘
 */
export class HostFacade implements IDisposable {
    private readonly _logger = new Logger('HostFacade');
    private readonly _disposables: IDisposable[] = [];
    private _isReady = false;
    private _readyPromise: Promise<void> | null = null;
    public static readonly EXTENSION_KEY = EXTENSION_NAME;

    /** 获取酒馆全局上下文 (SillyTavern.getContext) */
    private getST(): SillyTavernContext | null {
        if (typeof window !== 'undefined' && (window as any).SillyTavern?.getContext) {
            return (window as any).SillyTavern.getContext();
        }
        return null;
    }

    /**
     * 等待宿主环境及其事件源就绪
     */
    public async whenReady(timeoutMs = DEFAULT_HOST_READY_TIMEOUT_MS): Promise<void> {
        if (this._isReady) return;
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = new Promise<void>((resolve) => {
            const ctx = this.getST();
            if (ctx?.eventSource && ctx?.event_types) {
                this._isReady = true;
                resolve();
                return;
            }

            const timer = setInterval(() => {
                const currentCtx = this.getST();
                if (currentCtx?.eventSource && currentCtx?.event_types) {
                    clearInterval(timer);
                    this._isReady = true;
                    resolve();
                }
            }, DEFAULT_HOST_READY_POLL_INTERVAL_MS);

            setTimeout(() => {
                clearInterval(timer);
                this._isReady = true;
                resolve();
            }, timeoutMs);
        });

        return this._readyPromise;
    }

    /** 解绑宿主事件监听器 */
    private unbindHostEvent(eventName: string, listener: (...args: any[]) => void): void {
        const ctx = this.getST();
        if (!ctx?.eventSource) return;
        if (typeof ctx.eventSource.off === 'function') {
            try {
                ctx.eventSource.off(eventName, listener);
            } catch {}
        } else if (typeof ctx.eventSource.removeListener === 'function') {
            try {
                ctx.eventSource.removeListener(eventName, listener);
            } catch {}
        }
    }

    /** 监听角色消息渲染完成事件 */
    public onCharacterMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable {
        const ctx = this.getST();
        const eventType = ctx?.event_types?.CHARACTER_MESSAGE_RENDERED;
        if (!ctx?.eventSource || !eventType) return toDisposable(() => {});

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? data?.id ?? 0);
            const chat = ctx.chat || [];
            const msgObj = chat[messageId] || (typeof data === 'object' ? data : null);
            handler({
                messageId,
                chatId: this.getCurrentChatId() || '',
                isUser: false,
                rawText: msgObj?.mes || msgObj?.text || '',
                swipeId: msgObj?.swipe_id,
                element: this.getMessageElement(messageId) || undefined
            });
        };

        ctx.eventSource.on(eventType, listener);
        const d = toDisposable(() => this.unbindHostEvent(eventType, listener));
        this._disposables.push(d);
        return d;
    }

    /** 监听用户消息渲染完成事件 */
    public onUserMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable {
        const ctx = this.getST();
        const eventType = ctx?.event_types?.USER_MESSAGE_RENDERED;
        if (!ctx?.eventSource || !eventType) return toDisposable(() => {});

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? data?.id ?? 0);
            const chat = ctx.chat || [];
            const msgObj = chat[messageId] || (typeof data === 'object' ? data : null);
            handler({
                messageId,
                chatId: this.getCurrentChatId() || '',
                isUser: true,
                rawText: msgObj?.mes || msgObj?.text || '',
                swipeId: msgObj?.swipe_id,
                element: this.getMessageElement(messageId) || undefined
            });
        };

        ctx.eventSource.on(eventType, listener);
        const d = toDisposable(() => this.unbindHostEvent(eventType, listener));
        this._disposables.push(d);
        return d;
    }

    /** 监听消息分支切换事件 (Swipe) */
    public onMessageSwiped(handler: (ev: { messageId: number; swipeId: number }) => void): IDisposable {
        const ctx = this.getST();
        const eventType = ctx?.event_types?.MESSAGE_SWIPED;
        if (!ctx?.eventSource || !eventType) return toDisposable(() => {});

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? 0);
            const swipeId = data?.swipeId ?? (ctx.chat?.[messageId]?.swipe_id ?? 0);
            handler({ messageId, swipeId });
        };

        ctx.eventSource.on(eventType, listener);
        const d = toDisposable(() => this.unbindHostEvent(eventType, listener));
        this._disposables.push(d);
        return d;
    }

    /** 监听消息编辑或重新生成更新事件 */
    public onMessageUpdated(handler: (ev: { messageId: number }) => void): IDisposable {
        const ctx = this.getST();
        const eventType = ctx?.event_types?.MESSAGE_UPDATED || ctx?.event_types?.MESSAGE_EDITED;
        if (!ctx?.eventSource || !eventType) return toDisposable(() => {});

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? data?.id ?? 0);
            handler({ messageId });
        };

        ctx.eventSource.on(eventType, listener);
        const d = toDisposable(() => this.unbindHostEvent(eventType, listener));
        this._disposables.push(d);
        return d;
    }

    /** 监听消息删除事件 */
    public onMessageDeleted(handler: (ev: { messageId: number }) => void): IDisposable {
        const ctx = this.getST();
        const eventType = ctx?.event_types?.MESSAGE_DELETED;
        if (!ctx?.eventSource || !eventType) return toDisposable(() => {});

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? 0);
            handler({ messageId });
        };

        ctx.eventSource.on(eventType, listener);
        const d = toDisposable(() => this.unbindHostEvent(eventType, listener));
        this._disposables.push(d);
        return d;
    }

    /** 监听会话切换事件 (CHAT_CHANGED) */
    public onChatChanged(handler: (chatId: string) => void): IDisposable {
        const ctx = this.getST();
        const eventType = ctx?.event_types?.CHAT_CHANGED;
        if (!ctx?.eventSource || !eventType) return toDisposable(() => {});

        const listener = (data: any) => {
            const chatId = typeof data === 'string' ? data : (data?.id || this.getCurrentChatId() || '');
            handler(chatId);
        };

        ctx.eventSource.on(eventType, listener);
        const d = toDisposable(() => this.unbindHostEvent(eventType, listener));
        this._disposables.push(d);
        return d;
    }

    /** 获取当前会话 ID */
    public getCurrentChatId(): string | null {
        const ctx = this.getST();
        return ctx?.chatId || ctx?.getCurrentChatId?.() || null;
    }

    /** 获取当前对话角色的基础信息 */
    public getCurrentCharacter(): { name: string; avatar?: string; description?: string } | null {
        const ctx = this.getST();
        if (!ctx) return null;
        const charId = ctx.characterId;
        if (charId === undefined || charId === null) return null;
        const charObj = ctx.characters?.[charId];
        if (!charObj) return null;
        return {
            name: charObj.name || '',
            avatar: charObj.avatar || '',
            description: charObj.description || ''
        };
    }

    /** 获取指定楼层的 DOM 容器元素 */
    public getMessageElement(messageId: number): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return (document.querySelector(`.mes[mesid="${messageId}"]`) ||
            document.querySelector(`div[mesid="${messageId}"]`)) as HTMLElement | null;
    }

    /**
     * 向指定楼层的 message.extra[EXTENSION_KEY] 写入扩展数据并触发防抖存盘
     */
    public writeChatMessageExtra(messageId: number, key: string, value: unknown): void {
        const ctx = this.getST();
        if (!ctx || !Array.isArray(ctx.chat)) return;

        const message = ctx.chat[messageId];
        if (!message) return;

        message.extra = message.extra || {};
        message.extra[HostFacade.EXTENSION_KEY] = message.extra[HostFacade.EXTENSION_KEY] || {};
        message.extra[HostFacade.EXTENSION_KEY][key] = value;

        if (ctx.eventSource && ctx.event_types?.MESSAGE_UPDATED && typeof ctx.eventSource.emit === 'function') {
            ctx.eventSource.emit(ctx.event_types.MESSAGE_UPDATED, messageId);
        }
        this.saveChatDebounced();
    }

    /** 防抖保存当前聊天记录 */
    public saveChatDebounced(): void {
        const ctx = this.getST();
        if (typeof ctx?.saveChatDebounced === 'function') {
            try {
                ctx.saveChatDebounced();
            } catch (err) {
                this._logger.error('保存聊天记录失败', err);
            }
        }
    }

    /** 防抖保存全局扩展设置 */
    public saveExtensionSettingsDebounced(): void {
        const ctx = this.getST();
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            try {
                ctx.saveSettingsDebounced();
            } catch (err) {
                this._logger.error('保存设置失败', err);
            }
        }
    }

    /** 读取宿主 extensionSettings 中的插件设置 */
    public getExtensionSettings<T = Record<string, unknown>>(): T | null {
        const ctx = this.getST();
        if (ctx?.extensionSettings) {
            if (ctx.extensionSettings[HostFacade.EXTENSION_KEY] !== undefined) {
                return ctx.extensionSettings[HostFacade.EXTENSION_KEY] as T;
            }
        }
        return null;
    }

    /** 将设置存入宿主 extensionSettings */
    public saveExtensionSettings(settings: Record<string, unknown>): void {
        const ctx = this.getST();
        if (!ctx) return;
        ctx.extensionSettings = ctx.extensionSettings || {};
        ctx.extensionSettings[HostFacade.EXTENSION_KEY] = settings;
        this.saveExtensionSettingsDebounced();
    }

    /** 获取宿主 API CSRF 安全标头 */
    public getRequestHeaders(): Record<string, string> {
        const ctx = this.getST();
        if (typeof ctx?.getRequestHeaders === 'function') {
            try {
                return ctx.getRequestHeaders();
            } catch {}
        }
        if (typeof (window as any).getRequestHeaders === 'function') {
            try {
                return (window as any).getRequestHeaders();
            } catch {}
        }

        return {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
    }

    public dispose(): void {
        this._isReady = false;
        this._readyPromise = null;
        for (const d of this._disposables) {
            try {
                d.dispose();
            } catch {}
        }
        this._disposables.length = 0;
    }
}
