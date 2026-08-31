/**
 * SillyTavern 宿主事件与事件源类型声明
 * 来源规范：st-extension skill 与 public/scripts/events.js
 */

export interface SillyTavernEventTypes {
    /** 宿主应用完成初始化，UI 注入的最佳时机 */
    readonly APP_INITIALIZED: 'app_initialized';
    /** 宿主完全就绪 */
    readonly APP_READY: 'app_ready';
    /** 切换聊天会话，必须在此处中止在途请求并清理临时资源 */
    readonly CHAT_CHANGED: 'chat_id_changed';
    /** 聊天会话加载完毕 */
    readonly CHAT_LOADED: 'chat_loaded';
    /** 消息已更新（如修改 extra 或媒体附件后通知宿主重绘） */
    readonly MESSAGE_UPDATED: 'message_updated';
    /** 用户消息渲染完成，可用于楼层按钮按需挂载 */
    readonly USER_MESSAGE_RENDERED: 'user_message_rendered';
    /** 角色消息渲染完成，可用于楼层按钮按需挂载 */
    readonly CHARACTER_MESSAGE_RENDERED: 'character_message_rendered';
    /** 消息已接收 */
    readonly MESSAGE_RECEIVED: 'message_received';
    /** 消息已发送 */
    readonly MESSAGE_SENT: 'message_sent';
    /** 扩展设置项更新 */
    readonly SETTINGS_UPDATED: 'settings_updated';
    /** 生图提示词预处理事件（允许其他扩展协作调整） */
    readonly SD_PROMPT_PROCESSING: 'sd_prompt_processing';
}

export interface SillyTavernEventSource {
    /** 注册事件监听器 */
    on(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;
    /** 移除事件监听器 */
    off(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;
    /** 触发自定义事件或向宿主广播事件 */
    emit(event: string, ...args: unknown[]): void;
}
