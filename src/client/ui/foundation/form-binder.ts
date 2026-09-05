/**
 * @module ui/foundation/form-binder
 * @description 响应式表单数据绑定管理器 (FormBinder)
 * 提供统一响应式表单数据绑定能力，实现 Store 与 UI 控件的声明式双向联动与状态同步
 */

import { IDisposable, DisposableStore } from '../../core';

/**
 * 响应式配置存储必须满足的最小契约接口
 */
export interface IObservableStore<TState extends object> {
    get<K extends keyof TState>(key: K): TState[K];
    set<K extends keyof TState>(key: K, value: TState[K]): void;
    subscribeKey<K extends keyof TState>(key: K, listener: (newVal: TState[K], oldVal: TState[K]) => void): IDisposable;
}

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
    private readonly _store: IObservableStore<TState>;
    private readonly _disposables = new DisposableStore();

    constructor(store: IObservableStore<TState>) {
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
     * 获取绑定的底层 Store 实例
     */
    public getStore(): IObservableStore<TState> {
        return this._store;
    }

    /**
     * 释放所有绑定订阅，防止内存泄漏
     */
    public dispose(): void {
        this._disposables.dispose();
    }
}

/**
 * 专用于子模块或特定后端的响应式表单状态存储容器
 */
export class EngineFormStore<T extends Record<string, any>> implements IObservableStore<T>, IDisposable {
    private readonly _data: T;
    private readonly _listeners = new Map<keyof T, Set<(newVal: any, oldVal: any) => void>>();
    private readonly _stateListeners = new Set<(state: T) => void>();
    private readonly _onSave?: (data: T) => void;
    private _isDisposed = false;

    constructor(initial: T, onSave?: (data: T) => void) {
        this._data = { ...initial };
        this._onSave = onSave;
    }

    public get<K extends keyof T>(key: K): T[K] {
        return this._data[key];
    }

    public set<K extends keyof T>(key: K, value: T[K]): void {
        if (this._isDisposed) return;
        const oldVal = this._data[key];
        this._data[key] = value;
        const listeners = this._listeners.get(key);
        if (listeners) {
            listeners.forEach((fn) => fn(value, oldVal));
        }
        this._stateListeners.forEach((fn) => fn({ ...this._data }));
        this._onSave?.(this._data);
    }

    public subscribe(listener: (state: T) => void): IDisposable {
        if (this._isDisposed) return { dispose: () => {} };
        this._stateListeners.add(listener);
        return {
            dispose: () => {
                this._stateListeners.delete(listener);
            }
        };
    }

    public subscribeKey<K extends keyof T>(key: K, listener: (newVal: T[K], oldVal: T[K]) => void): IDisposable {
        if (this._isDisposed) return { dispose: () => {} };
        let set = this._listeners.get(key);
        if (!set) {
            set = new Set();
            this._listeners.set(key, set);
        }
        set.add(listener);
        return {
            dispose: () => {
                set?.delete(listener);
            }
        };
    }

    public getState(): T {
        return { ...this._data };
    }

    public dispose(): void {
        this._isDisposed = true;
        this._listeners.clear();
    }
}

