/**
 * @module core/disposable
 * @description 资源销毁接口与 DisposableBag 统一管理容器
 *
 * 职责：
 * - 定义 IDisposable 接口，用于统一管理需要显式销毁的组件资源
 * - 提供 DisposableBag 容器收纳取消订阅与事件解绑闭包，在页面切换或组件卸载时批量清理，防止内存泄漏
 */
/**
 * 资源销毁统一接口
 * 包含清理事件监听、取消订阅或定时器的 dispose 方法
 */
export interface IDisposable {
    dispose(): void;
}
/**
 * 资源清理容器
 * 收集清理函数（如 unsubscribe、removeEventListener），
 * 在 dispose() 时按“后注册先清理”的顺序批量解绑
 */
export declare class DisposableBag implements IDisposable {
    private _fns;
    private _disposed;
    /**
     * 注册一个清理函数
     * @param fn 清理函数（如 unsubscribe、removeEventListener）
     */
    add(fn: () => void): void;
    /**
     * 将 IDisposable 对象纳入生命周期管理
     */
    addDisposable(disposable: IDisposable): void;
    /**
     * 销毁所有持有的资源（LIFO 顺序执行）
     * 多次调用幂等，不会重复执行
     */
    dispose(): void;
    /** 是否已销毁 */
    get isDisposed(): boolean;
}
/**
 * 创建一个无操作的 IDisposable（用于占位或测试）
 */
export declare function noopDisposable(): IDisposable;
//# sourceMappingURL=disposable.d.ts.map