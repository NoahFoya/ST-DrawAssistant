/**
 * 通用生命周期与基础类型
 */

export interface IDisposable {
    dispose(): void;
}

/**
 * 将清理回调包装为执行一次的 IDisposable 对象。
 */
export function toDisposable(fn: () => void): IDisposable {
    let isDisposed = false;
    return {
        dispose: () => {
            if (!isDisposed) {
                isDisposed = true;
                try {
                    fn();
                } catch (err) {
                    console.warn('[ST-DrawAssistant] 资源释放回调执行异常:', err);
                }
            }
        }
    };
}

/**
 * 资源集中清理容器。在组件销毁或扩展卸载时按逆序执行释放逻辑，避免事件监听和定时器泄露。
 */
export class DisposableStore implements IDisposable {
    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    public add<T extends IDisposable>(item: T): T {
        if (!item) {
            return item;
        }

        if (this._isDisposed) {
            try {
                item.dispose();
            } catch (error) {
                console.error('[DisposableStore] 释放已注销项时发生异常:', error);
            }
            return item;
        }

        this._disposables.push(item);
        return item;
    }

    public clear(): void {
        while (this._disposables.length > 0) {
            const item = this._disposables.pop();
            try {
                item?.dispose();
            } catch (error) {
                console.error('[DisposableStore] 清理资源时发生异常:', error);
            }
        }
    }

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this.clear();
    }
}

/**
 * 日志分级
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

/**
 * 网络请求异常分类代码
 */
export type NetworkErrorCode =
    | 'MIXED_CONTENT'
    | 'CORS_ERROR'
    | 'TIMEOUT'
    | 'ABORTED'
    | 'GATEWAY_ERROR'
    | 'SECURITY_BLOCKED'
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR';
