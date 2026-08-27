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

import { IDisposable, toDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';

export type StateListener<T> = (state: T, keyPath?: string, oldState?: T) => void;
export type KeyListener<V> = (newValue: V, oldValue: V) => void;

/**
 * 响应式状态中心
 *
 * 提供只读快照获取、键值写入、批量更新、键级精准监听与防抖自动持久化能力。
 */
export class ObservableStore<T extends Record<string, any>> implements IDisposable {
    private _state: T;
    private readonly _globalListeners = new Set<StateListener<T>>();
    private readonly _keyListeners = new Map<keyof T, Set<KeyListener<any>>>();
    private readonly _logger = new Logger('ObservableStore');
    private _isDisposed = false;
    private _saveHandler?: (state: T) => void;
    private _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _debounceMs: number;

    constructor(initialState: T, options?: { onSave?: (state: T) => void; debounceMs?: number }) {
        this._state = { ...initialState };
        this._saveHandler = options?.onSave;
        this._debounceMs = options?.debounceMs ?? 300;
    }

    /** 返回当前完整状态的只读快照 */
    public getState(): Readonly<T> {
        return this._state;
    }

    /** 读取指定键的当前值 */
    public get<K extends keyof T>(key: K): T[K] {
        return this._state[key];
    }

    /**
     * 设置单个键值，若新旧值相同则跳过，否则触发键级与全局监听器并安排防抖持久化
     *
     * @param key 目标键名
     * @param value 新值
     */
    public set<K extends keyof T>(key: K, value: T[K]): void {
        if (this._isDisposed) return;

        const oldValue = this._state[key];
        if (oldValue === value) return;

        const oldState = this._state;
        this._state = {
            ...this._state,
            [key]: value
        };

        const keyHandlers = this._keyListeners.get(key);
        if (keyHandlers) {
            for (const handler of Array.from(keyHandlers)) {
                try {
                    handler(value, oldValue);
                } catch (e) {
                    this._logger.error(`键级监听器执行异常 (${String(key)})`, e);
                }
            }
        }

        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, String(key), oldState);
            } catch (e) {
                this._logger.error('全局状态监听器执行异常', e);
            }
        }

        this.scheduleSave();
    }

    /**
     * 批量更新多个键值，仅通知发生实际变化的键，结束后统一触发全局监听器并安排防抖持久化
     *
     * @param partial 要更新的键值对子集
     */
    public update(partial: Partial<T>): void {
        if (this._isDisposed || !partial) return;

        let hasChange = false;
        const oldState = this._state;
        const changedKeys: (keyof T)[] = [];

        const nextState = { ...this._state };
        for (const [k, v] of Object.entries(partial)) {
            const key = k as keyof T;
            if (nextState[key] !== v) {
                nextState[key] = v as any;
                hasChange = true;
                changedKeys.push(key);
            }
        }

        if (!hasChange) return;
        this._state = nextState;

        for (const key of changedKeys) {
            const handlers = this._keyListeners.get(key);
            if (handlers) {
                for (const h of Array.from(handlers)) {
                    try {
                        h(this._state[key], oldState[key]);
                    } catch (e) {
                        this._logger.error(`批量更新键级监听异常 (${String(key)})`, e);
                    }
                }
            }
        }

        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, undefined, oldState);
            } catch (e) {
                this._logger.error('批量更新全局监听异常', e);
            }
        }

        this.scheduleSave();
    }

    /**
     * 用新状态完整替换当前状态，触发所有键级与全局监听器并安排防抖持久化
     *
     * @param newState 替换后的完整新状态对象
     */
    public reset(newState: T): void {
        if (this._isDisposed || !newState) return;

        const oldState = this._state;
        this._state = { ...newState };

        for (const [key, handlers] of this._keyListeners.entries()) {
            const newVal = this._state[key];
            const oldVal = oldState[key];
            if (handlers) {
                for (const h of Array.from(handlers)) {
                    try {
                        h(newVal, oldVal);
                    } catch (e) {
                        this._logger.error(`重置状态键级监听异常 (${String(key)})`, e);
                    }
                }
            }
        }

        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, undefined, oldState);
            } catch (e) {
                this._logger.error('重置状态全局监听异常', e);
            }
        }

        this.scheduleSave();
    }

    /**
     * 订阅任意键变化的全局监听器，每次状态更新后均会触发
     *
     * @param listener 监听回调，接收新状态、变化键路径和旧状态
     * @returns 取消订阅的销毁句柄
     */
    public subscribe(listener: StateListener<T>): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});
        this._globalListeners.add(listener);
        return toDisposable(() => {
            this._globalListeners.delete(listener);
        });
    }

    /**
     * 订阅指定单个键的细粒度变化，仅在该键值发生变化时触发
     *
     * @param key 要监听的键名
     * @param listener 监听回调，接收新值与旧值
     * @returns 取消订阅的销毁句柄
     */
    public subscribeKey<K extends keyof T>(key: K, listener: KeyListener<T[K]>): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});

        let set = this._keyListeners.get(key);
        if (!set) {
            set = new Set();
            this._keyListeners.set(key, set);
        }
        set.add(listener);

        return toDisposable(() => {
            const s = this._keyListeners.get(key);
            if (s) {
                s.delete(listener);
                if (s.size === 0) {
                    this._keyListeners.delete(key);
                }
            }
        });
    }

    private scheduleSave(): void {
        if (!this._saveHandler) return;

        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }

        this._saveDebounceTimer = setTimeout(() => {
            if (!this._isDisposed && this._saveHandler) {
                try {
                    this._saveHandler(this._state);
                } catch (err) {
                    this._logger.error('执行持久化保存失败', err);
                }
            }
        }, this._debounceMs);
    }

    /** 立即执行未决的持久化写入 */
    public flush(): void {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }
        if (this._saveHandler && !this._isDisposed) {
            try {
                this._saveHandler(this._state);
            } catch (err) {
                this._logger.error('立即执行持久化保存失败', err);
            }
        }
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this.flush();
        this._isDisposed = true;
        this._globalListeners.clear();
        this._keyListeners.clear();
    }
}
