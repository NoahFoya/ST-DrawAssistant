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
export declare function toDisposable(fn: () => void): IDisposable;
/**
 * 资源收集与批量清理容器 (DisposableStore)
 * 统一管理子项生命周期，支持级联与批量释放，防止内存泄露
 */
export declare class DisposableStore implements IDisposable {
    private readonly _disposables;
    private _isDisposed;
    /**
     * 容器是否已完成释放
     */
    get isDisposed(): boolean;
    /**
     * 注册一个可释放对象进入容器管理
     */
    add<T extends IDisposable>(item: T): T;
    /**
     * 清空当前容器中管理的所有资源，并按注册逆序逐一执行 dispose()
     */
    clear(): void;
    /**
     * 释放容器持有的所有资源，并将容器永久标记为已销毁
     */
    dispose(): void;
}
//# sourceMappingURL=disposable.d.ts.map