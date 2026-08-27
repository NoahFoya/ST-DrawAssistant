/**
 * @module ui/foundation/form-binder
 * @description 响应式表单数据绑定管理器 (FormBinder)
 * 解决在各个 onChange 中手动闭包打补丁与 refreshTab() 的反模式，实现 Store 与 UI 控件的声明式双向联动
 */

import { ObservableStore, IDisposable, DisposableStore } from '../../core';

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
export class FormBinder<TState extends object> implements IDisposable {
    private readonly _store: ObservableStore<TState>;
    private readonly _disposables = new DisposableStore();

    constructor(store: ObservableStore<TState>) {
        this._store = store;
    }

    /**
     * 声明式绑定 Store 的属性键与 UI 控件
     *
     * @param def 绑定定义配置
     * @returns 包含 UI 变更时写入 Store 的分发函数
     */
    public bind<K extends keyof TState>(def: BindingDefinition<TState, K>): (uiValue: any) => void {
        // 1. 初始化当前值
        const initialVal = this._store.get(def.key);
        try {
            def.updateUI(initialVal);
        } catch (e) {
            console.error(`[FormBinder] 初始化 UI 状态异常 [${String(def.key)}]:`, e);
        }

        // 2. 订阅 Store 变更 -> 自动驱动 UI 更新
        const sub = this._store.subscribeKey(def.key, (newVal) => {
            try {
                def.updateUI(newVal);
            } catch (e) {
                console.error(`[FormBinder] 驱动 UI 更新异常 [${String(def.key)}]:`, e);
            }
        });
        this._disposables.add(sub);

        // 3. 返回 UI 变更时自动写回 Store 的调度函数
        return (uiValue: any) => {
            const storeVal = def.transformToStore ? def.transformToStore(uiValue) : uiValue;
            this._store.set(def.key, storeVal);
        };
    }

    /**
     * 获取绑定的底层 ObservableStore 实例
     */
    public getStore(): ObservableStore<TState> {
        return this._store;
    }

    /**
     * 释放所有绑定订阅，防止内存泄漏
     */
    public dispose(): void {
        this._disposables.dispose();
    }
}
