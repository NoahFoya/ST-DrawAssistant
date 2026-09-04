/**
 * @module core/config/config-store
 * @description 配置管理中心与深度合并服务
 */

import { IDisposable, toDisposable, DrawAssistantSettings } from '../types';
import { Logger } from '../logger';
import { DEFAULT_SAVE_DEBOUNCE_MS, BUILTIN_THEMES, BUILTIN_THEME_DARK } from '../constants';
import { encryptCredential, decryptCredential } from '../crypto';

export type StateListener<T> = (state: T, keyPath?: string, oldState?: T) => void;
export type KeyListener<V> = (newValue: V, oldValue: V) => void;

/** 判断键名是否属于敏感 API 密钥字段 (支持常见命名风格通配) */
function isSensitiveKey(keyName: string): boolean {
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

/** 遍历并转换配置中的敏感凭据 */
async function mapSensitiveCredentials(
    settings: DrawAssistantSettings,
    transform: (value: string) => Promise<string>
): Promise<{ result: DrawAssistantSettings; modified: boolean }> {
    if (!settings.engineConfigs || typeof settings.engineConfigs !== 'object') {
        return { result: settings, modified: false };
    }

    let modified = false;
    const cloned = JSON.parse(JSON.stringify(settings));

    for (const provider of Object.keys(cloned.engineConfigs)) {
        const cfg = cloned.engineConfigs[provider];
        if (cfg && typeof cfg === 'object') {
            for (const k of Object.keys(cfg)) {
                if (isSensitiveKey(k) && typeof cfg[k] === 'string' && cfg[k]) {
                    const original = cfg[k];
                    const transformed = await transform(original);
                    if (transformed !== original) {
                        cfg[k] = transformed;
                        modified = true;
                    }
                }
            }
        }
    }

    return { result: modified ? cloned : settings, modified };
}

/** 遍历并加密配置中的敏感凭据 */
export async function encryptSettingsCredentials(settings: DrawAssistantSettings): Promise<DrawAssistantSettings> {
    const { result } = await mapSensitiveCredentials(settings, (val) => {
        return val.startsWith('enc:v1:') ? Promise.resolve(val) : encryptCredential(val);
    });
    return result;
}

/** 遍历并解密配置中的密文凭据 */
export async function decryptSettingsCredentials(settings: DrawAssistantSettings): Promise<DrawAssistantSettings> {
    const { result } = await mapSensitiveCredentials(settings, (val) => {
        return val.startsWith('enc:v1:') ? decryptCredential(val) : Promise.resolve(val);
    });
    return result;
}

function hasSensitiveCredentials(settings: DrawAssistantSettings): boolean {
    if (!settings.engineConfigs || typeof settings.engineConfigs !== 'object') return false;
    for (const p of Object.keys(settings.engineConfigs)) {
        const cfg = settings.engineConfigs[p];
        if (cfg && typeof cfg === 'object') {
            for (const k of Object.keys(cfg)) {
                if (isSensitiveKey(k) && typeof cfg[k] === 'string' && cfg[k] && !cfg[k].startsWith('enc:v1:')) {
                    return true;
                }
            }
        }
    }
    return false;
}

function hasEncryptedCredentials(settings: DrawAssistantSettings): boolean {
    if (!settings.engineConfigs || typeof settings.engineConfigs !== 'object') return false;
    for (const p of Object.keys(settings.engineConfigs)) {
        const cfg = settings.engineConfigs[p];
        if (cfg && typeof cfg === 'object') {
            for (const k of Object.keys(cfg)) {
                if (isSensitiveKey(k) && typeof cfg[k] === 'string' && cfg[k].startsWith('enc:v1:')) {
                    return true;
                }
            }
        }
    }
    return false;
}

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
    engineConfigs: {},
    uiPreferences: {},
    customData: {}
};

function isPlainObject(item: unknown): item is Record<string, any> {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item));
}

function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
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

    /** 初始配置密文异步解密就绪 Promise */
    public readonly ready: Promise<void>;

    constructor(
        initialSettings?: unknown,
        options?: { onSave?: (state: DrawAssistantSettings) => void; debounceMs?: number }
    ) {
        this._state = mergeSettingsWithDefaults(initialSettings, DEFAULT_SETTINGS);
        this._saveHandler = options?.onSave;
        this._debounceMs = options?.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;

        // 内存中维护解密后的明文凭据供各驱动读取；持久化前自动加密敏感字段
        this.ready = decryptSettingsCredentials(this._state)
            .then((decrypted) => {
                this._state = decrypted;
            })
            .catch((err) => {
                this._logger.warn('初始化解密敏感凭据异常，将保留原值:', err);
            });
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

        this.notifyChanges(oldState, [key], String(key));
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

        this.notifyChanges(oldState, changedKeys);
        this.scheduleSave();
    }

    private notifyChanges(
        oldState: DrawAssistantSettings,
        changedKeys: (keyof DrawAssistantSettings)[],
        singleKeyPath?: string
    ): void {
        for (const key of changedKeys) {
            const handlers = this._keyListeners.get(key);
            if (handlers) {
                const newValue = this._state[key];
                const oldValue = oldState[key];
                for (const h of Array.from(handlers)) {
                    try {
                        h(newValue, oldValue);
                    } catch (err) {
                        this._logger.error(`配置项变更监听执行失败 [${String(key)}]`, err);
                    }
                }
            }
        }

        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, singleKeyPath, oldState);
            } catch (err) {
                this._logger.error('全局配置监听执行失败', err);
            }
        }
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

    /** 安排防抖保存 (持久化保存前自动加密凭据) */
    private scheduleSave(): void {
        if (!this._saveHandler) return;

        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }

        this._saveDebounceTimer = setTimeout(() => {
            const handler = this._saveHandler;
            const state = this._state;
            const logger = this._logger;
            if (!handler) return;

            if (!hasSensitiveCredentials(state)) {
                handler(state);
            } else {
                void encryptSettingsCredentials(state).then((persistable) => {
                    handler(persistable);
                }).catch((err) => {
                    logger.error('防抖保存加密失败', err);
                });
            }
        }, this._debounceMs);
    }

    /** 立即执行尚未写入的保存任务 */
    public flush(): void {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }

        const handler = this._saveHandler;
        const state = this._state;
        const logger = this._logger;
        if (!handler) return;

        if (!hasSensitiveCredentials(state)) {
            handler(state);
        } else {
            void encryptSettingsCredentials(state).then((persistable) => {
                handler(persistable);
            }).catch((err) => {
                logger.error('立即保存失败', err);
            });
        }
    }

    /** 导出当前完整设置为 JSON 文本 (支持脱敏导出与完整导出) */
    public exportJson(sanitize = false): string {
        const cloned = JSON.parse(JSON.stringify(this._state));
        if (sanitize && cloned.engineConfigs && typeof cloned.engineConfigs === 'object') {
            for (const p of Object.keys(cloned.engineConfigs)) {
                if (cloned.engineConfigs[p] && typeof cloned.engineConfigs[p] === 'object') {
                    for (const k of Object.keys(cloned.engineConfigs[p])) {
                        if (isSensitiveKey(k)) {
                            cloned.engineConfigs[p][k] = '';
                        }
                    }
                }
            }
        }
        return JSON.stringify(cloned, null, 2);
    }

    /**
     * 从持久化存储或外部源安全加载设置
     * 自动解密已加密的敏感凭据，确保内存中均为明文，并派发变更通知
     */
    public async loadSettings(settings: unknown): Promise<void> {
        if (this._isDisposed || !settings) return;

        let merged = mergeSettingsWithDefaults(settings, this._state);
        if (hasEncryptedCredentials(merged)) {
            try {
                merged = await decryptSettingsCredentials(merged);
            } catch (err) {
                this._logger.warn('加载设置解密敏感凭据异常，保留原值:', err);
            }
        }

        const oldState = this._state;
        this._state = merged;

        const changedKeys: (keyof DrawAssistantSettings)[] = [];
        for (const [k, v] of Object.entries(this._state)) {
            const key = k as keyof DrawAssistantSettings;
            if (oldState[key] !== v) {
                changedKeys.push(key);
            }
        }

        if (changedKeys.length > 0) {
            this.notifyChanges(oldState, changedKeys);
        }
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
            if (hasEncryptedCredentials(merged)) {
                void decryptSettingsCredentials(merged)
                    .then((decrypted) => {
                        this.update(decrypted);
                    })
                    .catch((err) => {
                        this._logger.warn('导入配置解密敏感凭据异常，保留原值:', err);
                    });
            }
            return true;
        } catch (err) {
            this._logger.error('导入配置 JSON 失败', err);
            return false;
        }
    }

    public dispose(): void {
        if (this._isDisposed) return;
        void this.flush();
        this._isDisposed = true;
        this._globalListeners.clear();
        this._keyListeners.clear();
    }
}
