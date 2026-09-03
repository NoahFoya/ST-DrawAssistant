/**
 * @module core/config/config-store
 * @description 配置管理中心与深度合并服务
 */

import { IDisposable, toDisposable, DrawAssistantSettings } from '../types';
import { Logger } from '../logger';
import { DEFAULT_SAVE_DEBOUNCE_MS, BUILTIN_THEMES, BUILTIN_THEME_DARK } from '../constants';

export type StateListener<T> = (state: T, keyPath?: string, oldState?: T) => void;
export type KeyListener<V> = (newValue: V, oldValue: V) => void;

/** 插件默认配置 */
export const DEFAULT_SETTINGS: DrawAssistantSettings = {
    enabled: true,
    activeProvider: 'comfyui',
    requestMode: 'browser',
    storageStrategy: 'split',
    taskTimeoutMs: 180000,
    maxConcurrentTasks: 1,
    autoGenerate: false,

    themePreset: BUILTIN_THEME_DARK.id,
    customThemes: BUILTIN_THEMES.map(theme => ({
        id: theme.id,
        name: theme.name,
        tokens: { ...theme.tokens }
    })),
    fabVisible: true,
    fabPosition: null,
    lightboxEnabled: true,

    engineConfigs: {},
    characterRules: {},
    macroRuleTree: []
};

function isPlainObject(item: unknown): item is Record<string, any> {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item));
}

function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(obj);
        } catch {}
    }
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 递归合并配置对象
 * 普通对象递归补齐默认值；数组与基础类型优先保留用户当前设置；实现完整对象隔离
 */
export function mergeSettingsWithDefaults(
    userSettings: unknown,
    defaults: DrawAssistantSettings = DEFAULT_SETTINGS
): DrawAssistantSettings {
    const baseDefaults = deepClone(defaults);
    if (!userSettings || typeof userSettings !== 'object') {
        return baseDefaults;
    }

    const raw = userSettings as Record<string, any>;

    function deepMerge(target: any, source: any): any {
        if (source === undefined) {
            return target;
        }
        if (Array.isArray(target)) {
            return Array.isArray(source) ? deepClone(source) : target;
        }
        if (isPlainObject(target) && isPlainObject(source)) {
            const result: Record<string, any> = { ...target };
            for (const key of Object.keys(source)) {
                result[key] = key in target ? deepMerge(target[key], source[key]) : deepClone(source[key]);
            }
            return result;
        }
        return deepClone(source);
    }

    return deepMerge(baseDefaults, raw) as DrawAssistantSettings;
}

/**
 * 配置状态管理中心
 * 提供单向数据流、按键订阅变更与防抖持久化能力
 */
export class ConfigStore implements IDisposable {
    private _state: DrawAssistantSettings;
    private readonly _globalListeners = new Set<StateListener<DrawAssistantSettings>>();
    private readonly _keyListeners = new Map<keyof DrawAssistantSettings, Set<KeyListener<any>>>();
    private readonly _logger = new Logger('ConfigStore');
    private _isDisposed = false;
    private readonly _saveHandler?: (state: DrawAssistantSettings) => void;
    private _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _debounceMs: number;

    constructor(
        initialSettings?: unknown,
        options?: { onSave?: (state: DrawAssistantSettings) => void; debounceMs?: number }
    ) {
        this._state = mergeSettingsWithDefaults(initialSettings, DEFAULT_SETTINGS);
        this._saveHandler = options?.onSave;
        this._debounceMs = options?.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
    }

    /** 获取当前全局配置快照 */
    public getState(): Readonly<DrawAssistantSettings> {
        return this._state;
    }

    /** 读取指定顶级配置项 */
    public get<K extends keyof DrawAssistantSettings>(key: K): DrawAssistantSettings[K] {
        return this._state[key];
    }

    /** 设置单个顶级配置项并触发监听与防抖保存 */
    public set<K extends keyof DrawAssistantSettings>(key: K, value: DrawAssistantSettings[K]): void {
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
                } catch (err) {
                    this._logger.error(`配置项变更监听执行失败 [${String(key)}]`, err);
                }
            }
        }

        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, String(key), oldState);
            } catch (err) {
                this._logger.error('全局配置监听执行失败', err);
            }
        }

        this.scheduleSave();
    }

    /** 批量更新多个配置项 */
    public update(partial: Partial<DrawAssistantSettings>): void {
        if (this._isDisposed || !partial) return;

        let hasChange = false;
        const oldState = this._state;
        const changedKeys: (keyof DrawAssistantSettings)[] = [];
        const nextState = { ...this._state } as Record<string, any>;

        for (const [k, v] of Object.entries(partial)) {
            const key = k as keyof DrawAssistantSettings;
            if (nextState[key] !== v) {
                nextState[key] = v;
                hasChange = true;
                changedKeys.push(key);
            }
        }

        if (!hasChange) return;
        this._state = nextState as DrawAssistantSettings;

        for (const key of changedKeys) {
            const handlers = this._keyListeners.get(key);
            if (handlers) {
                for (const h of Array.from(handlers)) {
                    try {
                        h(this._state[key], oldState[key]);
                    } catch (err) {
                        this._logger.error(`配置项变更监听执行失败 [${String(key)}]`, err);
                    }
                }
            }
        }

        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, undefined, oldState);
            } catch (err) {
                this._logger.error('全局配置监听执行失败', err);
            }
        }

        this.scheduleSave();
    }

    /** 获取指定后端的专属配置 */
    public getEngineConfig<T = Record<string, unknown>>(provider: string): T | undefined {
        return this._state.engineConfigs[provider] as T | undefined;
    }

    /** 设置或更新指定后端的专属配置 */
    public setEngineConfig(provider: string, config: Record<string, unknown>): void {
        const nextEngineConfigs = {
            ...this._state.engineConfigs,
            [provider]: config
        };
        this.set('engineConfigs', nextEngineConfigs);
    }

    /** 注册全局配置变更监听器 */
    public subscribe(listener: StateListener<DrawAssistantSettings>): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});
        this._globalListeners.add(listener);
        return toDisposable(() => {
            this._globalListeners.delete(listener);
        });
    }

    /** 注册指定键名的细粒度监听器 */
    public subscribeKey<K extends keyof DrawAssistantSettings>(
        key: K,
        listener: KeyListener<DrawAssistantSettings[K]>
    ): IDisposable {
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

    /** 安排防抖保存 */
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
                    this._logger.error('防抖保存失败', err);
                }
            }
        }, this._debounceMs);
    }

    /** 立即执行尚未写入的保存任务 */
    public flush(): void {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }
        if (this._saveHandler && !this._isDisposed) {
            try {
                this._saveHandler(this._state);
            } catch (err) {
                this._logger.error('立即保存失败', err);
            }
        }
    }

    /** 导出当前完整设置为 JSON 文本 (用于用户本地备份与分享) */
    public exportJson(): string {
        return JSON.stringify(this._state, null, 2);
    }

    /**
     * 从 JSON 文本解析并合并导入设置
     *
     * @param jsonText JSON 文本
     * @returns 导入是否成功
     */
    public importJson(jsonText: string): boolean {
        try {
            const parsed = JSON.parse(jsonText);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('无效的配置 JSON 对象');
            }
            const merged = mergeSettingsWithDefaults(parsed, this._state);
            this.update(merged);
            return true;
        } catch (err) {
            this._logger.error('导入配置 JSON 失败', err);
            return false;
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
