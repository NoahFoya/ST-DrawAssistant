/**
 * 强类型事件发布订阅工具
 */

import { IDisposable, toDisposable } from '../types/common';
import { Logger } from './logger';

export type EventHandler<T> = (payload: T) => void;

export class TypedEventBus<TEventMap extends Record<string, any>> implements IDisposable {
    private readonly _listeners = new Map<keyof TEventMap, Set<EventHandler<any>>>();
    private readonly _logger = new Logger('EventBus');
    private _isDisposed = false;

    /**
     * 注册事件监听器。
     * @returns 返回可用于取消订阅的 IDisposable 句柄
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
     * 广播事件，异常由内部捕获，防止中断后续处理函数的执行。
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

    public clear(): void {
        this._listeners.clear();
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._listeners.clear();
    }
}
