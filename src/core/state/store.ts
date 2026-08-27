/**
 * @module core/state/store
 * @description 响应式全局状态与配置中心 (ObservableStore)
 */

import { IDisposable, toDisposable } from '../foundation/disposable';

export type StateListener<T> = (state: T, keyPath?: string) => void;
export type KeyListener<V> = (newValue: V, oldValue: V) => void;

/**
 * 响应式全局状态配置中心
 */
export class ObservableStore<T extends Record<string, any>> implements IDisposable {
    private _state: T;
    private readonly _globalListeners = new Set<StateListener<T>>();
    private readonly _keyListeners = new Map<keyof T, Set<KeyListener<any>>>();
    private _isDisposed = false;
    private _saveHandler?: (state: T) => void;
    private _saveDebounceTimer: any = null;
    private readonly _debounceMs: number;

    constructor(initialState: T, options?: { onSave?: (state: T) => void; debounceMs?: number }) {
        this._state = { ...initialState };
        this._saveHandler = options?.onSave;
        this._debounceMs = options?.debounceMs ?? 300;
    }

    /**
     * 获取完整配置状态快照 (浅拷贝)
     * @returns 当前状态对象的只读浅拷贝快照
     */
    public getState(): Readonly<T> {
        return this._state;
    }

    /**
     * 读取指定配置字段的值
     * @param key 配置项键名
     * @returns 对应配置项的当前值
     */
    public get<K extends keyof T>(key: K): T[K] {
        return this._state[key];
    }

    /**
     * 写入单个配置字段并触发键级与全局响应式更新
     * @param key 配置项键名
     * @param value 新的配置值
     */
    public set<K extends keyof T>(key: K, value: T[K]): void {
        if (this._isDisposed) return;

        const oldValue = this._state[key];
        if (oldValue === value) return;

        this._state = {
            ...this._state,
            [key]: value
        };

        // 触发键级监听
        const keyHandlers = this._keyListeners.get(key);
        if (keyHandlers) {
            for (const handler of Array.from(keyHandlers)) {
                try {
                    handler(value, oldValue);
                } catch (e) {
                    console.error(`[ObservableStore] 键级监听器异常 (${String(key)}):`, e);
                }
            }
        }

        // 触发全局状态监听
        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, String(key));
            } catch (e) {
                console.error('[ObservableStore] 全局监听器异常:', e);
            }
        }

        this.scheduleSave();
    }

    /**
     * 批量更新配置
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

        // 触发各键监听
        for (const key of changedKeys) {
            const handlers = this._keyListeners.get(key);
            if (handlers) {
                for (const h of Array.from(handlers)) {
                    try {
                        h(this._state[key], oldState[key]);
                    } catch (e) {
                        console.error(`[ObservableStore] 批量更新键监听异常 (${String(key)}):`, e);
                    }
                }
            }
        }

        // 触发全局监听
        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state);
            } catch (e) {
                console.error('[ObservableStore] 批量更新全局监听异常:', e);
            }
        }

        this.scheduleSave();
    }

    /**
     * 订阅整个配置树的变更
     */
    public subscribe(listener: StateListener<T>): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});
        this._globalListeners.add(listener);
        return toDisposable(() => {
            this._globalListeners.delete(listener);
        });
    }

    /**
     * 细粒度订阅特定键的变更
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

    /**
     * 防抖持久化写入
     */
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
                    console.error('[ObservableStore] 执行持久化落盘失败:', err);
                }
            }
        }, this._debounceMs);
    }

    /**
     * 立即执行未决的持久化保存
     */
    public flush(): void {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }
        if (this._saveHandler && !this._isDisposed) {
            this._saveHandler(this._state);
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
