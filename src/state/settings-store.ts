/**
 * 设置状态管理模块
 * 负责插件全局配置的内存管理、键值变更监听、导出导入脱敏与防抖持久化。
 */

import { IDisposable, toDisposable, DrawAssistantSettings, PresetsArchiveData, PresetItem } from '../types';
import { Logger } from '../utils/logger';
import { DEFAULT_SAVE_DEBOUNCE_MS } from '../constants';
import defaultSettingsJson from '../../config/default-settings.json';

export type StateListener<T> = (state: T, keyPath?: string, oldState?: T) => void;
export type KeyListener<V> = (newValue: V, oldValue: V) => void;

/**
 * 判断键名是否属于敏感 API 密钥字段 (支持常见命名风格通配，用于导出脱敏)
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

/** 插件出厂默认配置 (静态导入自 config/default-settings.json) */
export const DEFAULT_SETTINGS: DrawAssistantSettings = defaultSettingsJson as DrawAssistantSettings;

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
 * 校验并清洗外部配置对象，确保结构合法。
 * 集中校验各引擎配置，确保写入宿主配置的数据轻量且符合类型规范。
 */
export function cleanRawSettings(raw: Record<string, any>): Record<string, any> {
    if (!isPlainObject(raw)) {
        return {};
    }
    const cleaned = { ...raw };
    if (!isPlainObject(cleaned.engineConfigs)) {
        cleaned.engineConfigs = {};
    }
    return cleaned;
}

export const sanitizeAndMigrateSettings = cleanRawSettings;

/**
 * 合并外部配置与默认配置
 */
export function mergeSettingsWithDefaults(
    userSettings: unknown,
    defaults: DrawAssistantSettings = DEFAULT_SETTINGS
): DrawAssistantSettings {
    const baseDefaults = deepClone(defaults);
    if (!userSettings || typeof userSettings !== 'object') {
        return baseDefaults;
    }

    const raw = cleanRawSettings(userSettings as Record<string, any>);

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

    const merged = deepMerge(baseDefaults, raw) as DrawAssistantSettings;

    if (isPlainObject(raw.engineConfigs)) {
        merged.engineConfigs = deepClone(raw.engineConfigs);
    }
    if (isPlainObject(raw.uiPreferences)) {
        merged.uiPreferences = deepClone(raw.uiPreferences);
    }
    if (isPlainObject(raw.extensions)) {
        merged.extensions = deepClone(raw.extensions);
    }
    if (isPlainObject(raw.customData)) {
        merged.customData = deepClone(raw.customData);
    }

    return merged;
}

export interface PluginArchiveData {
    version: 1;
    appName: 'ST-DrawAssistant';
    exportTime: string;
    sanitized: boolean;
    settings: DrawAssistantSettings;
    presets: {
        themes: any[];
        prompts: any[];
        workflows: any[];
        drawing: Record<string, any[]>;
    };
}

/**
 * 递归清除配置对象中的 API Key 与访问令牌
 */
export function sanitizeSettings(settings: DrawAssistantSettings): DrawAssistantSettings {
    const cloned = JSON.parse(JSON.stringify(settings)) as DrawAssistantSettings;
    if (typeof (cloned as any).apiKey === 'string') {
        (cloned as any).apiKey = '';
    }
    if (cloned.engineConfigs && typeof cloned.engineConfigs === 'object') {
        for (const p of Object.keys(cloned.engineConfigs)) {
            const conf = cloned.engineConfigs[p];
            if (conf && typeof conf === 'object') {
                for (const k of Object.keys(conf)) {
                    if (isSensitiveKey(k)) {
                        conf[k] = '';
                    }
                }
                if (conf.providers && typeof conf.providers === 'object') {
                    for (const provKey of Object.keys(conf.providers)) {
                        const provConf = conf.providers[provKey];
                        if (provConf && typeof provConf === 'object' && 'apiKey' in provConf) {
                            provConf.apiKey = '';
                        }
                    }
                }
                if (Array.isArray(conf.channels)) {
                    conf.channels.forEach((ch: any) => {
                        if (ch && typeof ch === 'object' && 'apiKey' in ch) {
                            ch.apiKey = '';
                        }
                    });
                }
            }
        }
    }
    return cloned;
}

/**
 * 设置存储管理类
 * 负责插件配置的状态读取、更新分发与定时保存
 */
export class SettingsStore implements IDisposable {
    private _state: DrawAssistantSettings;
    private _committedState: DrawAssistantSettings;
    private readonly _globalListeners = new Set<StateListener<DrawAssistantSettings>>();
    private readonly _keyListeners = new Map<keyof DrawAssistantSettings, Set<KeyListener<any>>>();
    private readonly _logger = new Logger('SettingsStore');
    private _isDisposed = false;
    private readonly _saveHandler?: (state: DrawAssistantSettings) => void;
    private _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _debounceMs: number;

    public readonly ready: Promise<void>;

    constructor(
        initialSettings?: unknown,
        options?: { onSave?: (state: DrawAssistantSettings) => void; debounceMs?: number }
    ) {
        this._state = mergeSettingsWithDefaults(initialSettings, DEFAULT_SETTINGS);
        this._committedState = deepClone(this._state);
        this._saveHandler = options?.onSave;
        this._debounceMs = options?.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;

        this.ready = Promise.resolve();
    }

    /** 将当前内存状态固化为提交基准快照 */
    public commit(): void {
        this._committedState = deepClone(this._state);
    }

    /** 还原为上一个提交基准快照并通知监听器 */
    public rollback(): void {
        if (this._isDisposed) return;
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }

        const oldState = this._state;
        const restoredState = deepClone(this._committedState);
        this._state = restoredState;

        const changedKeys: (keyof DrawAssistantSettings)[] = [];
        for (const key of Object.keys(oldState) as (keyof DrawAssistantSettings)[]) {
            if (JSON.stringify(oldState[key]) !== JSON.stringify(restoredState[key])) {
                changedKeys.push(key);
            }
        }

        if (changedKeys.length > 0) {
            this.notifyChanges(oldState, changedKeys);
        }
    }

    /** 获取当前配置快照 */
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

    /** 批量更新配置项 */
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
                        this._logger.error(`配置项变更监听回调执行失败 [${String(key)}]`, err);
                    }
                }
            }
        }

        for (const listener of Array.from(this._globalListeners)) {
            try {
                listener(this._state, singleKeyPath, oldState);
            } catch (err) {
                this._logger.error('全局配置变更回调执行失败', err);
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
            [provider]: isPlainObject(config) ? { ...config } : {}
        };
        this.set('engineConfigs', nextEngineConfigs);
    }

    /** 获取指定分类下的预设列表 */
    public getPresets<T = any>(category: string, subCategory?: string): PresetItem<T>[] {
        const allPresets = this._state.presets;
        if (!allPresets) return [];
        if (category === 'themes') return deepClone(allPresets.themes || []) as PresetItem<T>[];
        if (category === 'prompts') return deepClone(allPresets.prompts || []) as PresetItem<T>[];
        if (category === 'workflows') return deepClone(allPresets.workflows || []) as PresetItem<T>[];
        if (category === 'drawing' && subCategory) {
            return deepClone(allPresets.drawing?.[subCategory] || []) as PresetItem<T>[];
        }
        return [];
    }

    /** 获取单个预设详情 */
    public getPreset<T = any>(category: string, id: string, subCategory?: string): PresetItem<T> | null {
        const list = this.getPresets<T>(category, subCategory);
        return list.find(item => item.id === id) || null;
    }

    /** 保存或新增单个预设方案并持久化 */
    public savePreset<T = any>(
        category: string,
        item: { id: string; name: string; data?: T; isBuiltin?: boolean },
        subCategory?: string
    ): boolean {
        if (this._isDisposed) return false;
        const currentPresets = deepClone(this._state.presets || { themes: [], prompts: [], workflows: [], drawing: {} });
        const toSave: PresetItem<T> = {
            id: item.id,
            name: item.name,
            data: item.data ? deepClone(item.data) : undefined,
            isBuiltin: Boolean(item.isBuiltin)
        };

        const updateList = (list: PresetItem<T>[]): PresetItem<T>[] => {
            const idx = list.findIndex(p => p.id === item.id);
            if (idx >= 0) {
                const next = [...list];
                next[idx] = toSave;
                return next;
            }
            return [...list, toSave];
        };

        if (category === 'themes') {
            currentPresets.themes = updateList(currentPresets.themes);
        } else if (category === 'prompts') {
            currentPresets.prompts = updateList(currentPresets.prompts);
        } else if (category === 'workflows') {
            currentPresets.workflows = updateList(currentPresets.workflows);
        } else if (category === 'drawing' && subCategory) {
            currentPresets.drawing = currentPresets.drawing || {};
            currentPresets.drawing[subCategory] = updateList(currentPresets.drawing[subCategory] || []);
        } else {
            return false;
        }

        this.set('presets', currentPresets);
        return true;
    }

    /** 删除指定预设方案并持久化 */
    public deletePreset(category: string, id: string, subCategory?: string): boolean {
        if (this._isDisposed) return false;
        const currentPresets = deepClone(this._state.presets || { themes: [], prompts: [], workflows: [], drawing: {} });

        if (category === 'themes') {
            currentPresets.themes = (currentPresets.themes || []).filter(p => p.id !== id);
        } else if (category === 'prompts') {
            currentPresets.prompts = (currentPresets.prompts || []).filter(p => p.id !== id);
        } else if (category === 'workflows') {
            currentPresets.workflows = (currentPresets.workflows || []).filter(p => p.id !== id);
        } else if (category === 'drawing' && subCategory) {
            if (currentPresets.drawing && currentPresets.drawing[subCategory]) {
                currentPresets.drawing[subCategory] = currentPresets.drawing[subCategory].filter(p => p.id !== id);
            }
        } else {
            return false;
        }

        this.set('presets', currentPresets);
        return true;
    }

    /** 导出全量预设方案归档 */
    public exportPresetsArchive(): PresetsArchiveData {
        return deepClone(this._state.presets || { themes: [], prompts: [], workflows: [], drawing: {} });
    }

    /** 导入批量预设方案归档 */
    public importPresetsArchive(archive: any): { success: boolean; importedCount: number; error?: string } {
        if (!archive || typeof archive !== 'object') {
            return { success: false, importedCount: 0, error: '无效的预设归档数据' };
        }
        let count = 0;
        const current = deepClone(this._state.presets || { themes: [], prompts: [], workflows: [], drawing: {} });

        const mergeList = (targetList: PresetItem[], incomingList: any[]): PresetItem[] => {
            const next = [...targetList];
            for (const item of incomingList) {
                if (item?.id && item?.name) {
                    const idx = next.findIndex(p => p.id === item.id);
                    if (idx >= 0) {
                        next[idx] = deepClone(item);
                    } else {
                        next.push(deepClone(item));
                    }
                    count++;
                }
            }
            return next;
        };

        if (Array.isArray(archive.themes)) {
            current.themes = mergeList(current.themes || [], archive.themes);
        }
        if (Array.isArray(archive.prompts)) {
            current.prompts = mergeList(current.prompts || [], archive.prompts);
        }
        if (Array.isArray(archive.workflows)) {
            current.workflows = mergeList(current.workflows || [], archive.workflows);
        }
        if (archive.drawing && typeof archive.drawing === 'object') {
            current.drawing = current.drawing || {};
            for (const [engine, list] of Object.entries(archive.drawing)) {
                if (Array.isArray(list)) {
                    current.drawing[engine] = mergeList(current.drawing[engine] || [], list);
                }
            }
        }

        this.set('presets', current);
        return { success: true, importedCount: count };
    }

    /** 恢复出厂默认预设方案 */
    public resetPresets(): { success: boolean; error?: string } {
        const defaultPresets = deepClone(DEFAULT_SETTINGS.presets);
        this.set('presets', defaultPresets);
        return { success: true };
    }

    /**
     * 补齐驱动的默认配置
     * 仅在内存中填补缺失字段，不触发持久化，避免覆盖用户既有配置
     */
    public registerEngineDefaults(provider: string, defaults: Record<string, unknown>): void {
        const current = this._state.engineConfigs[provider];
        if (!current || Object.keys(current).length === 0) {
            this._state = {
                ...this._state,
                engineConfigs: {
                    ...this._state.engineConfigs,
                    [provider]: deepClone(defaults)
                }
            };
        } else {
            this._state = {
                ...this._state,
                engineConfigs: {
                    ...this._state.engineConfigs,
                    [provider]: { ...deepClone(defaults), ...current }
                }
            };
        }
    }

    /** 注册全局配置变更监听器 */
    public subscribe(listener: StateListener<DrawAssistantSettings>): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});
        this._globalListeners.add(listener);
        return toDisposable(() => {
            this._globalListeners.delete(listener);
        });
    }

    /** 注册指定键名的监听器 */
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

    private scheduleSave(): void {
        if (!this._saveHandler) return;

        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }

        this._saveDebounceTimer = setTimeout(() => {
            const handler = this._saveHandler;
            const state = this._state;
            if (!handler) return;
            try {
                handler(state);
            } catch (err) {
                this._logger.error('配置防抖持久化保存失败', err);
            }
        }, this._debounceMs);
    }

    /** 立即执行防抖中的持久化任务 */
    public flush(): void {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }

        const handler = this._saveHandler;
        const state = this._state;
        if (!handler) return;
        try {
            handler(state);
        } catch (err) {
            this._logger.error('配置立即持久化保存失败', err);
        }
    }

    /** 导出当前完整设置为 JSON 字符串 */
    public exportJson(sanitize = false): string {
        const data = sanitize ? sanitizeSettings(this._state) : JSON.parse(JSON.stringify(this._state));
        return JSON.stringify(data, null, 2);
    }

    /** 生成符合导出版式的归档对象 */
    public buildArchive(
        presetsData?: PluginArchiveData['presets'] | null,
        sanitize = false
    ): PluginArchiveData {
        const rawSettings = sanitize ? sanitizeSettings(this._state) : deepClone(this._state);

        const presets = presetsData || {
            themes: [],
            prompts: [],
            workflows: [],
            drawing: {}
        };

        return {
            version: 1,
            appName: 'ST-DrawAssistant',
            exportTime: new Date().toISOString(),
            sanitized: sanitize,
            settings: rawSettings,
            presets: deepClone(presets)
        };
    }

    /** 严格校验归档 JSON 数据结构 */
    public validateArchive(raw: unknown): { valid: boolean; error?: string; data?: PluginArchiveData } {
        if (!raw || typeof raw !== 'object') {
            return { valid: false, error: '导入数据必须为有效的 JSON 对象' };
        }

        const candidate = raw as Record<string, any>;
        if (candidate.appName !== 'ST-DrawAssistant') {
            return { valid: false, error: '非 ST-DrawAssistant 插件配置文件，无法导入' };
        }

        if (candidate.version !== 1) {
            return { valid: false, error: `不支持的归档版本: ${candidate.version}，仅支持标准 v1 归档` };
        }

        if (!candidate.settings || typeof candidate.settings !== 'object') {
            return { valid: false, error: '归档包中缺少必要的主配置 (settings) 数据' };
        }

        if (!candidate.presets || typeof candidate.presets !== 'object') {
            return { valid: false, error: '归档包中缺少必要的预设方案 (presets) 数据' };
        }

        return { valid: true, data: candidate as PluginArchiveData };
    }

    /** 加载外部设置并派发变更通知 */
    public async loadSettings(settings: unknown): Promise<void> {
        if (this._isDisposed || !settings) return;

        const merged = mergeSettingsWithDefaults(settings, this._state);
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

    /** 从 JSON 文本解析并合并导入设置 */
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
        void this.flush();
        this._isDisposed = true;
        this._globalListeners.clear();
        this._keyListeners.clear();
    }
}
