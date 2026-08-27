/**
 * @module core/foundation/event-bus
 * @description 强类型事件总线与核心事件定义
 */
import { IDisposable } from './disposable';
/** 核心事件类型映射定义 */
export interface CoreEventMap {
    /** 宿主环境连接就绪 */
    'host:ready': void;
    /** 配置项变动 */
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
    /** 任务执行成功 */
    'task:completed': {
        taskId: string;
        imageBlobs: Blob[];
        metadata?: Record<string, unknown>;
    };
    /** 任务执行失败 */
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
    /** 模态框开关 */
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
/** 强类型事件总线接口 */
export interface ITypedEventBus<Events = CoreEventMap> {
    /** 订阅事件并返回销毁句柄 */
    on<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    /** 单次订阅事件 */
    once<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    /** 广播事件数据 */
    emit<K extends keyof Events>(eventName: K, payload: Events[K]): void;
    /** 注销指定事件监听器 */
    off<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): void;
    /** 清空所有监听器 */
    clear(): void;
}
/** 强类型事件总线实现 (支持异步异常隔离) */
export declare class TypedEventBus<Events = CoreEventMap> implements ITypedEventBus<Events>, IDisposable {
    private readonly _listeners;
    private _isDisposed;
    /**
     * 订阅指定事件，返回可用于取消订阅的销毁句柄
     * 总线已销毁时返回空操作句柄而非抛出错误
     */
    on<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    /** 单次订阅指定事件，回调触发一次后自动注销 */
    once<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable;
    /**
     * 向所有订阅者广播事件数据
     * 单个监听器的同步异常与异步异常均被隔离，不会中断其他监听器执行
     */
    emit<K extends keyof Events>(eventName: K, payload: Events[K]): void;
    /** 注销指定事件的单个监听器，若该监听器下已无其他订阅则同时清除事件条目 */
    off<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): void;
    /** 清除全部事件监听器，常用于重置场景 */
    clear(): void;
    /** 销毁事件总线，清除所有监听器并阻止后续事件广播 */
    dispose(): void;
}
//# sourceMappingURL=event-bus.d.ts.map