/**
 * @module core/foundation/host-bridge
 * @description SillyTavern 宿主环境安全沙箱桥接接口与实现 (IHostBridge 与 whenReady 握手)
 */

import { IDisposable, toDisposable } from './disposable';

export interface HostMessageEvent {
    readonly messageId: number;
    readonly chatId: string;
    readonly isUser: boolean;
    readonly rawText: string;
    readonly swipeId?: number;
    readonly element?: HTMLElement;
}

/**
 * 宿主环境沙箱适配接口
 * 彻底阻断插件业务代码对全局宿主变量与原生 DOM 的直接访问
 */
export interface IHostBridge {
    /** 阻塞等待宿主环境及全局上下文完全就绪 */
    whenReady(): Promise<void>;

    /** 监听 AI 角色消息渲染完成事件 (对应宿主 CHARACTER_MESSAGE_RENDERED) */
    onCharacterMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable;
    /** 监听用户消息渲染完成事件 (对应宿主 USER_MESSAGE_RENDERED) */
    onUserMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable;
    /** 监听楼层分支滑动切换事件 (Swipe) */
    onMessageSwiped(handler: (ev: { messageId: number; swipeId: number }) => void): IDisposable;
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

    /** 读取指定楼层的原始聊天消息对象 */
    getChatMessage(messageId: number): Record<string, any> | null;
    /** 向指定楼层的 extra 字段写入数据并安全持久化 */
    writeChatMessageExtra(messageId: number, key: string, value: unknown): void;

    /** 持久化当前会话级元数据 (chatMetadata) */
    saveChatMetadata(): void;
    /** 防抖持久化全局设置 (extensionSettings) */
    saveExtensionSettingsDebounced(): void;

    /** 读取扩展设置 */
    getExtensionSettings<T = Record<string, unknown>>(moduleName: string): T | null;
    /** 直接保存扩展设置 */
    saveExtensionSettings(moduleName: string, settings: Record<string, unknown>): void;
}

export class SillyTavernHostBridge implements IHostBridge, IDisposable {
    private _isReady = false;
    private _readyPromise: Promise<void> | null = null;
    private _stContext: any = null;
    private readonly _memorySettings = new Map<string, any>();

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

    private getST(): any {
        if (!this._stContext && typeof window !== 'undefined' && (window as any).SillyTavern?.getContext) {
            this._stContext = (window as any).SillyTavern.getContext();
        }
        return this._stContext;
    }

    public async whenReady(): Promise<void> {
        if (this._isReady) return;
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = new Promise<void>((resolve) => {
            const checkReady = () => {
                const ctx = this.getST();
                if (ctx && ctx.eventSource && ctx.event_types) {
                    this._isReady = true;
                    resolve();
                    return true;
                }
                return false;
            };

            if (checkReady()) return;

            const timer = setInterval(() => {
                if (checkReady()) clearInterval(timer);
            }, 50);

            setTimeout(() => {
                clearInterval(timer);
                this._isReady = true;
                resolve();
            }, 5000);
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
        return toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.CHARACTER_MESSAGE_RENDERED, listener);
        });
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
        return toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.USER_MESSAGE_RENDERED, listener);
        });
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
        return toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.MESSAGE_SWIPED, listener);
        });
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
        return toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.MESSAGE_DELETED, listener);
        });
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
        return toDisposable(() => {
            ctx.eventSource.removeListener?.(ctx.event_types.CHAT_CHANGED, listener);
        });
    }

    public getCurrentCharacter(): { name: string; avatar?: string; description?: string } | null {
        const ctx = this.getST();
        if (!ctx) return null;
        const charId = ctx.characterId;
        if (charId === undefined || charId === null) {
            // 尝试从当前聊天对象或群组对象中探测角色信息
            if (ctx.characters && Array.isArray(ctx.characters) && ctx.characters.length > 0) {
                const first = ctx.characters[0];
                return {
                    name: first.name || '',
                    avatar: first.avatar || '',
                    description: first.description || ''
                };
            }
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

    public getMessageElement(messageId: number): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return document.querySelector(`div[mesid="${messageId}"]`) as HTMLElement | null;
    }

    public getMainContainer(): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        return (document.getElementById('sheld') || document.body) as HTMLElement | null;
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

        const saveFn = ctx.saveChatConditional ?? ctx.saveChat;
        if (typeof saveFn === 'function') {
            saveFn.call(ctx);
        }
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
        if (ctx?.extensionSettings?.[moduleName] !== undefined) {
            return ctx.extensionSettings[moduleName] as T;
        }
        return (this._memorySettings.get(moduleName) as T) || null;
    }

    public dispose(): void {
        this._isReady = false;
        this._readyPromise = null;
        this._stContext = null;
        this._memorySettings.clear();
    }
}
