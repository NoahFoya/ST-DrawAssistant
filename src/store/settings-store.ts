/**
 * 插件配置中心与持久化存储服务 (SettingsStore)。
 *
 * @remarks
 * 负责插件配置与预设的管理与持久化：
 * 1. 集中管理通用设置、提供商配置、素材库与提示词四通道预设；
 * 2. 运行时加载大型预设：首次初始化或恢复默认设置时，从 `config/presets/` 异步读取静态 JSON 预设文件；
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
    GeminiProviderConfig,
    GrokProviderConfig,
    PresetCategory,
    PresetItem,
    PresetSettings,
    DrawingPresetData,
    PromptPresetData,
    WorkflowPresetData,
    MaterialLibraryConfig,
    MaterialActivationPresetData,
    MaterialItemActivationRule,
    ActivationTriggerMode,
    PromptInjectionConfig,
    ImageStorageQuality,
} from '@types';
import { PROMPT_POLLING_PRESET_ID } from '../config/constants';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';
import { EMBEDDED_AVATAR_FIELD, materialImageStorage } from './material-image-storage';
import { imageStorage } from './image-storage';
import {
    SECRET_FIELD_PATTERN,
    stripSecretsDeep,
    preserveBlankSecretsDeep,
    restoreProviderSecretsFromStorage,
    persistProviderSecretsToStorage,
} from './secret-vault';
import defaultSettingsData from '../../config/default-settings.json';
import {
    createEmptyPresetSettings,
    loadOfficialStaticPresets,
    type LoadStaticPresetsOptions,
} from './static-preset-loader';

/** 官方预设更新同步分组 */
export type OfficialPresetSyncCategory =
    | 'prompts'
    | 'drawing'
    | 'workflows'
    | 'materialsAndThemes'
    | 'injectionAndRules';

/** 全部官方预设更新同步分组列表（按依赖先后排列） */
export const ALL_OFFICIAL_SYNC_CATEGORIES: readonly OfficialPresetSyncCategory[] = [
    'prompts',
    'workflows',
    'drawing',
    'materialsAndThemes',
    'injectionAndRules',
];

/** 官方预设差异条目类型 */
export type OfficialPresetDiffKind = 'add' | 'update';

/** 官方预设同步执行模式 */
export type OfficialPresetSyncMode = 'add-only' | 'selected';

/** 单条官方预设差异明细 */
export interface OfficialPresetDiffItem {
    readonly key: string;
    readonly category: OfficialPresetSyncCategory;
    readonly bucketLabel: string;
    readonly kind: OfficialPresetDiffKind;
    readonly officialId: string;
    readonly officialName: string;
    readonly localId?: string;
    readonly localName?: string;
    readonly renamed: boolean;
    readonly description?: string;
}

/** 官方预设快速同步分组差异统计 */
export interface OfficialPresetCategoryDiff {
    readonly category: OfficialPresetSyncCategory;
    readonly label: string;
    readonly overwriteCount: number;
    readonly addCount: number;
    readonly customPreservedCount: number;
    readonly items: readonly OfficialPresetDiffItem[];
}

/** 官方预设预览或同步结果统计 */
export interface OfficialPresetSyncResult {
    readonly totalOverwriteCount: number;
    readonly totalAddCount: number;
    readonly totalCustomPreservedCount: number;
    readonly categories: OfficialPresetCategoryDiff[];
}

/** 官方预设同步参数选项 */
export interface SyncOfficialPresetsOptions {
    /** 需要同步的分组清单，未传时同步全部分组 */
    readonly categories?: readonly OfficialPresetSyncCategory[];
    /** 同步模式：'add-only' 仅补充新增项、绝不覆盖；'selected' 按 selectedItemKeys（未传时默认全选）同步 */
    readonly mode?: OfficialPresetSyncMode;
    /** 显式勾选同步的差异条目 key 列表 */
    readonly selectedItemKeys?: readonly string[];
    /** 静态预设加载附加选项（如强制刷新或测试注入 fetcher） */
    readonly loaderOptions?: LoadStaticPresetsOptions;
}

/** 静态预设目录单条目（用于关于页按需载入/卸载管理） */
export interface StaticPresetCatalogItem {
    readonly key: string;
    readonly category: OfficialPresetSyncCategory;
    readonly bucketLabel: string;
    readonly officialId: string;
    readonly officialName: string;
    readonly description?: string;
    readonly loaded: boolean;
    readonly localId?: string;
}

/** 静态预设目录按分类汇总 */
export interface StaticPresetCatalogCategory {
    readonly category: OfficialPresetSyncCategory;
    readonly label: string;
    readonly loadedCount: number;
    readonly totalCount: number;
    readonly items: readonly StaticPresetCatalogItem[];
}

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

/** 绘制预设解析选项 */
export interface ResolveDrawingPresetOptions {
    /** 显式指定的绘图预设 ID */
    explicitPresetId?: string;
    /** 隐式读取配置中的激活预设但未命中时是否抛出异常，默认 false（预处理阶段回退 undefined；实际后端执行传 true） */
    throwOnMissingActive?: boolean;
}

/** 插件核心配置结构定义 */
export interface DrawAssistantSettings {
    isInitialized: boolean;
    hasSeenGuide: boolean;
    lastSeenChangelogVersion?: string;
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
        gemini: GeminiProviderConfig;
        grok: GrokProviderConfig;
        [key: string]: unknown;
    };
    ui: {
        fab: {
            visible: boolean;
            opacity: number;
            icon: string;
            animationType?: 'starlight' | 'orbit-ring' | 'aurora-pulse' | 'ripple' | 'none';
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

const FORBIDDEN_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(item: unknown): item is Record<string, unknown> {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
    }
    const proto = Object.getPrototypeOf(item);
    return proto === null || proto === Object.prototype;
}

/** 递归深度合并两个纯对象，跳过危险原型属性并隔离外部对象引用 */
function deepMerge<T extends object>(target: T, source?: unknown): T {
    if (!isPlainObject(source)) {
        return target;
    }

    const result = { ...target } as Record<string, unknown>;

    for (const key of Object.keys(source)) {
        if (FORBIDDEN_MERGE_KEYS.has(key)) {
            continue;
        }
        const sourceVal = source[key];
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

interface UpsertPresetResult<P> {
    readonly nextList: PresetItem<P>[];
    readonly existedBefore: boolean;
    readonly savedId: string;
    readonly savedItem: PresetItem<P>;
}

/** 预设名称归一化键（用于 UI 判重与存储写入保持一致） */
export function normalizePresetNameKey(name: string): string {
    return name.trim().toLowerCase();
}

/**
 * 纯函数：更新或追加带时间戳的预设项（对角色/服装预设同步对齐外层与内层名称，并保证名称唯一性与 ID 稳定）。
 * 新建预设（`idIndex === -1`）优先采信外层传入的新名称，避免模板或来源副本中的旧 `data.name` 反向覆盖已有条目。
 */
function upsertPresetItem<P>(
    list: PresetItem<P>[],
    item: PresetItem<P>,
    enforceUniqueName = false
): UpsertPresetResult<P> {
    const nextList = [...list];
    const idIndex = nextList.findIndex((p) => p.id === item.id);
    const prevOuterName =
        idIndex >= 0 && typeof nextList[idIndex].name === 'string'
            ? nextList[idIndex].name.trim()
            : '';

    const outerName = typeof item.name === 'string' ? item.name.trim() : '';
    const dataName =
        isPlainObject(item.data) && typeof (item.data as Record<string, unknown>).name === 'string'
            ? ((item.data as Record<string, unknown>).name as string).trim()
            : '';

    const rawIncomingName = enforceUniqueName
        ? idIndex === -1
            ? outerName || dataName
            : outerName && outerName !== prevOuterName && dataName === prevOuterName
              ? outerName
              : dataName || outerName
        : '';
    const incomingName = rawIncomingName ? normalizePresetNameKey(rawIncomingName) : '';

    const nameIndex = incomingName
        ? nextList.findIndex((p, idx) => {
              if (idx === idIndex) return false;
              const existingRaw =
                  isPlainObject(p.data) && typeof (p.data as Record<string, unknown>).name === 'string'
                      ? (p.data as Record<string, unknown>).name
                      : p.name;
              const existingName = normalizePresetNameKey(String(existingRaw || ''));
              return Boolean(existingName && existingName === incomingName);
          })
        : -1;

    if (idIndex >= 0 && nameIndex >= 0) {
        throw new Error(`预设名称 "${rawIncomingName}" 已被现有条目占用，请更换名称`);
    }

    const index = idIndex >= 0 ? idIndex : nameIndex;
    const stableId = index >= 0 ? nextList[index].id : item.id;
    let safeData = item.data;
    if (isPlainObject(safeData)) {
        const hasEmbeddedAvatar = EMBEDDED_AVATAR_FIELD in safeData;
        const needsSyncName =
            enforceUniqueName &&
            Boolean(rawIncomingName) &&
            (safeData as Record<string, unknown>).name !== rawIncomingName;
        if (hasEmbeddedAvatar || needsSyncName) {
            const clonedData = { ...safeData } as Record<string, unknown>;
            if (hasEmbeddedAvatar) {
                delete clonedData[EMBEDDED_AVATAR_FIELD];
            }
            if (needsSyncName) {
                clonedData.name = rawIncomingName;
            }
            safeData = clonedData as P;
        }
    }

    const updated: PresetItem<P> = {
        ...item,
        id: stableId,
        name: enforceUniqueName && rawIncomingName ? rawIncomingName : item.name,
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
        savedItem: updated,
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

/** 清理绘图预设中失效的提示词预设绑定及轮询候选池条目 */
function pruneDrawingPromptRefs(
    dpList: readonly PresetItem<DrawingPresetData>[],
    isRemovedPrompt: (id: string) => boolean,
    fallbackPromptId: string
): { readonly list: PresetItem<DrawingPresetData>[]; readonly changed: boolean } {
    let changed = false;
    const list = dpList.map((dp) => {
        if (!dp?.data) return dp;
        const pid = dp.data.promptPresetId;
        const clearPrompt =
            typeof pid === 'string' &&
            pid.length > 0 &&
            pid !== PROMPT_POLLING_PRESET_ID &&
            isRemovedPrompt(pid);
        const rawPool = dp.data.promptPollingPool;
        const filteredPool = Array.isArray(rawPool)
            ? rawPool.filter((entry) => entry && !isRemovedPrompt(entry.presetId))
            : undefined;
        const poolChanged = Array.isArray(rawPool) && filteredPool!.length !== rawPool.length;
        if (!clearPrompt && !poolChanged) return dp;
        changed = true;
        return {
            ...dp,
            data: {
                ...dp.data,
                ...(clearPrompt ? { promptPresetId: fallbackPromptId } : {}),
                ...(poolChanged ? { promptPollingPool: filteredPool } : {}),
            },
        };
    });
    return { list, changed };
}

/** 清理绘图预设映射表中失效的工作流 / 局部重绘引用 */
function pruneDrawingWorkflowRefs(
    drawingMap: PresetSettings['drawing'],
    isRemovedWorkflow: (id: string) => boolean
): { readonly map: PresetSettings['drawing']; readonly changed: boolean } {
    if (!isPlainObject(drawingMap)) {
        return { map: drawingMap, changed: false };
    }
    const nextMap: Record<string, PresetItem<DrawingPresetData>[]> = {};
    let changed = false;
    for (const [provKey, dpList] of Object.entries(drawingMap)) {
        if (!Array.isArray(dpList)) continue;
        nextMap[provKey] = dpList.map((dp) => {
            if (!dp?.data) return dp;
            const clearTxt = Boolean(dp.data.txt2imgWorkflowId && isRemovedWorkflow(dp.data.txt2imgWorkflowId));
            const clearInp = Boolean(dp.data.inpaintPresetId && isRemovedWorkflow(dp.data.inpaintPresetId));
            if (!clearTxt && !clearInp) return dp;
            changed = true;
            return {
                ...dp,
                data: {
                    ...dp.data,
                    ...(clearTxt ? { txt2imgWorkflowId: '' } : {}),
                    ...(clearInp ? { inpaintPresetId: '' } : {}),
                },
            };
        });
    }
    return { map: changed ? (nextMap as PresetSettings['drawing']) : drawingMap, changed };
}

/** 从角色档案列表的 `boundOutfitIds` 中移除已失效的服装 ID */
function pruneCharacterOutfitRefs<TChar extends PresetItem<{ boundOutfitIds?: string[] }>>(
    characters: TChar[] | undefined,
    isRemovedOutfit: (id: string) => boolean
): { readonly list: TChar[] | undefined; readonly changed: boolean } {
    if (!Array.isArray(characters)) {
        return { list: characters, changed: false };
    }
    let changed = false;
    const list = characters.map((char) => {
        const boundIds = char?.data?.boundOutfitIds;
        if (!Array.isArray(boundIds)) return char;
        const filtered = boundIds.filter((bid) => !isRemovedOutfit(bid));
        if (filtered.length === boundIds.length) return char;
        changed = true;
        return { ...char, data: { ...char.data, boundOutfitIds: filtered } };
    });
    return { list: changed ? list : characters, changed };
}

/** 从素材启用预设中移除已失效的角色或服装激活规则 */
function pruneActivationMaterialRefs(
    activations: PresetItem<MaterialActivationPresetData>[] | undefined,
    isRemovedChar: ((id: string) => boolean) | null,
    isRemovedOutfit: ((id: string) => boolean) | null
): { readonly list: PresetItem<MaterialActivationPresetData>[] | undefined; readonly changed: boolean } {
    if (!Array.isArray(activations) || activations.length === 0) {
        return { list: activations, changed: false };
    }
    let changed = false;
    const pruneRuleMap = (
        rules: Record<string, MaterialItemActivationRule> | undefined,
        isRemoved: (id: string) => boolean
    ): Record<string, MaterialItemActivationRule> | undefined => {
        if (!rules) return rules;
        const nextRules: Record<string, MaterialItemActivationRule> = {};
        let ruleChanged = false;
        for (const [id, rule] of Object.entries(rules)) {
            if (isRemoved(id)) {
                ruleChanged = true;
            } else {
                nextRules[id] = rule;
            }
        }
        if (ruleChanged) {
            changed = true;
            return nextRules;
        }
        return rules;
    };

    const list = activations.map((act) => {
        if (!act?.data) return act;
        const nextCharRules = isRemovedChar
            ? pruneRuleMap(act.data.characterRules, isRemovedChar)
            : act.data.characterRules;
        const nextOutfitRules = isRemovedOutfit
            ? pruneRuleMap(act.data.outfitRules, isRemovedOutfit)
            : act.data.outfitRules;
        if (nextCharRules === act.data.characterRules && nextOutfitRules === act.data.outfitRules) {
            return act;
        }
        return {
            ...act,
            data: {
                ...act.data,
                ...(nextCharRules !== act.data.characterRules ? { characterRules: nextCharRules } : {}),
                ...(nextOutfitRules !== act.data.outfitRules ? { outfitRules: nextOutfitRules } : {}),
            },
        };
    });
    return { list: changed ? list : activations, changed };
}

const OFFICIAL_SYNC_CATEGORY_LABELS: Readonly<Record<OfficialPresetSyncCategory, string>> = {
    prompts: '提示词预设',
    workflows: '工作流预设 (ComfyUI)',
    drawing: '绘图参数预设',
    materialsAndThemes: '角色 / 服装 / 主题外观',
    injectionAndRules: '提示词通道与素材规则',
};

/** 生成键顺序无关的稳定 JSON 字符串，用于比较预设内容是否真正发生变化 */
function canonicalizeForCompare(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalizeForCompare);
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            const v = record[key];
            if (v !== undefined) {
                sorted[key] = canonicalizeForCompare(v);
            }
        }
        return sorted;
    }
    return value;
}

function isPresetContentEqual<T>(
    localItem: PresetItem<T>,
    officialName: string,
    officialDescription: string | undefined,
    officialData: T
): boolean {
    const a = canonicalizeForCompare({
        name: (localItem.name || '').trim(),
        description: localItem.description ?? '',
        data: localItem.data,
    });
    const b = canonicalizeForCompare({
        name: (officialName || '').trim(),
        description: officialDescription ?? '',
        data: officialData,
    });
    return JSON.stringify(a) === JSON.stringify(b);
}

/** 分配不与已占用集合冲突的稳定唯一预设 ID */
function resolveSafeUniquePresetId(preferredId: string, usedIds: Set<string>): string {
    if (preferredId && !usedIds.has(preferredId)) {
        return preferredId;
    }
    const base = preferredId || 'preset';
    let suffix = 1;
    let candidate = `${base}_official`;
    while (usedIds.has(candidate)) {
        suffix += 1;
        candidate = `${base}_official_${suffix}`;
    }
    return candidate;
}

/** 基于当前列表与官方列表构建官方 ID -> 实际本地 ID 映射（ID 优先，规范化名称回退） */
function buildOfficialIdMap<T>(
    effectiveList: readonly PresetItem<T>[],
    officialList: readonly PresetItem<T>[]
): Map<string, string> {
    const map = new Map<string, string>();
    const byId = new Set<string>();
    const byName = new Map<string, PresetItem<T>>();
    for (const item of effectiveList) {
        if (item?.id) byId.add(item.id);
        if (!item?.name) continue;
        const key = normalizePresetNameKey(item.name);
        if (key && !byName.has(key)) {
            byName.set(key, item);
        }
    }
    for (const off of officialList) {
        if (!off?.id) continue;
        if (byId.has(off.id)) {
            map.set(off.id, off.id);
            continue;
        }
        const matched = byName.get(normalizePresetNameKey(off.name || ''));
        if (matched) {
            map.set(off.id, matched.id);
        }
    }
    return map;
}

const ALL_PROVIDERS: readonly ProviderType[] = [
    'comfyui',
    'sdwebui',
    'novelai',
    'openai',
    'gemini',
    'grok',
] as const;

const PROVIDER_BUCKET_LABELS: Readonly<Record<string, string>> = {
    comfyui: 'ComfyUI',
    sdwebui: 'SD-WebUI',
    novelai: 'NovelAI',
    openai: 'OpenAI 兼容',
    gemini: 'Google Gemini',
    grok: 'xAI Grok',
};

const INJECTION_BUCKET_LABELS: Readonly<Record<string, string>> = {
    material_activations: '素材启用规则',
    material_extractions: '楼层提取规则',
    material_formats: '格式与宏定义',
    prompt_story: '故事插画',
    prompt_character: '素材创作',
    prompt_vocab: '词汇指导',
    prompt_material: '素材注入',
};

/**
 * 纯函数：按「官方 ID 优先 + 规范化名称回退」匹配并合并单个预设数组。
 * - 支持 `mode: 'add-only'`（仅新增缺失项）与 `selectedKeys`（逐条精细勾选）。
 * - 未被选中的已有预设与所有用户自建/非匹配预设完整保留。
 */
function mergePresetListByName<T>(
    localList: readonly PresetItem<T>[],
    officialList: readonly PresetItem<T>[],
    options: {
        readonly now?: number;
        readonly category: OfficialPresetSyncCategory;
        readonly bucketKey: string;
        readonly bucketLabel: string;
        readonly mode?: OfficialPresetSyncMode;
        readonly selectedKeys?: ReadonlySet<string>;
        readonly transformData?: (data: T, officialItem: PresetItem<T>) => T;
    }
): {
    readonly nextList: PresetItem<T>[];
    readonly overwriteCount: number;
    readonly addCount: number;
    readonly customPreservedCount: number;
    readonly diffItems: OfficialPresetDiffItem[];
} {
    const now = options.now ?? Date.now();
    const mode = options.mode ?? 'selected';
    const selectedKeys = options.selectedKeys;
    const safeLocal = Array.isArray(localList) ? localList : [];
    const safeOfficial = Array.isArray(officialList) ? officialList : [];

    const nextList = safeLocal.map((item) => structuredClone(item));
    const indexById = new Map<string, number>();
    const indexByName = new Map<string, number>();
    const usedIds = new Set<string>();
    const matchedLocalIndices = new Set<number>();

    for (let idx = 0; idx < nextList.length; idx++) {
        const item = nextList[idx];
        if (item?.id) {
            usedIds.add(item.id);
            if (!indexById.has(item.id)) {
                indexById.set(item.id, idx);
            }
        }
        const key = item?.name ? normalizePresetNameKey(item.name) : '';
        if (key && !indexByName.has(key)) {
            indexByName.set(key, idx);
        }
    }

    let overwriteCount = 0;
    let addCount = 0;
    const diffItems: OfficialPresetDiffItem[] = [];

    for (const off of safeOfficial) {
        if (!off?.name) continue;
        const nameKey = normalizePresetNameKey(off.name);
        if (!nameKey) continue;

        const itemKey = `${options.category}:${options.bucketKey}:${off.id || nameKey}`;
        const transformedData = options.transformData
            ? options.transformData(structuredClone(off.data), off)
            : structuredClone(off.data);

        const idIdx = off.id ? indexById.get(off.id) : undefined;
        const nameIdx = indexByName.get(nameKey);
        const existingIdx = idIdx !== undefined ? idIdx : nameIdx;

        if (existingIdx !== undefined) {
            matchedLocalIndices.add(existingIdx);
            const localItem = nextList[existingIdx];
            if (!isPresetContentEqual(localItem, off.name, off.description, transformedData)) {
                const renamed = Boolean(
                    localItem.name && normalizePresetNameKey(localItem.name) !== nameKey
                );
                diffItems.push({
                    key: itemKey,
                    category: options.category,
                    bucketLabel: options.bucketLabel,
                    kind: 'update',
                    officialId: off.id || nameKey,
                    officialName: off.name,
                    localId: localItem.id,
                    localName: localItem.name,
                    renamed,
                    description: off.description,
                });

                const shouldApply =
                    mode !== 'add-only' && (!selectedKeys || selectedKeys.has(itemKey));
                if (shouldApply) {
                    overwriteCount += 1;
                    nextList[existingIdx] = {
                        ...localItem,
                        name: off.name,
                        ...(off.description !== undefined ? { description: off.description } : {}),
                        data: transformedData,
                        updatedAt: now,
                    };
                }
            }
        } else {
            diffItems.push({
                key: itemKey,
                category: options.category,
                bucketLabel: options.bucketLabel,
                kind: 'add',
                officialId: off.id || nameKey,
                officialName: off.name,
                renamed: false,
                description: off.description,
            });

            const shouldApply = !selectedKeys || selectedKeys.has(itemKey);
            if (shouldApply) {
                addCount += 1;
                const nextId = resolveSafeUniquePresetId(off.id, usedIds);
                usedIds.add(nextId);
                const addedItem: PresetItem<T> = {
                    ...structuredClone(off),
                    id: nextId,
                    data: transformedData,
                    createdAt: off.createdAt ?? now,
                    updatedAt: now,
                };
                indexById.set(nextId, nextList.length);
                indexByName.set(nameKey, nextList.length);
                nextList.push(addedItem);
            }
        }
    }

    const customPreservedCount = Math.max(0, safeLocal.length - matchedLocalIndices.size);
    return { nextList, overwriteCount, addCount, customPreservedCount, diffItems };
}

interface OfficialSyncPlan {
    readonly nextPresets: PresetSettings;
    readonly result: OfficialPresetSyncResult;
}

/** 计算官方预设同步执行计划（供干跑预览与真实持久化共用） */
function planOfficialPresetSync(
    current: PresetSettings,
    official: PresetSettings,
    selectedCategories: readonly OfficialPresetSyncCategory[],
    options?: {
        readonly mode?: OfficialPresetSyncMode;
        readonly selectedItemKeys?: readonly string[];
    }
): OfficialSyncPlan {
    const selectedSet = new Set<OfficialPresetSyncCategory>(selectedCategories);
    const mode: OfficialPresetSyncMode = options?.mode ?? 'selected';
    const selectedKeys = options?.selectedItemKeys
        ? new Set<string>(options.selectedItemKeys)
        : undefined;
    const nextPresets = structuredClone(current);
    const now = Date.now();
    const diffs: OfficialPresetCategoryDiff[] = [];

    // 1. 提示词预设 (按提供商分桶)
    {
        let overwriteCount = 0;
        let addCount = 0;
        let customPreservedCount = 0;
        const items: OfficialPresetDiffItem[] = [];
        const providerKeys = new Set([
            ...Object.keys(nextPresets.prompts || {}),
            ...Object.keys(official.prompts || {}),
        ]);
        for (const provKey of providerKeys) {
            const localArr = nextPresets.prompts?.[provKey] || [];
            const offArr = official.prompts?.[provKey] || [];
            if (selectedSet.has('prompts')) {
                const merged = mergePresetListByName(localArr, offArr, {
                    now,
                    category: 'prompts',
                    bucketKey: provKey,
                    bucketLabel: PROVIDER_BUCKET_LABELS[provKey] || provKey,
                    mode,
                    selectedKeys,
                });
                nextPresets.prompts[provKey] = merged.nextList;
                overwriteCount += merged.overwriteCount;
                addCount += merged.addCount;
                customPreservedCount += merged.customPreservedCount;
                items.push(...merged.diffItems);
            }
        }
        if (selectedSet.has('prompts')) {
            diffs.push({
                category: 'prompts',
                label: OFFICIAL_SYNC_CATEGORY_LABELS.prompts,
                overwriteCount,
                addCount,
                customPreservedCount,
                items,
            });
        }
    }

    // 2. ComfyUI 工作流预设
    if (selectedSet.has('workflows')) {
        const merged = mergePresetListByName(
            nextPresets.workflows || [],
            official.workflows || [],
            {
                now,
                category: 'workflows',
                bucketKey: 'workflows',
                bucketLabel: 'ComfyUI 工作流',
                mode,
                selectedKeys,
            }
        );
        nextPresets.workflows = merged.nextList;
        diffs.push({
            category: 'workflows',
            label: OFFICIAL_SYNC_CATEGORY_LABELS.workflows,
            overwriteCount: merged.overwriteCount,
            addCount: merged.addCount,
            customPreservedCount: merged.customPreservedCount,
            items: merged.diffItems,
        });
    }

    // 3. 绘图参数预设（依托上方解析后的提示词与工作流本地 ID 重映射引用）
    if (selectedSet.has('drawing')) {
        const workflowIdMap = buildOfficialIdMap(
            nextPresets.workflows || [],
            official.workflows || []
        );
        let overwriteCount = 0;
        let addCount = 0;
        let customPreservedCount = 0;
        const items: OfficialPresetDiffItem[] = [];
        const providerKeys = new Set([
            ...Object.keys(nextPresets.drawing || {}),
            ...Object.keys(official.drawing || {}),
        ]);
        for (const provKey of providerKeys) {
            const localArr = nextPresets.drawing?.[provKey] || [];
            const offArr = official.drawing?.[provKey] || [];
            const promptIdMap = buildOfficialIdMap(
                nextPresets.prompts?.[provKey] || [],
                official.prompts?.[provKey] || []
            );
            const merged = mergePresetListByName(localArr, offArr, {
                now,
                category: 'drawing',
                bucketKey: provKey,
                bucketLabel: PROVIDER_BUCKET_LABELS[provKey] || provKey,
                mode,
                selectedKeys,
                transformData: (data) => {
                    const remapped = { ...data };
                    if (
                        remapped.promptPresetId &&
                        remapped.promptPresetId !== PROMPT_POLLING_PRESET_ID
                    ) {
                        remapped.promptPresetId =
                            promptIdMap.get(remapped.promptPresetId) ?? remapped.promptPresetId;
                    }
                    if (remapped.txt2imgWorkflowId) {
                        remapped.txt2imgWorkflowId =
                            workflowIdMap.get(remapped.txt2imgWorkflowId) ??
                            remapped.txt2imgWorkflowId;
                    }
                    if (remapped.inpaintPresetId) {
                        remapped.inpaintPresetId =
                            workflowIdMap.get(remapped.inpaintPresetId) ??
                            remapped.inpaintPresetId;
                    }
                    if (Array.isArray(remapped.promptPollingPool)) {
                        remapped.promptPollingPool = remapped.promptPollingPool.map((entry) => ({
                            ...entry,
                            presetId: promptIdMap.get(entry.presetId) ?? entry.presetId,
                        }));
                    }
                    return remapped;
                },
            });
            nextPresets.drawing[provKey] = merged.nextList;
            overwriteCount += merged.overwriteCount;
            addCount += merged.addCount;
            customPreservedCount += merged.customPreservedCount;
            items.push(...merged.diffItems);
        }
        diffs.push({
            category: 'drawing',
            label: OFFICIAL_SYNC_CATEGORY_LABELS.drawing,
            overwriteCount,
            addCount,
            customPreservedCount,
            items,
        });
    }

    // 4. 角色 / 服装 / 主题外观
    if (selectedSet.has('materialsAndThemes')) {
        const outfitsMerged = mergePresetListByName(
            nextPresets.outfits || [],
            official.outfits || [],
            {
                now,
                category: 'materialsAndThemes',
                bucketKey: 'outfits',
                bucketLabel: '服装档案',
                mode,
                selectedKeys,
            }
        );
        nextPresets.outfits = outfitsMerged.nextList;
        const outfitIdMap = buildOfficialIdMap(nextPresets.outfits, official.outfits || []);

        const charsMerged = mergePresetListByName(
            nextPresets.characters || [],
            official.characters || [],
            {
                now,
                category: 'materialsAndThemes',
                bucketKey: 'characters',
                bucketLabel: '角色档案',
                mode,
                selectedKeys,
                transformData: (data) => {
                    if (!Array.isArray(data.boundOutfitIds)) return data;
                    return {
                        ...data,
                        boundOutfitIds: data.boundOutfitIds.map((oid) => outfitIdMap.get(oid) ?? oid),
                    };
                },
            }
        );
        nextPresets.characters = charsMerged.nextList;

        const themesMerged = mergePresetListByName(
            nextPresets.themes || [],
            official.themes || [],
            {
                now,
                category: 'materialsAndThemes',
                bucketKey: 'themes',
                bucketLabel: '界面主题',
                mode,
                selectedKeys,
            }
        );
        nextPresets.themes = themesMerged.nextList;

        diffs.push({
            category: 'materialsAndThemes',
            label: OFFICIAL_SYNC_CATEGORY_LABELS.materialsAndThemes,
            overwriteCount:
                outfitsMerged.overwriteCount +
                charsMerged.overwriteCount +
                themesMerged.overwriteCount,
            addCount: outfitsMerged.addCount + charsMerged.addCount + themesMerged.addCount,
            customPreservedCount:
                outfitsMerged.customPreservedCount +
                charsMerged.customPreservedCount +
                themesMerged.customPreservedCount,
            items: [
                ...outfitsMerged.diffItems,
                ...charsMerged.diffItems,
                ...themesMerged.diffItems,
            ],
        });
    }

    // 5. 提示词通道与素材规则预设
    if (selectedSet.has('injectionAndRules')) {
        const ruleKeys = [
            'material_activations',
            'material_extractions',
            'material_formats',
            'prompt_story',
            'prompt_character',
            'prompt_vocab',
            'prompt_material',
        ] as const;

        let overwriteCount = 0;
        let addCount = 0;
        let customPreservedCount = 0;
        const items: OfficialPresetDiffItem[] = [];

        for (const key of ruleKeys) {
            const localArr = (nextPresets[key] as PresetItem<unknown>[]) || [];
            const offArr = (official[key] as PresetItem<unknown>[]) || [];
            const merged = mergePresetListByName(localArr, offArr, {
                now,
                category: 'injectionAndRules',
                bucketKey: key,
                bucketLabel: INJECTION_BUCKET_LABELS[key] || key,
                mode,
                selectedKeys,
            });
            (nextPresets as unknown as Record<string, unknown>)[key] = merged.nextList;
            overwriteCount += merged.overwriteCount;
            addCount += merged.addCount;
            customPreservedCount += merged.customPreservedCount;
            items.push(...merged.diffItems);
        }

        diffs.push({
            category: 'injectionAndRules',
            label: OFFICIAL_SYNC_CATEGORY_LABELS.injectionAndRules,
            overwriteCount,
            addCount,
            customPreservedCount,
            items,
        });
    }

    const totalOverwriteCount = diffs.reduce((sum, d) => sum + d.overwriteCount, 0);
    const totalAddCount = diffs.reduce((sum, d) => sum + d.addCount, 0);
    const totalCustomPreservedCount = diffs.reduce((sum, d) => sum + d.customPreservedCount, 0);

    return {
        nextPresets,
        result: {
            totalOverwriteCount,
            totalAddCount,
            totalCustomPreservedCount,
            categories: diffs,
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
    private static readonly SECRET_FIELD_PATTERN = SECRET_FIELD_PATTERN;

    private _settings: DrawAssistantSettings;
    private _hasInitializedFromHost = false;

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

        // 从本地浏览器存储载入敏感凭据
        this.restoreLocalSecrets();
        this._hasInitializedFromHost = true;

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
                    '';

                this._settings = {
                    ...this._settings,
                    isInitialized: true,
                    activeThemePresetId: resolvedThemePreset,
                    presets: mergedPresets,
                };
                this.reconcileActivePresetPointers();
                this.saveToHost();
                eventBus.emit('settings:updated', {
                    keys: [
                        'isInitialized',
                        'presets',
                        'activeThemePresetId',
                        'promptInjection',
                        'materialConfig',
                        'providers',
                    ],
                });
            } catch (err) {
                logger.error('[SettingsStore] 初始化加载默认静态预设失败:', err);
                throw err;
            }
        } else if (this.reconcileActivePresetPointers()) {
            this.saveToHost();
            eventBus.emit('settings:updated', {
                keys: [
                    'activeThemePresetId',
                    'promptInjection',
                    'materialConfig',
                    'providers',
                ],
            });
        }
    }

    /**
     * 从静态预设文件重新导入全套默认推荐预设并激活就绪。
     */
    public async importOfficialPresets(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        const officialPresets = await loadOfficialStaticPresets(loaderOptions);
        const prevThemePreset = this._settings.activeThemePresetId;
        const resolvedThemePreset =
            prevThemePreset || officialPresets.themes[0]?.id || '';

        this._settings = {
            ...this._settings,
            isInitialized: true,
            activeThemePresetId: resolvedThemePreset,
            presets: officialPresets,
        };
        const reconciled = this.reconcileActivePresetPointers();
        const updateKeys = ['presets', 'isInitialized'];
        if (reconciled || resolvedThemePreset !== prevThemePreset) {
            updateKeys.push('activeThemePresetId', 'promptInjection', 'materialConfig', 'providers');
        }

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
        this.saveToHost(key === 'providers');
    }

    /**
     * 批量合并更新配置。
     * @param patch 待合并的部分配置对象
     */
    public update(patch: Partial<DrawAssistantSettings>): void {
        this._settings = deepMerge(this._settings, patch);
        const allKeys = Object.keys(patch);

        eventBus.emit('settings:updated', { keys: allKeys, patch });
        this.saveToHost(patch.providers !== undefined);
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
        this.saveToHost(true);
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
     * 解析指定服务提供方当前生效的绘图预设。
     *
     * @remarks
     * 解析优先级：显式传入 `explicitPresetId` > 服务配置 `activeDrawingPresetId`。
     * 语义约束：
     * - 显式指定非 `'default'` ID 缺失时固定抛出异常，防止携带无效参数快照继续生图；
     * - 隐式读取配置激活项缺失时按 `throwOnMissingActive` 决定抛出异常或返回 `{ presetId: undefined, preset: undefined }`；
     * - ID 为 `'default'` 且未显式持久化条目时允许 `preset` 为 `undefined`。
     *
     * @param provider 服务提供方类型
     * @param options 解析选项
     * @returns 解析得到的有效预设 ID 与预设数据
     */
    public resolveDrawingPreset<T = Record<string, unknown>>(
        provider: ProviderType,
        options: ResolveDrawingPresetOptions = {}
    ): { presetId?: string; preset?: T } {
        const explicitId =
            typeof options.explicitPresetId === 'string' && options.explicitPresetId.trim()
                ? options.explicitPresetId.trim()
                : undefined;

        let effectiveId = explicitId;
        if (!effectiveId) {
            const config = this.getProviderConfig<{ activeDrawingPresetId?: string }>(provider);
            const activeId = config?.activeDrawingPresetId;
            if (typeof activeId === 'string' && activeId.trim()) {
                effectiveId = activeId.trim();
            }
        }

        if (!effectiveId) {
            return {};
        }

        const item = this.getPreset<T>('drawing', effectiveId, provider);
        if (item?.data) {
            return { presetId: effectiveId, preset: item.data };
        }

        if (effectiveId === 'default') {
            return { presetId: 'default', preset: undefined };
        }

        if (explicitId) {
            throw new Error(`关联的生图预设已失效或不存在 (ID: ${effectiveId})，请重新选择预设`);
        }

        if (options.throwOnMissingActive) {
            throw new Error(`当前激活的绘图预设已失效或不存在 (ID: ${effectiveId})，请重新选择预设`);
        }

        return {};
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
        let emittedItem: PresetItem<T> = timestampedItem;

        if (category === 'drawing' || category === 'prompts') {
            const providerKey = providerType || this._settings.activeProvider;
            const currentList = this.getPresets<T>(category, providerKey);
            const { nextList, savedItem } = upsertPresetItem(currentList, timestampedItem);
            emittedItem = savedItem;

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
            const { nextList, existedBefore, savedId, savedItem } = upsertPresetItem(
                currentList,
                timestampedItem,
                isMaterialArchive
            );
            emittedItem = savedItem;
            const previousAvatarId = isMaterialArchive
                ? String(
                      (
                          currentList.find((p) => p.id === savedId)?.data as
                              | Record<string, unknown>
                              | undefined
                      )?.avatarId || ''
                  ).trim()
                : '';
            const nextAvatarId = isMaterialArchive
                ? String(
                      (savedItem.data as Record<string, unknown> | undefined)?.avatarId || ''
                  ).trim()
                : '';

            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    [category]: nextList,
                },
            };

            if (category === 'outfits') {
                this.reconcileCharacterBoundOutfitRef(savedItem.name, savedId);
            }

            if (isMaterialArchive) {
                if (previousAvatarId && previousAvatarId !== nextAvatarId) {
                    this.cleanupUnusedMaterialAvatars([previousAvatarId]);
                }
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

        eventBus.emit('settings:updated', { key: `presets.${category}`, value: emittedItem });
        this.saveToHost();
    }

    /** 内部辅助：定位目标素材启用预设并将单条角色或服装规则合并写回配置 */
    private applyMaterialActivationRulePatch(
        kind: 'character' | 'outfit',
        materialPresetId: string,
        buildRule: (prev?: MaterialItemActivationRule) => MaterialItemActivationRule,
        activationPresetId?: string
    ): PresetItem<MaterialActivationPresetData> | null {
        if (!materialPresetId.trim()) {
            return null;
        }
        const actList = this._settings.presets.material_activations;
        if (!Array.isArray(actList) || actList.length === 0) {
            return null;
        }
        const targetId =
            activationPresetId || this._settings.materialConfig?.activeActivationPresetId || '';
        const targetIndex = actList.findIndex((p) => p.id === targetId);
        const resolvedIndex = targetIndex >= 0 ? targetIndex : 0;
        const targetPreset = actList[resolvedIndex];
        if (!targetPreset?.data) {
            return null;
        }

        const nextData = structuredClone(targetPreset.data);
        const mapKey = kind === 'character' ? 'characterRules' : 'outfitRules';
        const existingMap = nextData[mapKey] || {};
        nextData[mapKey] = {
            ...existingMap,
            [materialPresetId]: buildRule(existingMap[materialPresetId]),
        };

        const nextPreset: PresetItem<MaterialActivationPresetData> = {
            ...targetPreset,
            data: nextData,
            updatedAt: Date.now(),
        };
        const nextActList = [...actList];
        nextActList[resolvedIndex] = nextPreset;

        this._settings = {
            ...this._settings,
            presets: {
                ...this._settings.presets,
                material_activations: nextActList,
            },
        };
        return nextPreset;
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
        const updatedPreset = this.applyMaterialActivationRulePatch(
            kind,
            materialPresetId,
            () => ({ ...rule }),
            activationPresetId
        );
        if (!updatedPreset) {
            return false;
        }

        eventBus.emit('settings:updated', {
            key: 'presets.material_activations',
            value: updatedPreset,
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
        this.applyMaterialActivationRulePatch(kind, materialPresetId, (prevRule) => ({
            enabled: true,
            triggerMode: prevRule?.triggerMode || defaultTriggerMode,
        }));
    }

    /** 保存服装预设后，将角色 boundOutfitIds 中对应的待绑定同名服装引用替换为该服装预设 ID */
    private reconcileCharacterBoundOutfitRef(outfitName: string, outfitId: string): void {
        const cleanKey = normalizePresetNameKey(outfitName);
        if (!cleanKey || !outfitId) return;

        const chars = this._settings.presets.characters;
        if (!Array.isArray(chars) || chars.length === 0) return;

        let changed = false;
        const nextChars = chars.map((char) => {
            const boundIds = char?.data?.boundOutfitIds;
            if (!Array.isArray(boundIds) || boundIds.length === 0) return char;

            let itemChanged = false;
            const replaced: string[] = [];
            const seen = new Set<string>();
            for (const rawRef of boundIds) {
                const ref = (rawRef || '').trim();
                if (!ref) continue;
                const mapped = normalizePresetNameKey(ref) === cleanKey ? outfitId : ref;
                if (mapped !== ref) {
                    itemChanged = true;
                }
                if (!seen.has(mapped)) {
                    seen.add(mapped);
                    replaced.push(mapped);
                } else {
                    itemChanged = true;
                }
            }

            if (!itemChanged) return char;
            changed = true;
            return {
                ...char,
                data: {
                    ...char.data,
                    boundOutfitIds: replaced,
                },
            };
        });

        if (changed) {
            this._settings = {
                ...this._settings,
                presets: {
                    ...this._settings.presets,
                    characters: nextChars,
                },
            };
        }
    }

    /**
     * 删除指定预设，并同步清理依赖它的关联引用：
     * 1. 删除提示词预设时，将引用它的绘图预设 `promptPresetId` 重置为可用首项或空串；
     * 2. 删除工作流预设时，清理绘图预设中失效的 `txt2imgWorkflowId` / `inpaintPresetId` 引用；
     * 3. 删除角色或服装时，从各素材启用预设中移除对应规则；
     * 4. 删除服装时，从所有角色的 `boundOutfitIds` 中移除该服装 ID；
     * 5. 删除当前激活的主题或提示词通道预设时，回退至剩余列表首项或默认预设。
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
            let updatedProviders = this._settings.providers;
            // 若删除的是提示词预设，对齐固定绑定并从轮询候选池清理该失效 ID（保留 '__polling__' 特殊绑定）
            if (category === 'prompts' && updatedDrawingPresets?.[providerKey]) {
                const fallbackPromptId = nextList[0]?.id || '';
                const pruned = pruneDrawingPromptRefs(
                    updatedDrawingPresets[providerKey] || [],
                    (pid) => pid === id,
                    fallbackPromptId
                );
                if (pruned.changed) {
                    updatedDrawingPresets = {
                        ...updatedDrawingPresets,
                        [providerKey]: pruned.list,
                    };
                }
            } else if (
                category === 'drawing' &&
                updatedProviders?.[providerKey] &&
                (updatedProviders[providerKey] as { activeDrawingPresetId?: string })
                    .activeDrawingPresetId === id
            ) {
                updatedProviders = {
                    ...updatedProviders,
                    [providerKey]: {
                        ...(updatedProviders[providerKey] as Record<string, unknown>),
                        activeDrawingPresetId: nextList[0]?.id || '',
                    },
                } as DrawAssistantSettings['providers'];
            }

            this._settings = {
                ...this._settings,
                providers: updatedProviders,
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
        const targetItem = currentList.find((p) => p.id === id);
        if (!targetItem) {
            return false;
        }
        const nextList = currentList.filter((p) => p.id !== id);
        const removedAvatarId =
            (category === 'characters' || category === 'outfits') &&
            isPlainObject(targetItem.data) &&
            typeof (targetItem.data as Record<string, unknown>).avatarId === 'string'
                ? ((targetItem.data as Record<string, unknown>).avatarId as string)
                : '';

        // 1. 删除工作流时，清理绘图预设内的 txt2imgWorkflowId / inpaintPresetId 失效引用
        const nextDrawingPresets =
            category === 'workflows'
                ? pruneDrawingWorkflowRefs(this._settings.presets.drawing, (wid) => wid === id).map
                : this._settings.presets.drawing;

        // 2. 同步清理素材启用预设中的激活规则引用
        const nextActivations =
            category === 'characters' || category === 'outfits'
                ? pruneActivationMaterialRefs(
                      this._settings.presets.material_activations,
                      category === 'characters' ? (cid) => cid === id : null,
                      category === 'outfits' ? (oid) => oid === id : null
                  ).list
                : this._settings.presets.material_activations;

        // 3. 删除服装时，同步清理角色预设中的专属服装绑定引用
        const nextCharacters =
            category === 'outfits'
                ? pruneCharacterOutfitRefs(this._settings.presets.characters, (oid) => oid === id)
                      .list
                : this._settings.presets.characters;

        // 4. 素材类激活项回退：角色 / 服装 / 启用 / 解析 / 格式
        let nextMaterialConfig = this._settings.materialConfig;
        if (
            category === 'characters' &&
            nextMaterialConfig.activeCharacterPresetId === id
        ) {
            nextMaterialConfig = {
                ...nextMaterialConfig,
                activeCharacterPresetId: nextList[0]?.id || '',
            };
        } else if (
            category === 'outfits' &&
            nextMaterialConfig.activeOutfitPresetId === id
        ) {
            nextMaterialConfig = {
                ...nextMaterialConfig,
                activeOutfitPresetId: nextList[0]?.id || '',
            };
        } else if (
            category === 'material_activations' &&
            nextMaterialConfig.activeActivationPresetId === id
        ) {
            nextMaterialConfig = {
                ...nextMaterialConfig,
                activeActivationPresetId: nextList[0]?.id || '',
            };
        } else if (
            category === 'material_extractions' &&
            nextMaterialConfig.activeExtractionPresetId === id
        ) {
            nextMaterialConfig = {
                ...nextMaterialConfig,
                activeExtractionPresetId: nextList[0]?.id || '',
            };
        } else if (
            category === 'material_formats' &&
            nextMaterialConfig.activeFormatPresetId === id
        ) {
            nextMaterialConfig = {
                ...nextMaterialConfig,
                activeFormatPresetId: nextList[0]?.id || '',
            };
        }

        // 5. 提示词通道激活项对齐：若删除项为激活预设，自动对齐为剩余列表首项
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

        // 6. 主题预设激活项对齐：若删除项为当前激活主题，自动对齐为剩余主题首项
        let nextThemePreset = this._settings.activeThemePresetId;
        if (category === 'themes' && nextThemePreset === id) {
            nextThemePreset = nextList[0]?.id || '';
        }

        this._settings = {
            ...this._settings,
            activeThemePresetId: nextThemePreset,
            promptInjection: nextPromptInjection,
            materialConfig: nextMaterialConfig,
            presets: {
                ...this._settings.presets,
                [category]: nextList,
                ...(nextDrawingPresets !== this._settings.presets.drawing
                    ? { drawing: nextDrawingPresets }
                    : {}),
                ...(category === 'outfits' && nextCharacters !== this._settings.presets.characters
                    ? { characters: nextCharacters }
                    : {}),
                ...(nextActivations !== this._settings.presets.material_activations
                    ? { material_activations: nextActivations }
                    : {}),
            },
        };

        if (removedAvatarId) {
            this.cleanupUnusedMaterialAvatars([removedAvatarId]);
        }

        eventBus.emit('settings:updated', {
            key: `presets.${category}`,
            value: { deletedId: id },
        });
        this.saveToHost();
        return true;
    }

    /** 清理已不再被任何角色或服装预设引用的素材头像 Blob */
    private cleanupUnusedMaterialAvatars(candidateAvatarIds: Iterable<string>): void {
        const candidates = new Set<string>();
        for (const id of candidateAvatarIds) {
            const clean = (id || '').trim();
            if (clean) candidates.add(clean);
        }
        if (candidates.size === 0) return;

        const inUse = new Set<string>();
        for (const item of this._settings.presets.characters || []) {
            const avatarId = item?.data?.avatarId?.trim();
            if (avatarId) inUse.add(avatarId);
        }
        for (const item of this._settings.presets.outfits || []) {
            const avatarId = item?.data?.avatarId?.trim();
            if (avatarId) inUse.add(avatarId);
        }

        for (const id of candidates) {
            if (!inUse.has(id)) {
                void materialImageStorage.deleteAvatar(id);
            }
        }
    }

    /**
     * 将当前内存配置持久化同步至 SillyTavern 宿主。
     *
     * @param syncSecrets 是否同步写入本地隔离私密凭据；初始化完成后默认同步，初始化前仅在显式修改 providers 时写入
     */
    public saveToHost(syncSecrets = false): void {
        // 1. 仅在宿主初始化完成后或显式更新提供方凭据时写入本地隔离存储，防止初始化前写入空密钥抹除已有凭据
        if (syncSecrets || this._hasInitializedFromHost) {
            this.persistLocalSecrets();
        }

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

    /** 从本地浏览器存储载入敏感凭据并合并入内存 */
    private restoreLocalSecrets(): void {
        restoreProviderSecretsFromStorage(this._settings.providers);
    }

    /** 将内存中的敏感凭据保存至本地浏览器存储 */
    private persistLocalSecrets(): void {
        persistProviderSecretsToStorage(this._settings.providers);
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
        const snapshot = includeSecrets
            ? this._settings
            : this.stripSecretsFromSettings(this._settings);

        return JSON.stringify(snapshot, null, 2);
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

            const parsedRecord = parsed as Record<string, unknown>;
            const KNOWN_SETTINGS_KEYS = [
                'isInitialized',
                'hasSeenGuide',
                'enabled',
                'activeProvider',
                'transport',
                'taskTimeoutMs',
                'cancelOnChatChange',
                'saveToServer',
                'imageQuality',
                'autoGenerate',
                'cleanPrompt',
                'promptStartTag',
                'promptEndTag',
                'activeThemePresetId',
                'presets',
                'promptInjection',
                'materialConfig',
                'providers',
                'ui',
            ];
            const hasKnownKey = KNOWN_SETTINGS_KEYS.some((k) => k in parsedRecord);
            const looksLikeSinglePreset =
                !hasKnownKey && isPlainObject(parsedRecord.data);
            const looksLikeComfyWorkflow =
                !hasKnownKey &&
                (Array.isArray(parsedRecord.nodes) ||
                    Object.values(parsedRecord).some(
                        (v) =>
                            isPlainObject(v) &&
                            typeof v.class_type === 'string' &&
                            isPlainObject(v.inputs)
                    ));
            if (!hasKnownKey || looksLikeSinglePreset || looksLikeComfyWorkflow) {
                return {
                    success: false,
                    error: looksLikeComfyWorkflow
                        ? '检测到该文件为 ComfyUI 工作流 JSON，请前往「ComfyUI → 工作流设置」导入'
                        : looksLikeSinglePreset
                          ? '检测到该文件为单项预设 JSON，请前往对应功能选项卡的预设栏导入'
                          : '配置备份格式无效：未包含有效的插件全局配置字段',
                };
            }

            if ('presets' in parsedRecord) {
                if (!isPlainObject(parsedRecord.presets)) {
                    return { success: false, error: '配置备份格式无效：presets 字段必须为对象' };
                }
                const cleanedPresets: Record<string, unknown> = {};
                for (const [catKey, catVal] of Object.entries(parsedRecord.presets)) {
                    if (FORBIDDEN_MERGE_KEYS.has(catKey)) continue;
                    if (Array.isArray(catVal)) {
                        cleanedPresets[catKey] = catVal.filter(
                            (item) => isPlainObject(item) && typeof item.id === 'string' && isPlainObject(item.data)
                        );
                    } else if (isPlainObject(catVal)) {
                        const subMap: Record<string, unknown> = {};
                        for (const [subKey, subArr] of Object.entries(catVal)) {
                            if (FORBIDDEN_MERGE_KEYS.has(subKey)) continue;
                            if (Array.isArray(subArr)) {
                                subMap[subKey] = subArr.filter(
                                    (item) =>
                                        isPlainObject(item) && typeof item.id === 'string' && isPlainObject(item.data)
                                );
                            }
                        }
                        cleanedPresets[catKey] = subMap;
                    }
                }
                parsedRecord.presets = cleanedPresets;
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

            const oldAvatarIds: string[] = [];
            for (const c of this._settings.presets.characters || []) {
                if (c?.data?.avatarId) oldAvatarIds.push(c.data.avatarId);
            }
            for (const o of this._settings.presets.outfits || []) {
                if (o?.data?.avatarId) oldAvatarIds.push(o.data.avatarId);
            }

            const patchKeys = new Set<string>(Object.keys(parsed));
            this._settings = deepMerge(this._settings, parsed);
            if (this._settings.isInitialized && this.reconcileActivePresetPointers()) {
                patchKeys.add('activeThemePresetId');
                patchKeys.add('promptInjection');
                patchKeys.add('materialConfig');
                patchKeys.add('providers');
            }
            eventBus.emit('settings:updated', { keys: Array.from(patchKeys), patch: parsed });
            this.saveToHost(parsed.providers !== undefined);
            if (oldAvatarIds.length > 0) {
                this.cleanupUnusedMaterialAvatars(oldAvatarIds);
            }
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
            this._settings.activeThemePresetId = officialPresets.themes[0]?.id || '';
        }

        // 5. 绘图参数预设
        if (options.drawingPresets && officialPresets) {
            this._settings.presets.drawing = structuredClone(officialPresets.drawing);
            for (const provKey of Object.keys(officialPresets.drawing)) {
                const provCfg = this._settings.providers[provKey];
                if (isPlainObject(provCfg)) {
                    const defaultActive =
                        (baseDefaults.providers[provKey] as { activeDrawingPresetId?: string } | undefined)
                            ?.activeDrawingPresetId ||
                        officialPresets.drawing[provKey]?.[0]?.id ||
                        '';
                    provCfg.activeDrawingPresetId = defaultActive;
                }
            }
        }

        // 6. 提示词预设
        if (options.promptPresets && officialPresets) {
            this._settings.presets.prompts = structuredClone(officialPresets.prompts);
        }

        // 7. 工作流预设
        if (options.workflowPresets && officialPresets) {
            this._settings.presets.workflows = structuredClone(officialPresets.workflows);
        }

        const candidateRecycleAvatars: string[] = [];

        // 8. 角色档案
        if (options.characterPresets && officialPresets) {
            for (const oldChar of this._settings.presets.characters || []) {
                if (oldChar?.data?.avatarId) candidateRecycleAvatars.push(oldChar.data.avatarId);
            }
            this._settings.presets.characters = structuredClone(officialPresets.characters);
            this._settings.materialConfig.activeCharacterPresetId =
                officialPresets.characters[0]?.id || '';
        }

        // 9. 服装档案
        if (options.outfitPresets && officialPresets) {
            for (const oldOutfit of this._settings.presets.outfits || []) {
                if (oldOutfit?.data?.avatarId) candidateRecycleAvatars.push(oldOutfit.data.avatarId);
            }
            this._settings.presets.outfits = structuredClone(officialPresets.outfits);
            this._settings.materialConfig.activeOutfitPresetId =
                officialPresets.outfits[0]?.id || '';
        }

        if (candidateRecycleAvatars.length > 0) {
            this.cleanupUnusedMaterialAvatars(candidateRecycleAvatars);
        }

        // 10. 素材启用预设
        if (options.materialActivationPresets && officialPresets) {
            this._settings.presets.material_activations = structuredClone(
                officialPresets.material_activations
            );
            this._settings.materialConfig.activeActivationPresetId =
                officialPresets.material_activations[0]?.id || 'material_activation_default';
        }

        // 11. 楼层解析与提取预设
        if (options.materialExtractionPresets && officialPresets) {
            this._settings.presets.material_extractions = structuredClone(
                officialPresets.material_extractions
            );
            this._settings.materialConfig.activeExtractionPresetId =
                officialPresets.material_extractions[0]?.id || 'material_extraction_default';
        }

        // 12. 格式与宏规则预设
        if (options.materialFormatPresets && officialPresets) {
            this._settings.presets.material_formats = structuredClone(
                officialPresets.material_formats
            );
            this._settings.materialConfig.activeFormatPresetId =
                officialPresets.material_formats[0]?.id || 'material_format_default';
        }

        // 级联清理跨分类的失效引用 ID（例如单独恢复提示词/工作流/角色/服装预设后）
        if (options.promptPresets && !options.drawingPresets && isPlainObject(this._settings.presets.drawing)) {
            const promptsByProvider = this._settings.presets.prompts || {};
            for (const [provKey, dpList] of Object.entries(this._settings.presets.drawing)) {
                if (!Array.isArray(dpList)) continue;
                const validPromptIds = new Set((promptsByProvider[provKey] || []).map((p) => p.id));
                const fallbackPromptId = promptsByProvider[provKey]?.[0]?.id || '';
                const pruned = pruneDrawingPromptRefs(
                    dpList,
                    (pid) => !validPromptIds.has(pid),
                    fallbackPromptId
                );
                if (pruned.changed) {
                    this._settings.presets.drawing[provKey] = pruned.list;
                }
            }
        }

        if (options.workflowPresets && !options.drawingPresets && isPlainObject(this._settings.presets.drawing)) {
            const validWorkflowIds = new Set((this._settings.presets.workflows || []).map((w) => w.id));
            const pruned = pruneDrawingWorkflowRefs(
                this._settings.presets.drawing,
                (wid) => !validWorkflowIds.has(wid)
            );
            if (pruned.changed) {
                this._settings.presets.drawing = pruned.map;
            }
        }

        if (options.outfitPresets || options.characterPresets) {
            const validCharIds = new Set((this._settings.presets.characters || []).map((c) => c.id));
            const validOutfitIds = new Set((this._settings.presets.outfits || []).map((o) => o.id));
            if (options.outfitPresets && !options.characterPresets) {
                const prunedChars = pruneCharacterOutfitRefs(
                    this._settings.presets.characters,
                    (oid) => !validOutfitIds.has(oid)
                );
                if (prunedChars.changed && prunedChars.list) {
                    this._settings.presets.characters = prunedChars.list;
                }
            }
            if (!options.materialActivationPresets) {
                const prunedActs = pruneActivationMaterialRefs(
                    this._settings.presets.material_activations,
                    options.characterPresets ? (cid) => !validCharIds.has(cid) : null,
                    options.outfitPresets ? (oid) => !validOutfitIds.has(oid) : null
                );
                if (prunedActs.changed && prunedActs.list) {
                    this._settings.presets.material_activations = prunedActs.list;
                }
            }
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
            await imageStorage.clearAllImages();
        }

        this._settings.isInitialized = true;
        this.reconcileActivePresetPointers();
        this.saveToHost(Boolean(options.providers));

        eventBus.emit('settings:updated', {
            isReset: true,
            keys: Object.keys(this._settings),
        });
    }

    /**
     * 对齐所有指向预设 ID 的激活指针（主题、各引擎绘图预设、提示词四通道、素材配置），
     * 若当前指针不在对应预设池中，则自动回退至该分类首项或置空。
     *
     * @returns 是否发生任意指针修正
     */
    private reconcileActivePresetPointers(): boolean {
        let changed = false;
        const presets = this._settings.presets;

        let nextThemePresetId = this._settings.activeThemePresetId;
        const themes = presets.themes || [];
        if (!themes.some((t) => t.id === nextThemePresetId)) {
            const candidate = themes[0]?.id || '';
            if (candidate !== nextThemePresetId) {
                nextThemePresetId = candidate;
                changed = true;
            }
        }

        let nextProviders = this._settings.providers;
        for (const prov of ALL_PROVIDERS) {
            const provCfg = (nextProviders as Record<string, unknown> | undefined)?.[prov] as
                | ({ activeDrawingPresetId?: string } & Record<string, unknown>)
                | undefined;
            const list = presets.drawing?.[prov] || [];
            if (provCfg && typeof provCfg === 'object') {
                const cur = provCfg.activeDrawingPresetId || '';
                if (!list.some((d) => d.id === cur)) {
                    const nextId = list[0]?.id || '';
                    if (nextId !== cur) {
                        if (nextProviders === this._settings.providers) {
                            nextProviders = { ...this._settings.providers };
                        }
                        (nextProviders as Record<string, unknown>)[prov] = {
                            ...provCfg,
                            activeDrawingPresetId: nextId,
                        };
                        changed = true;
                    }
                }
            }
        }

        const channelCategories: ReadonlyArray<
            readonly [
                keyof PromptInjectionConfig,
                'prompt_story' | 'prompt_character' | 'prompt_vocab' | 'prompt_material',
            ]
        > = [
            ['story', 'prompt_story'],
            ['character', 'prompt_character'],
            ['vocab', 'prompt_vocab'],
            ['material', 'prompt_material'],
        ];
        let nextPromptInjection = this._settings.promptInjection;
        if (nextPromptInjection) {
            for (const [channelKey, presetKey] of channelCategories) {
                const channelCfg = nextPromptInjection[channelKey];
                if (!channelCfg) continue;
                const list = presets[presetKey] || [];
                const cur = channelCfg.activePresetId || '';
                if (!list.some((p) => p.id === cur)) {
                    const nextId = list[0]?.id || '';
                    if (nextId !== cur) {
                        if (nextPromptInjection === this._settings.promptInjection) {
                            nextPromptInjection = { ...this._settings.promptInjection };
                        }
                        nextPromptInjection = {
                            ...nextPromptInjection,
                            [channelKey]: {
                                ...channelCfg,
                                activePresetId: nextId,
                            },
                        };
                        changed = true;
                    }
                }
            }
        }

        let nextMaterialConfig = this._settings.materialConfig;
        if (nextMaterialConfig) {
            const alignMaterialField = (
                field:
                    | 'activeCharacterPresetId'
                    | 'activeOutfitPresetId'
                    | 'activeActivationPresetId'
                    | 'activeExtractionPresetId'
                    | 'activeFormatPresetId',
                list: ReadonlyArray<PresetItem<unknown>>,
                allowEmptyWhenPopulated: boolean
            ) => {
                const cur = nextMaterialConfig[field] || '';
                if (allowEmptyWhenPopulated && !cur) return;
                if (!list.some((item) => item.id === cur)) {
                    const nextId = list[0]?.id || '';
                    if (nextId !== cur) {
                        if (nextMaterialConfig === this._settings.materialConfig) {
                            nextMaterialConfig = { ...this._settings.materialConfig };
                        }
                        nextMaterialConfig[field] = nextId;
                        changed = true;
                    }
                }
            };

            alignMaterialField('activeCharacterPresetId', presets.characters || [], true);
            alignMaterialField('activeOutfitPresetId', presets.outfits || [], true);
            alignMaterialField('activeActivationPresetId', presets.material_activations || [], false);
            alignMaterialField('activeExtractionPresetId', presets.material_extractions || [], false);
            alignMaterialField('activeFormatPresetId', presets.material_formats || [], false);
        }

        if (changed) {
            this._settings = {
                ...this._settings,
                activeThemePresetId: nextThemePresetId,
                providers: nextProviders,
                promptInjection: nextPromptInjection,
                materialConfig: nextMaterialConfig,
            };
        }

        return changed;
    }

    /**
     * 干跑预览覆盖式同步官方静态预设的差异计数（不修改本地存储）。
     *
     * @param options 同步范围与静态加载选项
     * @returns 各分组与总计的同名覆盖数、新增数及保留的自定义预设数
     */
    public async previewOfficialPresetSync(
        options?: SyncOfficialPresetsOptions
    ): Promise<OfficialPresetSyncResult> {
        const official = await loadOfficialStaticPresets(options?.loaderOptions);
        const categories =
            options?.categories && options.categories.length > 0
                ? options.categories
                : ALL_OFFICIAL_SYNC_CATEGORIES;
        return planOfficialPresetSync(this._settings.presets, official, categories).result;
    }

    /**
     * 非破坏性同步官方最新预设：
     * 1. 按「官方 ID 优先 + 规范化名称回退」匹配已有预设，支持 `mode: 'add-only'`（仅补充新增项，绝不覆盖）与 `selectedItemKeys` 逐条选择性同步；
     * 2. 自动补充本地尚未收录的官方预设（或仅补充勾选的新增项）；
     * 3. 完整保留未被勾选的已有预设以及用户自建、改名副本，不做任何删除或改动。
     *
     * @param options 同步范围、模式、逐条勾选清单与静态加载选项
     * @returns 实际执行的变更数量统计
     */
    public async syncOfficialPresets(
        options?: SyncOfficialPresetsOptions
    ): Promise<OfficialPresetSyncResult> {
        const official = await loadOfficialStaticPresets(options?.loaderOptions);
        const categories =
            options?.categories && options.categories.length > 0
                ? options.categories
                : ALL_OFFICIAL_SYNC_CATEGORIES;
        const plan = planOfficialPresetSync(this._settings.presets, official, categories, {
            mode: options?.mode,
            selectedItemKeys: options?.selectedItemKeys,
        });

        if (plan.result.totalOverwriteCount > 0 || plan.result.totalAddCount > 0) {
            this._settings = {
                ...this._settings,
                presets: plan.nextPresets,
            };
            if (this._settings.isInitialized) {
                this.reconcileActivePresetPointers();
            }
            this.saveToHost(false);
            eventBus.emit('settings:updated', {
                isReset: true,
                keys: [
                    'presets',
                    'activeThemePresetId',
                    'promptInjection',
                    'materialConfig',
                    'providers',
                ],
            });
        }

        return plan.result;
    }

    /**
     * 枚举全部内置静态预设目录及其在本地预设池中的载入状态（用于「关于与支持」按需载入/卸载）。
     */
    public async getStaticPresetCatalog(
        loaderOptions?: LoadStaticPresetsOptions
    ): Promise<StaticPresetCatalogCategory[]> {
        const official = await loadOfficialStaticPresets(loaderOptions);
        const local = this._settings.presets;

        const bucketsForCategory = (
            category: OfficialPresetSyncCategory
        ): Array<{
            bucketKey: string;
            bucketLabel: string;
            officialList: PresetItem<unknown>[];
            localList: PresetItem<unknown>[];
        }> => {
            switch (category) {
                case 'prompts':
                    return ALL_PROVIDERS.map((prov) => ({
                        bucketKey: prov,
                        bucketLabel: PROVIDER_BUCKET_LABELS[prov] || prov,
                        officialList: (official.prompts?.[prov] || []) as PresetItem<unknown>[],
                        localList: (local.prompts?.[prov] || []) as PresetItem<unknown>[],
                    }));
                case 'workflows':
                    return [
                        {
                            bucketKey: 'workflows',
                            bucketLabel: 'ComfyUI 工作流',
                            officialList: (official.workflows || []) as PresetItem<unknown>[],
                            localList: (local.workflows || []) as PresetItem<unknown>[],
                        },
                    ];
                case 'drawing':
                    return ALL_PROVIDERS.map((prov) => ({
                        bucketKey: prov,
                        bucketLabel: PROVIDER_BUCKET_LABELS[prov] || prov,
                        officialList: (official.drawing?.[prov] || []) as PresetItem<unknown>[],
                        localList: (local.drawing?.[prov] || []) as PresetItem<unknown>[],
                    }));
                case 'materialsAndThemes':
                    return [
                        {
                            bucketKey: 'themes',
                            bucketLabel: '界面主题',
                            officialList: (official.themes || []) as PresetItem<unknown>[],
                            localList: (local.themes || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'characters',
                            bucketLabel: '角色档案',
                            officialList: (official.characters || []) as PresetItem<unknown>[],
                            localList: (local.characters || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'outfits',
                            bucketLabel: '服装档案',
                            officialList: (official.outfits || []) as PresetItem<unknown>[],
                            localList: (local.outfits || []) as PresetItem<unknown>[],
                        },
                    ];
                case 'injectionAndRules':
                    return [
                        {
                            bucketKey: 'prompt_story',
                            bucketLabel: '故事插画通道',
                            officialList: (official.prompt_story || []) as PresetItem<unknown>[],
                            localList: (local.prompt_story || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'prompt_vocab',
                            bucketLabel: '词汇指导通道',
                            officialList: (official.prompt_vocab || []) as PresetItem<unknown>[],
                            localList: (local.prompt_vocab || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'prompt_character',
                            bucketLabel: '角色创作通道',
                            officialList: (official.prompt_character || []) as PresetItem<unknown>[],
                            localList: (local.prompt_character || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'prompt_material',
                            bucketLabel: '素材注入通道',
                            officialList: (official.prompt_material || []) as PresetItem<unknown>[],
                            localList: (local.prompt_material || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'material_activations',
                            bucketLabel: '素材启用预设',
                            officialList: (official.material_activations || []) as PresetItem<unknown>[],
                            localList: (local.material_activations || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'material_extractions',
                            bucketLabel: '档案提取规则',
                            officialList: (official.material_extractions || []) as PresetItem<unknown>[],
                            localList: (local.material_extractions || []) as PresetItem<unknown>[],
                        },
                        {
                            bucketKey: 'material_formats',
                            bucketLabel: '变量与宏格式',
                            officialList: (official.material_formats || []) as PresetItem<unknown>[],
                            localList: (local.material_formats || []) as PresetItem<unknown>[],
                        },
                    ];
            }
        };

        return ALL_OFFICIAL_SYNC_CATEGORIES.map((category) => {
            const items: StaticPresetCatalogItem[] = [];
            for (const bucket of bucketsForCategory(category)) {
                const idMap = buildOfficialIdMap(bucket.localList, bucket.officialList);
                for (const offItem of bucket.officialList) {
                    const localId = idMap.get(offItem.id);
                    const nameKey = normalizePresetNameKey(offItem.name || '');
                    items.push({
                        key: `${category}:${bucket.bucketKey}:${offItem.id || nameKey}`,
                        category,
                        bucketLabel: bucket.bucketLabel,
                        officialId: offItem.id,
                        officialName: offItem.name,
                        description: offItem.description,
                        loaded: Boolean(localId),
                        localId,
                    });
                }
            }
            const loadedCount = items.filter((i) => i.loaded).length;
            return {
                category,
                label: OFFICIAL_SYNC_CATEGORY_LABELS[category],
                loadedCount,
                totalCount: items.length,
                items,
            };
        });
    }

    /**
     * 按 key 清单载入（或重新导入）指定的内置静态预设条目，不弹出覆盖确认。
     */
    public async loadStaticPresetItems(
        itemKeys: readonly string[],
        loaderOptions?: LoadStaticPresetsOptions
    ): Promise<number> {
        if (itemKeys.length === 0) return 0;
        const result = await this.syncOfficialPresets({
            mode: 'selected',
            selectedItemKeys: itemKeys,
            loaderOptions,
        });
        return result.totalAddCount + result.totalOverwriteCount;
    }

    /**
     * 按 key 清单从本地预设池卸载指定的内置静态预设条目，不影响用户自定义预设。
     */
    public async unloadStaticPresetItems(
        itemKeys: readonly string[],
        loaderOptions?: LoadStaticPresetsOptions
    ): Promise<number> {
        if (itemKeys.length === 0) return 0;
        const catalog = await this.getStaticPresetCatalog(loaderOptions);
        const targetSet = new Set(itemKeys);
        const removeIdsByBucket = new Map<string, Set<string>>();

        for (const cat of catalog) {
            for (const item of cat.items) {
                if (!targetSet.has(item.key) || !item.loaded || !item.localId) continue;
                const parts = item.key.split(':');
                const bucketScopeKey =
                    cat.category === 'prompts' || cat.category === 'drawing'
                        ? `${cat.category}:${parts[1]}`
                        : parts[1];
                let idSet = removeIdsByBucket.get(bucketScopeKey);
                if (!idSet) {
                    idSet = new Set<string>();
                    removeIdsByBucket.set(bucketScopeKey, idSet);
                }
                idSet.add(item.localId);
            }
        }

        if (removeIdsByBucket.size === 0) return 0;

        const nextPresets = structuredClone(this._settings.presets);
        let removedCount = 0;

        const filterBucket = (
            bucketKey: string,
            list: PresetItem<unknown>[] | undefined
        ): PresetItem<unknown>[] => {
            const arr = list || [];
            const ids = removeIdsByBucket.get(bucketKey);
            if (!ids || ids.size === 0) return arr;
            const filtered = arr.filter((p) => !ids.has(p.id));
            removedCount += arr.length - filtered.length;
            return filtered;
        };

        for (const prov of ALL_PROVIDERS) {
            nextPresets.prompts[prov] = filterBucket(
                `prompts:${prov}`,
                nextPresets.prompts[prov] as PresetItem<unknown>[]
            ) as PresetItem<PromptPresetData>[];
            nextPresets.drawing[prov] = filterBucket(
                `drawing:${prov}`,
                nextPresets.drawing[prov] as PresetItem<unknown>[]
            ) as PresetItem<DrawingPresetData>[];
        }
        nextPresets.workflows = filterBucket(
            'workflows',
            nextPresets.workflows as PresetItem<unknown>[]
        ) as PresetItem<WorkflowPresetData>[];

        for (const key of [
            'themes',
            'characters',
            'outfits',
            'prompt_story',
            'prompt_vocab',
            'prompt_character',
            'prompt_material',
            'material_activations',
            'material_extractions',
            'material_formats',
        ] as const) {
            (nextPresets as unknown as Record<string, unknown>)[key] = filterBucket(
                key,
                nextPresets[key] as PresetItem<unknown>[]
            );
        }

        if (removedCount > 0) {
            const removedWorkflowIds = removeIdsByBucket.get('workflows');
            const removedCharIds = removeIdsByBucket.get('characters');
            const removedOutfitIds = removeIdsByBucket.get('outfits');
            const candidateAvatarIds: string[] = [];

            if (removedCharIds?.size) {
                for (const c of this._settings.presets.characters || []) {
                    if (removedCharIds.has(c.id) && c?.data?.avatarId) {
                        candidateAvatarIds.push(c.data.avatarId);
                    }
                }
            }
            if (removedOutfitIds?.size) {
                for (const o of this._settings.presets.outfits || []) {
                    if (removedOutfitIds.has(o.id) && o?.data?.avatarId) {
                        candidateAvatarIds.push(o.data.avatarId);
                    }
                }
            }

            // 1. 清理提示词预设被卸载后绘图预设里的失效绑定与轮询池条目
            for (const prov of ALL_PROVIDERS) {
                const removedPromptIds = removeIdsByBucket.get(`prompts:${prov}`);
                if (!removedPromptIds?.size || !Array.isArray(nextPresets.drawing[prov])) continue;
                const fallbackPromptId = nextPresets.prompts[prov]?.[0]?.id || '';
                const pruned = pruneDrawingPromptRefs(
                    nextPresets.drawing[prov],
                    (pid) => removedPromptIds.has(pid),
                    fallbackPromptId
                );
                if (pruned.changed) {
                    nextPresets.drawing[prov] = pruned.list;
                }
            }

            // 2. 清理工作流被卸载后绘图预设里的失效工作流引用
            if (removedWorkflowIds?.size) {
                const pruned = pruneDrawingWorkflowRefs(
                    nextPresets.drawing,
                    (wid) => removedWorkflowIds.has(wid)
                );
                if (pruned.changed) {
                    nextPresets.drawing = pruned.map;
                }
            }

            // 3. 清理服装/角色被卸载后的专属绑定与启用规则引用
            if (removedOutfitIds?.size) {
                const prunedChars = pruneCharacterOutfitRefs(
                    nextPresets.characters,
                    (oid) => removedOutfitIds.has(oid)
                );
                if (prunedChars.changed && prunedChars.list) {
                    nextPresets.characters = prunedChars.list;
                }
            }
            if (removedCharIds?.size || removedOutfitIds?.size) {
                const prunedActs = pruneActivationMaterialRefs(
                    nextPresets.material_activations,
                    removedCharIds?.size ? (cid) => removedCharIds.has(cid) : null,
                    removedOutfitIds?.size ? (oid) => removedOutfitIds.has(oid) : null
                );
                if (prunedActs.changed && prunedActs.list) {
                    nextPresets.material_activations = prunedActs.list;
                }
            }

            this._settings = {
                ...this._settings,
                presets: nextPresets,
            };
            this.reconcileActivePresetPointers();
            if (candidateAvatarIds.length > 0) {
                this.cleanupUnusedMaterialAvatars(candidateAvatarIds);
            }
            this.saveToHost(false);
            eventBus.emit('settings:updated', {
                isReset: true,
                keys: [
                    'presets',
                    'activeThemePresetId',
                    'promptInjection',
                    'materialConfig',
                    'providers',
                ],
            });
        }

        return removedCount;
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
