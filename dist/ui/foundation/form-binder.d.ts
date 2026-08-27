/**
 * @module ui/foundation/form-binder
 * @description 响应式表单数据绑定管理器 (FormBinder)
 * 解决在各个 onChange 中手动闭包打补丁与 refreshTab() 的反模式，实现 Store 与 UI 控件的声明式双向联动
 */
import { ObservableStore } from '../../core/state/store';
import { IDisposable } from '../../core/foundation/disposable';
export interface BindingDefinition<TState, K extends keyof TState> {
    /** 绑定的 Store 属性键名 */
    key: K;
    /** 当 Store 数据变化时同步更新 UI 控件的回调 */
    updateUI: (value: TState[K]) => void;
    /** 可选的数值/状态转换函数 (UI 到 Store) */
    transformToStore?: (uiValue: any) => TState[K];
}
/**
 * 响应式表单绑定器
 */
export declare class FormBinder<TState extends object> implements IDisposable {
    private readonly _store;
    private readonly _disposables;
    constructor(store: ObservableStore<TState>);
    /**
     * 声明式绑定 Store 的属性键与 UI 控件
     *
     * @param def 绑定定义配置
     * @returns 包含 UI 变更时写入 Store 的分发函数
     */
    bind<K extends keyof TState>(def: BindingDefinition<TState, K>): (uiValue: any) => void;
    /**
     * 获取绑定的底层 ObservableStore 实例
     */
    getStore(): ObservableStore<TState>;
    /**
     * 释放所有绑定订阅，防止内存泄漏
     */
    dispose(): void;
}
//# sourceMappingURL=form-binder.d.ts.map