/**
 * 插件配置中心与持久化存储服务 (SettingsStore)。
 *
 * @remarks
 * 负责插件配置与预设的管理与持久化：
 * 1. 集中管理通用设置、提供商配置、素材库与提示词四通道预设；
 * 2. 零内嵌预设数据：首次初始化或恢复默认设置时，通过运行时异步读取 `config/presets/` 下的静态 JSON 文件；
 * 3. 深拷贝快照保护：外部读取接口返回深拷贝快照，避免状态被外部直接修改；
 * 4. 宿主防抖持久化与凭据隔离：API Key 等敏感凭据隔离存放于本地 `localStorage`，同步给宿主的副本自动脱敏。
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
    MaterialLibraryConfig,
    MaterialActivationPresetData,
    MaterialItemActivationRule,
    ActivationTriggerMode,
    PromptInjectionConfig,
} from '@types';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';
import defaultSettingsData from '../../config/default-settings.json';
import {
    createEmptyPresetSettings,
    loadOfficialStaticPresets,
    type LoadStaticPresetsOptions,
} from './static-preset-loader';

/** 配置导入结果结构 */
export interface SettingsImportResult {
    readonly success: boolean;
    readonly error?: string;
}

/** 局部恢复出厂设置细分控制选项 */
export interface ResetPartialOptions {
    readonly general?: boolean;
    readonly providers?: boolean;
    readonly ui?: boolean;
    readonly drawingPresets?: boolean;
    readonly promptPresets?: boolean;
    readonly workflowPresets?: boolean;
    readonly themePresets?: boolean;
    readonly characterPresets?: boolean;
    readonly outfitPresets?: boolean;
    readonly materialActivationPresets?: boolean;
    readonly materialExtractionPresets?: boolean;
    readonly materialFormatPresets?: boolean;
    readonly promptStoryPresets?: boolean;
    readonly promptCharacterPresets?: boolean;
    readonly promptVocabPresets?: boolean;
    readonly promptMaterialPresets?: boolean;
    readonly resetLocalLexicon?: boolean;
    /** 清空本地生成图库记录与 Blob 缓存（可选） */
    readonly resetLocalGallery?: boolean;
    readonly loaderOptions?: LoadStaticPresetsOptions;
}

/** 保存预设附加控制项 */
export interface SavePresetOptions {
    /**
     * 针对角色或服装预设：是否将其同步开启于当前激活的「启用预设」中。
     * 缺省行为：新建素材默认自动加入当前启用预设（`true`），修改既有素材保持原启用状态不变（`false`）。
     */
    readonly autoActivateMaterial?: boolean;
    /** 自动加入启用预设时的初始触发模式（默认 `'keyword'`） */
    readonly defaultTriggerMode?: ActivationTriggerMode;
}

/** 默认单任务超时时间（毫秒） */
export const DEFAULT_TASK_TIMEOUT_MS = 120_000;

/** 图像存储格式与画质策略 */
export type ImageStorageQuality = 'original' | 'webp-high' | 'webp-medium';

/** 插件核心配置结构定义 */
export interface DrawAssistantSettings {
    isInitialized: boolean;
    hasSeenGuide: boolean;
    enabled: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    taskTimeoutMs: number;
    cancelOnChatChange: boolean;
    saveToServer: boolean;
    imageQuality: ImageStorageQuality;
    autoGenerate: boolean;
    cleanPrompt: boolean;
    promptStartTag: string;
    promptEndTag: string;
    activeThemePresetId: string;
    presets: PresetSettings;
    promptInjection: PromptInjectionConfig;
    materialConfig: MaterialLibraryConfig;
    providers: {
        comfyui: ComfyUIProviderConfig;
        sdwebui: SDWebUIProviderConfig;
        novelai: NovelAIProviderConfig;
        openai: OpenAIProviderConfig;
        [key: string]: unknown;
    };
    ui: {
        fab: {
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

/** 递归深度合并两个纯对象，防止外部对象引用逃逸 */
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
            result[key] =
                isPlainObject(sourceVal) || Array.isArray(sourceVal)
                    ? structuredClone(sourceVal)
                    : sourceVal;
        }
    }

    return result as T;
}

/**
 * 递归复制对象，并将命中敏感字段名的字符串值置空。
 *
 * 提供方配置中存在嵌套结构（如 NovelAI 按服务商暂存的 serviceProfiles.*.apiKey），
 * 仅处理第一层会使嵌套密钥随宿主配置或导出文件泄露。
 */
function stripSecretsDeep<T>(value: T, pattern: RegExp): T {
    if (Array.isArray(value)) {
        return value.map((item) => stripSecretsDeep(item, pattern)) as unknown as T;
    }
    if (!isPlainObject(value)) {
        return value;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
        result[key] =
            pattern.test(key) && typeof val === 'string' ? '' : stripSecretsDeep(val, pattern);
    }
    return result as T;
}

/** 递归提取对象中非空的敏感字段，保持原有嵌套路径；无敏感值时返回 undefined */
function collectSecretsDeep(
    value: unknown,
    pattern: RegExp
): Record<string, unknown> | undefined {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
        if (pattern.test(key) && typeof val === 'string') {
            if (val.trim()) result[key] = val;
        } else {
            const nested = collectSecretsDeep(val, pattern);
            if (nested) result[key] = nested;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

/** 将 collectSecretsDeep 产出的敏感字段按路径递归写回目标对象，目标缺少中间节点时跳过 */
function restoreSecretsDeep(
    target: Record<string, unknown>,
    secrets: Record<string, unknown>
): void {
    for (const [key, val] of Object.entries(secrets)) {
        if (isPlainObject(val)) {
            const node = target[key];
            if (isPlainObject(node)) {
                restoreSecretsDeep(node, val);
            }
        } else {
            target[key] = val;
        }
    }
}

/** 导入配置时，对传入对象中被置空的敏感字段递归保留本地已有的有效值 */
function preserveBlankSecretsDeep(
    incoming: Record<string, unknown>,
    local: Record<string, unknown>,
    pattern: RegExp
): void {
    for (const [key, val] of Object.entries(incoming)) {
        if (pattern.test(key)) {
            if (val === '' && typeof local[key] === 'string' && local[key]) {
                incoming[key] = local[key];
            }
        } else if (isPlainObject(val) && isPlainObject(local[key])) {
            preserveBlankSecretsDeep(val, local[key] as Record<string, unknown>, pattern);
        }
    }
}

interface UpsertPresetResult<P> {
    readonly nextList: PresetItem<P>[];
    readonly existedBefore: boolean;
    readonly savedId: string;
}

/** 纯函数：更新或追加带时间戳的预设项（对角色/服装预设同步保证名称唯一性与 ID 稳定） */
function upsertPresetItem<P>(
    list: PresetItem<P>[],
    item: PresetItem<P>,
    enforceUniqueName = false
): UpsertPresetResult<P> {
    const nextList = [...list];
    const incomingName =
        enforceUniqueName &&
        isPlainObject(item.data) &&
        typeof (item.data as Record<string, unknown>).name === 'string'
            ? ((item.data as Record<string, unknown>).name as string).trim().toLowerCase()
            : '';

    const index = nextList.findIndex((p) => {
        if (p.id === item.id) return true;
        if (incomingName && isPlainObject(p.data)) {
            const existingName = String((p.data as Record<string, unknown>).name || '')
                .trim()
                .toLowerCase();
            if (existingName && existingName === incomingName) {
                return true;
            }
        }
        return false;
    });

    const stableId = index >= 0 ? nextList[index].id : item.id;
    let safeData = item.data;
    if (isPlainObject(safeData) && '_embeddedAvatarDataUrl' in safeData) {
        const clonedData = { ...safeData };
        delete clonedData._embeddedAvatarDataUrl;
        safeData = clonedData as P;
    }

    const updated: PresetItem<P> = {
        ...item,
        id: stableId,
        data: safeData,
        updatedAt: item.updatedAt || Date.now(),
    };

    if (index >= 0) {
        nextList[index] = updated;
    } else {
        nextList.push(updated);
    }

    return {
        nextList,
        existedBefore: index >= 0,
        savedId: stableId,
    };
}

/** 构建轻量初始配置骨架（不含任何内嵌预设数据） */
function buildDefaultSettings(): DrawAssistantSettings {
    const base = structuredClone(defaultSettingsData) as unknown as DrawAssistantSettings;
    return {
        ...base,
        isInitialized: false,
        presets: createEmptyPresetSettings(),
    };
}

/**
 * 将官方静态预设合并至当前预设池中为空的分类（保留已有非空分类）。
 */
function mergeEmptyPresetCategories(
    current: PresetSettings,
    official: PresetSettings
): PresetSettings {
    const next = structuredClone(current);

    for (const [providerKey, officialList] of Object.entries(official.drawing)) {
        const curList = next.drawing?.[providerKey];
        if (!Array.isArray(curList) || curList.length === 0) {
            next.drawing[providerKey] = structuredClone(officialList);
        }
    }

    for (const [providerKey, officialList] of Object.entries(official.prompts)) {
        const curList = next.prompts?.[providerKey];
        if (!Array.isArray(curList) || curList.length === 0) {
            next.prompts[providerKey] = structuredClone(officialList);
        }
    }

    const arrayCategories: Array<
        Exclude<PresetCategory, 'drawing' | 'prompts'>
    > = [
        'workflows',
        'themes',
        'characters',
        'outfits',
        'material_activations',
        'material_extractions',
        'material_formats',
        'prompt_story',
        'prompt_character',
        'prompt_vocab',
        'prompt_material',
    ];

    for (const cat of arrayCategories) {
        const curArr = next[cat];
        if (!Array.isArray(curArr) || curArr.length === 0) {
            (next as unknown as Record<string, unknown>)[cat] = structuredClone(official[cat]);
        }
    }

    return next;
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
     * 从宿主环境异步初始化配置数据。
     *
     * @remarks
     * 1. 读取 `hostContext.extensionSettings['ST-DrawAssistant']` 并与默认配置结构深合并；
     * 2. 从浏览器本地隔离存储 (`localStorage`) 还原私密凭据；
     * 3. 若检测到首次启用 (`!isInitialized`)，通过运行时异步载入 `config/presets/` 静态预设文件。
     */
    public async initializeFromHost(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        const hostContext =
            typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
        const rawSettings = hostContext?.extensionSettings?.[SettingsStore.EXTENSION_NAME] as
            | Record<string, unknown>
            | undefined;

        if (rawSettings && typeof rawSettings === 'object') {
            this._settings = deepMerge(this._settings, rawSettings);
        }

        // 从本地专属隔离存储中载入真实私密凭据
        this.restoreLocalSecrets();

        if (!this._settings.isInitialized) {
            try {
                const officialPresets = await loadOfficialStaticPresets(loaderOptions);
                const mergedPresets = mergeEmptyPresetCategories(
                    this._settings.presets,
                    officialPresets
                );

                const resolvedThemePreset =
                    this._settings.activeThemePresetId ||
                    mergedPresets.themes[0]?.id ||
                    'default_glass';

                this._settings = {
                    ...this._settings,
                    isInitialized: true,
                    activeThemePresetId: resolvedThemePreset,
                    presets: mergedPresets,
                };
                this.saveToHost();
                eventBus.emit('settings:updated', {
                    keys: ['isInitialized', 'presets', 'activeThemePresetId'],
                });
            } catch (err) {
                logger.error('[SettingsStore] 初始化加载默认静态预设失败:', err);
            }
        }
    }

    /**
     * 从静态预设文件重新导入全套默认推荐预设并激活就绪。
     */
    public async importOfficialPresets(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        const officialPresets = await loadOfficialStaticPresets(loaderOptions);
        const resolvedThemePreset =
            this._settings.activeThemePresetId || officialPresets.themes[0]?.id || 'default_glass';
        const updateKeys = ['presets', 'isInitialized'];
        if (resolvedThemePreset !== this._settings.activeThemePresetId) {
            updateKeys.push('activeThemePresetId');
        }

        this._settings = {
            ...this._settings,
            isInitialized: true,
            activeThemePresetId: resolvedThemePreset,
            presets: officialPresets,
        };

        eventBus.emit('settings:updated', { keys: updateKeys });
        this.saveToHost();
    }

    /**
     * 获取当前完整配置深拷贝快照。
     *
     * @remarks
     * 适用于需完整不可变快照的场景；若仅需读取单一标量字段（如 enabled、activeProvider），推荐优先使用 get(key) 以获得更高性能。
     */
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
    public set<K extends keyof DrawAssistantSettings>(
        key: K,
        value: DrawAssistantSettings[K]
    ): void {
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
        const allKeys = Object.keys(patch);

        eventBus.emit('settings:updated', { keys: allKeys, patch });
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
    public setProviderConfig<T = Record<string, unknown>>(
        type: ProviderType,
        patch: Partial<T>
    ): void {
        const current = (this.getProviderConfig<T>(type) || {}) as T;
        const updated = deepMerge(
            current as Record<string, unknown>,
            patch as Record<string, unknown>
        ) as T;

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
     * 获取指定分类下的预设列表。
     *
     * @param category 预设分类
     * @param providerType 若为 drawing 或 prompts 分类，指定所属绘图服务提供方；缺省使用当前激活提供方
     * @returns 预设条目数组
     */
    public getPresets<T = Record<string, unknown>>(
        category: PresetCategory,
        providerType?: string
    ): PresetItem<T>[] {
        if (category === 'drawing' || category === 'prompts') {
            const providerKey = providerType || this._settings.activeProvider;
            const categoryMap = (this._settings.presets[category] || {}) as Record<
                string,
                PresetItem<T>[]
            >;
            return (categoryMap[providerKey] || []) as PresetItem<T>[];
        }

        return (this._settings.presets[category] || []) as unknown as PresetItem<T>[];
    }

    /**
     * 根据 ID 检索指定分类中的单一预设。
     *
     * @param category 预设分类
     * @param id 预设唯一标识符
     * @param providerType 绘图服务提供方类型 (针对 drawing 或 prompts 分类)
     */
    public getPreset<T = Record<string, unknown>>(
        category: PresetCategory,
        id: string,
        providerType?: string
    ): PresetItem<T> | undefined {
        return this.getPresets<T>(category, providerType).find((item) => item.id === id);
    }

    /**
     * 保存预设。
     *
     * @remarks
     * 1. 若已存在同 ID 预设（角色/服装同时检测唯一 `data.name`）则直接更新现有预设，不存在则追加；
     * 2. 当新建角色或服装档案（或显式指定 `options.autoActivateMaterial = true`）且存在当前启用预设时，
     *    自动将其登记入当前激活的「启用预设」（默认 `enabled: true, triggerMode: 'keyword'`）。
     */
    public savePreset<T = Record<string, unknown>>(
        category: PresetCategory,
        item: PresetItem<T>,
        providerType?: string,
        options?: SavePresetOptions
    ): void {
        const timestampedItem: PresetItem<T> = {
            ...item,
            updatedAt: item.updatedAt || Date.now(),
        };

        if (category === 'drawing' || category === 'prompts') {
            const providerKey = providerType || this._settings.activeProvider;
            const currentList = this.getPresets<T>(category, providerKey);
            const { nextList } = upsertPresetItem(currentList, timestampedItem);

            const existingMap = this._settings.presets[category] || {};
            const safeMap = isPlainObject(existingMap) ? { ...existingMap } : {};

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    [category]: {
                        ...safeMap,
                        [providerKey]: nextList,
                    },
                },
            };
        } else {
            const currentList = this.getPresets<T>(category);
            const isMaterialArchive = category === 'characters' || category === 'outfits';
            const { nextList, existedBefore, savedId } = upsertPresetItem(
                currentList,
                timestampedItem,
                isMaterialArchive
            );
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    [category]: nextList,
                },
            };

            if (isMaterialArchive) {
                const shouldAutoActivate = options?.autoActivateMaterial ?? !existedBefore;
                if (shouldAutoActivate) {
                    this.enableMaterialInActivePresetInternal(
                        category === 'characters' ? 'character' : 'outfit',
                        savedId,
                        options?.defaultTriggerMode ?? 'keyword'
                    );
                }
            }
        }

        eventBus.emit('settings:updated', { key: `presets.${category}`, value: item });
        this.saveToHost();
    }

    /**
     * 在指定（或缺省当前激活）的素材启用预设中更新单条角色或服装的激活规则。
     */
    public setMaterialActivationRule(
        kind: 'character' | 'outfit',
        materialPresetId: string,
        rule: MaterialItemActivationRule,
        activationPresetId?: string
    ): boolean {
        if (!materialPresetId.trim()) {
            return false;
        }
        const actList = this.getPresets<MaterialActivationPresetData>('material_activations');
        if (actList.length === 0) {
            return false;
        }
        const targetId =
            activationPresetId || this._settings.materialConfig?.activeActivationPresetId || '';
        const targetIndex = actList.findIndex((p) => p.id === targetId);
        const resolvedIndex = targetIndex >= 0 ? targetIndex : 0;
        const targetPreset = actList[resolvedIndex];

        const nextData = structuredClone(targetPreset.data);
        if (kind === 'character') {
            nextData.characterRules = {
                ...(nextData.characterRules || {}),
                [materialPresetId]: { ...rule },
            };
        } else {
            nextData.outfitRules = {
                ...(nextData.outfitRules || {}),
                [materialPresetId]: { ...rule },
            };
        }

        const nextActList = [...actList];
        nextActList[resolvedIndex] = {
            ...targetPreset,
            data: nextData,
            updatedAt: Date.now(),
        };

        this._settings = {
            ...this._settings,
            presets: {
                ...this._settings.presets,
                material_activations: nextActList,
            },
        };

        eventBus.emit('settings:updated', {
            key: 'presets.material_activations',
            value: nextActList[resolvedIndex],
        });
        this.saveToHost();
        return true;
    }

    /** 内部辅助：在不重复广播事件的前提下将角色或服装写入当前启用预设 */
    private enableMaterialInActivePresetInternal(
        kind: 'character' | 'outfit',
        materialPresetId: string,
        defaultTriggerMode: ActivationTriggerMode
    ): void {
        const actList = this._settings.presets.material_activations;
        if (!Array.isArray(actList) || actList.length === 0) {
            return;
        }
        const activeActId = this._settings.materialConfig?.activeActivationPresetId || '';
        const foundIdx = actList.findIndex((p) => p.id === activeActId);
        const idx = foundIdx >= 0 ? foundIdx : 0;
        const target = actList[idx];
        if (!target?.data) {
            return;
        }

        const nextData = structuredClone(target.data);
        const mapKey = kind === 'character' ? 'characterRules' : 'outfitRules';
        const existingMap = nextData[mapKey] || {};
        const prevRule = existingMap[materialPresetId];

        nextData[mapKey] = {
            ...existingMap,
            [materialPresetId]: {
                enabled: true,
                triggerMode: prevRule?.triggerMode || defaultTriggerMode,
            },
        };

        const nextList = [...actList];
        nextList[idx] = {
            ...target,
            data: nextData,
            updatedAt: Date.now(),
        };

        this._settings = {
            ...this._settings,
            presets: {
                ...this._settings.presets,
                material_activations: nextList,
            },
        };
    }

    /**
     * 删除指定预设。
     *
     * @remarks
     * 具备严格的级联清理（Cascade Cleanup）时序保护机制：
     * 1. 删除提示词预设时，自动对齐引用它的绘图预设中的 promptPresetId 关联指针；
     * 2. 删除角色或服装时，自动级联清理全部素材启用规则（material_activations）中挂载的激活条目，防止悬挂引用；
     * 3. 删除服装时，自动级联清理所有角色中 boundOutfitIds 的引用；
     * 4. 删除当前激活预设（提示词通道激活项或主题预设 activeThemePresetId）时，自动平滑退避对齐至首项或默认预设。
     *
     * @param category 预设分类
     * @param id 待删除的预设 ID
     * @param providerType 绘图服务提供方类型 (针对 drawing 或 prompts 分类)
     * @returns 是否成功找到并删除
     */
    public deletePreset(category: PresetCategory, id: string, providerType?: string): boolean {
        if (category === 'drawing' || category === 'prompts') {
            const providerKey = providerType || this._settings.activeProvider;
            const currentList = this.getPresets(category, providerKey);
            const nextList = currentList.filter((p) => p.id !== id);

            if (nextList.length === currentList.length) {
                return false;
            }

            const existingMap = this._settings.presets[category] || {};
            const safeMap = isPlainObject(existingMap) ? { ...existingMap } : {};

            let updatedDrawingPresets = this._settings.presets.drawing;
            // 若删除的是提示词预设，且当前后端的绘图预设关联了该预设，则自动对齐为剩余预设首项
            if (category === 'prompts' && updatedDrawingPresets?.[providerKey]) {
                const fallbackPromptId = nextList[0]?.id || '';
                const currentDrawings = updatedDrawingPresets[providerKey] || [];
                const patchedDrawings = currentDrawings.map((dp) => {
                    if (dp?.data?.promptPresetId === id) {
                        return {
                            ...dp,
                            data: {
                                ...dp.data,
                                promptPresetId: fallbackPromptId,
                            },
                        };
                    }
                    return dp;
                });
                updatedDrawingPresets = {
                    ...updatedDrawingPresets,
                    [providerKey]: patchedDrawings,
                };
            }

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    [category]: {
                        ...safeMap,
                        [providerKey]: nextList,
                    },
                    ...(category === 'prompts' ? { drawing: updatedDrawingPresets } : {}),
                },
            };
            eventBus.emit('settings:updated', {
                key: `presets.${category}`,
                value: { deletedId: id },
            });
            this.saveToHost();
            return true;
        }

        const currentList = this.getPresets(category);
        const nextList = currentList.filter((p) => p.id !== id);
        if (nextList.length === currentList.length) {
            return false;
        }

        // 1. 同步清理素材启用预设中的激活规则引用
        let nextActivations = this._settings.presets.material_activations;
        if (
            (category === 'characters' || category === 'outfits') &&
            Array.isArray(nextActivations) &&
            nextActivations.length > 0
        ) {
            const mapKey = category === 'characters' ? 'characterRules' : 'outfitRules';
            nextActivations = nextActivations.map((act) => {
                if (!act?.data?.[mapKey] || !(id in act.data[mapKey])) {
                    return act;
                }
                const clonedRules = { ...act.data[mapKey] };
                delete clonedRules[id];
                return {
                    ...act,
                    data: {
                        ...act.data,
                        [mapKey]: clonedRules,
                    },
                };
            });
        }

        // 2. 删除服装时，同步清理角色预设中的专属服装绑定引用
        let nextCharacters = this._settings.presets.characters;
        if (category === 'outfits' && Array.isArray(nextCharacters)) {
            nextCharacters = nextCharacters.map((char) => {
                if (
                    char.data?.boundOutfitIds &&
                    Array.isArray(char.data.boundOutfitIds) &&
                    char.data.boundOutfitIds.includes(id)
                ) {
                    return {
                        ...char,
                        data: {
                            ...char.data,
                            boundOutfitIds: char.data.boundOutfitIds.filter((bid) => bid !== id),
                        },
                    };
                }
                return char;
            });
        }

        // 3. 提示词通道激活项对齐：若删除项为激活预设，自动对齐为剩余列表首项
        const channelKeyMap: Record<string, keyof PromptInjectionConfig> = {
            prompt_story: 'story',
            prompt_character: 'character',
            prompt_vocab: 'vocab',
            prompt_material: 'material',
        };
        const channelKey = channelKeyMap[category];
        let nextPromptInjection = this._settings.promptInjection;
        if (channelKey && nextPromptInjection?.[channelKey]) {
            if (nextPromptInjection[channelKey].activePresetId === id) {
                const fallbackId = nextList[0]?.id || '';
                nextPromptInjection = {
                    ...nextPromptInjection,
                    [channelKey]: {
                        ...nextPromptInjection[channelKey],
                        activePresetId: fallbackId,
                    },
                };
            }
        }

        // 4. 主题预设激活项对齐：若删除项为当前激活主题，自动对齐为默认主题
        let nextThemePreset = this._settings.activeThemePresetId;
        if (category === 'themes' && nextThemePreset === id) {
            nextThemePreset = nextList[0]?.id || 'default_glass';
        }

        this._settings = {
            ...this._settings,
            activeThemePresetId: nextThemePreset,
            promptInjection: nextPromptInjection,
            presets: {
                ...this._settings.presets,
                [category]: nextList,
                ...(category === 'outfits' && nextCharacters !== this._settings.presets.characters
                    ? { characters: nextCharacters }
                    : {}),
                ...(nextActivations !== this._settings.presets.material_activations
                    ? { material_activations: nextActivations }
                    : {}),
            },
        };

        eventBus.emit('settings:updated', {
            key: `presets.${category}`,
            value: { deletedId: id },
        });
        this.saveToHost();
        return true;
    }

    /**
     * 将当前内存配置持久化同步至 SillyTavern 宿主。
     */
    public saveToHost(): void {
        // 1. 持久化敏感凭据至本地隔离存储
        this.persistLocalSecrets();

        // 2. 构造脱敏副本同步给宿主
        const hostContext =
            typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
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
            const storage =
                typeof window !== 'undefined' && window.localStorage
                    ? window.localStorage
                    : typeof localStorage !== 'undefined'
                      ? localStorage
                      : undefined;
            if (!storage) return;
            const raw = storage.getItem(SettingsStore.LOCAL_SECRETS_KEY);
            if (!raw) {
                // 本地存储无凭据时，从宿主配置同步初始密钥并写入本地存储
                this.persistLocalSecrets();
                return;
            }
            const secrets = JSON.parse(raw) as Record<string, Record<string, unknown>>;
            if (secrets && typeof secrets === 'object') {
                for (const [pKey, secObj] of Object.entries(secrets)) {
                    if (secObj && typeof secObj === 'object') {
                        const provider = (this._settings.providers as Record<string, unknown>)[
                            pKey
                        ];
                        if (isPlainObject(provider)) {
                            restoreSecretsDeep(provider, secObj);
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
            const storage =
                typeof window !== 'undefined' && window.localStorage
                    ? window.localStorage
                    : typeof localStorage !== 'undefined'
                      ? localStorage
                      : undefined;
            if (!storage) return;
            const secrets: Record<string, Record<string, unknown>> = {};
            if (this._settings.providers && typeof this._settings.providers === 'object') {
                for (const [pKey, pCfg] of Object.entries(this._settings.providers)) {
                    const collected = collectSecretsDeep(
                        pCfg,
                        SettingsStore.SECRET_FIELD_PATTERN
                    );
                    if (collected) secrets[pKey] = collected;
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
                    (cloned.providers as Record<string, unknown>)[pKey] = stripSecretsDeep(
                        pCfg,
                        SettingsStore.SECRET_FIELD_PATTERN
                    );
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
                    (cloned.providers as Record<string, unknown>)[providerKey] = stripSecretsDeep(
                        providerCfg,
                        SettingsStore.SECRET_FIELD_PATTERN
                    );
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
                        const localCfg = this.getProviderConfig<Record<string, unknown>>(
                            pKey as ProviderType
                        );
                        if (localCfg) {
                            preserveBlankSecretsDeep(
                                pCfg as Record<string, unknown>,
                                localCfg,
                                SettingsStore.SECRET_FIELD_PATTERN
                            );
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
     * 按选定分类细粒度恢复出厂设置，并可按需从静态 JSON 重新装载官方预设。
     *
     * @param options 细分分类恢复选项
     */
    public async resetPartialToDefaults(options: ResetPartialOptions): Promise<void> {
        const baseDefaults = buildDefaultSettings();
        const needsOfficialPresets = Boolean(
            options.drawingPresets ||
            options.promptPresets ||
            options.workflowPresets ||
            options.themePresets ||
            options.characterPresets ||
            options.outfitPresets ||
            options.materialActivationPresets ||
            options.materialExtractionPresets ||
            options.materialFormatPresets ||
            options.promptStoryPresets ||
            options.promptCharacterPresets ||
            options.promptVocabPresets ||
            options.promptMaterialPresets
        );

        const officialPresets = needsOfficialPresets
            ? await loadOfficialStaticPresets(options.loaderOptions)
            : null;

        // 1. 通用基础运行配置
        if (options.general) {
            this._settings.enabled = baseDefaults.enabled;
            this._settings.activeProvider = baseDefaults.activeProvider;
            this._settings.transport = baseDefaults.transport;
            this._settings.taskTimeoutMs = baseDefaults.taskTimeoutMs;
            this._settings.cancelOnChatChange = baseDefaults.cancelOnChatChange;
            this._settings.saveToServer = baseDefaults.saveToServer;
            this._settings.imageQuality = baseDefaults.imageQuality;
            this._settings.autoGenerate = baseDefaults.autoGenerate;
            this._settings.cleanPrompt = baseDefaults.cleanPrompt;
            this._settings.promptStartTag = baseDefaults.promptStartTag;
            this._settings.promptEndTag = baseDefaults.promptEndTag;
            this._settings.materialConfig.autoSwitchByCard =
                baseDefaults.materialConfig.autoSwitchByCard;
        }

        // 2. 提供商配置
        if (options.providers) {
            this._settings.providers = structuredClone(baseDefaults.providers);
        }

        // 3. 界面交互配置
        if (options.ui) {
            this._settings.ui = structuredClone(baseDefaults.ui);
            this._settings.hasSeenGuide = baseDefaults.hasSeenGuide;
        }

        // 4. 主题预设
        if (options.themePresets && officialPresets) {
            this._settings.presets.themes = structuredClone(officialPresets.themes);
            this._settings.activeThemePresetId = officialPresets.themes[0]?.id || 'default_glass';
        }

        // 5. 绘图参数预设
        if (options.drawingPresets && officialPresets) {
            this._settings.presets.drawing = structuredClone(officialPresets.drawing);
        }

        // 6. 提示词预设
        if (options.promptPresets && officialPresets) {
            this._settings.presets.prompts = structuredClone(officialPresets.prompts);
        }

        // 7. 工作流预设
        if (options.workflowPresets && officialPresets) {
            this._settings.presets.workflows = structuredClone(officialPresets.workflows);
        }

        // 8. 角色档案
        if (options.characterPresets && officialPresets) {
            this._settings.presets.characters = structuredClone(officialPresets.characters);
            this._settings.materialConfig.activeCharacterPresetId =
                officialPresets.characters[0]?.id || '';
        }

        // 9. 服装档案
        if (options.outfitPresets && officialPresets) {
            this._settings.presets.outfits = structuredClone(officialPresets.outfits);
            this._settings.materialConfig.activeOutfitPresetId =
                officialPresets.outfits[0]?.id || '';
        }

        // 10. 素材启用预设
        if (options.materialActivationPresets && officialPresets) {
            this._settings.presets.material_activations = structuredClone(
                officialPresets.material_activations
            );
            this._settings.materialConfig.activeActivationPresetId =
                officialPresets.material_activations[0]?.id || 'mat_act_default';
        }

        // 11. 楼层解析与提取预设
        if (options.materialExtractionPresets && officialPresets) {
            this._settings.presets.material_extractions = structuredClone(
                officialPresets.material_extractions
            );
            this._settings.materialConfig.activeExtractionPresetId =
                officialPresets.material_extractions[0]?.id || 'ext_default';
            this._settings.materialConfig.extraction = structuredClone(
                baseDefaults.materialConfig.extraction
            );
        }

        // 12. 格式与宏规则预设
        if (options.materialFormatPresets && officialPresets) {
            this._settings.presets.material_formats = structuredClone(
                officialPresets.material_formats
            );
            this._settings.materialConfig.activeFormatPresetId =
                officialPresets.material_formats[0]?.id || 'fmt_default';
            this._settings.materialConfig.format = structuredClone(
                baseDefaults.materialConfig.format
            );
            this._settings.materialConfig.characterMacros = structuredClone(
                baseDefaults.materialConfig.characterMacros
            );
            this._settings.materialConfig.outfitMacros = structuredClone(
                baseDefaults.materialConfig.outfitMacros
            );
        }

        // 13. 提示词通道预设 (4大通道)
        if (options.promptStoryPresets && officialPresets) {
            this._settings.presets.prompt_story = structuredClone(officialPresets.prompt_story);
            this._settings.promptInjection.story = structuredClone(
                baseDefaults.promptInjection.story
            );
        }
        if (options.promptCharacterPresets && officialPresets) {
            this._settings.presets.prompt_character = structuredClone(
                officialPresets.prompt_character
            );
            this._settings.promptInjection.character = structuredClone(
                baseDefaults.promptInjection.character
            );
        }
        if (options.promptVocabPresets && officialPresets) {
            this._settings.presets.prompt_vocab = structuredClone(officialPresets.prompt_vocab);
            this._settings.promptInjection.vocab = structuredClone(
                baseDefaults.promptInjection.vocab
            );
        }
        if (options.promptMaterialPresets && officialPresets) {
            this._settings.presets.prompt_material = structuredClone(
                officialPresets.prompt_material
            );
            this._settings.promptInjection.material = structuredClone(
                baseDefaults.promptInjection.material
            );
        }

        // 14. 本地词库清空（可选）
        if (options.resetLocalLexicon) {
            const { localLexiconStorage } = await import('./local-lexicon-storage');
            await localLexiconStorage.clearAll();
        }

        // 15. 本地图库记录与图片缓存清空（可选）
        if (options.resetLocalGallery) {
            const { StorageMaintenanceService } = await import('../ui/viewmodels/storage-maintenance');
            await StorageMaintenanceService.clearAllRecords(false);
        }

        this._settings.isInitialized = true;
        this.saveToHost();

        eventBus.emit('settings:updated', {
            isReset: true,
            keys: Object.keys(this._settings),
        });
    }

    /**
     * 恢复所有设置为默认值并重新异步装载默认静态推荐预设文件。
     */
    public async resetToDefaults(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        return this.resetPartialToDefaults({
            general: true,
            providers: true,
            ui: true,
            drawingPresets: true,
            promptPresets: true,
            workflowPresets: true,
            themePresets: true,
            characterPresets: true,
            outfitPresets: true,
            materialActivationPresets: true,
            materialExtractionPresets: true,
            materialFormatPresets: true,
            promptStoryPresets: true,
            promptCharacterPresets: true,
            promptVocabPresets: true,
            promptMaterialPresets: true,
            resetLocalLexicon: false,
            loaderOptions,
        });
    }
}

/** 全局默认单例配置中心 */
export const settingsStore = new SettingsStore();
