/**
 * @module core/foundation/event-bus
 * @description 强类型跨模块事件总线 (TypedEventBus 与 CoreEventMap)
 */
import { IDisposable } from './disposable';
/**
 * 跨模块核心事件定义列表
 */
export interface CoreEventMap {
    /** 宿主就绪完成 */
    'host:ready': void;
    /** 设置项发生变动 (携带变化路径与新旧值) */
    'settings:changed': {
        path: string;
        value: unknown;
        oldValue: unknown;
    };
    /** 主题变动 */
    'theme:changed': {
        themeId: string;
    };
    /** 任务状态流转 */
    'task:state_changed': {
        taskId: string;
        status: string;
        progress?: number;
        error?: string;
    };
    /** 任务完成并获得图片 */
    'task:completed': {
        taskId: string;
        imageBlobs: Blob[];
        metadata?: Record<string, unknown>;
    };
    /** 任务失败 */
    'task:failed': {
        taskId: string;
        error: string;
    };
    /** 聊天会话切换 */
    'chat:changed': {
        chatId: string;
    };
    /** 楼层消息已渲染 */
    'message:rendered': {
        messageId: number;
        chatId: string;
        isUser: boolean;
    };
    /** 模态框打开/关闭事件 */
    'modal:opened': {
        modalId: string;
    };
    'modal:closed': {
        modalId: string;
    };
    /** 诊断日志记录 */
    'diagnostics:log': {
        level: string;
        namespace: string;
        message: string;
        timestamp: number;
    };
}
export type EventHandler<T = any> = (payload: T) => void | Promise<void>;
/**
 * 强类型事件总线通用接口
 */
export interface ITypedEventBus<Events = CoreEventMap> {
    /**
     * 订阅指定事件
     * @param eventName 事件名称
     * @param handler 事件处理回调函数
     * @returns 用于取消订阅的 IDisposable 句柄
     */
    on<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    /**
     * 单次订阅指定事件（触发一次后自动解除）
     * @param eventName 事件名称
     * @param handler 事件处理回调函数
     * @returns 用于取消订阅的 IDisposable 句柄
     */
    once<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    /**
     * 触发指定事件并向所有监听器广播载荷
     * @param eventName 事件名称
     * @param payload 事件携带的强类型载荷数据
     */
    emit<K extends keyof Events>(eventName: K, payload: Events[K]): void;
    /**
     * 取消指定监听回调函数的订阅
     * @param eventName 事件名称
     * @param handler 待解绑的处理回调函数
     */
    off<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): void;
    /**
     * 清空所有事件的所有监听器
     */
    clear(): void;
}
/**
 * 强类型事件总线实现类
 */
export declare class TypedEventBus<Events = CoreEventMap> implements ITypedEventBus<Events>, IDisposable {
    private readonly _listeners;
    private _isDisposed;
    on<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    once<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    emit<K extends keyof Events>(eventName: K, payload: Events[K]): void;
    off<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): void;
    clear(): void;
    dispose(): void;
}
//# sourceMappingURL=event-bus.d.ts.map