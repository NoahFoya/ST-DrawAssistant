/**
 * @module core/foundation/host-bridge
 * @description SillyTavern 宿主环境安全沙箱桥接接口与实现 (IHostBridge 与 whenReady 握手)
 */
import { IDisposable } from './disposable';
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
    onMessageSwiped(handler: (ev: {
        messageId: number;
        swipeId: number;
    }) => void): IDisposable;
    /** 监听楼层删除或撤回事件 */
    onMessageDeleted(handler: (ev: {
        messageId: number;
    }) => void): IDisposable;
    /** 监听当前聊天文件切换事件 */
    onChatChanged(handler: (chatId: string) => void): IDisposable;
    /** 获取当前选中角色的元数据 */
    getCurrentCharacter(): {
        name: string;
        avatar?: string;
        description?: string;
    } | null;
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
export declare class SillyTavernHostBridge implements IHostBridge, IDisposable {
    private _isReady;
    private _readyPromise;
    private _stContext;
    private readonly _memorySettings;
    constructor();
    private initHostContext;
    private getST;
    whenReady(): Promise<void>;
    onCharacterMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable;
    onUserMessageRendered(handler: (ev: HostMessageEvent) => void): IDisposable;
    onMessageSwiped(handler: (ev: {
        messageId: number;
        swipeId: number;
    }) => void): IDisposable;
    onMessageDeleted(handler: (ev: {
        messageId: number;
    }) => void): IDisposable;
    onChatChanged(handler: (chatId: string) => void): IDisposable;
    getCurrentCharacter(): {
        name: string;
        avatar?: string;
        description?: string;
    } | null;
    getCurrentChatId(): string | null;
    getChatHistory(limit?: number): HostMessageEvent[];
    getMessageElement(messageId: number): HTMLElement | null;
    getMainContainer(): HTMLElement | null;
    getChatMessage(messageId: number): Record<string, any> | null;
    writeChatMessageExtra(messageId: number, key: string, value: unknown): void;
    saveChatMetadata(): void;
    saveExtensionSettingsDebounced(): void;
    saveExtensionSettings(moduleName: string, settings: Record<string, unknown>): void;
    getExtensionSettings<T = Record<string, unknown>>(moduleName: string): T | null;
    dispose(): void;
}
//# sourceMappingURL=host-bridge.d.ts.map