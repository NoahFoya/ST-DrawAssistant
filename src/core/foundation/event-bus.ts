/**
 * @module core/foundation/event-bus
 * @description 强类型跨模块事件总线 (TypedEventBus 与 CoreEventMap)
 */

import { IDisposable, toDisposable } from './disposable';

/**
 * 跨模块核心事件定义列表
 */
export interface CoreEventMap {
    /** 宿主就绪完成 */
    'host:ready': void;
    /** 设置项发生变动 (携带变化路径与新旧值) */
    'settings:changed': { path: string; value: unknown; oldValue: unknown };
    /** 主题变动 */
    'theme:changed': { themeId: string };
    /** 任务状态流转 */
    'task:state_changed': { taskId: string; status: string; progress?: number; error?: string };
    /** 任务完成并获得图片 */
    'task:completed': { taskId: string; imageBlobs: Blob[]; metadata?: Record<string, unknown> };
    /** 任务失败 */
    'task:failed': { taskId: string; error: string };
    /** 聊天会话切换 */
    'chat:changed': { chatId: string };
    /** 楼层消息已渲染 */
    'message:rendered': { messageId: number; chatId: string; isUser: boolean };
    /** 模态框打开/关闭事件 */
    'modal:opened': { modalId: string };
    'modal:closed': { modalId: string };
    /** 诊断日志记录 */
    'diagnostics:log': { level: string; namespace: string; message: string; timestamp: number };
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
export class TypedEventBus<Events = CoreEventMap> implements ITypedEventBus<Events>, IDisposable {
    private readonly _listeners = new Map<keyof Events, Set<EventHandler<any>>>();
    private _isDisposed = false;

    public on<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable {
        if (this._isDisposed) {
            return toDisposable(() => {});
        }

        let handlers = this._listeners.get(eventName);
        if (!handlers) {
            handlers = new Set();
            this._listeners.set(eventName, handlers);
        }

        handlers.add(handler);

        return toDisposable(() => {
            this.off(eventName, handler);
        });
    }

    public once<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): IDisposable {
        const wrapper: EventHandler<Events[K]> = (payload: Events[K]) => {
            this.off(eventName, wrapper);
            return handler(payload);
        };
        return this.on(eventName, wrapper);
    }

    public emit<K extends keyof Events>(eventName: K, payload: Events[K]): void {
        if (this._isDisposed) {
            return;
        }

        const handlers = this._listeners.get(eventName);
        if (!handlers || handlers.size === 0) {
            return;
        }

        for (const handler of Array.from(handlers)) {
            try {
                const result = handler(payload);
                if (result instanceof Promise) {
                    result.catch((err) => {
                        console.error(`[TypedEventBus] 事件处理异步异常 (${String(eventName)}):`, err);
                    });
                }
            } catch (error) {
                console.error(`[TypedEventBus] 事件处理同步异常 (${String(eventName)}):`, error);
            }
        }
    }

    public off<K extends keyof Events>(eventName: K, handler: EventHandler<Events[K]>): void {
        const handlers = this._listeners.get(eventName);
        if (!handlers) {
            return;
        }
        handlers.delete(handler);
        if (handlers.size === 0) {
            this._listeners.delete(eventName);
        }
    }

    public clear(): void {
        this._listeners.clear();
    }

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        this.clear();
    }
}
