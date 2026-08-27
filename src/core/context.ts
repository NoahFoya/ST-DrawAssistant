/**
 * @module core/context
 * @description SillyTavern 宿主上下文封装模块
 *
 * 职责：
 * - 声明宿主环境接口类型定义 (ChatMessage, EventSource, EventTypes, SillyTavernContext)
 * - 提供访问宿主上下文环境的统一入口函数 getContext()
 *
 * 宿主环境约束：
 * - getContext() 必须在宿主 APP_READY 事件触发后调用。
 * - 在模块顶层直接调用会导致访问到未初始化的宿主对象。
 *
 * 规范参考：
 * - .agents/Skills/sillytavern-extension-host/SKILL.md §2 (宿主 API 契约)
 */

// ─── SillyTavern 宿主全局类型声明 ────────────────────────────────────────────

/** 聊天消息结构 */
export interface ChatMessage {
    /** 消息角色 */
    role: 'user' | 'assistant' | 'system';
    /** 消息文本内容 */
    content: string;
    /** 发送者显示名称 */
    name?: string;
    /** 是否为用户发出的消息 */
    is_user: boolean;
    /** 是否为系统消息 */
    is_system: boolean;
    /** 附加元数据扩展字典 */
    extra?: Record<string, unknown>;
    /** 消息时间戳串 */
    date?: string;
    /** HTML 格式渲染后的消息体 */
    mes?: string;
    /** 消息 Swipe 变体序号 */
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

/** 事件总线订阅与触发接口 */
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
    // 数据属性
    chat: ChatMessage[];
    characters: Record<string, unknown>;
    characterId: number;
    groupId?: string;
    chatMetadata: Record<string, unknown>;
    /** 官方扩展设置持久化对象树 (按扩展模块名分区) */
    extensionSettings: Record<string, unknown>;
    onlineStatus: 'online' | 'offline';

    // 事件系统
    eventSource: EventSource;
    event_types: EventTypes;

    // 核心方法
    saveSettingsDebounced(): void;
    saveMetadata(): void;
    saveChatConditional?(): void;
    getTokenCountAsync(text: string): Promise<number>;
    renderExtensionTemplateAsync(
        extensionName: string,
        templateId: string,
        data?: Record<string, unknown>
    ): Promise<string>;

    // 扩展能力
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

// ─── 上下文访问函数 ────────────────────────────────────────────────────────────

/**
 * 安全获取 SillyTavern 宿主上下文
 *
 * @returns {SillyTavernContext} 类型安全的宿主上下文对象
 * @throws {Error} 如果在 window.SillyTavern 未就绪之前调用抛出环境异常
 *
 * @example
 * // ✅ 正确用法：在 APP_READY 事件回调中调用
 * eventSource.on(event_types.APP_READY, () => {
 *   const ctx = getContext();
 *   // 安全使用 ctx
 * });
 */
export function getContext(): SillyTavernContext {
    if (typeof window.SillyTavern?.getContext !== 'function') {
        throw new Error('[ST-DrawAssistant] 无法获取 SillyTavern 宿主上下文：window.SillyTavern.getContext() 未就绪');
    }
    const ctx = window.SillyTavern.getContext() as SillyTavernContext;
    if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') {
        throw new Error('[ST-DrawAssistant] 宿主上下文契约破坏：getContext().extensionSettings 为空或无效');
    }
    return ctx;
}

/**
 * 便捷访问：获取事件总线与事件类型
 *
 * @returns {{ eventSource: EventSource; event_types: EventTypes }} 事件总线与事件常量
 * @throws {Error} 宿主未就绪时抛出异常
 */
export function getEventBus(): { eventSource: EventSource; event_types: EventTypes } {
    const ctx = getContext();
    return { eventSource: ctx.eventSource, event_types: ctx.event_types };
}

