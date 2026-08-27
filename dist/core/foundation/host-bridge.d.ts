/**
 * @module core/foundation/host-bridge
 * @description SillyTavern 宿主环境桥接适配器实现 (IHostBridge)
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
    onMessageSwiped(handler: (ev: {
        messageId: number;
        swipeId: number;
    }) => void): IDisposable;
    /** 监听楼层编辑修改事件 (对应宿主 MESSAGE_EDITED / MESSAGE_UPDATED) */
    onMessageEdited(handler: (ev: {
        messageId: number;
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
    /** 原子化补丁更新指定楼层的 extra 字段并安全持久化 */
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
}
export declare class SillyTavernHostBridge implements IHostBridge, IDisposable {
    private _isReady;
    private _readyPromise;
    private _stContext;
    private readonly _memorySettings;
    private readonly _disposables;
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
    onMessageEdited(handler: (ev: {
        messageId: number;
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
    patchChatMessageExtra<T = unknown>(messageId: number, key: string, updater: (prev: T | undefined) => T): void;
    getReferencedImageIds(): Set<string>;
    saveChatMetadata(): void;
    saveExtensionSettingsDebounced(): void;
    saveExtensionSettings(moduleName: string, settings: Record<string, unknown>): void;
    getExtensionSettings<T = Record<string, unknown>>(moduleName: string): T | null;
    dispose(): void;
}
//# sourceMappingURL=host-bridge.d.ts.map