/**
 * 插件配置状态中心与持久化存储服务。
 *
 * @remarks
 * 在内存中维护配置状态，管理通用设置、绘图服务提供方私有配置与预设方案。
 * 配置变更通过防抖同步至 SillyTavern 宿主 extensionSettings['ST-DrawAssistant']。
 */

import type {
    ProviderType,
    TransportMode,
    SDWebUIProviderConfig,
    ComfyUIProviderConfig,
    NovelAIProviderConfig,
    OpenAIProviderConfig,
    PresetCategory,
    PresetItem,
    PresetSettings,
    DrawingPresetData,
    PromptPresetData,
    WorkflowPresetData,
    ThemePresetData,
} from '@types';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';
import defaultSettingsData from '../../config/default-settings.json';
import recommendedDrawingData from '../../config/presets/drawing.json';
import recommendedPromptsData from '../../config/presets/prompts.json';
import recommendedWorkflowsData from '../../config/presets/workflows.json';
import recommendedThemesData from '../../config/presets/themes.json';

/** 配置导入结果结构 */
export interface SettingsImportResult {
    readonly success: boolean;
    readonly error?: string;
}

/** 默认单任务超时时间（毫秒） */
export const DEFAULT_TASK_TIMEOUT_MS = 120_000;

/** 默认图像存储格式 */
export const DEFAULT_IMAGE_FORMAT: 'original' | 'webp' | 'png' = 'original';

/** 默认图像压缩质量 */
export const DEFAULT_IMAGE_QUALITY = 0.85;

/** 插件核心配置结构定义 */
export interface DrawAssistantSettings {
    enabled: boolean;
    showHelp: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    taskTimeoutMs: number;
    saveToIndexedDB: boolean;
    saveToServer: boolean;
    embedToBase64: boolean;
    enableThumbnail: boolean;
    maxStoredImages: number;
    imageFormat: 'original' | 'webp' | 'png';
    imageQuality: number;
    autoGenerate: boolean;
    cleanPrompt: boolean;
    placeholderStart: string;
    placeholderEnd: string;
    enabledExtensions: Record<string, boolean>;
    extensionCustomSettings: Record<string, unknown>;
    themePreset: string;
    presets: PresetSettings;
    providers: {
        comfyui: ComfyUIProviderConfig;
        sdwebui: SDWebUIProviderConfig;
        novelai: NovelAIProviderConfig;
        openai: OpenAIProviderConfig;
        [key: string]: unknown;
    };
    ui: {
        trigger: {
            visible: boolean;
            opacity: number;
            icon: string;
            autoSnap: boolean;
        };
        lightbox: {
            enabled: boolean;
        };
        actionPanel: {
            enabled: boolean;
            hideButtonOnDone: boolean;
        };
        imageDisplay: {
            align: string;
            objectFit: string;
            maxHeight: number;
            maxWidthPct: number;
            rounded: boolean;
            autoBlur: boolean;
            collapsed: boolean;
        };
    };
}

/** 递归深度合并两个纯对象 */
function deepMerge<T extends Record<string, any>>(target: T, source?: Partial<T>): T {
    const result = { ...target };
    if (!source || typeof source !== 'object') {
        return result;
    }

    for (const key of Object.keys(source) as (keyof T)[]) {
        const sourceVal = source[key];
        const targetVal = target[key];

        if (
            sourceVal &&
            typeof sourceVal === 'object' &&
            !Array.isArray(sourceVal) &&
            targetVal &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            result[key] = deepMerge(targetVal, sourceVal as any);
        } else if (sourceVal !== undefined) {
            result[key] = sourceVal as any;
        }
    }

    return result;
}

/** 构建包含初始出厂推荐预设的默认配置实例 */
function buildDefaultSettings(): DrawAssistantSettings {
    const base = defaultSettingsData as unknown as DrawAssistantSettings;
    const initialPresets: PresetSettings = {
        drawing: (recommendedDrawingData as unknown as Record<string, PresetItem<DrawingPresetData>[]>) || {
            comfyui: [],
            sdwebui: [],
            novelai: [],
            openai: [],
        },
        prompts: (recommendedPromptsData as unknown as PresetItem<PromptPresetData>[]) || [],
        workflows: (recommendedWorkflowsData as unknown as PresetItem<WorkflowPresetData>[]) || [],
        themes: (recommendedThemesData as unknown as PresetItem<ThemePresetData>[]) || [],
    };

    const mergedDrawing: Record<string, PresetItem<DrawingPresetData>[]> = { ...initialPresets.drawing };
    if (base.presets?.drawing) {
        for (const [providerKey, list] of Object.entries(base.presets.drawing)) {
            if (Array.isArray(list) && list.length > 0) {
                mergedDrawing[providerKey] = list;
            }
        }
    }

    return {
        ...base,
        presets: {
            drawing: mergedDrawing,
            prompts: base.presets?.prompts?.length ? base.presets.prompts : initialPresets.prompts,
            workflows: base.presets?.workflows?.length ? base.presets.workflows : initialPresets.workflows,
            themes: base.presets?.themes?.length ? base.presets.themes : initialPresets.themes,
        },
    };
}

/**
 * 插件配置状态中心类。
 */
export class SettingsStore {
    /** 插件标识，与 manifest.json 一致 */
    public static readonly EXTENSION_NAME = 'ST-DrawAssistant';
    /** 敏感配置字段键名匹配规则 */
    private static readonly SECRET_FIELD_PATTERN = /^(?:apiKey|secret|token|password)$/i;

    private _settings: DrawAssistantSettings;
    private readonly _subscribers = new Map<string, Set<(val: any) => void>>();

    public constructor(initialData?: Partial<DrawAssistantSettings>) {
        const baseDefaults = buildDefaultSettings();
        this._settings = deepMerge(baseDefaults, initialData);
    }

    /**
     * 从宿主环境初始化配置数据。
     *
     * @remarks
     * 读取 hostContext.extensionSettings['ST-DrawAssistant'] 并与内置默认配置深合并。
     */
    public initializeFromHost(): void {
        const hostContext = window.SillyTavern?.getContext?.();
        const rawSettings = hostContext?.extensionSettings?.[SettingsStore.EXTENSION_NAME];

        if (rawSettings && typeof rawSettings === 'object') {
            this._settings = deepMerge(this._settings, rawSettings);
        }
    }

    /** 获取当前完整配置对象，通过 Readonly 类型保护防止外部直接修改 */
    public getAll(): Readonly<DrawAssistantSettings> {
        return this._settings;
    }

    /** getAll 的别名方法，获取当前完整配置对象 */
    public getSettings(): Readonly<DrawAssistantSettings> {
        return this._settings;
    }

    /**
     * 读取指定配置项的值。
     * @param key 根级配置键名
     */
    public get<K extends keyof DrawAssistantSettings>(key: K): DrawAssistantSettings[K] {
        return this._settings[key];
    }

    /**
     * 更新单个根级配置项的值。
     * @param key 根级配置键名
     * @param value 新值
     */
    public set<K extends keyof DrawAssistantSettings>(key: K, value: DrawAssistantSettings[K]): void {
        if (this._settings[key] === value) {
            return;
        }

        this._settings = {
            ...this._settings,
            [key]: value,
        };

        this._notifySubscribers(String(key), value);
        eventBus.emit('settings:updated', { key: String(key), value });
        this.saveToHost();
    }

    /**
     * 批量合并更新配置。
     * @param patch 待合并的部分配置对象
     */
    public update(patch: Partial<DrawAssistantSettings>): void {
        this._settings = deepMerge(this._settings, patch);

        for (const [k, v] of Object.entries(patch)) {
            this._notifySubscribers(k, v);
        }

        eventBus.emit('settings:updated', {});
        this.saveToHost();
    }

    /**
     * 读取指定绘图服务提供方的私有配置对象。
     * @param type 绘图服务提供方类型标识
     */
    public getProviderConfig<T = Record<string, unknown>>(type: ProviderType): T | undefined {
        const providers = this._settings.providers as Record<string, unknown> | undefined;
        return providers?.[type] as T | undefined;
    }

    /**
     * 更新指定绘图服务提供方的私有配置。
     * @param type 绘图服务提供方类型标识
     * @param patch 待更新的私有配置子集
     */
    public setProviderConfig<T = Record<string, unknown>>(type: ProviderType, patch: Partial<T>): void {
        const current = (this.getProviderConfig<T>(type) || {}) as T;
        const updated: T = {
            ...current,
            ...patch,
        };

        this._settings = {
            ...this._settings,
            providers: {
                ...this._settings.providers,
                [type]: updated,
            },
        };

        this._notifySubscribers(`providers.${type}`, updated);
        eventBus.emit('settings:updated', { key: `providers.${type}`, value: updated });
        this.saveToHost();
    }

    /**
     * 获取指定分类下的预设方案列表。
     *
     * @param category 预设分类 (drawing | prompts | workflows | themes)
     * @param providerType 若为 drawing 分类，指定所属绘图服务提供方；缺省使用当前激活提供方
     * @returns 预设条目数组
     */
    public getPresets<T = Record<string, unknown>>(category: PresetCategory, providerType?: string): PresetItem<T>[] {
        if (category === 'drawing') {
            const providerKey = providerType || this._settings.activeProvider;
            const drawingMap = this._settings.presets.drawing || {};
            return (drawingMap[providerKey] || []) as PresetItem<T>[];
        }

        return (this._settings.presets[category] || []) as PresetItem<T>[];
    }

    /**
     * 根据 ID 检索指定分类中的单一预设方案。
     *
     * @param category 预设分类
     * @param id 预设方案唯一标识符
     * @param providerType 绘图服务提供方类型 (针对 drawing 分类)
     */
    public getPreset<T = Record<string, unknown>>(
        category: PresetCategory,
        id: string,
        providerType?: string
    ): PresetItem<T> | undefined {
        return this.getPresets<T>(category, providerType).find((item) => item.id === id);
    }

    /**
     * 保存预设方案。
     *
     * @remarks
     * 若已存在同 ID 预设则更新现有条目，不存在则追加至列表末尾。
     *
     * @param category 预设分类
     * @param item 预设条目对象
     * @param providerType 绘图服务提供方类型 (针对 drawing 分类)
     */
    public savePreset<T = Record<string, unknown>>(
        category: PresetCategory,
        item: PresetItem<T>,
        providerType?: string
    ): void {
        const timestampedItem: PresetItem<T> = {
            ...item,
            updatedAt: item.updatedAt || Date.now(),
        };

        if (category === 'drawing') {
            const providerKey = providerType || this._settings.activeProvider;
            const currentList = this.getPresets<T>('drawing', providerKey);
            const index = currentList.findIndex((p) => p.id === item.id);
            const nextList = [...currentList];

            if (index >= 0) {
                nextList[index] = timestampedItem;
            } else {
                nextList.push(timestampedItem);
            }

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    drawing: {
                        ...this._settings.presets.drawing,
                        [providerKey]: nextList as any,
                    },
                },
            };
        } else {
            const currentList = this.getPresets<T>(category);
            const index = currentList.findIndex((p) => p.id === item.id);
            const nextList = [...currentList];

            if (index >= 0) {
                nextList[index] = timestampedItem;
            } else {
                nextList.push(timestampedItem);
            }

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    [category]: nextList as any,
                },
            };
        }

        this._notifySubscribers(`presets.${category}`, item);
        eventBus.emit('settings:updated', { key: `presets.${category}`, value: item });
        this.saveToHost();
    }

    /**
     * 删除指定预设方案。
     *
     * @param category 预设分类
     * @param id 待删除的预设方案 ID
     * @param providerType 绘图服务提供方类型 (针对 drawing 分类)
     * @returns 是否成功找到并删除
     */
    public deletePreset(category: PresetCategory, id: string, providerType?: string): boolean {
        if (category === 'drawing') {
            const providerKey = providerType || this._settings.activeProvider;
            const currentList = this.getPresets('drawing', providerKey);
            const nextList = currentList.filter((p) => p.id !== id);

            if (nextList.length === currentList.length) {
                return false;
            }

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    drawing: {
                        ...this._settings.presets.drawing,
                        [providerKey]: nextList as any,
                    },
                },
            };
        } else {
            const currentList = this.getPresets(category);
            const nextList = currentList.filter((p) => p.id !== id);

            if (nextList.length === currentList.length) {
                return false;
            }

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    [category]: nextList as any,
                },
            };
        }

        this._notifySubscribers(`presets.${category}`, { deletedId: id });
        eventBus.emit('settings:updated', { key: `presets.${category}`, value: { deletedId: id } });
        this.saveToHost();
        return true;
    }

    /**
     * 恢复出厂推荐预设方案。
     *
     * @remarks
     * 从静态推荐方案中重新填充至预设池。若当前已存在同 ID 预设，则重置为推荐参数；若不存在则追加。
     *
     * @param category 指定恢复的分类，缺省恢复全部分类
     * @param providerType 绘图服务提供方类型 (针对 drawing 分类)
     */
    public restoreRecommendedPresets(category?: PresetCategory, providerType?: string): void {
        const restoreDrawing = (pKey: string) => {
            const recommended = (recommendedDrawingData as Record<string, PresetItem<DrawingPresetData>[]>)[pKey] || [];
            for (const item of recommended) {
                this.savePreset('drawing', item, pKey);
            }
        };

        if (!category || category === 'drawing') {
            if (providerType) {
                restoreDrawing(providerType);
            } else {
                for (const pKey of Object.keys(recommendedDrawingData)) {
                    restoreDrawing(pKey);
                }
            }
        }

        if (!category || category === 'prompts') {
            const recommended = recommendedPromptsData as unknown as PresetItem<PromptPresetData>[];
            for (const item of recommended) {
                this.savePreset('prompts', item);
            }
        }

        if (!category || category === 'workflows') {
            const recommended = recommendedWorkflowsData as unknown as PresetItem<WorkflowPresetData>[];
            for (const item of recommended) {
                this.savePreset('workflows', item);
            }
        }

        if (!category || category === 'themes') {
            const recommended = recommendedThemesData as unknown as PresetItem<ThemePresetData>[];
            for (const item of recommended) {
                this.savePreset('themes', item);
            }
        }
    }

    /** restoreRecommendedPresets 的别名方法，恢复出厂推荐预设方案 */
    public restoreDefaultPresets(category?: PresetCategory, providerType?: string): void {
        this.restoreRecommendedPresets(category, providerType);
    }

    /**
     * 订阅特定键名的配置项变更。
     * @param key 配置键名
     * @param callback 变更触发回调函数
     * @returns 注销监听函数
     */
    public onSettingChange<T = unknown>(key: string, callback: (value: T) => void): () => void {
        let set = this._subscribers.get(key);
        if (!set) {
            set = new Set();
            this._subscribers.set(key, set);
        }
        set.add(callback);

        return () => {
            set?.delete(callback);
            if (set?.size === 0) {
                this._subscribers.delete(key);
            }
        };
    }

    /**
     * 将当前内存配置持久化同步至 SillyTavern 宿主。
     */
    public saveToHost(): void {
        const hostContext = window.SillyTavern?.getContext?.();
        if (hostContext?.extensionSettings) {
            hostContext.extensionSettings[SettingsStore.EXTENSION_NAME] = { ...this._settings };
        }

        // 调用宿主防抖持久化接口
        if (typeof hostContext?.saveSettingsDebounced === 'function') {
            try {
                hostContext.saveSettingsDebounced();
            } catch (err) {
                logger.error('调用宿主 saveSettingsDebounced 异常:', err);
            }
        }
    }

    /**
     * 导出配置为 JSON 字符串。
     * @param includeSecrets 是否包含 API Key 等私密字段，默认 false 执行脱敏
     */
    public exportSettings(includeSecrets = false): string {
        const cloned: DrawAssistantSettings = JSON.parse(JSON.stringify(this._settings));

        if (!includeSecrets && cloned.providers && typeof cloned.providers === 'object') {
            for (const [providerKey, providerCfg] of Object.entries(cloned.providers)) {
                if (providerCfg && typeof providerCfg === 'object' && !Array.isArray(providerCfg)) {
                    const sanitized: Record<string, unknown> = { ...(providerCfg as Record<string, unknown>) };
                    for (const field of Object.keys(sanitized)) {
                        if (SettingsStore.SECRET_FIELD_PATTERN.test(field) && typeof sanitized[field] === 'string') {
                            sanitized[field] = '';
                        }
                    }
                    (cloned.providers as Record<string, unknown>)[providerKey] = sanitized;
                }
            }
        }

        return JSON.stringify(cloned, null, 2);
    }

    /**
     * 导入并应用外部配置 JSON 文本。
     * @param jsonString 配置 JSON 字符串
     * @returns 导入操作结果结构，包含成功标志或具体错误信息
     */
    public importSettings(jsonString: string): SettingsImportResult {
        if (!jsonString || typeof jsonString !== 'string') {
            logger.error('导入配置失败: 传入的 JSON 字符串为空');
            return { success: false, error: '配置内容不能为空' };
        }

        try {
            const parsed = JSON.parse(jsonString);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                logger.error('导入配置失败: JSON 解析结果不是合法的键值对象');
                return { success: false, error: '配置格式必须为 JSON 对象' };
            }

            this.update(parsed);
            return { success: true };
        } catch (err: any) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('导入配置发生 JSON 解析异常:', err);
            return { success: false, error: `JSON 解析失败: ${message}` };
        }
    }

    /**
     * 恢复所有设置为内置默认值。
     */
    public resetToDefaults(): void {
        const baseDefaults = buildDefaultSettings();
        this._settings = JSON.parse(JSON.stringify(baseDefaults));

        for (const [key, val] of Object.entries(this._settings)) {
            this._notifySubscribers(key, val);
        }

        eventBus.emit('settings:updated', {});
        this.saveToHost();
    }

    private _notifySubscribers(key: string, value: unknown): void {
        const set = this._subscribers.get(key);
        if (!set) {
            return;
        }

        for (const callback of Array.from(set)) {
            try {
                callback(value);
            } catch (err) {
                logger.error(`字段订阅监听器执行异常 (${key}):`, err);
            }
        }
    }
}

/** 全局默认单例配置中心 */
export const settingsStore = new SettingsStore();
