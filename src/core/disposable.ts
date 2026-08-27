/**
 * @module core/disposable
 * @description 资源销毁接口与 DisposableBag 统一管理容器
 *
 * 职责：
 * - 定义 IDisposable 接口，用于统一管理需要显式销毁的组件资源
 * - 提供 DisposableBag 容器收纳取消订阅与事件解绑闭包，在页面切换或组件卸载时批量清理，防止内存泄漏
 */

// ─── IDisposable 接口 ─────────────────────────────────────────────────────────

/**
 * 资源销毁统一接口
 * 包含清理事件监听、取消订阅或定时器的 dispose 方法
 */
export interface IDisposable {
    dispose(): void;
}

// ─── DisposableBag 容器 ───────────────────────────────────────────────────────

/**
 * 资源清理容器
 * 收集清理函数（如 unsubscribe、removeEventListener），
 * 在 dispose() 时按“后注册先清理”的顺序批量解绑
 */
export class DisposableBag implements IDisposable {
    private _fns: (() => void)[] = [];
    private _disposed = false;

    /**
     * 注册一个清理函数
     * @param fn 清理函数（如 unsubscribe、removeEventListener）
     */
    add(fn: () => void): void {
        if (this._disposed) {
            // 已销毁的 bag 不再接收新注册，直接执行以防资源泄漏
            fn();
            return;
        }
        this._fns.push(fn);
    }

    /**
     * 将 IDisposable 对象纳入生命周期管理
     */
    addDisposable(disposable: IDisposable): void {
        this.add(() => disposable.dispose());
    }

    /**
     * 销毁所有持有的资源（LIFO 顺序执行）
     * 多次调用幂等，不会重复执行
     */
    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        // 反向执行，保证 LIFO 顺序（后注册的先销毁）
        for (let i = this._fns.length - 1; i >= 0; i--) {
            try {
                this._fns[i]();
            } catch (err) {
                console.error('[DisposableBag] 资源清理函数执行异常', err);
            }
        }
        this._fns = [];
    }

    /** 是否已销毁 */
    get isDisposed(): boolean {
        return this._disposed;
    }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 创建一个无操作的 IDisposable（用于占位或测试）
 */
export function noopDisposable(): IDisposable {
    return { dispose: () => {} };
}
