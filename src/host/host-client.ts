/**
 * SillyTavern 宿主环境接口封装
 * 处理酒馆全局对象、消息树、角色上下文、原生事件监听与配置防抖保存。
 */

import { IDisposable, toDisposable } from '../types/common';
import {
    EXTENSION_NAME,
    DEFAULT_HOST_READY_TIMEOUT_MS,
    DEFAULT_HOST_READY_POLL_INTERVAL_MS
} from '../constants';
import { blobToBase64 } from '../utils/binary';

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
    saveChat?: () => Promise<void> | void;
    saveChatDebounced?: () => void;
    saveSettingsDebounced: () => void;
    getRequestHeaders?: () => Record<string, string>;
}

interface HostSubscriptionDescriptor {
    readonly getEventType: (ctx: SillyTavernContext) => string | undefined;
    readonly listener: (ctx: SillyTavernContext, ...args: any[]) => void;
    disposable?: IDisposable;
}

export class HostClient implements IDisposable {
    private readonly _disposables = new Set<IDisposable>();
    private readonly _pendingSubscriptions = new Set<HostSubscriptionDescriptor>();
    private _isReady = false;
    private _readyPromise: Promise<void> | null = null;
    private _pollTimer: ReturnType<typeof setInterval> | null = null;
    private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    public static readonly EXTENSION_KEY = EXTENSION_NAME;

    public isReady(): boolean {
        if (this._isReady) return true;
        const ctx = this.getST();
        if (Boolean(ctx?.eventSource && ctx?.event_types)) {
            this._isReady = true;
            return true;
        }
        return false;
    }

    private getST(): SillyTavernContext | null {
        if (typeof window !== 'undefined' && (window as any).SillyTavern?.getContext) {
            return (window as any).SillyTavern.getContext();
        }
        return null;
    }

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
     * 等待宿主环境及核心事件总线加载就绪
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
     * 注册事件监听。若宿主未就绪则暂存，待就绪后自动绑定，避免因加载时序报错。
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

    public onChatSwiped(handler: (ev: { messageId: number; swipeId: number }) => void): IDisposable {
        return this.onMessageSwiped(handler);
    }

    public onMessageUpdated(handler: (ev: { messageId: number }) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.MESSAGE_UPDATED,
            (_ctx, messageId: number) => {
                handler({ messageId });
            }
        );
    }

    public onMessageEdited(handler: (ev: { messageId: number }) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.MESSAGE_EDITED,
            (_ctx, messageId: number) => {
                handler({ messageId });
            }
        );
    }

    /**
     * 监听消息删除事件
     * 酒馆原生在删楼后重新重编剩余消息的 mesid，并触发 MESSAGE_DELETED(chat.length)。
     * 传递的数值为删除后的新聊天记录长度（newChatLength）。
     */
    public onMessageDeleted(handler: (ev: { newChatLength: number; messageId?: number }) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.MESSAGE_DELETED,
            (_ctx, newChatLength: number) => {
                const len = typeof newChatLength === 'number' ? newChatLength : 0;
                handler({ newChatLength: len, messageId: len });
            }
        );
    }

    public onMoreMessagesLoaded(handler: () => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.MORE_MESSAGES_LOADED,
            () => {
                handler();
            }
        );
    }

    public onChatLoaded(handler: () => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.CHAT_LOADED,
            () => {
                handler();
            }
        );
    }

    public onChatChanged(handler: (chatId: string) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.CHAT_CHANGED,
            (ctx, chatId?: string) => {
                handler(chatId || ctx.chatId || '');
            }
        );
    }

    public onGenerationStarted(handler: (data?: any) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.GENERATION_STARTED,
            (_ctx, data?: any) => {
                handler(data);
            }
        );
    }

    public onGenerationEnded(handler: (data?: any) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.GENERATION_ENDED,
            (_ctx, data?: any) => {
                handler(data);
            }
        );
    }

    public onSettingsUpdated(handler: (settings?: unknown) => void): IDisposable {
        return this.subscribe(
            (ctx) => ctx.event_types.SETTINGS_UPDATED,
            (_ctx, settings) => {
                handler(settings);
            }
        );
    }

    public getCurrentChatId(): string | null {
        return this.getST()?.chatId || null;
    }

    public getUserName(): string | null {
        const ctx = this.getST();
        if (!ctx) return null;
        return ctx.name1 || ctx.name || null;
    }

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

    public getMessageElement(messageId: number): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return document.querySelector(`.mes[mesid="${messageId}"]`) as HTMLElement | null;
    }

    /**
     * 写入楼层消息的 extra 元数据
     * 统一写入顶级 extra 属性，保存会话并广播 MESSAGE_UPDATED 事件
     */
    public writeChatMessageExtra(messageId: number, key: string, value: unknown): void {
        const ctx = this.getST();
        if (!ctx?.chat) return;

        const message = ctx.chat[messageId];
        if (!message) return;

        message.extra = message.extra || {};
        message.extra[key] = value;

        this.saveChat();
        if (ctx.eventSource?.emit && ctx.event_types?.MESSAGE_UPDATED) {
            void ctx.eventSource.emit(ctx.event_types.MESSAGE_UPDATED, messageId);
        }
    }

    public readChatMessageExtra<T = unknown>(messageId: number, key?: string): T | undefined {
        const ctx = this.getST();
        if (!ctx?.chat) return undefined;

        const message = ctx.chat[messageId];
        if (!message?.extra) return undefined;

        if (key) {
            return message.extra[key] as T | undefined;
        }

        return message.extra as T;
    }

    public getChatMessage(messageId: number): SillyTavernMessage | null {
        const ctx = this.getST();
        return ctx?.chat?.[messageId] || null;
    }

    public getMessageById(messageId: number): SillyTavernMessage | null {
        return this.getChatMessage(messageId);
    }

    public getChat(): SillyTavernMessage[] {
        const ctx = this.getST();
        return ctx?.chat || [];
    }

    public async updateMessage(messageId: number, message: SillyTavernMessage): Promise<void> {
        const ctx = this.getST();
        if (ctx?.chat && ctx.chat[messageId]) {
            ctx.chat[messageId] = message;
            ctx.eventSource?.emit?.(ctx.event_types?.MESSAGE_UPDATED || 'message_updated', messageId);
        }
        this.saveChat();
    }

    public saveChat(): void {
        const ctx = this.getST();
        if (typeof ctx?.saveChatDebounced === 'function') {
            ctx.saveChatDebounced();
            return;
        }
        if (typeof ctx?.saveChat === 'function') {
            void ctx.saveChat();
        }
    }

    public saveChatDebounced(): void {
        this.saveChat();
    }

    public saveExtensionSettingsDebounced(): void {
        this.getST()?.saveSettingsDebounced?.();
    }

    public getExtensionSettings<T = Record<string, unknown>>(): T | null {
        const ctx = this.getST();
        if (ctx?.extensionSettings) {
            if (ctx.extensionSettings[HostClient.EXTENSION_KEY] !== undefined) {
                return ctx.extensionSettings[HostClient.EXTENSION_KEY] as T;
            }
        }
        return null;
    }

    public saveExtensionSettings(settings: Record<string, unknown>): boolean {
        const ctx = this.getST();
        if (!ctx) {
            console.warn('[ST-DrawAssistant][HostClient] 未处于 SillyTavern 宿主环境，配置未持久化至宿主磁盘');
            return false;
        }
        try {
            ctx.extensionSettings = ctx.extensionSettings || {};
            ctx.extensionSettings[HostClient.EXTENSION_KEY] = settings;
            this.saveExtensionSettingsDebounced();
            return true;
        } catch (err) {
            console.error('[ST-DrawAssistant][HostClient] 保存插件设置异常:', err);
            return false;
        }
    }

    public getRequestHeaders(): Record<string, string> {
        return this.getST()?.getRequestHeaders?.() || {};
    }

    /**
     * 上传图片至 SillyTavern 宿主服务端静态资产目录 (/api/images/upload)
     * 生成跨设备全局可访问的静态相对路径，规避客户端 IndexedDB 易失与跨端裂图问题
     */
    public async uploadImageToServer(
        blob: Blob,
        options?: { filename?: string; characterName?: string; format?: string }
    ): Promise<{ path: string }> {
        if (typeof fetch === 'undefined') {
            throw new Error('当前运行环境不支持 fetch 网络接口');
        }

        const base64Data = await blobToBase64(blob);
        const format = options?.format || (blob.type.includes('jpeg') ? 'jpeg' : blob.type.includes('webp') ? 'webp' : 'png');
        const uploadBody: Record<string, unknown> = {
            image: base64Data,
            format
        };
        if (options?.characterName) {
            uploadBody.ch_name = options.characterName;
        }
        if (options?.filename) {
            uploadBody.filename = options.filename;
        }

        const headers: Record<string, string> = {
            ...this.getRequestHeaders(),
            'Content-Type': 'application/json'
        };

        const response = await fetch('/api/images/upload', {
            method: 'POST',
            headers,
            body: JSON.stringify(uploadBody)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`上传图片至酒馆服务端失败 (HTTP ${response.status}): ${errText || response.statusText}`);
        }

        const data = await response.json();
        if (data?.path) {
            const normalizedPath = String(data.path).startsWith('/') ? data.path : `/${data.path}`;
            return { path: normalizedPath };
        }

        throw new Error('上传图片成功但未收到有效的图片相对路径响应');
    }

    /**
     * 从 SillyTavern 宿主服务端删除指定图片资产 (/api/images/delete)
     */
    public async deleteImageFromServer(path: string): Promise<boolean> {
        if (typeof fetch === 'undefined' || !path) return false;
        try {
            const cleanPath = path.startsWith('/') ? path.slice(1) : path;
            const headers: Record<string, string> = {
                ...this.getRequestHeaders(),
                'Content-Type': 'application/json'
            };
            const response = await fetch('/api/images/delete', {
                method: 'POST',
                headers,
                body: JSON.stringify({ path: cleanPath })
            });
            return response.ok;
        } catch (err) {
            console.warn('[ST-DrawAssistant][HostClient] 从酒馆服务端删除图片异常:', err);
            return false;
        }
    }

    public getExtensionDrawerContainer(): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return document.getElementById('extensions_settings');
    }

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

    public getReferencedImageIds(): Set<string> {
        const ids = new Set<string>();
        const ctx = this.getST();
        const chat = ctx?.chat;
        if (!Array.isArray(chat)) return ids;

        for (const msg of chat) {
            const extra = msg?.extra;
            if (!extra || typeof extra !== 'object') continue;

            const daImages = extra['da_images'] as Record<string, Record<string, { uuid?: string }>> | undefined;
            if (!daImages || typeof daImages !== 'object') continue;

            for (const swipeGroup of Object.values(daImages)) {
                if (swipeGroup && typeof swipeGroup === 'object') {
                    for (const entry of Object.values(swipeGroup)) {
                        if (entry && typeof entry.uuid === 'string' && entry.uuid) {
                            ids.add(entry.uuid);
                        }
                    }
                }
            }
        }
        return ids;
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
