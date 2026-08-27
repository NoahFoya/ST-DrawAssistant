/**
 * @module extensions/character-manager/ui/adapters
 * @description 角色管理器 5 大子面板预设方案操作适配器工厂 (基于泛型通用工厂实现)
 */

import { PresetToolbarAdapter } from '../../../ui';
import { CharacterStorage } from '../data/storage';
import { CHARACTER_STORAGE_KEYS } from '../constants';
import type {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    RegexFormulaScheme
} from '../types';

interface PresetAdapterConfig<T extends { id: string }> {
    label: string;
    prefix: string;
    storageKey: string;
    getName: (item: T) => string;
    buildNewEntity: (id: string, name: string, data: T) => T;
    updateEntityName: (item: T, newName: string) => T;
    isFormula?: boolean;
}

/**
 * 泛型预设适配器通用生成器 (直接通过 storageKey 操作实体引擎)
 */
function createPresetAdapterHelper<T extends { id: string }>(
    storage: CharacterStorage,
    config: PresetAdapterConfig<T>
): PresetToolbarAdapter<T> {
    return {
        label: config.label,
        getProfiles: () =>
            storage.getEntities<T>(config.storageKey).map((item) => ({
                id: item.id,
                name: config.getName(item),
                data: item
            })),
        getInitialId: () =>
            config.isFormula
                ? storage.getActiveFormulaId()
                : storage.getEntities<T>(config.storageKey)[0]?.id ?? '',
        createProfile: (name, data) => {
            const newId = `${config.prefix}_${Date.now()}`;
            const trimmedName = name.trim() || `新${config.label}`;
            const newEntity = config.buildNewEntity(newId, trimmedName, data);
            storage.upsertEntity<T>(config.storageKey, newEntity);
            if (config.isFormula) storage.setActiveFormulaId(newId);
            return newId;
        },
        saveProfile: (id, data) => {
            storage.upsertEntity<T>(config.storageKey, { ...data, id });
        },
        renameProfile: (id, newName) => {
            const trimmed = newName.trim();
            if (!trimmed) return;
            const item = storage.getEntities<T>(config.storageKey).find((x) => x.id === id);
            if (item) storage.upsertEntity<T>(config.storageKey, config.updateEntityName(item, trimmed));
        },
        deleteProfile: (id) => {
            storage.deleteEntity<T>(config.storageKey, id);
            const remaining = storage.getEntities<T>(config.storageKey);
            const nextId = remaining[0]?.id ?? '';
            if (config.isFormula) storage.setActiveFormulaId(nextId);
            return nextId;
        }
    };
}

// ── 1. 角色预设适配器工厂 ──────────────────────────────────────────────────
export function createCharacterPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<CharacterProfile> {
    return createPresetAdapterHelper<CharacterProfile>(storage, {
        label: '角色预设',
        prefix: 'char',
        storageKey: CHARACTER_STORAGE_KEYS.CHARACTERS,
        getName: (c) => (c.nameCN ? `${c.nameCN} (${c.nameEN || '未命名'})` : c.nameEN || c.id),
        buildNewEntity: (id, name, data) => ({ ...data, id, nameCN: name, nameEN: data.nameEN || name }),
        updateEntityName: (c, newName) => ({ ...c, nameCN: newName })
    });
}

// ── 2. 服装预设适配器工厂 ──────────────────────────────────────────────────
export function createOutfitPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<OutfitProfile> {
    return createPresetAdapterHelper<OutfitProfile>(storage, {
        label: '服装预设',
        prefix: 'outfit',
        storageKey: CHARACTER_STORAGE_KEYS.OUTFITS,
        getName: (o) => (o.nameCN ? `${o.nameCN} (${o.nameEN || '未命名'})` : o.nameEN || o.id),
        buildNewEntity: (id, name, data) => ({ ...data, id, nameCN: name, nameEN: data.nameEN || name }),
        updateEntityName: (o, newName) => ({ ...o, nameCN: newName })
    });
}

// ── 3. 启用方案适配器工厂 ──────────────────────────────────────────────────
export function createEnableSchemePresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<EnableSchemeProfile> {
    return createPresetAdapterHelper<EnableSchemeProfile>(storage, {
        label: '启用方案',
        prefix: 'scheme',
        storageKey: CHARACTER_STORAGE_KEYS.SCHEMES,
        getName: (s) => s.name,
        buildNewEntity: (id, name, data) => ({ ...data, id, name }),
        updateEntityName: (s, newName) => ({ ...s, name: newName })
    });
}

// ── 4. 提示词注入模板方案适配器工厂 ────────────────────────────────────────
export function createInjectionTemplatePresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<InjectionTemplateScheme> {
    return createPresetAdapterHelper<InjectionTemplateScheme>(storage, {
        label: '注入模板',
        prefix: 'template',
        storageKey: CHARACTER_STORAGE_KEYS.TEMPLATES,
        getName: (t) => t.name,
        buildNewEntity: (id, name, data) => ({ ...data, id, name }),
        updateEntityName: (t, newName) => ({ ...t, name: newName })
    });
}

// ── 5. 正则宏公式方案适配器工厂 ────────────────────────────────────────────
export function createRegexFormulaPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<RegexFormulaScheme> {
    return createPresetAdapterHelper<RegexFormulaScheme>(storage, {
        label: '公式方案',
        prefix: 'formula',
        storageKey: CHARACTER_STORAGE_KEYS.FORMULAS,
        isFormula: true,
        getName: (f) => f.name,
        buildNewEntity: (id, name, data) => ({ ...data, id, name }),
        updateEntityName: (f, newName) => ({ ...f, name: newName })
    });
}
