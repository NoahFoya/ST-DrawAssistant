/**
 * 预设池数据仓库与引用完整性维护器 (PresetRepository)。
 *
 * @remarks
 * 负责各类预设的检索、解析、增删改查、跨分类引用剪枝、激活指针一致性校对，
 * 以及关联角色/服装本地头像资产的无用回收。
 */

import type {
    ActivationTriggerMode,
    DrawingPresetData,
    MaterialActivationPresetData,
    MaterialItemActivationRule,
    PresetCategory,
    PresetItem,
    PresetSettings,
    PromptInjectionConfig,
    ProviderType,
} from '@types';
import { PROMPT_POLLING_PRESET_ID } from '../config/constants';
import { normalizePresetNameKey } from '../domain/preset/preset-validation';
import { eventBus } from '../util/event-bus';
import { EMBEDDED_AVATAR_FIELD, materialImageStorage } from './material-image-storage';
import { isPlainObject, type SettingsRepository } from './settings-repository';
import type {
    DrawAssistantSettings,
    ResolveDrawingPresetOptions,
    SavePresetOptions,
} from './settings-store';

export const ALL_PROVIDERS: readonly ProviderType[] = [
    'comfyui',
    'sdwebui',
    'novelai',
    'openai',
    'gemini',
    'grok',
] as const;

export interface UpsertPresetResult<P> {
    readonly nextList: PresetItem<P>[];
    readonly existedBefore: boolean;
    readonly savedId: string;
    readonly savedItem: PresetItem<P>;
}

export interface DrawingPresetLookupPorts {
    getProviderConfig: (provider: ProviderType) => { activeDrawingPresetId?: string } | undefined;
    getPreset: <T = Record<string, unknown>>(
        category: PresetCategory,
        id: string,
        providerType?: string
    ) => PresetItem<T> | undefined;
}

/**
 * 统一解析当前任务/服务生效的生图参数预设（可供实例与鸭子类型端口复用）。
 */
export function resolveDrawingPresetFromPorts<T = Record<string, unknown>>(
    ports: DrawingPresetLookupPorts,
    provider: ProviderType,
    options: ResolveDrawingPresetOptions = {}
): { presetId?: string; preset?: T } {
    const explicitId =
        typeof options.explicitPresetId === 'string' && options.explicitPresetId.trim()
            ? options.explicitPresetId.trim()
            : undefined;

    let effectiveId = explicitId;
    if (!effectiveId) {
        const config = ports.getProviderConfig(provider);
        const activeId = config?.activeDrawingPresetId;
        if (typeof activeId === 'string' && activeId.trim()) {
            effectiveId = activeId.trim();
        }
    }

    if (!effectiveId) {
        return {};
    }

    const item = ports.getPreset<T>('drawing', effectiveId, provider);
    if (item?.data) {
        return { presetId: effectiveId, preset: item.data };
    }

    if (effectiveId === 'default') {
        return { presetId: 'default', preset: undefined };
    }

    if (explicitId) {
        throw new Error(
            `关联的生图参数预设已失效或不存在 (ID: ${effectiveId})，请重新选择预设`
        );
    }

    if (options.throwOnMissingActive) {
        throw new Error(
            `当前激活的生图参数预设已失效或不存在 (ID: ${effectiveId})，请重新选择预设`
        );
    }

    return {};
}

/**
 * 纯函数：更新或追加带时间戳的预设项（对角色/服装预设同步更新外层与内层名称，并保证名称唯一性与 ID 稳定）。
 * 新建预设（`idIndex === -1`）优先采信外层传入的新名称，避免模板或来源副本中的旧 `data.name` 反向覆盖已有条目。
 */
export function upsertPresetItem<P>(
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
                  isPlainObject(p.data) &&
                  typeof (p.data as Record<string, unknown>).name === 'string'
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

/** 将官方静态预设合并至当前预设池中为空的分类（保留已有非空分类） */
export function mergeEmptyPresetCategories(
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

    const arrayCategories: Array<Exclude<PresetCategory, 'drawing' | 'prompts'>> = [
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

/** 清理生图参数预设中失效的提示词预设绑定及轮询候选池条目 */
export function pruneDrawingPromptRefs(
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

/** 清理生图参数预设映射表中失效的工作流 / 局部重绘引用 */
export function pruneDrawingWorkflowRefs(
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
            const clearTxt = Boolean(
                dp.data.txt2imgWorkflowId && isRemovedWorkflow(dp.data.txt2imgWorkflowId)
            );
            const clearInp = Boolean(
                dp.data.inpaintPresetId && isRemovedWorkflow(dp.data.inpaintPresetId)
            );
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
export function pruneCharacterOutfitRefs<TChar extends PresetItem<{ boundOutfitIds?: string[] }>>(
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
export function pruneActivationMaterialRefs(
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
        if (
            nextCharRules === act.data.characterRules &&
            nextOutfitRules === act.data.outfitRules
        ) {
            return act;
        }
        return {
            ...act,
            data: {
                ...act.data,
                ...(nextCharRules !== act.data.characterRules
                    ? { characterRules: nextCharRules }
                    : {}),
                ...(nextOutfitRules !== act.data.outfitRules
                    ? { outfitRules: nextOutfitRules }
                    : {}),
            },
        };
    });
    return { list: changed ? list : activations, changed };
}

export class PresetRepository {
    public constructor(private readonly repo: SettingsRepository) {}

    public getPresets<T = Record<string, unknown>>(
        category: PresetCategory,
        providerType?: string
    ): PresetItem<T>[] {
        const current = this.repo.getRaw();
        if (category === 'drawing' || category === 'prompts') {
            const providerKey = providerType || current.activeProvider;
            const categoryMap = (current.presets[category] || {}) as Record<string, PresetItem<T>[]>;
            return (categoryMap[providerKey] || []) as PresetItem<T>[];
        }

        return (current.presets[category] || []) as unknown as PresetItem<T>[];
    }

    public getPreset<T = Record<string, unknown>>(
        category: PresetCategory,
        id: string,
        providerType?: string
    ): PresetItem<T> | undefined {
        return this.getPresets<T>(category, providerType).find((item) => item.id === id);
    }

    public resolveDrawingPreset<T = Record<string, unknown>>(
        provider: ProviderType,
        options: ResolveDrawingPresetOptions = {}
    ): { presetId?: string; preset?: T } {
        return resolveDrawingPresetFromPorts<T>(
            {
                getProviderConfig: (p) =>
                    this.repo.getProviderConfig<{ activeDrawingPresetId?: string }>(p),
                getPreset: <U = Record<string, unknown>>(
                    category: PresetCategory,
                    id: string,
                    providerType?: string
                ) => this.getPreset<U>(category, id, providerType),
            },
            provider,
            options
        );
    }

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
        const current = this.repo.getRaw();

        if (category === 'drawing' || category === 'prompts') {
            const providerKey = providerType || current.activeProvider;
            const currentList = this.getPresets<T>(category, providerKey);
            const { nextList, savedItem } = upsertPresetItem(currentList, timestampedItem);
            emittedItem = savedItem;

            const existingMap = current.presets[category] || {};
            const safeMap = isPlainObject(existingMap) ? { ...existingMap } : {};

            this.repo.replaceRaw({
                ...current,
                presets: {
                    ...current.presets,
                    [category]: {
                        ...safeMap,
                        [providerKey]: nextList,
                    },
                },
            });
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

            this.repo.replaceRaw({
                ...current,
                presets: {
                    ...current.presets,
                    [category]: nextList,
                },
            });

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
        this.repo.saveToHost();
    }

    private applyMaterialActivationRulePatch(
        kind: 'character' | 'outfit',
        materialPresetId: string,
        buildRule: (prev?: MaterialItemActivationRule) => MaterialItemActivationRule,
        activationPresetId?: string
    ): PresetItem<MaterialActivationPresetData> | null {
        if (!materialPresetId.trim()) {
            return null;
        }
        const current = this.repo.getRaw();
        const actList = current.presets.material_activations;
        if (!Array.isArray(actList) || actList.length === 0) {
            return null;
        }
        const targetId = activationPresetId || current.materialConfig?.activeActivationPresetId || '';
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

        this.repo.replaceRaw({
            ...current,
            presets: {
                ...current.presets,
                material_activations: nextActList,
            },
        });
        return nextPreset;
    }

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
        this.repo.saveToHost();
        return true;
    }

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

    private reconcileCharacterBoundOutfitRef(outfitName: string, outfitId: string): void {
        const cleanKey = normalizePresetNameKey(outfitName);
        if (!cleanKey || !outfitId) return;

        const current = this.repo.getRaw();
        const chars = current.presets.characters;
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
            this.repo.replaceRaw({
                ...current,
                presets: {
                    ...current.presets,
                    characters: nextChars,
                },
            });
        }
    }

    public deletePreset(category: PresetCategory, id: string, providerType?: string): boolean {
        const current = this.repo.getRaw();
        if (category === 'drawing' || category === 'prompts') {
            const providerKey = providerType || current.activeProvider;
            const currentList = this.getPresets(category, providerKey);
            const nextList = currentList.filter((p) => p.id !== id);

            if (nextList.length === currentList.length) {
                return false;
            }

            const existingMap = current.presets[category] || {};
            const safeMap = isPlainObject(existingMap) ? { ...existingMap } : {};

            let updatedDrawingPresets = current.presets.drawing;
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
            }

            this.repo.replaceRaw({
                ...current,
                presets: {
                    ...current.presets,
                    [category]: {
                        ...safeMap,
                        [providerKey]: nextList,
                    },
                    ...(category === 'prompts' ? { drawing: updatedDrawingPresets } : {}),
                },
            });
            this.reconcileActivePresetPointers();
            eventBus.emit('settings:updated', {
                key: `presets.${category}`,
                value: { deletedId: id },
            });
            this.repo.saveToHost();
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

        const nextDrawingPresets =
            category === 'workflows'
                ? pruneDrawingWorkflowRefs(current.presets.drawing, (wid) => wid === id).map
                : current.presets.drawing;

        const nextActivations =
            category === 'characters' || category === 'outfits'
                ? pruneActivationMaterialRefs(
                      current.presets.material_activations,
                      category === 'characters' ? (cid) => cid === id : null,
                      category === 'outfits' ? (oid) => oid === id : null
                  ).list
                : current.presets.material_activations;

        const nextCharacters =
            category === 'outfits'
                ? pruneCharacterOutfitRefs(current.presets.characters, (oid) => oid === id).list
                : current.presets.characters;

        this.repo.replaceRaw({
            ...current,
            presets: {
                ...current.presets,
                [category]: nextList,
                ...(nextDrawingPresets !== current.presets.drawing
                    ? { drawing: nextDrawingPresets }
                    : {}),
                ...(category === 'outfits' && nextCharacters !== current.presets.characters
                    ? { characters: nextCharacters }
                    : {}),
                ...(nextActivations !== current.presets.material_activations
                    ? { material_activations: nextActivations }
                    : {}),
            },
        });
        this.reconcileActivePresetPointers();

        if (removedAvatarId) {
            this.cleanupUnusedMaterialAvatars([removedAvatarId]);
        }

        eventBus.emit('settings:updated', {
            key: `presets.${category}`,
            value: { deletedId: id },
        });
        this.repo.saveToHost();
        return true;
    }

    public cleanupUnusedMaterialAvatars(candidateAvatarIds: Iterable<string>): void {
        const candidates = new Set<string>();
        for (const id of candidateAvatarIds) {
            const clean = (id || '').trim();
            if (clean) candidates.add(clean);
        }
        if (candidates.size === 0) return;

        const current = this.repo.getRaw();
        const inUse = new Set<string>();
        for (const item of current.presets.characters || []) {
            const avatarId = item?.data?.avatarId?.trim();
            if (avatarId) inUse.add(avatarId);
        }
        for (const item of current.presets.outfits || []) {
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
     * 校对并修正所有指向预设 ID 的激活指针，若当前指针不在对应预设池中则回退至首项或置空。
     */
    public reconcileActivePresetPointers(targetSettings?: DrawAssistantSettings): boolean {
        const current = targetSettings ?? this.repo.getRaw();
        let changed = false;
        const presets = current.presets;

        let nextThemePresetId = current.activeThemePresetId;
        const themes = presets.themes || [];
        if (!themes.some((t) => t.id === nextThemePresetId)) {
            const candidate = themes[0]?.id || '';
            if (candidate !== nextThemePresetId) {
                nextThemePresetId = candidate;
                changed = true;
            }
        }

        let nextProviders = current.providers;
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
                        if (nextProviders === current.providers) {
                            nextProviders = { ...current.providers };
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
        let nextPromptInjection = current.promptInjection;
        if (nextPromptInjection) {
            for (const [channelKey, presetKey] of channelCategories) {
                const channelCfg = nextPromptInjection[channelKey];
                if (!channelCfg) continue;
                const list = presets[presetKey] || [];
                const cur = channelCfg.activePresetId || '';
                if (!list.some((p) => p.id === cur)) {
                    const nextId = list[0]?.id || '';
                    if (nextId !== cur) {
                        if (nextPromptInjection === current.promptInjection) {
                            nextPromptInjection = { ...current.promptInjection };
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

        let nextMaterialConfig = current.materialConfig;
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
                        if (nextMaterialConfig === current.materialConfig) {
                            nextMaterialConfig = { ...current.materialConfig };
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
            if (targetSettings) {
                targetSettings.activeThemePresetId = nextThemePresetId;
                targetSettings.providers = nextProviders;
                targetSettings.promptInjection = nextPromptInjection;
                targetSettings.materialConfig = nextMaterialConfig;
            } else {
                this.repo.replaceRaw({
                    ...current,
                    activeThemePresetId: nextThemePresetId,
                    providers: nextProviders,
                    promptInjection: nextPromptInjection,
                    materialConfig: nextMaterialConfig,
                });
            }
        }

        return changed;
    }
}
