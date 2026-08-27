/**
 * @module core/foundation/disposable
 * @description 生命周期管理与资源清理工具 (IDisposable 接口与 DisposableStore 实现)
 */

/**
 * 可释放资源的标准接口
 */
export interface IDisposable {
    /**
     * 释放当前持有的所有资源 (DOM 监听、定时器、WebSocket、事件订阅等)
     */
    dispose(): void;
}

/**
 * 将任意无参回调函数包装为符合 IDisposable 接口的对象
 *
 * @param fn 释放时执行的回调函数
 * @returns 包装后的 IDisposable 实例
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

/**
 * 资源收集与批量清理容器 (DisposableStore)
 * 统一管理子项生命周期，支持级联与批量释放，防止内存泄露
 */
export class DisposableStore implements IDisposable {
    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    /**
     * 容器是否已完成释放
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * 注册一个可释放对象进入容器管理
     */
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

    /**
     * 清空当前容器中管理的所有资源，并按注册逆序逐一执行 dispose()
     */
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

    /**
     * 释放容器持有的所有资源，并将容器永久标记为已销毁
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this.clear();
    }
}
