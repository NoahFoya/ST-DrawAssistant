/**
 * SillyTavern 宿主上下文的类型安全封装
 *
 * ⚠️ 调用时机：必须在 APP_READY 事件触发之后调用 getContext()。
 *    在模块顶层直接调用会在宿主初始化前执行，返回可能不完整的对象。
 *
 * 参考：.agents/Skills/sillytavern-extension-host/SKILL.md §2
 */
/** 聊天消息结构 */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    name?: string;
    is_user: boolean;
    is_system: boolean;
    extra?: Record<string, unknown>;
    date?: string;
    mes?: string;
    swipe_id?: number;
}
/** 宿主事件类型常量（部分列举，按需扩展） */
export interface EventTypes {
    APP_INITIALIZED: string;
    APP_READY: string;
    APP_SYSTEM_MENU_READY: string;
    MESSAGE_SENT: string;
    MESSAGE_RECEIVED: string;
    USER_MESSAGE_RENDERED: string;
    CHARACTER_MESSAGE_RENDERED: string;
    GENERATION_STARTED: string;
    GENERATION_ENDED: string;
    GENERATION_STOPPED: string;
    CHAT_CHANGED: string;
    CHAT_DELETED: string;
    GROUP_UPDATED: string;
    EXTENSIONS_LOADED: string;
    EXTENSION_SETTINGS_UPDATED: string;
    [key: string]: string;
}
/** 事件总线 */
export interface EventSource {
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
}
/** 斜杠命令注册参数 */
export interface SlashCommandConfig {
    name: string;
    description?: string;
    callback: (args: string, context: unknown) => Promise<string> | string;
    aliases?: string[];
    requiresArgs?: boolean;
    helpString?: string;
    hostOnly?: boolean;
}
/** 斜杠命令解析器 */
export interface SlashCommandParser {
    addCommand(config: SlashCommandConfig): void;
    removeCommand(name: string): void;
}
/** LLM 工具参数 Schema */
export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
    }>;
    required?: string[];
}
/** LLM 函数工具注册参数 */
export interface ToolConfig {
    name: string;
    displayName?: string;
    description: string;
    parameters: ToolParameterSchema;
    callback: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}
/** LLM 工具管理器 */
export interface ToolManager {
    registerTool(config: ToolConfig): void;
}
/** SillyTavern 宿主上下文完整接口 */
export interface SillyTavernContext {
    chat: ChatMessage[];
    characters: Record<string, unknown>;
    characterId: number;
    groupId?: string;
    chatMetadata: Record<string, unknown>;
    extension_settings: Record<string, unknown>;
    onlineStatus: 'online' | 'offline';
    eventSource: EventSource;
    event_types: EventTypes;
    saveSettingsDebounced(): void;
    saveMetadata(): void;
    saveChatConditional?(): void;
    getTokenCountAsync(text: string): Promise<number>;
    renderExtensionTemplateAsync(extensionName: string, templateId: string, data?: Record<string, unknown>): Promise<string>;
    SlashCommandParser: SlashCommandParser;
    ToolManager: ToolManager;
}
/** SillyTavern 全局命名空间声明 */
declare global {
    interface Window {
        SillyTavern: {
            getContext(): SillyTavernContext;
        };
        saveChatConditional?: () => void;
    }
}
/**
 * 获取 SillyTavern 宿主上下文
 *
 * @returns 类型安全的宿主上下文对象
 *
 * @throws 如果在 APP_READY 之前调用，宿主可能尚未完全初始化
 *
 * @example
 * // ✅ 正确用法：在 APP_READY 事件回调中调用
 * eventSource.on(event_types.APP_READY, () => {
 *   const ctx = getContext();
 *   // 安全使用 ctx
 * });
 *
 * // ❌ 错误用法：模块顶层直接调用
 * const ctx = getContext(); // 宿主可能未初始化
 */
export declare function getContext(): SillyTavernContext;
/**
 * 便捷访问：获取事件总线与事件类型
 * 仅在 APP_READY 后调用
 */
export declare function getEventBus(): {
    eventSource: EventSource;
    event_types: EventTypes;
};
//# sourceMappingURL=context.d.ts.map