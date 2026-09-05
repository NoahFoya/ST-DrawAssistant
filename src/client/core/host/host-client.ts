/**
 * @module core/host/host-client
 * @description SillyTavern 宿主环境接口代理
 */

import { IDisposable, toDisposable } from '../types';
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

export interface SillyTavernMessage {
    mes: string;
    is_user?: boolean;
    swipe_id?: number;
    extra?: Record<string, any>;
}

interface SillyTavernContext {
    chat: SillyTavernMessage[];
    chatId: string;
    name?: string;
    name1?: string;
    userName?: string;
    characterId?: number | string;
    characters?: Record<string | number, {
        name?: string;
        avatar?: string;
        description?: string;
        personality?: string;
        data?: Record<string, unknown>;
    }>;
    eventSource: {
        on: (event: string, fn: (...args: any[]) => void) => void;
        off?: (event: string, fn: (...args: any[]) => void) => void;
        removeListener?: (event: string, fn: (...args: any[]) => void) => void;
        emit: (event: string, ...args: any[]) => void;
    };
    event_types: Record<string, string>;
    extensionSettings: Record<string, unknown>;
    saveChatDebounced: () => void;
    saveSettingsDebounced: () => void;
    getRequestHeaders?: () => Record<string, string>;
}

interface HostSubscriptionDescriptor {
    readonly getEventType: (ctx: SillyTavernContext) => string | undefined;
    readonly listener: (ctx: SillyTavernContext, ...args: any[]) => void;
    disposable?: IDisposable;
}

/**
 * 酒馆宿主环境客户端接口代理
 * 封装酒馆就绪检测、消息事件监听、角色信息读取与配置防抖保存
 */
export class HostClient implements IDisposable {
    private readonly _disposables = new Set<IDisposable>();
    /**
     * 待绑定的事件监听列表
     * 若插件加载时酒馆环境尚未就绪，先暂存监听器，等酒馆加载完毕后再统一绑定
     */
    private readonly _pendingSubscriptions = new Set<HostSubscriptionDescriptor>();
    private _isReady = false;
    private _readyPromise: Promise<void> | null = null;
    private _pollTimer: ReturnType<typeof setInterval> | null = null;
    private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    public static readonly EXTENSION_KEY = EXTENSION_NAME;

    /** 检查宿主是否已经就绪 */
    public isReady(): boolean {
        if (this._isReady) return true;
        const ctx = this.getST();
        if (Boolean(ctx?.eventSource && ctx?.event_types)) {
            this._isReady = true;
            return true;
        }
        return false;
    }

    /**
     * 获取酒馆全局上下文快照 (SillyTavern.getContext)
     */
    private getST(): SillyTavernContext | null {
        if (typeof window !== 'undefined' && (window as any).SillyTavern?.getContext) {
            return (window as any).SillyTavern.getContext();
        }
        return null;
    }

    /**
     * 停止并清理就绪轮询与超时监控计时器
     */
    private clearReadyTimers(): void {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }
    }

    /**
     * 异步等待宿主环境及核心事件总线注入就绪
     *
     * @param timeoutMs 最长等待毫秒数，超时将拒绝 Promise 并保留现场日志
     */
    public async whenReady(timeoutMs = DEFAULT_HOST_READY_TIMEOUT_MS): Promise<void> {
        if (this.isReady()) {
            this._flushPendingSubscriptions();
            return;
        }
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = new Promise<void>((resolve, reject) => {
            this._pollTimer = setInterval(() => {
                if (this.isReady()) {
                    this.clearReadyTimers();
                    this._flushPendingSubscriptions();
                    resolve();
                }
            }, DEFAULT_HOST_READY_POLL_INTERVAL_MS);

            this._timeoutTimer = setTimeout(() => {
                this.clearReadyTimers();
                this._readyPromise = null;
                reject(new Error(`等待 SillyTavern 宿主环境就绪超时 (${timeoutMs}ms)`));
            }, timeoutMs);
        });

        return this._readyPromise;
    }

    /**
     * 将暂存的事件监听描述符批量注册至宿主真实事件源
     */
    private _flushPendingSubscriptions(): void {
        const ctx = this.getST();
        if (!ctx?.eventSource || !ctx?.event_types) return;

        for (const item of Array.from(this._pendingSubscriptions)) {
            if (item.disposable) continue;
            const eventType = item.getEventType(ctx);
            if (!eventType) continue;

            const bound = (...args: any[]) => item.listener(ctx, ...args);
            ctx.eventSource.on(eventType, bound);

            const activeDisposable = toDisposable(() => {
                if (typeof ctx.eventSource.off === 'function') {
                    ctx.eventSource.off(eventType, bound);
                } else if (typeof ctx.eventSource.removeListener === 'function') {
                    ctx.eventSource.removeListener(eventType, bound);
                }
            });

            item.disposable = activeDisposable;
            this._disposables.add(activeDisposable);
        }
    }

    /**
     * 注册宿主事件监听器，并返回用于取消监听的清理对象
     *
     * 支持延迟绑定：若宿主尚未就绪，先暂存监听器，待宿主加载完毕后自动完成绑定，
     * 避免因插件与宿主加载时序不一致导致报错。
     */
    private subscribe(
        getEventType: (ctx: SillyTavernContext) => string | undefined,
        listener: (ctx: SillyTavernContext, ...args: any[]) => void
    ): IDisposable {
        const item: HostSubscriptionDescriptor = {
            getEventType,
            listener
        };

        this._pendingSubscriptions.add(item);

        if (this.isReady()) {
            this._flushPendingSubscriptions();
        }

        const remover = toDisposable(() => {
            this._disposables.delete(remover);
            this._pendingSubscriptions.delete(item);
            if (item.disposable) {
                this._disposables.delete(item.disposable);
                item.disposable.dispose();
                item.disposable = undefined;
            }
        });

        this._disposables.add(remover);
        return remover;
    }

    /** 监听角色消息渲染完成事件 */
    public onCharacterMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.CHARACTER_MESSAGE_RENDERED,
            (ctx, messageId: number) => {
                const msg = ctx.chat?.[messageId];
                if (!msg) return;

                handler({
                    messageId,
                    chatId: ctx.chatId || '',
                    isUser: false,
                    rawText: msg.mes || '',
                    swipeId: msg.swipe_id,
                    element: this.getMessageElement(messageId) || undefined
                });
            }
        );
    }

    /** 监听用户消息渲染完成事件 */
    public onUserMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.USER_MESSAGE_RENDERED,
            (ctx, messageId: number) => {
                const msg = ctx.chat?.[messageId];
                if (!msg) return;

                handler({
                    messageId,
                    chatId: ctx.chatId || '',
                    isUser: true,
                    rawText: msg.mes || '',
                    swipeId: msg.swipe_id,
                    element: this.getMessageElement(messageId) || undefined
                });
            }
        );
    }

    /** 监听消息分支切换事件 (Swipe) */
    public onMessageSwiped(handler: (ev: { messageId: number; swipeId: number }) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.MESSAGE_SWIPED,
            (ctx, messageId: number, swipeId?: number) => {
                const resolvedSwipeId = typeof swipeId === 'number'
                    ? swipeId
                    : (ctx.chat?.[messageId]?.swipe_id ?? 0);
                handler({ messageId, swipeId: resolvedSwipeId });
            }
        );
    }

    /** 监听消息分支切换事件便捷别名 */
    public onChatSwiped(handler: (ev: { messageId: number; swipeId: number }) => void): IDisposable {
        return this.onMessageSwiped(handler);
    }

    /** 监听消息编辑或更新事件 */
    public onMessageUpdated(handler: (ev: { messageId: number }) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.MESSAGE_UPDATED,
            (_ctx, messageId: number) => {
                handler({ messageId });
            }
        );
    }

    /** 监听消息删除事件 */
    public onMessageDeleted(handler: (ev: { messageId: number }) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.MESSAGE_DELETED,
            (_ctx, messageId: number) => {
                handler({ messageId });
            }
        );
    }

    /** 监听会话切换事件 (CHAT_CHANGED) */
    public onChatChanged(handler: (chatId: string) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.CHAT_CHANGED,
            (ctx, chatId?: string) => {
                handler(chatId || ctx.chatId || '');
            }
        );
    }

    /** 获取当前会话 ID */
    public getCurrentChatId(): string | null {
        return this.getST()?.chatId || null;
    }

    /** 获取当前用户名称 (User Name) */
    public getUserName(): string | null {
        const ctx = this.getST();
        if (!ctx) return null;
        return ctx.name || ctx.name1 || (ctx as any).userName || null;
    }

    /** 获取当前对话角色的基础与卡片信息 */
    public getCurrentCharacter(): {
        name: string;
        avatar?: string;
        description?: string;
        personality?: string;
        data?: Record<string, unknown>;
    } | null {
        const ctx = this.getST();
        if (!ctx) return null;
        const charId = ctx.characterId;
        if (charId === undefined || charId === null) return null;
        const charObj = ctx.characters?.[charId];
        if (!charObj) return null;
        return {
            name: charObj.name || '',
            avatar: charObj.avatar || '',
            description: charObj.description || '',
            personality: charObj.personality || '',
            data: charObj.data as Record<string, unknown> | undefined
        };
    }

    /** 获取指定消息的 DOM 容器元素 */
    public getMessageElement(messageId: number): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return document.querySelector(`.mes[mesid="${messageId}"]`) as HTMLElement | null;
    }

    /**
     * 向指定消息的 message.extra 写入插件数据并防抖保存
     * 变更后通知酒馆界面刷新
     */
    public writeChatMessageExtra(messageId: number, key: string, value: unknown): void {
        const ctx = this.getST();
        if (!ctx?.chat) return;

        const message = ctx.chat[messageId];
        if (!message) return;

        message.extra = message.extra || {};
        message.extra[HostClient.EXTENSION_KEY] = message.extra[HostClient.EXTENSION_KEY] || {};
        message.extra[HostClient.EXTENSION_KEY][key] = value;

        ctx.eventSource.emit(ctx.event_types.MESSAGE_UPDATED, messageId);
        ctx.saveChatDebounced();
    }

    /**
     * 读取指定消息的 message.extra[EXTENSION_KEY] 扩展数据
     *
     * @param messageId 消息索引
     * @param key 字段键名 (可选，若不传则返回整个命名空间对象)
     */
    public readChatMessageExtra<T = unknown>(messageId: number, key?: string): T | undefined {
        const ctx = this.getST();
        if (!ctx?.chat) return undefined;

        const message = ctx.chat[messageId];
        if (!message?.extra) return undefined;

        const extData = message.extra[HostClient.EXTENSION_KEY];
        if (!extData) return undefined;

        if (key) {
            return extData[key] as T;
        }
        return extData as T;
    }

    /**
     * 根据索引获取酒馆原始聊天消息对象
     * 用于提取 swipe_id、楼层文本或校验楼层归属
     *
     * @param messageId 楼层索引
     * @returns 消息对象或 null (若索引超出范围或宿主未就绪)
     */
    public getChatMessage(messageId: number): SillyTavernMessage | null {
        const ctx = this.getST();
        return ctx?.chat?.[messageId] || null;
    }

    /**
     * 根据索引获取消息对象便捷别名
     */
    public getMessageById(messageId: number): SillyTavernMessage | null {
        return this.getChatMessage(messageId);
    }

    /**
     * 更新指定消息对象并触发防抖保存
     */
    public async updateMessage(messageId: number, message: SillyTavernMessage): Promise<void> {
        const ctx = this.getST();
        if (ctx?.chat && ctx.chat[messageId]) {
            ctx.chat[messageId] = message;
            ctx.eventSource?.emit?.(ctx.event_types?.MESSAGE_UPDATED || 'message_updated', messageId);
        }
        this.saveChatDebounced();
    }

    /** 防抖保存当前聊天记录 */
    public saveChatDebounced(): void {
        this.getST()?.saveChatDebounced?.();
    }

    /** 防抖保存全局扩展设置 */
    public saveExtensionSettingsDebounced(): void {
        this.getST()?.saveSettingsDebounced?.();
    }

    /** 读取宿主 extensionSettings 中的插件设置 */
    public getExtensionSettings<T = Record<string, unknown>>(): T | null {
        const ctx = this.getST();
        if (ctx?.extensionSettings) {
            if (ctx.extensionSettings[HostClient.EXTENSION_KEY] !== undefined) {
                return ctx.extensionSettings[HostClient.EXTENSION_KEY] as T;
            }
        }
        return null;
    }

    /** 将设置存入宿主 extensionSettings */
    public saveExtensionSettings(settings: Record<string, unknown>): void {
        const ctx = this.getST();
        if (!ctx) return;
        ctx.extensionSettings = ctx.extensionSettings || {};
        ctx.extensionSettings[HostClient.EXTENSION_KEY] = settings;
        this.saveExtensionSettingsDebounced();
    }

    /** 获取酒馆 API CSRF 请求头 */
    public getRequestHeaders(): Record<string, string> {
        return this.getST()?.getRequestHeaders?.() || {};
    }

    /** 获取酒馆扩展设置抽屉容器 DOM 节点 */
    public getExtensionDrawerContainer(): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return document.getElementById('extensions_settings');
    }

    /**
     * 渲染酒馆扩展 HTML 模板
     * @param templateName 模板名称 (如 'settings')
     * @param data 渲染上下文数据
     */
    public async renderTemplate(templateName: string, data?: Record<string, unknown>): Promise<string> {
        const ctx = this.getST();
        if (ctx && typeof (ctx as any).renderExtensionTemplateAsync === 'function') {
            try {
                return await (ctx as any).renderExtensionTemplateAsync('third-party/ST-DrawAssistant', templateName, data);
            } catch {
                return await (ctx as any).renderExtensionTemplateAsync('ST-DrawAssistant', templateName, data);
            }
        }
        return '';
    }

    public dispose(): void {
        this.clearReadyTimers();
        this._isReady = false;
        this._readyPromise = null;
        this._pendingSubscriptions.clear();
        for (const d of Array.from(this._disposables)) {
            d.dispose();
        }
        this._disposables.clear();
    }
}
