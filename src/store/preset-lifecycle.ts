/**
 * 预设生命周期与同步重置服务 (PresetLifecycle)。
 *
 * @remarks
 * 负责宿主异步初始化、官方静态预设预览与增量同步、按需目录载入/卸载、
 * 全局配置导入导出以及细分分类恢复出厂设置。
 */

import type {
    DrawingPresetData,
    PresetItem,
    PresetSettings,
    PromptPresetData,
    ProviderType,
    WorkflowPresetData,
} from '@types';
import { PROMPT_POLLING_PRESET_ID } from '../config/constants';
import { normalizePresetNameKey } from '../domain/preset/preset-validation';
import { getHostContext } from '../host';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';
import { imageStorage } from './image-storage';
import { preserveBlankSecretsDeep, SECRET_FIELD_PATTERN } from './secret-vault';
import {
    ALL_PROVIDERS,
    mergeEmptyPresetCategories,
    pruneActivationMaterialRefs,
    pruneCharacterOutfitRefs,
    pruneDrawingPromptRefs,
    pruneDrawingWorkflowRefs,
    type PresetRepository,
} from './preset-repository';
import {
    buildDefaultSettings,
    deepMerge,
    FORBIDDEN_MERGE_KEYS,
    isPlainObject,
    SettingsRepository,
} from './settings-repository';
import {
    loadOfficialStaticPresets,
    type LoadStaticPresetsOptions,
} from './static-preset-loader';
import type {
    DrawAssistantSettings,
    OfficialPresetCategoryDiff,
    OfficialPresetDiffItem,
    OfficialPresetSyncCategory,
    OfficialPresetSyncMode,
    OfficialPresetSyncResult,
    ResetPartialOptions,
    SettingsImportResult,
    StaticPresetCatalogCategory,
    StaticPresetCatalogItem,
    SyncOfficialPresetsOptions,
} from './settings-store';

/** 全部官方预设更新同步分组列表（按依赖先后排列） */
export const ALL_OFFICIAL_SYNC_CATEGORIES: readonly OfficialPresetSyncCategory[] = [
    'prompts',
    'workflows',
    'drawing',
    'materialsAndThemes',
    'injectionAndRules',
] as const;

const OFFICIAL_SYNC_CATEGORY_LABELS: Readonly<Record<OfficialPresetSyncCategory, string>> = {
    prompts: '提示词预设',
    workflows: '工作流预设 (ComfyUI)',
    drawing: '生图参数预设',
    materialsAndThemes: '角色 / 服装 / 主题外观',
    injectionAndRules: '提示词通道与素材规则',
};

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

    // 3. 绘图参数预设
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
    const totalCustomPreservedCount = diffs.reduce(
        (sum, d) => sum + d.customPreservedCount,
        0
    );

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

export class PresetLifecycle {
    public constructor(
        private readonly repo: SettingsRepository,
        private readonly presets: PresetRepository
    ) {}

    public async initializeFromHost(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        const hostContext = getHostContext();
        const rawSettings = hostContext?.extensionSettings?.[SettingsRepository.EXTENSION_NAME] as
            | Record<string, unknown>
            | undefined;

        if (rawSettings && typeof rawSettings === 'object') {
            this.repo.replaceRaw(deepMerge(this.repo.getRaw(), rawSettings));
        }

        this.repo.restoreLocalSecrets();
        this.repo.setHasInitializedFromHost(true);

        const current = this.repo.getRaw();
        if (!current.isInitialized) {
            try {
                const officialPresets = await loadOfficialStaticPresets(loaderOptions);
                const mergedPresets = mergeEmptyPresetCategories(current.presets, officialPresets);

                const resolvedThemePreset =
                    current.activeThemePresetId || mergedPresets.themes[0]?.id || '';

                const next: DrawAssistantSettings = {
                    ...current,
                    isInitialized: true,
                    activeThemePresetId: resolvedThemePreset,
                    presets: mergedPresets,
                };
                this.presets.reconcileActivePresetPointers(next);
                this.repo.replaceRaw(next, { forceAllSlices: true });
                this.repo.saveToHost();
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
        } else if (this.presets.reconcileActivePresetPointers()) {
            this.repo.saveToHost();
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

    public async importOfficialPresets(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        const officialPresets = await loadOfficialStaticPresets(loaderOptions);
        const current = this.repo.getRaw();
        const prevThemePreset = current.activeThemePresetId;
        const resolvedThemePreset = prevThemePreset || officialPresets.themes[0]?.id || '';

        const next: DrawAssistantSettings = {
            ...current,
            isInitialized: true,
            activeThemePresetId: resolvedThemePreset,
            presets: officialPresets,
        };
        const reconciled = this.presets.reconcileActivePresetPointers(next);
        this.repo.replaceRaw(next);
        const updateKeys = ['presets', 'isInitialized'];
        if (reconciled || resolvedThemePreset !== prevThemePreset) {
            updateKeys.push(
                'activeThemePresetId',
                'promptInjection',
                'materialConfig',
                'providers'
            );
        }

        eventBus.emit('settings:updated', { keys: updateKeys });
        this.repo.saveToHost();
    }

    public exportSettings(includeSecrets = false): string {
        const raw = this.repo.getRaw();
        const snapshot = includeSecrets ? raw : this.repo.stripSecretsFromSettings(raw);
        return JSON.stringify(snapshot, null, 2);
    }

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
                'enabled',
                'activeProvider',
                'transport',
                'taskTimeoutMs',
                'cancelOnChatChange',
                'cancelOnSwipe',
                'saveToServer',
                'imageQuality',
                'autoGenerate',
                'cleanPrompt',
                'cleanPromptPunctuation',
                'normalizeChinesePunctuation',
                'thinkingDisplayMode',
                'cleanHistoryThinking',
                'cleanHistoryMarkup',
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
            const looksLikeSinglePreset = !hasKnownKey && isPlainObject(parsedRecord.data);
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
                            (item) =>
                                isPlainObject(item) &&
                                typeof item.id === 'string' &&
                                isPlainObject(item.data)
                        );
                    } else if (isPlainObject(catVal)) {
                        const subMap: Record<string, unknown> = {};
                        for (const [subKey, subArr] of Object.entries(catVal)) {
                            if (FORBIDDEN_MERGE_KEYS.has(subKey)) continue;
                            if (Array.isArray(subArr)) {
                                subMap[subKey] = subArr.filter(
                                    (item) =>
                                        isPlainObject(item) &&
                                        typeof item.id === 'string' &&
                                        isPlainObject(item.data)
                                );
                            }
                        }
                        cleanedPresets[catKey] = subMap;
                    }
                }
                parsedRecord.presets = cleanedPresets;
            }

            if (parsed.providers && typeof parsed.providers === 'object') {
                for (const [pKey, pCfg] of Object.entries(parsed.providers)) {
                    if (pCfg && typeof pCfg === 'object') {
                        const localCfg = this.repo.getProviderConfig<Record<string, unknown>>(
                            pKey as ProviderType
                        );
                        if (localCfg) {
                            preserveBlankSecretsDeep(
                                pCfg as Record<string, unknown>,
                                localCfg,
                                SECRET_FIELD_PATTERN
                            );
                        }
                    }
                }
            }

            const current = this.repo.getRaw();
            const oldAvatarIds: string[] = [];
            for (const c of current.presets.characters || []) {
                if (c?.data?.avatarId) oldAvatarIds.push(c.data.avatarId);
            }
            for (const o of current.presets.outfits || []) {
                if (o?.data?.avatarId) oldAvatarIds.push(o.data.avatarId);
            }

            const patchKeys = new Set<string>(Object.keys(parsed));
            const next = deepMerge(current, parsed);
            if (next.isInitialized && this.presets.reconcileActivePresetPointers(next)) {
                patchKeys.add('activeThemePresetId');
                patchKeys.add('promptInjection');
                patchKeys.add('materialConfig');
                patchKeys.add('providers');
            }
            this.repo.replaceRaw(next, { forceAllSlices: true });
            eventBus.emit('settings:updated', { keys: Array.from(patchKeys), patch: parsed });
            this.repo.saveToHost(parsed.providers !== undefined);
            if (oldAvatarIds.length > 0) {
                this.presets.cleanupUnusedMaterialAvatars(oldAvatarIds);
            }
            return { success: true };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('导入配置发生 JSON 解析异常:', message);
            return { success: false, error: `JSON 解析失败: ${message}` };
        }
    }

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

        // 构造深拷贝副本后再修改各区块，保证 Signal 切片的引用比较严格感知变更
        const next = structuredClone(this.repo.getRaw());

        if (options.general) {
            next.enabled = baseDefaults.enabled;
            next.activeProvider = baseDefaults.activeProvider;
            next.transport = baseDefaults.transport;
            next.taskTimeoutMs = baseDefaults.taskTimeoutMs;
            next.cancelOnChatChange = baseDefaults.cancelOnChatChange;
            next.cancelOnSwipe = baseDefaults.cancelOnSwipe;
            next.saveToServer = baseDefaults.saveToServer;
            next.imageQuality = baseDefaults.imageQuality;
            next.autoGenerate = baseDefaults.autoGenerate;
            next.cleanPrompt = baseDefaults.cleanPrompt;
            next.cleanPromptPunctuation = baseDefaults.cleanPromptPunctuation;
            next.normalizeChinesePunctuation = baseDefaults.normalizeChinesePunctuation;
            next.thinkingDisplayMode = baseDefaults.thinkingDisplayMode;
            next.cleanHistoryThinking = baseDefaults.cleanHistoryThinking;
            next.cleanHistoryMarkup = baseDefaults.cleanHistoryMarkup;
            next.promptStartTag = baseDefaults.promptStartTag;
            next.promptEndTag = baseDefaults.promptEndTag;
            next.materialConfig.autoSwitchByCard = baseDefaults.materialConfig.autoSwitchByCard;
        }

        if (options.providers) {
            next.providers = structuredClone(baseDefaults.providers);
        }

        if (options.ui) {
            next.ui = structuredClone(baseDefaults.ui);
        }

        if (options.themePresets && officialPresets) {
            next.presets.themes = structuredClone(officialPresets.themes);
            next.activeThemePresetId = officialPresets.themes[0]?.id || '';
        }

        if (options.drawingPresets && officialPresets) {
            next.presets.drawing = structuredClone(officialPresets.drawing);
            for (const provKey of Object.keys(officialPresets.drawing)) {
                const provCfg = next.providers[provKey];
                if (isPlainObject(provCfg)) {
                    const defaultActive =
                        (
                            baseDefaults.providers[provKey] as
                                | { activeDrawingPresetId?: string }
                                | undefined
                        )?.activeDrawingPresetId ||
                        officialPresets.drawing[provKey]?.[0]?.id ||
                        '';
                    provCfg.activeDrawingPresetId = defaultActive;
                }
            }
        }

        if (options.promptPresets && officialPresets) {
            next.presets.prompts = structuredClone(officialPresets.prompts);
        }

        if (options.workflowPresets && officialPresets) {
            next.presets.workflows = structuredClone(officialPresets.workflows);
        }

        const candidateRecycleAvatars: string[] = [];

        if (options.characterPresets && officialPresets) {
            for (const oldChar of next.presets.characters || []) {
                if (oldChar?.data?.avatarId) candidateRecycleAvatars.push(oldChar.data.avatarId);
            }
            next.presets.characters = structuredClone(officialPresets.characters);
            next.materialConfig.activeCharacterPresetId =
                officialPresets.characters[0]?.id || '';
        }

        if (options.outfitPresets && officialPresets) {
            for (const oldOutfit of next.presets.outfits || []) {
                if (oldOutfit?.data?.avatarId) candidateRecycleAvatars.push(oldOutfit.data.avatarId);
            }
            next.presets.outfits = structuredClone(officialPresets.outfits);
            next.materialConfig.activeOutfitPresetId = officialPresets.outfits[0]?.id || '';
        }

        if (options.materialActivationPresets && officialPresets) {
            next.presets.material_activations = structuredClone(
                officialPresets.material_activations
            );
            next.materialConfig.activeActivationPresetId =
                officialPresets.material_activations[0]?.id || 'material_activation_default';
        }

        if (options.materialExtractionPresets && officialPresets) {
            next.presets.material_extractions = structuredClone(
                officialPresets.material_extractions
            );
            next.materialConfig.activeExtractionPresetId =
                officialPresets.material_extractions[0]?.id || 'material_extraction_default';
        }

        if (options.materialFormatPresets && officialPresets) {
            next.presets.material_formats = structuredClone(officialPresets.material_formats);
            next.materialConfig.activeFormatPresetId =
                officialPresets.material_formats[0]?.id || 'material_format_default';
        }

        if (
            options.promptPresets &&
            !options.drawingPresets &&
            isPlainObject(next.presets.drawing)
        ) {
            const promptsByProvider = next.presets.prompts || {};
            for (const [provKey, dpList] of Object.entries(next.presets.drawing)) {
                if (!Array.isArray(dpList)) continue;
                const validPromptIds = new Set((promptsByProvider[provKey] || []).map((p) => p.id));
                const fallbackPromptId = promptsByProvider[provKey]?.[0]?.id || '';
                const pruned = pruneDrawingPromptRefs(
                    dpList,
                    (pid) => !validPromptIds.has(pid),
                    fallbackPromptId
                );
                if (pruned.changed) {
                    next.presets.drawing[provKey] = pruned.list;
                }
            }
        }

        if (
            options.workflowPresets &&
            !options.drawingPresets &&
            isPlainObject(next.presets.drawing)
        ) {
            const validWorkflowIds = new Set((next.presets.workflows || []).map((w) => w.id));
            const pruned = pruneDrawingWorkflowRefs(
                next.presets.drawing,
                (wid) => !validWorkflowIds.has(wid)
            );
            if (pruned.changed) {
                next.presets.drawing = pruned.map;
            }
        }

        if (options.outfitPresets || options.characterPresets) {
            const validCharIds = new Set((next.presets.characters || []).map((c) => c.id));
            const validOutfitIds = new Set((next.presets.outfits || []).map((o) => o.id));
            if (options.outfitPresets && !options.characterPresets) {
                const prunedChars = pruneCharacterOutfitRefs(
                    next.presets.characters,
                    (oid) => !validOutfitIds.has(oid)
                );
                if (prunedChars.changed && prunedChars.list) {
                    next.presets.characters = prunedChars.list;
                }
            }
            if (!options.materialActivationPresets) {
                const prunedActs = pruneActivationMaterialRefs(
                    next.presets.material_activations,
                    options.characterPresets ? (cid) => !validCharIds.has(cid) : null,
                    options.outfitPresets ? (oid) => !validOutfitIds.has(oid) : null
                );
                if (prunedActs.changed && prunedActs.list) {
                    next.presets.material_activations = prunedActs.list;
                }
            }
        }

        if (options.promptStoryPresets && officialPresets) {
            next.presets.prompt_story = structuredClone(officialPresets.prompt_story);
            next.promptInjection.story = structuredClone(baseDefaults.promptInjection.story);
        }
        if (options.promptCharacterPresets && officialPresets) {
            next.presets.prompt_character = structuredClone(officialPresets.prompt_character);
            next.promptInjection.character = structuredClone(
                baseDefaults.promptInjection.character
            );
        }
        if (options.promptVocabPresets && officialPresets) {
            next.presets.prompt_vocab = structuredClone(officialPresets.prompt_vocab);
            next.promptInjection.vocab = structuredClone(baseDefaults.promptInjection.vocab);
        }
        if (options.promptMaterialPresets && officialPresets) {
            next.presets.prompt_material = structuredClone(officialPresets.prompt_material);
            next.promptInjection.material = structuredClone(baseDefaults.promptInjection.material);
        }

        if (options.resetLocalLexicon) {
            const { localLexiconStorage } = await import('./local-lexicon-storage');
            await localLexiconStorage.clearAll();
        }

        if (options.resetLocalGallery) {
            await imageStorage.clearAllImages();
        }

        next.isInitialized = true;
        this.presets.reconcileActivePresetPointers(next);
        this.repo.replaceRaw(next, { forceAllSlices: true });

        if (candidateRecycleAvatars.length > 0) {
            this.presets.cleanupUnusedMaterialAvatars(candidateRecycleAvatars);
        }

        this.repo.saveToHost(Boolean(options.providers));

        eventBus.emit('settings:updated', {
            isReset: true,
            keys: Object.keys(next),
        });
    }

    public async previewOfficialPresetSync(
        options?: SyncOfficialPresetsOptions
    ): Promise<OfficialPresetSyncResult> {
        const official = await loadOfficialStaticPresets(options?.loaderOptions);
        const categories =
            options?.categories && options.categories.length > 0
                ? options.categories
                : ALL_OFFICIAL_SYNC_CATEGORIES;
        return planOfficialPresetSync(this.repo.getRaw().presets, official, categories).result;
    }

    public async syncOfficialPresets(
        options?: SyncOfficialPresetsOptions
    ): Promise<OfficialPresetSyncResult> {
        const official = await loadOfficialStaticPresets(options?.loaderOptions);
        const categories =
            options?.categories && options.categories.length > 0
                ? options.categories
                : ALL_OFFICIAL_SYNC_CATEGORIES;
        const current = this.repo.getRaw();
        const plan = planOfficialPresetSync(current.presets, official, categories, {
            mode: options?.mode,
            selectedItemKeys: options?.selectedItemKeys,
        });

        if (plan.result.totalOverwriteCount > 0 || plan.result.totalAddCount > 0) {
            const next: DrawAssistantSettings = {
                ...current,
                presets: plan.nextPresets,
            };
            if (next.isInitialized) {
                this.presets.reconcileActivePresetPointers(next);
            }
            this.repo.replaceRaw(next);
            this.repo.saveToHost(false);
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

    public async getStaticPresetCatalog(
        loaderOptions?: LoadStaticPresetsOptions
    ): Promise<StaticPresetCatalogCategory[]> {
        const official = await loadOfficialStaticPresets(loaderOptions);
        const local = this.repo.getRaw().presets;

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

        const current = this.repo.getRaw();
        const nextPresets = structuredClone(current.presets);
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
                for (const c of current.presets.characters || []) {
                    if (removedCharIds.has(c.id) && c?.data?.avatarId) {
                        candidateAvatarIds.push(c.data.avatarId);
                    }
                }
            }
            if (removedOutfitIds?.size) {
                for (const o of current.presets.outfits || []) {
                    if (removedOutfitIds.has(o.id) && o?.data?.avatarId) {
                        candidateAvatarIds.push(o.data.avatarId);
                    }
                }
            }

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

            if (removedWorkflowIds?.size) {
                const pruned = pruneDrawingWorkflowRefs(
                    nextPresets.drawing,
                    (wid) => removedWorkflowIds.has(wid)
                );
                if (pruned.changed) {
                    nextPresets.drawing = pruned.map;
                }
            }

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

            const next: DrawAssistantSettings = {
                ...current,
                presets: nextPresets,
            };
            this.presets.reconcileActivePresetPointers(next);
            this.repo.replaceRaw(next);
            if (candidateAvatarIds.length > 0) {
                this.presets.cleanupUnusedMaterialAvatars(candidateAvatarIds);
            }
            this.repo.saveToHost(false);
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

    public async resetToDefaults(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        const officialPresets = await loadOfficialStaticPresets(loaderOptions);
        const baseDefaults = buildDefaultSettings();
        const next: DrawAssistantSettings = {
            ...baseDefaults,
            isInitialized: true,
            activeThemePresetId: officialPresets.themes[0]?.id || '',
            presets: officialPresets,
        };
        this.presets.reconcileActivePresetPointers(next);
        this.repo.replaceRaw(next, { forceAllSlices: true });
        this.repo.saveToHost(true);
        eventBus.emit('settings:updated', {
            isReset: true,
            keys: Object.keys(next),
        });
    }
}
