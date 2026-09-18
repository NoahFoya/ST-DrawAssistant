/**
 * SillyTavern 宿主事件与事件源类型定义。
 *
 * @remarks
 * 声明本生图插件依赖的宿主核心生命周期、消息渲染与分支切换事件常量与参数签名。
 * 剔除与生图领域无关的预留事件，保留动态索引签名以安全兼容宿主其他事件。
 * 宿主内部 emit 属于异步触发，类型中返回 `Promise<void>` 以便调用方按需 await 等待。
 */

/** 候选分支删除事件参数 */
export interface MessageSwipeDeletedEventData {
    messageId: number;
    swipeId: number;
    newSwipeId: number;
}

/** 会话载入完成事件参数 */
export interface ChatLoadedEventData {
    detail?: {
        id?: number;
        character?: unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** 宿主官方核心事件名常量映射接口 */
export interface SillyTavernEventTypes {
    /** 应用完成初始化，UI 注入与命令注册的最佳入口 */
    readonly APP_INITIALIZED: 'app_initialized';
    /** 宿主全局就绪，核心处理函数串行 await 执行完毕 */
    readonly APP_READY: 'app_ready';
    /** 会话初次载入或重载完成，用于触发存量历史楼层的扫描装配 */
    readonly CHAT_LOADED: 'chatLoaded';
    /** 切换聊天会话，用于中止在途请求并释放当前会话资源 */
    readonly CHAT_CHANGED: 'chat_id_changed';
    /** 向上滚动加载更早历史消息，触发增量旧楼层的插槽扫描 */
    readonly MORE_MESSAGES_LOADED: 'more_messages_loaded';
    /** 角色消息渲染进 DOM，用于增量原位装配绘图插槽 */
    readonly CHARACTER_MESSAGE_RENDERED: 'character_message_rendered';
    /** 用户消息渲染进 DOM，用于增量原位装配绘图插槽 */
    readonly USER_MESSAGE_RENDERED: 'user_message_rendered';
    /** 消息已接收 */
    readonly MESSAGE_RECEIVED: 'message_received';
    /** 消息已发送 */
    readonly MESSAGE_SENT: 'message_sent';
    /** 左右滑动切换消息候选分支 */
    readonly MESSAGE_SWIPED: 'message_swiped';
    /** 删除某一候选分支，用于清理对应分支的图片展示记录 */
    readonly MESSAGE_SWIPE_DELETED: 'message_swipe_deleted';
    /** 用户开始编辑消息正文 (DOM 冲刷前) */
    readonly MESSAGE_EDITED: 'message_edited';
    /** 消息已更新 (正文编辑完成并重绘，触发重新解析挂载) */
    readonly MESSAGE_UPDATED: 'message_updated';
    /** 消息已被删除 (参数传递删除后的新数组长度) */
    readonly MESSAGE_DELETED: 'message_deleted';
    /** AI 文本生成开始 */
    readonly GENERATION_STARTED: 'generation_started';
    /** AI 文本生成被手动中止 */
    readonly GENERATION_STOPPED: 'generation_stopped';
    /** AI 文本生成定稿结束，传递当前数组长度，用于自动生图精准定位 */
    readonly GENERATION_ENDED: 'generation_ended';
    /** 扩展设置项更新 */
    readonly SETTINGS_UPDATED: 'settings_updated';
    /** 扩展配置数据加载完成 */
    readonly EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded';

    /** 允许动态未知事件安全访问 */
    readonly [key: string]: string | undefined;
}

/** 宿主核心事件与参数签名映射表 */
export interface SillyTavernEventPayloadMap {
    'app_initialized': [];
    'app_ready': [];
    'chatLoaded': [detail?: ChatLoadedEventData];
    'chat_id_changed': [chatId: string];
    'more_messages_loaded': [];
    'character_message_rendered': [messageId: number, type?: string];
    'user_message_rendered': [messageId: number];
    'message_received': [messageId: number, type?: string];
    'message_sent': [messageId: number];
    'message_swiped': [messageId: number];
    'message_swipe_deleted': [data: MessageSwipeDeletedEventData];
    'message_edited': [messageId: number];
    'message_updated': [messageId: number];
    'message_deleted': [newChatLength: number];
    'generation_started': [];
    'generation_stopped': [];
    'generation_ended': [chatLength: number];
    'settings_updated': [];
    'extension_settings_loaded': [];
}

/** 宿主事件总线接口 */
export interface SillyTavernEventSource {
    /** 强类型事件监听注册 */
    on<K extends keyof SillyTavernEventPayloadMap>(
        event: K,
        handler: (...args: SillyTavernEventPayloadMap[K]) => void | Promise<void>
    ): void;
    /** 通用事件监听注册 */
    on(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;

    /** 强类型事件解绑 */
    off<K extends keyof SillyTavernEventPayloadMap>(
        event: K,
        handler: (...args: SillyTavernEventPayloadMap[K]) => void | Promise<void>
    ): void;
    /** 通用事件解绑 */
    off(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;

    /** 强类型事件派发 */
    emit<K extends keyof SillyTavernEventPayloadMap>(
        event: K,
        ...args: SillyTavernEventPayloadMap[K]
    ): Promise<void>;
    /** 通用事件派发 */
    emit(event: string, ...args: unknown[]): Promise<void>;
}
