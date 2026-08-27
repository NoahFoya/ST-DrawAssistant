/**
 * @module core/state/store
 * @description 响应式状态管理中心 (ObservableStore)
 *
 * 业务设计意图：
 * 1. 作为全局配置中心 (mainStore)：
 *    绑定 onSave 持久化回调，在配置发生变更时通过防抖 (默认 300ms) 自动存入浏览器的 Local Storage (SillyTavern extension_settings)；
 * 2. 作为局部草稿中心 (draftStore)：
 *    构造时不传 onSave，仅在内存中响应界面组件的输入与滑块调节，确保用户在未点击「保存」前不会污染已有预设或产生不必要的存盘开销；
 * 3. 支持全局订阅 (subscribe) 与单个键细粒度订阅 (subscribeKey)，实现 UI 控件的高效按需重渲染。
 */
import { IDisposable } from '../foundation/disposable';
export type StateListener<T> = (state: T, keyPath?: string, oldState?: T) => void;
export type KeyListener<V> = (newValue: V, oldValue: V) => void;
/**
 * 响应式状态中心
 *
 * 提供只读快照获取、键值写入、批量更新、键级精准监听与防抖自动持久化能力。
 */
export declare class ObservableStore<T extends Record<string, any>> implements IDisposable {
    private _state;
    private readonly _globalListeners;
    private readonly _keyListeners;
    private readonly _logger;
    private _isDisposed;
    private _saveHandler?;
    private _saveDebounceTimer;
    private readonly _debounceMs;
    constructor(initialState: T, options?: {
        onSave?: (state: T) => void;
        debounceMs?: number;
    });
    /** 返回当前完整状态的只读快照 */
    getState(): Readonly<T>;
    /** 读取指定键的当前值 */
    get<K extends keyof T>(key: K): T[K];
    /**
     * 设置单个键值，若新旧值相同则跳过，否则触发键级与全局监听器并安排防抖持久化
     *
     * @param key 目标键名
     * @param value 新值
     */
    set<K extends keyof T>(key: K, value: T[K]): void;
    /**
     * 批量更新多个键值，仅通知发生实际变化的键，结束后统一触发全局监听器并安排防抖持久化
     *
     * @param partial 要更新的键值对子集
     */
    update(partial: Partial<T>): void;
    /**
     * 用新状态完整替换当前状态，触发所有键级与全局监听器并安排防抖持久化
     *
     * @param newState 替换后的完整新状态对象
     */
    reset(newState: T): void;
    /**
     * 订阅任意键变化的全局监听器，每次状态更新后均会触发
     *
     * @param listener 监听回调，接收新状态、变化键路径和旧状态
     * @returns 取消订阅的销毁句柄
     */
    subscribe(listener: StateListener<T>): IDisposable;
    /**
     * 订阅指定单个键的细粒度变化，仅在该键值发生变化时触发
     *
     * @param key 要监听的键名
     * @param listener 监听回调，接收新值与旧值
     * @returns 取消订阅的销毁句柄
     */
    subscribeKey<K extends keyof T>(key: K, listener: KeyListener<T[K]>): IDisposable;
    private scheduleSave;
    /** 立即执行未决的持久化写入 */
    flush(): void;
    dispose(): void;
}
//# sourceMappingURL=store.d.ts.map