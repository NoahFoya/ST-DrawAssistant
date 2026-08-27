/**
 * @module core/state/store
 * @description 响应式全局状态与配置中心 (ObservableStore)
 */
import { IDisposable } from '../foundation/disposable';
export type StateListener<T> = (state: T, keyPath?: string) => void;
export type KeyListener<V> = (newValue: V, oldValue: V) => void;
/**
 * 响应式全局状态配置中心
 */
export declare class ObservableStore<T extends Record<string, any>> implements IDisposable {
    private _state;
    private readonly _globalListeners;
    private readonly _keyListeners;
    private _isDisposed;
    private _saveHandler?;
    private _saveDebounceTimer;
    private readonly _debounceMs;
    constructor(initialState: T, options?: {
        onSave?: (state: T) => void;
        debounceMs?: number;
    });
    /**
     * 获取完整配置状态快照 (浅拷贝)
     * @returns 当前状态对象的只读浅拷贝快照
     */
    getState(): Readonly<T>;
    /**
     * 读取指定配置字段的值
     * @param key 配置项键名
     * @returns 对应配置项的当前值
     */
    get<K extends keyof T>(key: K): T[K];
    /**
     * 写入单个配置字段并触发键级与全局响应式更新
     * @param key 配置项键名
     * @param value 新的配置值
     */
    set<K extends keyof T>(key: K, value: T[K]): void;
    /**
     * 批量更新配置
     */
    update(partial: Partial<T>): void;
    /**
     * 订阅整个配置树的变更
     */
    subscribe(listener: StateListener<T>): IDisposable;
    /**
     * 细粒度订阅特定键的变更
     */
    subscribeKey<K extends keyof T>(key: K, listener: KeyListener<T[K]>): IDisposable;
    /**
     * 防抖持久化写入
     */
    private scheduleSave;
    /**
     * 立即执行未决的持久化保存
     */
    flush(): void;
    dispose(): void;
}
//# sourceMappingURL=store.d.ts.map