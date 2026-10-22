/**
 * 插件配置状态中心与持久化存储服务 (SettingsStore)。
 *
 * @remarks
 * 架构规范与数据安全策略：
 * 1. 唯一事实来源 (SSOT)：集中维护插件通用开关、通信通道、当前激活提供方、私有后端配置以及四类预设方案；
 * 2. 深拷贝快照保护：外部读取接口（getSettings/getProviderConfig）均返回 structuredClone 快照，
 *    彻底阻断外部调用方的引用逃逸与私自修改内部状态，确保配置变更必须经由统一变更方法；
 * 3. 宿主防抖持久化：每次状态变更通过 saveToHost 同步至宿主 extensionSettings，并委托 saveSettingsDebounced
 *    防抖写入磁盘，规避高频变更造成的磁盘 I/O 峰值；
 * 4. 敏感凭据防护：导出的 JSON 默认剔除 API Key / Token 等凭据；导入时若外部凭据为空，则主动保留本地已有有效密钥。
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

/** 图像存储格式与画质策略 */
export type ImageStorageQuality = 'original' | 'webp-high' | 'webp-medium';

/** 插件核心配置结构定义 */
export interface DrawAssistantSettings {
    isInitialized: boolean;
    enabled: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    taskTimeoutMs: number;
    cancelOnChatChange: boolean;
    saveToIndexedDB: boolean;
    saveToServer: boolean;
    imageQuality: ImageStorageQuality;
    autoGenerate: boolean;
    cleanPrompt: boolean;
    placeholderStart: string;
    placeholderEnd: string;
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
        };
        lightbox: {
            enabled: boolean;
        };
        floorButton: {
            hideOnDone: boolean;
        };
        imageActionPanel: {
            enabled: boolean;
        };
        imageDisplay: {
            align: 'center' | 'flex-start' | 'flex-end' | string;
            objectFit: 'contain' | 'cover' | 'none' | string;
            maxHeight: number;
            maxWidthPct: number;
            rounded: boolean;
            autoBlur: boolean;
        };
    };
}

function isPlainObject(item: unknown): item is Record<string, unknown> {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item));
}

/** 递归深度合并两个纯对象，阻断外部对象引用逃逸 */
function deepMerge<T extends object>(target: T, source?: unknown): T {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return target;
    }

    const result = { ...target } as Record<string, unknown>;
    const src = source as Record<string, unknown>;

    for (const key of Object.keys(src)) {
        const sourceVal = src[key];
        const targetVal = result[key];

        if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
            result[key] = deepMerge(targetVal, sourceVal);
        } else if (sourceVal !== undefined) {
            result[key] = isPlainObject(sourceVal) || Array.isArray(sourceVal)
                ? structuredClone(sourceVal)
                : sourceVal;
        }
    }

    return result as T;
}

/** 纯函数：更新或追加带时间戳的预设方案项 */
function upsertPresetItem<P>(list: PresetItem<P>[], item: PresetItem<P>): PresetItem<P>[] {
    const nextList = [...list];
    const index = nextList.findIndex((p) => p.id === item.id);
    const updated: PresetItem<P> = {
        ...item,
        updatedAt: item.updatedAt || Date.now(),
    };
    if (index >= 0) {
        nextList[index] = updated;
    } else {
        nextList.push(updated);
    }
    return nextList;
}

/** 构建默认配置实例，直接装配官方静态预设方案以确保单一事实来源与自洽性 */
function buildDefaultSettings(): DrawAssistantSettings {
    const base = defaultSettingsData as unknown as DrawAssistantSettings;
    const drawingMap: Record<string, PresetItem<DrawingPresetData>[]> = {};
    for (const [pKey, list] of Object.entries(recommendedDrawingData as Record<string, PresetItem<DrawingPresetData>[]>)) {
        drawingMap[pKey] = structuredClone(list || []);
    }

    const themes = structuredClone((recommendedThemesData as unknown as PresetItem<ThemePresetData>[]) || []);
    const resolvedThemePreset = base.themePreset || themes[0]?.id || 'default_glass';

    return {
        ...base,
        isInitialized: false,
        themePreset: resolvedThemePreset,
        presets: {
            drawing: drawingMap,
            prompts: structuredClone((recommendedPromptsData as unknown as PresetItem<PromptPresetData>[]) || []),
            workflows: structuredClone((recommendedWorkflowsData as unknown as PresetItem<WorkflowPresetData>[]) || []),
            themes,
        },
    };
}

/**
 * 插件配置状态中心类。
 */
export class SettingsStore {
    /** 插件标识，与 manifest.json 一致 */
    public static readonly EXTENSION_NAME = 'ST-DrawAssistant';
    /** 本地隔离私密凭据存储键名 */
    public static readonly LOCAL_SECRETS_KEY = 'st_da_local_secrets';
    /** 敏感配置字段键名匹配规则 */
    private static readonly SECRET_FIELD_PATTERN = /^(?:apiKey|secret|token|password)$/i;

    private _settings: DrawAssistantSettings;

    public constructor(initialData?: Partial<DrawAssistantSettings>) {
        const baseDefaults = buildDefaultSettings();
        this._settings = deepMerge(baseDefaults, initialData);
    }

    /**
     * 从宿主环境初始化配置数据。
     *
     * @remarks
     * 1. 读取 hostContext.extensionSettings['ST-DrawAssistant'] 并与内置默认配置深合并；
     * 2. 结合浏览器本地专用隔离存储 (localStorage) 载入真实私密凭据；
     * 3. 若检测到插件未初始化，则受控载入静态推荐资产。
     */
    public initializeFromHost(): void {
        const hostContext = window.SillyTavern?.getContext?.();
        const rawSettings = hostContext?.extensionSettings?.[SettingsStore.EXTENSION_NAME] as Record<string, any> | undefined;

        if (rawSettings && typeof rawSettings === 'object') {
            this._settings = deepMerge(this._settings, rawSettings);
        }

        // 从本地专属隔离存储中载入真实私密凭据
        this.restoreLocalSecrets();

        if (!this._settings.isInitialized) {
            this._settings = {
                ...this._settings,
                isInitialized: true,
            };
            this.saveToHost();
            eventBus.emit('settings:updated', { keys: ['isInitialized'] });
        }
    }

    /**
     * 从本地静态文件导入全套官方推荐预设方案并激活就绪。
     *
     * @remarks
     * 重新装载 drawing、prompts、workflows 与 themes 官方预设资产，
     * 若当前 themePreset 未选定则显式初始化为推荐主题列表首项，
     * 并将 isInitialized 标志位置为 true，随后触发持久化同步与事件广播。
     */
    public importOfficialPresets(): void {
        const drawingMap: Record<string, PresetItem<DrawingPresetData>[]> = {};
        for (const [pKey, list] of Object.entries(recommendedDrawingData as Record<string, PresetItem<DrawingPresetData>[]>)) {
            drawingMap[pKey] = structuredClone(list || []);
        }

        const themes = structuredClone((recommendedThemesData as unknown as PresetItem<ThemePresetData>[]) || []);
        const resolvedThemePreset = this._settings.themePreset || themes[0]?.id || 'default_glass';
        const updateKeys = ['presets', 'isInitialized'];
        if (resolvedThemePreset && resolvedThemePreset !== this._settings.themePreset) {
            updateKeys.push('themePreset');
        }

        this._settings = {
            ...this._settings,
            isInitialized: true,
            themePreset: resolvedThemePreset,
            presets: {
                drawing: drawingMap,
                prompts: structuredClone((recommendedPromptsData as unknown as PresetItem<PromptPresetData>[]) || []),
                workflows: structuredClone((recommendedWorkflowsData as unknown as PresetItem<WorkflowPresetData>[]) || []),
                themes,
            },
        };

        eventBus.emit('settings:updated', { keys: updateKeys });
        this.saveToHost();
    }

    /** 获取当前完整配置快照，通过深拷贝快照保护防止外部直接篡改内部状态 */
    public getSettings(): Readonly<DrawAssistantSettings> {
        return structuredClone(this._settings);
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

        eventBus.emit('settings:updated', { key: String(key), value, keys: [String(key)] });
        this.saveToHost();
    }

    /**
     * 批量合并更新配置。
     * @param patch 待合并的部分配置对象
     */
    public update(patch: Partial<DrawAssistantSettings>): void {
        this._settings = deepMerge(this._settings, patch);

        eventBus.emit('settings:updated', { keys: Object.keys(patch), patch });
        this.saveToHost();
    }

    /**
     * 读取指定绘图服务提供方的私有配置对象快照。
     * @param type 绘图服务提供方类型标识
     */
    public getProviderConfig<T = Record<string, unknown>>(type: ProviderType): T | undefined {
        const providers = this._settings.providers as Record<string, unknown> | undefined;
        const config = providers?.[type];
        if (!config || typeof config !== 'object') {
            return undefined;
        }
        return structuredClone(config as Record<string, unknown>) as T;
    }

    /**
     * 更新指定绘图服务提供方的私有配置。
     * @param type 绘图服务提供方类型标识
     * @param patch 待更新的私有配置子集
     */
    public setProviderConfig<T = Record<string, unknown>>(type: ProviderType, patch: Partial<T>): void {
        const current = (this.getProviderConfig<T>(type) || {}) as T;
        const updated = deepMerge(current as Record<string, any>, patch as Record<string, any>) as T;

        this._settings = {
            ...this._settings,
            providers: {
                ...this._settings.providers,
                [type]: updated,
            },
        };

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
            const currentList = this.getPresets<DrawingPresetData>('drawing', providerKey);
            const nextList = upsertPresetItem(currentList, timestampedItem as unknown as PresetItem<DrawingPresetData>);

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    drawing: {
                        ...this._settings.presets.drawing,
                        [providerKey]: nextList,
                    },
                },
            };
        } else if (category === 'prompts') {
            const currentList = this.getPresets<PromptPresetData>('prompts');
            const nextList = upsertPresetItem(currentList, timestampedItem as unknown as PresetItem<PromptPresetData>);
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    prompts: nextList,
                },
            };
        } else if (category === 'workflows') {
            const currentList = this.getPresets<WorkflowPresetData>('workflows');
            const nextList = upsertPresetItem(currentList, timestampedItem as unknown as PresetItem<WorkflowPresetData>);
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    workflows: nextList,
                },
            };
        } else if (category === 'themes') {
            const currentList = this.getPresets<ThemePresetData>('themes');
            const nextList = upsertPresetItem(currentList, timestampedItem as unknown as PresetItem<ThemePresetData>);
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    themes: nextList,
                },
            };
        }

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
            const currentList = this.getPresets<DrawingPresetData>('drawing', providerKey);
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
                        [providerKey]: nextList,
                    },
                },
            };
        } else if (category === 'prompts') {
            const currentList = this.getPresets<PromptPresetData>('prompts');
            const nextList = currentList.filter((p) => p.id !== id);
            if (nextList.length === currentList.length) return false;
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    prompts: nextList,
                },
            };
        } else if (category === 'workflows') {
            const currentList = this.getPresets<WorkflowPresetData>('workflows');
            const nextList = currentList.filter((p) => p.id !== id);
            if (nextList.length === currentList.length) return false;
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    workflows: nextList,
                },
            };
        } else if (category === 'themes') {
            const currentList = this.getPresets<ThemePresetData>('themes');
            const nextList = currentList.filter((p) => p.id !== id);
            if (nextList.length === currentList.length) return false;
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    themes: nextList,
                },
            };
        }

        eventBus.emit('settings:updated', { key: `presets.${category}`, value: { deletedId: id } });
        this.saveToHost();
        return true;
    }

    /**
     * 将当前内存配置持久化同步至 SillyTavern 宿主。
     *
     * @remarks
     * 敏感凭据防护与隔离策略：
     * 1. 真实 API Key 等私密字段自动提取并持久化至浏览器专属本地隔离存储 (localStorage)；
     * 2. 写入宿主 extensionSettings 的配置副本中，所有敏感字段强制置空脱敏，
     *    避免明文密钥持久化存储进入酒馆服务端的 settings.json 或随配置导出外泄。
     */
    public saveToHost(): void {
        // 1. 持久化敏感凭据至本地隔离存储
        this.persistLocalSecrets();

        // 2. 构造脱敏副本同步给宿主
        const hostContext = window.SillyTavern?.getContext?.();
        if (hostContext?.extensionSettings) {
            const sanitized = this.stripSecretsFromSettings(this._settings);
            hostContext.extensionSettings[SettingsStore.EXTENSION_NAME] = sanitized;
        }

        // 3. 调用宿主防抖持久化接口
        if (typeof hostContext?.saveSettingsDebounced === 'function') {
            try {
                hostContext.saveSettingsDebounced();
            } catch (err) {
                logger.error('调用宿主 saveSettingsDebounced 异常:', err);
            }
        }
    }

    /** 从本地专属隔离存储载入私密凭据并合并入内存 */
    private restoreLocalSecrets(): void {
        try {
            const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : undefined);
            if (!storage) return;
            const raw = storage.getItem(SettingsStore.LOCAL_SECRETS_KEY);
            if (!raw) {
                // 若本地存储尚无凭据，但宿主存在历史遗留明文密钥，执行初次平滑迁移
                this.persistLocalSecrets();
                return;
            }
            const secrets = JSON.parse(raw) as Record<string, Record<string, string>>;
            if (secrets && typeof secrets === 'object') {
                for (const [pKey, secObj] of Object.entries(secrets)) {
                    if (secObj && typeof secObj === 'object') {
                        const provider = (this._settings.providers as Record<string, any>)[pKey];
                        if (provider && typeof provider === 'object') {
                            Object.assign(provider, secObj);
                        }
                    }
                }
            }
        } catch (err) {
            logger.warn('从本地隔离存储载入私密凭据异常:', err);
        }
    }

    /** 将内存中的敏感凭据持久化至本地专属隔离存储 */
    private persistLocalSecrets(): void {
        try {
            const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : undefined);
            if (!storage) return;
            const secrets: Record<string, Record<string, string>> = {};
            if (this._settings.providers && typeof this._settings.providers === 'object') {
                for (const [pKey, pCfg] of Object.entries(this._settings.providers)) {
                    if (pCfg && typeof pCfg === 'object') {
                        for (const [field, val] of Object.entries(pCfg as Record<string, unknown>)) {
                            if (SettingsStore.SECRET_FIELD_PATTERN.test(field) && typeof val === 'string' && val.trim()) {
                                if (!secrets[pKey]) secrets[pKey] = {};
                                secrets[pKey][field] = val;
                            }
                        }
                    }
                }
            }
            storage.setItem(SettingsStore.LOCAL_SECRETS_KEY, JSON.stringify(secrets));
        } catch (err) {
            logger.warn('持久化私密凭据至本地隔离存储异常:', err);
        }
    }

    /** 构造剥离了所有敏感凭据的宿主同步配置副本 */
    private stripSecretsFromSettings(settings: DrawAssistantSettings): DrawAssistantSettings {
        const cloned: DrawAssistantSettings = structuredClone(settings);
        if (cloned.providers && typeof cloned.providers === 'object') {
            for (const [pKey, pCfg] of Object.entries(cloned.providers)) {
                if (pCfg && typeof pCfg === 'object' && !Array.isArray(pCfg)) {
                    const sanitized: Record<string, unknown> = { ...(pCfg as Record<string, unknown>) };
                    for (const field of Object.keys(sanitized)) {
                        if (SettingsStore.SECRET_FIELD_PATTERN.test(field)) {
                            sanitized[field] = '';
                        }
                    }
                    (cloned.providers as Record<string, unknown>)[pKey] = sanitized;
                }
            }
        }
        return cloned;
    }

    /**
     * 导出配置为 JSON 字符串。
     * @param includeSecrets 是否包含 API Key 等私密字段，默认 false 执行脱敏
     */
    public exportSettings(includeSecrets = false): string {
        const cloned: DrawAssistantSettings = structuredClone(this._settings);

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

            // 保护现有敏感密钥：若导入数据中敏感字段为空字符串，保留本地已有有效密钥
            if (parsed.providers && typeof parsed.providers === 'object') {
                for (const [pKey, pCfg] of Object.entries(parsed.providers)) {
                    if (pCfg && typeof pCfg === 'object') {
                        const localCfg = this.getProviderConfig<Record<string, unknown>>(pKey as ProviderType);
                        if (localCfg) {
                            for (const [field, val] of Object.entries(pCfg as Record<string, unknown>)) {
                                if (SettingsStore.SECRET_FIELD_PATTERN.test(field) && val === '' && localCfg[field]) {
                                    (pCfg as Record<string, unknown>)[field] = localCfg[field];
                                }
                            }
                        }
                    }
                }
            }

            this.update(parsed);
            return { success: true };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('导入配置发生 JSON 解析异常:', message);
            return { success: false, error: `JSON 解析失败: ${message}` };
        }
    }

    /**
     * 恢复所有设置为内置默认值并重新装载静态推荐资产。
     */
    public resetToDefaults(): void {
        const baseDefaults = buildDefaultSettings();
        this._settings = structuredClone(baseDefaults);
        this._settings.isInitialized = true;
        this.saveToHost();

        eventBus.emit('settings:updated', { isReset: true, keys: Object.keys(this._settings) });
    }
}

/** 全局默认单例配置中心 */
export const settingsStore = new SettingsStore();
