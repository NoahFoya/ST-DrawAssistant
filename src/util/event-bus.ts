/**
 * 强类型事件总线与生命周期注销句柄
 * 提供模块间解耦通信，具备单订阅者异常隔离保护与成对注销能力，防止事件闭包内存泄漏。
 */

import { Logger } from './logger';

export interface IDisposable {
    dispose(): void;
}

/**
 * 将清理函数封装为符合 IDisposable 接口的对象，确保仅执行一次。
 */
export function toDisposable(fn: () => void): IDisposable {
    let isDisposed = false;
    return {
        dispose: () => {
            if (!isDisposed) {
                isDisposed = true;
                fn();
            }
        }
    };
}

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
     * 注册单次触发的事件监听器，触发后自动注销。
     */
    public once<K extends keyof TEventMap>(event: K, handler: EventHandler<TEventMap[K]>): IDisposable {
        if (this._isDisposed) {
            return toDisposable(() => {});
        }

        let subscription: IDisposable | null = null;
        const wrappedHandler: EventHandler<TEventMap[K]> = (payload) => {
            subscription?.dispose();
            subscription = null;
            handler(payload);
        };

        subscription = this.on(event, wrappedHandler);
        return subscription;
    }

    /**
     * 广播事件。
     * 单个处理函数内部异常会被捕获并记录日志，防止阻断其余订阅者的正常执行。
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

    /**
     * 清空当前所有注册的事件监听。
     */
    public clear(): void {
        this._listeners.clear();
    }

    /**
     * 销毁事件总线，清空全部监听并拒绝后续新注册。
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._listeners.clear();
    }
}
