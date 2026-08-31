/**
 * SillyTavern 宿主上下文接口声明
 * 来源规范：st-extension skill 与 SillyTavern public/scripts/st-context.js
 */

import type { ChatMessage, ChatMetadata } from './chat';
import type { SillyTavernEventSource, SillyTavernEventTypes } from './events';

export interface SillyTavernContext {
    /** 宿主全局事件总线 */
    readonly eventSource: SillyTavernEventSource;
    /** 宿主官方事件名常量映射 */
    readonly eventTypes: SillyTavernEventTypes;
    /** 当前会话消息列表（内存引用） */
    readonly chat: ChatMessage[];
    /** 当前加载的角色列表 */
    readonly characters: Record<string, unknown>[];
    /** 当前选中的角色索引或 ID */
    readonly characterId?: number | string;
    /** 当前会话的唯一标识 */
    readonly chatId?: string;
    /** 当前会话的元数据对象 */
    readonly chatMetadata?: ChatMetadata;
    /** 用户名与角色名 */
    readonly name1?: string;
    readonly name2?: string;
    /** 扩展设置根对象，各扩展以唯一键名注册 */
    readonly extensionSettings: Record<string, unknown>;

    /** 保存当前聊天记录到后端（通常在修改消息后配合 MESSAGE_UPDATED 触发） */
    saveChat(): Promise<void>;
    /** 防抖保存扩展设置项 */
    saveSettingsDebounced(): void;
    /** 获取附带 CSRF 校验凭证的请求头，用于调用宿主 /api 路由 */
    getRequestHeaders(): Record<string, string>;

    /** 异步加载并安全渲染扩展 HTML 模板 */
    renderExtensionTemplateAsync?(extensionName: string, templateName: string): Promise<string>;
    /** 向消息追加媒体文件（如出图产物） */
    appendMediaToMessage?(message: ChatMessage, media: Record<string, unknown>): void;
    /** 宏替换函数 */
    substituteParams?(text: string): string;
    substituteParamsExtended?(text: string): string;
}
