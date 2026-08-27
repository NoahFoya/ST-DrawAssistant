/**
 * @module core/foundation/host-bridge
 * @description SillyTavern 宿主环境桥接适配器实现 (IHostBridge)
 */

import { IDisposable, DisposableStore, toDisposable } from './disposable';

export interface HostMessageEvent {
    readonly messageId: number;
    readonly chatId: string;
    readonly isUser: boolean;
    readonly rawText: string;
    readonly swipeId?: number;
    readonly element?: HTMLElement;
}

/**
 * 宿主环境通信与事件适配接口
 * 封装对 SillyTavern 上下文、事件总线与持久化存储的交互
 */
export interface IHostBridge {
    /** 等待宿主环境及全局上下文完全就绪 */
    whenReady(): Promise<void>;

    /** 监听 AI 角色消息渲染完成事件 (对应宿主 CHARACTER_MESSAGE_RENDERED) */
    onCharacterMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable;
    /** 监听用户消息渲染完成事件 (对应宿主 USER_MESSAGE_RENDERED) */
    onUserMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable;
    /** 监听楼层分支滑动切换事件 (Swipe) */
    onMessageSwiped(handler: (ev: { messageId: number; swipeId: number }) => void): IDisposable;
    /** 监听楼层编辑修改事件 (对应宿主 MESSAGE_EDITED / MESSAGE_UPDATED) */
    onMessageEdited(handler: (ev: { messageId: number }) => void): IDisposable;
    /** 监听楼层删除或撤回事件 */
    onMessageDeleted(handler: (ev: { messageId: number }) => void): IDisposable;
    /** 监听当前聊天文件切换事件 */
    onChatChanged(handler: (chatId: string) => void): IDisposable;

    /** 获取当前选中角色的元数据 */
    getCurrentCharacter(): { name: string; avatar?: string; description?: string } | null;
    /** 获取当前会话 ID */
    getCurrentChatId(): string | null;
    /** 获取指定范围的历史消息 */
    getChatHistory(limit?: number): HostMessageEvent[];
    /** 获取指定楼层的 DOM 容器引用 */
    getMessageElement(messageId: number): HTMLElement | null;
    /** 获取插件主面板挂载的根容器 */
    getMainContainer(): HTMLElement | null;
    /** 获取 SillyTavern 原生扩展设置抽屉挂载容器 (#extensions_settings) */
    getExtensionDrawerContainer(): HTMLElement | null;
    /** 渲染扩展 HTML 模板 (基于 SillyTavern context.renderExtensionTemplateAsync) */
    renderTemplate(templateName: string, data?: Record<string, unknown>): Promise<string>;

    /** 读取指定楼层的原始聊天消息对象 */
    getChatMessage(messageId: number): Record<string, any> | null;
    /** 向指定楼层的 extra 字段写入数据并持久化保存 */
    writeChatMessageExtra(messageId: number, key: string, value: unknown): void;
    /** 增量补丁更新指定楼层的 extra 字段并持久化保存 */
    patchChatMessageExtra<T = unknown>(messageId: number, key: string, updater: (prev: T | undefined) => T): void;
    /** 获取当前聊天中所有被引用的图像 UUID 集合 */
    getReferencedImageIds(): Set<string>;


    /** 持久化当前会话级元数据 (chatMetadata) */
    saveChatMetadata(): void;
    /** 防抖持久化全局设置 (extensionSettings) */
    saveExtensionSettingsDebounced(): void;

    /** 读取扩展设置 */
    getExtensionSettings<T = Record<string, unknown>>(moduleName: string): T | null;
    /** 直接保存扩展设置 */
    saveExtensionSettings(moduleName: string, settings: Record<string, unknown>): void;
    /** 获取附带 CSRF Token 和认证凭据的宿主 API 请求头 */
    getRequestHeaders(): Record<string, string>;
}

export class SillyTavernHostBridge implements IHostBridge, IDisposable {
    private _isReady = false;
    private _readyPromise: Promise<void> | null = null;
    private _stContext: any = null;
    private readonly _memorySettings = new Map<string, any>();
    private readonly _disposables = new DisposableStore();

    constructor() {
        this.initHostContext();
    }

    private initHostContext(): void {
        try {
            if (typeof window !== 'undefined' && (window as any).SillyTavern?.getContext) {
                this._stContext = (window as any).SillyTavern.getContext();
            }
        } catch {
            this._stContext = null;
        }
    }

    /**
     * 获取 SillyTavern 宿主全局上下文
     *
     * 设计意图：
     * - SillyTavern.getContext() 调用轻量且稳定，每次实时获取可避免 chatMetadata 在 CHAT_CHANGED 等事件后被替换导致的过期引用问题；
     * - 当宿主全局对象未就绪时降级使用初始化阶段捕获的实例引用。
     */
    private getST(): any {
        if (typeof window !== 'undefined' && (window as any).SillyTavern?.getContext) {
            return (window as any).SillyTavern.getContext();
        }
        return this._stContext;
    }

    public async whenReady(): Promise<void> {
        if (this._isReady) return;
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = new Promise<void>((resolve) => {
            const ctx = this.getST();
            if (ctx?.eventSource && ctx?.event_types) {
                this._isReady = true;
                resolve();
                return;
            }

            const onReady = () => {
                this._isReady = true;
                resolve();
            };

            if (ctx?.eventSource && ctx?.event_types?.APP_READY) {
                ctx.eventSource.once(ctx.event_types.APP_READY, onReady);
            }

            // 极早加载兜底：宿主上下文尚未挂载时降级为轮询，最长等待 3 秒
            const timer = setInterval(() => {
                const currentCtx = this.getST();
                if (currentCtx?.eventSource && currentCtx?.event_types) {
                    clearInterval(timer);
                    onReady();
                }
            }, 100);

            setTimeout(() => {
                clearInterval(timer);
                this._isReady = true;
                resolve();
            }, 3000);
        });

        return this._readyPromise;
    }

    public onCharacterMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable {
        const ctx = this.getST();
        if (!ctx || !ctx.eventSource || !ctx.event_types?.CHARACTER_MESSAGE_RENDERED) {
            return toDisposable(() => {});
        }

        const listener = (data: any) => {
            const msgId = typeof data === 'number' ? data : (data?.messageId ?? data?.id ?? 0);
            const chat = ctx.chat || [];
            const msgObj = chat[msgId] || (typeof data === 'object' ? data : null);
            handler({
                messageId: msgId,
                chatId: this.getCurrentChatId() || '',
                isUser: false,
                rawText: msgObj?.mes || msgObj?.text || '',
                swipeId: msgObj?.swipe_id,
                element: this.getMessageElement(msgId) || undefined
            });
        };

        ctx.eventSource.on(ctx.event_types.CHARACTER_MESSAGE_RENDERED, listener);
        const d = toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.CHARACTER_MESSAGE_RENDERED, listener);
        });
        this._disposables.add(d);
        return d;
    }

    public onUserMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable {
        const ctx = this.getST();
        if (!ctx || !ctx.eventSource || !ctx.event_types?.USER_MESSAGE_RENDERED) {
            return toDisposable(() => {});
        }

        const listener = (data: any) => {
            const msgId = typeof data === 'number' ? data : (data?.messageId ?? data?.id ?? 0);
            const chat = ctx.chat || [];
            const msgObj = chat[msgId] || (typeof data === 'object' ? data : null);
            handler({
                messageId: msgId,
                chatId: this.getCurrentChatId() || '',
                isUser: true,
                rawText: msgObj?.mes || msgObj?.text || '',
                swipeId: msgObj?.swipe_id,
                element: this.getMessageElement(msgId) || undefined
            });
        };

        ctx.eventSource.on(ctx.event_types.USER_MESSAGE_RENDERED, listener);
        const d = toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.USER_MESSAGE_RENDERED, listener);
        });
        this._disposables.add(d);
        return d;
    }

    public onMessageSwiped(handler: (ev: { messageId: number; swipeId: number }) => void): IDisposable {
        const ctx = this.getST();
        if (!ctx || !ctx.eventSource || !ctx.event_types?.MESSAGE_SWIPED) {
            return toDisposable(() => {});
        }

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? 0);
            const swipeId = data?.swipeId ?? (ctx.chat?.[messageId]?.swipe_id ?? 0);
            handler({ messageId, swipeId });
        };

        ctx.eventSource.on(ctx.event_types.MESSAGE_SWIPED, listener);
        const d = toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.MESSAGE_SWIPED, listener);
        });
        this._disposables.add(d);
        return d;
    }

    public onMessageEdited(handler: (ev: { messageId: number }) => void): IDisposable {
        const ctx = this.getST();
        const eventType = ctx?.event_types?.MESSAGE_EDITED || ctx?.event_types?.MESSAGE_UPDATED;
        if (!ctx || !ctx.eventSource || !eventType) {
            return toDisposable(() => {});
        }

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? data?.id ?? 0);
            handler({ messageId });
        };

        ctx.eventSource.on(eventType, listener);
        const d = toDisposable(() => {
            ctx.eventSource.removeListener?.(eventType, listener);
        });
        this._disposables.add(d);
        return d;
    }

    public onMessageDeleted(handler: (ev: { messageId: number }) => void): IDisposable {
        const ctx = this.getST();
        if (!ctx || !ctx.eventSource || !ctx.event_types?.MESSAGE_DELETED) {
            return toDisposable(() => {});
        }

        const listener = (data: any) => {
            const messageId = typeof data === 'number' ? data : (data?.messageId ?? 0);
            handler({ messageId });
        };

        ctx.eventSource.on(ctx.event_types.MESSAGE_DELETED, listener);
        const d = toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.MESSAGE_DELETED, listener);
        });
        this._disposables.add(d);
        return d;
    }

    public onChatChanged(handler: (chatId: string) => void): IDisposable {
        const ctx = this.getST();
        if (!ctx || !ctx.eventSource || !ctx.event_types?.CHAT_CHANGED) {
            return toDisposable(() => {});
        }

        const listener = (data: any) => {
            const chatId = typeof data === 'string' ? data : (data?.id || this.getCurrentChatId() || '');
            handler(chatId);
        };

        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, listener);
        const d = toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.CHAT_CHANGED, listener);
        });
        this._disposables.add(d);
        return d;
    }

    public getCurrentCharacter(): { name: string; avatar?: string; description?: string } | null {
        const ctx = this.getST();
        if (!ctx) return null;
        const charId = ctx.characterId;
        if (charId === undefined || charId === null) {
            return null;
        }
        const charObj = ctx.characters?.[charId];
        if (!charObj) return null;
        return {
            name: charObj.name || '',
            avatar: charObj.avatar || '',
            description: charObj.description || ''
        };
    }

    public getCurrentChatId(): string | null {
        const ctx = this.getST();
        if (!ctx) return null;
        return ctx.chatId || ctx.getCurrentChatId?.() || null;
    }

    public getChatHistory(limit = 50): HostMessageEvent[] {
        const ctx = this.getST();
        if (!ctx || !Array.isArray(ctx.chat)) return [];
        const currentChatId = this.getCurrentChatId() || '';
        const list = ctx.chat.slice(-limit);

        return list.map((msg: any, index: number) => {
            const actualIndex = ctx.chat.length - list.length + index;
            return {
                messageId: actualIndex,
                chatId: currentChatId,
                isUser: Boolean(msg.is_user),
                rawText: msg.mes || msg.text || '',
                swipeId: msg.swipe_id,
                element: this.getMessageElement(actualIndex) || undefined
            };
        });
    }

    /**
     * 获取指定楼层的 DOM 根节点
     *
     * 优先采用 SillyTavern 官方标准的 `.mes[mesid="..."]` 类选择器，
     * 同时降级兼容 `div[mesid="..."]`。
     */
    public getMessageElement(messageId: number): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return (document.querySelector(`.mes[mesid="${messageId}"]`) ||
            document.querySelector(`div[mesid="${messageId}"]`)) as HTMLElement | null;
    }

    public getMainContainer(): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return (document.getElementById('sheld') || document.body) as HTMLElement | null;
    }

    public getExtensionDrawerContainer(): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return document.getElementById('extensions_settings');
    }

    public async renderTemplate(templateName: string, data?: Record<string, unknown>): Promise<string> {
        const ctx = this.getST();
        if (ctx && typeof ctx.renderExtensionTemplateAsync === 'function') {
            try {
                return await ctx.renderExtensionTemplateAsync('third-party/ST-DrawAssistant', templateName, data);
            } catch {
                return await ctx.renderExtensionTemplateAsync('ST-DrawAssistant', templateName, data);
            }
        }
        return '';
    }

    public getChatMessage(messageId: number): Record<string, any> | null {
        const ctx = this.getST();
        if (!ctx || !Array.isArray(ctx.chat)) return null;
        return ctx.chat[messageId] ?? null;
    }

    public writeChatMessageExtra(messageId: number, key: string, value: unknown): void {
        const ctx = this.getST();
        if (!ctx || !Array.isArray(ctx.chat)) return;
        const msg = ctx.chat[messageId];
        if (!msg) return;

        msg.extra = { ...(msg.extra ?? {}), [key]: value };

        const saveFn = ctx.saveChatConditional || ctx.saveChatDebounced || ctx.saveChat;
        if (typeof saveFn === 'function') {
            try {
                saveFn.call(ctx);
            } catch {
                // saveFn.call 失败时静默处理，避免因宿主内部异常中断 extra 写入流程
            }
        }
    }

    public patchChatMessageExtra<T = unknown>(messageId: number, key: string, updater: (prev: T | undefined) => T): void {
        const ctx = this.getST();
        if (!ctx || !Array.isArray(ctx.chat)) return;
        const msg = ctx.chat[messageId];
        if (!msg) return;

        const currentExtra = msg.extra ?? {};
        const currentVal = currentExtra[key] as T | undefined;
        const updatedVal = updater(currentVal);

        msg.extra = { ...currentExtra, [key]: updatedVal };

        const saveFn = ctx.saveChatConditional || ctx.saveChatDebounced || ctx.saveChat;
        if (typeof saveFn === 'function') {
            try {
                saveFn.call(ctx);
            } catch {
                // saveFn.call 失败时静默处理，避免因宿主内部异常中断 extra 写入流程
            }
        }
    }


    public getReferencedImageIds(): Set<string> {
        const ids = new Set<string>();
        const ctx = this.getST();
        const chat = ctx?.chat;
        if (Array.isArray(chat)) {
            for (const msg of chat) {
                const extra = msg?.extra;
                if (!extra || typeof extra !== 'object') continue;
                const daImages = extra['da_images'];
                if (!daImages || typeof daImages !== 'object') continue;
                for (const item of Object.values(daImages)) {
                    if (item && typeof item === 'object') {
                        const directUuid = (item as any).uuid || (item as any).id;
                        if (directUuid) ids.add(directUuid);
                        for (const sub of Object.values(item as Record<string, any>)) {
                            if (sub && typeof sub === 'object') {
                                const uid = (sub as any).uuid || (sub as any).id;
                                if (uid) ids.add(uid);
                            }
                        }
                    }
                }
            }
        }
        return ids;
    }

    public saveChatMetadata(): void {
        const ctx = this.getST();
        if (typeof ctx?.saveMetadata === 'function') {
            ctx.saveMetadata();
        } else if (typeof ctx?.saveChatConditional === 'function') {
            ctx.saveChatConditional();
        } else if (typeof ctx?.saveChat === 'function') {
            ctx.saveChat();
        }
    }

    public saveExtensionSettingsDebounced(): void {
        const ctx = this.getST();
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
    }

    public saveExtensionSettings(moduleName: string, settings: Record<string, unknown>): void {
        this._memorySettings.set(moduleName, settings);
        const ctx = this.getST();
        if (!ctx) return;
        if (!ctx.extensionSettings) {
            ctx.extensionSettings = {};
        }
        ctx.extensionSettings[moduleName] = settings;
        this.saveExtensionSettingsDebounced();
    }

    public getExtensionSettings<T = Record<string, unknown>>(moduleName: string): T | null {
        const ctx = this.getST();
        if (ctx?.extensionSettings) {
            if (ctx.extensionSettings[moduleName] !== undefined) {
                return ctx.extensionSettings[moduleName] as T;
            }
            // 兼容大小写与下划线/中划线别名
            const aliases = [
                'ST-DrawAssistant',
                'st-drawassistant',
                'st_drawassistant',
                'st_drawassistant_settings'
            ];
            for (const alias of aliases) {
                if (ctx.extensionSettings[alias] !== undefined) {
                    return ctx.extensionSettings[alias] as T;
                }
            }
        }
        return (this._memorySettings.get(moduleName) as T) || null;
    }

    public getRequestHeaders(): Record<string, string> {
        const ctx = this.getST();
        if (typeof ctx?.getRequestHeaders === 'function') {
            try {
                return ctx.getRequestHeaders();
            } catch {
                // 忽略异常并降级
            }
        }
        if (typeof (window as any).getRequestHeaders === 'function') {
            try {
                return (window as any).getRequestHeaders();
            } catch {
                // 忽略异常并降级
            }
        }
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
        const csrfToken = (window as any).csrfToken ||
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            (document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || '');
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        return headers;
    }

    public dispose(): void {
        this._isReady = false;
        this._readyPromise = null;
        this._stContext = null;
        this._memorySettings.clear();
        this._disposables.dispose();
    }
}
