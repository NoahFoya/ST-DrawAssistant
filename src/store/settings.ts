/**
 * 插件全局配置状态管理
 *
 * 功能：
 * 1. 维护 ExtensionSettings 运行时状态树与内存缓存；
 * 2. 处理默认配置自描述深合并与脏字段清洗过滤；
 * 3. 提供深层配置键精确监听与防抖自动持久化。
 *
 * Tips：
 * 1. I/O 缓冲：配置变更默认经过防抖异步写入宿主存储，避免高频修改导致 I/O 拥塞；
 * 2. 敏感凭据脱敏：在导出配置时自动过滤 apiKey、token、secret 等敏感字段。
 */

import type { ExtensionSettings } from '@types';
import type { IDisposable } from '@util/event-bus';
import type { DebouncedFunction } from '@util/async';
import { deepMerge, deepClone, isPlainObject } from '@util/object';
import { debounce } from '@util/async';
import { MODULE_NAME, DEFAULT_SAVE_DEBOUNCE_MS } from '../constants';
import defaultSettingsJson from '@config/default-settings.json';

/** 键变更监听回调函数类型 */
export type KeyChangeListener<V> = (newValue: V, oldValue: V) => void;

/**
 * 判断配置键名是否属于敏感 API 凭据字段
 * 导出配置时剔除敏感凭据字段，避免配置分享或备份时外泄私有密钥。
 */
export function isSensitiveKey(keyName: string): boolean {
    const lower = keyName.toLowerCase();
    return (
        lower === 'apikey' ||
        lower === 'api_key' ||
        lower.endsWith('apikey') ||
        lower.endsWith('api_key') ||
        lower === 'token' ||
        lower === 'secret'
    );
}

/** 插件出厂默认初始配置快照 */
export const DEFAULT_SETTINGS: ExtensionSettings = deepClone(defaultSettingsJson as unknown as ExtensionSettings);

/**
 * 校验并清洗外部传入的原始配置对象，阻断非法脏属性注入
 */
export function cleanRawSettings(raw: Record<string, any>): Record<string, any> {
    if (!isPlainObject(raw)) {
        return {};
    }
    const cleaned = { ...raw };
    if (cleaned.engines !== undefined && !isPlainObject(cleaned.engines)) {
        cleaned.engines = {};
    }
    // 剔除可能存在的历史废弃或非法字段
    delete cleaned.extensions;
    delete cleaned.uiPreferences;
    delete cleaned.customData;
    return cleaned;
}

/**
 * 合并用户既有配置与当前默认配置
 * 在补充版本升级新增配置项的同时保留已保存的用户自定义值。
 */
export function mergeSettingsWithDefaults(
    userSettings: unknown,
    defaults: ExtensionSettings = DEFAULT_SETTINGS
): ExtensionSettings {
    const baseDefaults = deepClone(defaults);
    if (!userSettings || typeof userSettings !== 'object') {
        return baseDefaults;
    }

    const raw = cleanRawSettings(userSettings as Record<string, any>);
    const merged = deepMerge(baseDefaults, raw) as ExtensionSettings;

    if (isPlainObject(raw.engines)) {
        merged.engines = deepMerge(baseDefaults.engines, raw.engines);
    }

    return merged;
}

/** 递归脱敏配置树中的敏感凭据 */
function sanitizeSensitiveFields(target: Record<string, any>): void {
    for (const key of Object.keys(target)) {
        const val = target[key];
        if (isSensitiveKey(key) && typeof val === 'string') {
            target[key] = '';
        } else if (isPlainObject(val)) {
            sanitizeSensitiveFields(val);
        }
    }
}

/** 设置管理实例构造参数 */
export interface SettingsStoreOptions {
    defaultSettings?: ExtensionSettings;
    hostSettingsProvider?: () => Record<string, any> | undefined;
    saveDebouncedProvider?: () => void;
    debounceMs?: number;
}

export class SettingsStore implements IDisposable {
    private _state: ExtensionSettings;
    private readonly _defaultSettings: ExtensionSettings;
    private readonly _hostSettingsProvider?: () => Record<string, any> | undefined;
    private readonly _saveDebouncedProvider?: () => void;
    private readonly _keyListeners = new Map<string, Set<KeyChangeListener<any>>>();
    private readonly _debouncedSave: DebouncedFunction<() => void>;
    private _isDisposed = false;

    constructor(options?: SettingsStoreOptions) {
        this._defaultSettings = options?.defaultSettings ? deepClone(options.defaultSettings) : DEFAULT_SETTINGS;
        this._hostSettingsProvider = options?.hostSettingsProvider;
        this._saveDebouncedProvider = options?.saveDebouncedProvider;

        // 初始化当前配置：若提供了宿主配置源则合并宿主配置，否则采用默认配置
        const hostRaw = this._getHostRawSettings();
        this._state = hostRaw
            ? mergeSettingsWithDefaults(hostRaw, this._defaultSettings)
            : deepClone(this._defaultSettings);

        const debounceMs = options?.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
        this._debouncedSave = debounce(() => {
            this._triggerHostSave();
        }, debounceMs);
    }

    /** 读取宿主原始配置引用 */
    private _getHostRawSettings(): Record<string, any> | undefined {
        if (this._hostSettingsProvider) {
            return this._hostSettingsProvider();
        }
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            const ctx = window.SillyTavern.getContext();
            if (ctx.extensionSettings) {
                return ctx.extensionSettings[MODULE_NAME] as Record<string, any> | undefined;
            }
        }
        return undefined;
    }

    /** 同步更新宿主中的配置对象引用 */
    private _syncToHostDirect(): void {
        if (this._hostSettingsProvider) {
            const target = this._hostSettingsProvider();
            if (target && typeof target === 'object') {
                Object.assign(target, this._state);
            }
            return;
        }
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            const ctx = window.SillyTavern.getContext();
            if (ctx.extensionSettings) {
                ctx.extensionSettings[MODULE_NAME] = this._state;
            }
        }
    }

    /** 触发宿主防抖持久化 */
    private _triggerHostSave(): void {
        if (this._isDisposed) return;
        this._syncToHostDirect();

        if (this._saveDebouncedProvider) {
            this._saveDebouncedProvider();
            return;
        }
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            const ctx = window.SillyTavern.getContext();
            if (typeof ctx.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
            }
        }
    }

    /**
     * 获取完整配置状态快照（只读浅拷贝）
     */
    public getState(): Readonly<ExtensionSettings> {
        return this._state;
    }

    /**
     * 获取单个配置键的值
     */
    public get<K extends keyof ExtensionSettings>(key: K): ExtensionSettings[K] {
        return this._state[key];
    }

    /**
     * 设置单个配置键的值，并通知监听器
     */
    public set<K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]): void {
        if (this._isDisposed) return;

        const oldValue = this._state[key];
        if (oldValue === value) return;

        this._state[key] = value;
        this._notifyKeyChange(key as string, value, oldValue);
        this._debouncedSave();
    }

    /**
     * 批量更新配置项
     */
    public update(partial: Partial<ExtensionSettings>): void {
        if (this._isDisposed || !isPlainObject(partial)) return;

        let hasChanges = false;
        for (const [k, newVal] of Object.entries(partial)) {
            const key = k as keyof ExtensionSettings;
            const oldVal = this._state[key];
            if (oldVal !== newVal) {
                (this._state as Record<string, any>)[k] = newVal;
                this._notifyKeyChange(k, newVal, oldVal);
                hasChanges = true;
            }
        }

        if (hasChanges) {
            this._debouncedSave();
        }
    }

    /**
     * 注册细粒度键变更监听
     */
    public onKeyChange<K extends keyof ExtensionSettings>(
        key: K,
        listener: KeyChangeListener<ExtensionSettings[K]>
    ): IDisposable {
        const keyStr = key as string;
        if (!this._keyListeners.has(keyStr)) {
            this._keyListeners.set(keyStr, new Set());
        }
        const set = this._keyListeners.get(keyStr)!;
        set.add(listener);

        return {
            dispose: () => {
                set.delete(listener);
                if (set.size === 0) {
                    this._keyListeners.delete(keyStr);
                }
            }
        };
    }

    /** 通知特定键的变更监听器，单监听器异常隔离保护 */
    private _notifyKeyChange(key: string, newVal: any, oldVal: any): void {
        const listeners = this._keyListeners.get(key);
        if (!listeners || listeners.size === 0) return;

        for (const listener of Array.from(listeners)) {
            try {
                listener(newVal, oldVal);
            } catch {
                // 异常隔离：避免单个 UI 监听器执行错误影响主流程
            }
        }
    }

    /**
     * 立即将未持久化的配置同步并强制持久化
     * 模态框关闭或插件注销前调用，保证内存状态即时持久化到磁盘。
     */
    public flush(): void {
        if (this._isDisposed) return;
        this._debouncedSave.flush();
    }

    /**
     * 导出配置为 JSON 字符串
     * @param includeSensitive 是否包含敏感凭据 (默认 false 进行安全脱敏)
     */
    public exportSettings(includeSensitive = false): string {
        const cloned = deepClone(this._state);
        if (!includeSensitive) {
            sanitizeSensitiveFields(cloned);
        }
        return JSON.stringify(cloned, null, 2);
    }

    /**
     * 从外部 JSON 字符串安全导入配置
     */
    public importSettings(jsonStr: string): boolean {
        if (this._isDisposed) return false;
        try {
            const parsed = JSON.parse(jsonStr);
            if (!isPlainObject(parsed)) {
                return false;
            }
            this._state = mergeSettingsWithDefaults(parsed, this._defaultSettings);
            this._syncToHostDirect();
            this.flush();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 重置为出厂默认配置
     */
    public resetToDefault(): void {
        if (this._isDisposed) return;
        this._state = deepClone(this._defaultSettings);
        this._syncToHostDirect();
        this.flush();
    }

    /**
     * 销毁实例，清空全部监听并取消待保存任务
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._debouncedSave.cancel();
        this._keyListeners.clear();
    }
}
