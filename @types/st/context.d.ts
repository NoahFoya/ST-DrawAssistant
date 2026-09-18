/**
 * SillyTavern 宿主上下文类型定义。
 *
 * @remarks
 * 声明 `SillyTavern.getContext()` 返回的只读宿主上下文成员。
 * 宿主上下文对象在运行时受 `Object.freeze()` 保护，所有属性均为只读引用。
 * 扩展运行时状态由扩展自身模块维护，避免直接向宿主全局上下文注入非标准属性。
 * 本插件作为非侵入式绘图扩展，仅访问必要的消息、事件总线、配置项与宏替换工具，
 * 不越权操控消息增删或分支切换。
 */

import type { ChatMessage, ChatMetadata } from './chat';
import type { SillyTavernEventSource, SillyTavernEventTypes } from './events';

export interface SillyTavernContext {
    // 1. 事件系统与核心状态 (只读引用)

    /** 宿主全局事件总线 */
    readonly eventSource: SillyTavernEventSource;
    /** 宿主官方事件名常量字典 */
    readonly eventTypes: SillyTavernEventTypes;
    /** 当前会话消息列表 (内存数组引用) */
    readonly chat: ChatMessage[];
    /** 当前加载的角色列表 */
    readonly characters: Record<string, unknown>[];
    /** 当前选中的角色索引或 ID */
    readonly characterId?: number | string;
    /** 当前会话的唯一标识 */
    readonly chatId?: string;
    /** 当前会话元数据对象 */
    readonly chatMetadata?: ChatMetadata;
    /** 用户名 (User Name) */
    readonly name1?: string;
    /** 角色名 (Character Name) */
    readonly name2?: string;
    /** 扩展配置根字典，各扩展按唯一模块名注册独立子项 */
    readonly extensionSettings: Record<string, unknown>;
    /** 是否为移动端运行环境 */
    readonly isMobile?: boolean;

    // 2. 数据持久化与网络安全方法

    /**
     * 保存当前会话聊天记录到宿主存储。
     *
     * @remarks
     * 宿主内部映射为 `saveChatConditional`，高频更新时建议由扩展内部防抖后调用。
     */
    saveChat(): Promise<void>;

    /**
     * 防抖保存扩展配置字典。
     *
     * @remarks
     * 修改 `extensionSettings` 中的对应配置项后调用此方法保存。
     */
    saveSettingsDebounced(): void;

    /**
     * 获取附带 CSRF 校验凭证的请求头字典。
     *
     * @remarks
     * 调用宿主内部 `/api` 端点时需包含此请求头以通过安全校验。
     */
    getRequestHeaders(): Record<string, string>;

    /** 获取当前活动会话 ID */
    getCurrentChatId?(): string | undefined;

    // 3. UI 模板与正文渲染工具

    /**
     * 异步加载并渲染扩展 HTML 模板
     * @param extensionName 扩展目录名称
     * @param templateName 模板文件名称 (无需 .html 后缀)
     */
    renderExtensionTemplateAsync?(extensionName: string, templateName: string): Promise<string>;

    /**
     * 宿主官方消息正文格式化函数 (Markdown 转 HTML)
     * @param mes 原始文本内容
     * @param ch_name 角色名称
     * @param isSystem 是否为系统消息
     * @param isUser 是否为用户消息
     * @param messageId 消息在会话中的索引
     */
    messageFormatting?(
        mes: string,
        ch_name?: string,
        isSystem?: boolean,
        isUser?: boolean,
        messageId?: number,
        sanitizerOverrides?: Record<string, unknown>,
        sanitize?: boolean
    ): string;

    /** 宿主宏参数替换函数 */
    substituteParams?(text: string): string;
    substituteParamsExtended?(text: string): string;

    /** 发送系统提示消息 */
    sendSystemMessage?(type: string, message: string): void;

    /** 允许安全访问宿主其他动态上下文成员 */
    readonly [key: string]: unknown;
}
