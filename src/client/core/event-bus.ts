/**
 * @module core/event-bus
 * @description 事件总线
 */

import { IDisposable, toDisposable } from './types';
import { Logger } from './logger';

export type EventHandler<T> = (payload: T) => void;

/**
 * 事件总线
 * 用于各模块之间的事件订阅与通知
 */
export class TypedEventBus<TEventMap extends Record<string, any>> implements IDisposable {
    private readonly _listeners = new Map<keyof TEventMap, Set<EventHandler<any>>>();
    private readonly _logger = new Logger('EventBus');
    private _isDisposed = false;

    /**
     * 注册事件监听器
     *
     * @param event 事件名称
     * @param handler 监听回调函数
     * @returns 返回用于取消订阅的 IDisposable 实例
     */
    public on<K extends keyof TEventMap>(event: K, handler: EventHandler<TEventMap[K]>): IDisposable {
        if (this._isDisposed) {
            return toDisposable(() => {});
        }

        let handlers = this._listeners.get(event);
        if (!handlers) {
            handlers = new Set();
            this._listeners.set(event, handlers);
        }
        handlers.add(handler);

        return toDisposable(() => {
            const set = this._listeners.get(event);
            if (set) {
                set.delete(handler);
                if (set.size === 0) {
                    this._listeners.delete(event);
                }
            }
        });
    }

    /**
     * 触发事件
     * 捕获并记录单个处理器的执行异常，防止异常扩散影响其他监听器
     */
    public emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
        if (this._isDisposed) return;

        const handlers = this._listeners.get(event);
        if (!handlers || handlers.size === 0) return;

        for (const handler of Array.from(handlers)) {
            try {
                handler(payload);
            } catch (err) {
                this._logger.error(`事件处理器执行异常 [${String(event)}]`, err);
            }
        }
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._listeners.clear();
    }
}
