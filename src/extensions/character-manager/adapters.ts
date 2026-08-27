/**
 * @module extensions/character-manager/adapters
 * @description 角色管理器 5 大子面板预设方案操作适配器工厂
 */

import { PresetToolbarAdapter } from '../../ui/components/preset-toolbar';
import {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    RegexFormulaScheme
} from './types';
import {
    CharacterStorage,
    DEFAULT_CHARACTER_PROFILE,
    DEFAULT_OUTFIT_PROFILE,
    DEFAULT_ENABLE_SCHEME,
    DEFAULT_INJECTION_TEMPLATE,
    DEFAULT_REGEX_FORMULA_SCHEME
} from './storage';

/**
 * 1. 角色设定预设方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 角色设定专属的 PresetToolbarAdapter
 */
export function createCharacterPresetAdapter(
    storage: CharacterStorage
): PresetToolbarAdapter<CharacterProfile> {
    return {
        label: '角色预设',
        getProfiles: () =>
            storage.getCharacters().map((c) => ({
                id: c.id,
                name: c.nameCN ? `${c.nameCN} (${c.nameEN || '未命名'})` : c.nameEN || c.id,
                data: c
            })),
        getInitialId: () => storage.getCharacters()[0]?.id ?? '',
        createProfile: (name, data) => {
            const newId = `char_${Date.now()}`;
            const trimmedName = name.trim() || '新角色设定';
            const newChar: CharacterProfile = {
                ...data,
                id: newId,
                nameCN: trimmedName,
                nameEN: data.nameEN || trimmedName
            };
            storage.upsertCharacter(newChar);
            return newId;
        },
        saveProfile: (id, data) => {
            storage.upsertCharacter({ ...data, id });
        },
        renameProfile: (id, newName) => {
            const trimmed = newName.trim();
            if (!trimmed) return;
            const item = storage.getCharacters().find((c) => c.id === id);
            if (item) storage.upsertCharacter({ ...item, nameCN: trimmed });
        },
        deleteProfile: (id) => {
            storage.deleteCharacter(id);
            return storage.getCharacters()[0]?.id ?? '';
        },
        resetToDefault: () => {
            storage.saveCharacters([DEFAULT_CHARACTER_PROFILE]);
        }
    };
}

/**
 * 2. 服装设定预设方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 服装设定专属的 PresetToolbarAdapter
 */
export function createOutfitPresetAdapter(
    storage: CharacterStorage
): PresetToolbarAdapter<OutfitProfile> {
    return {
        label: '服装预设',
        getProfiles: () =>
            storage.getOutfits().map((o) => ({
                id: o.id,
                name: o.nameCN ? `${o.nameCN} (${o.nameEN || '未命名'})` : o.nameEN || o.id,
                data: o
            })),
        getInitialId: () => storage.getOutfits()[0]?.id ?? '',
        createProfile: (name, data) => {
            const newId = `outfit_${Date.now()}`;
            const trimmedName = name.trim() || '新服装设定';
            const newOutfit: OutfitProfile = {
                ...data,
                id: newId,
                nameCN: trimmedName,
                nameEN: data.nameEN || trimmedName
            };
            storage.upsertOutfit(newOutfit);
            return newId;
        },
        saveProfile: (id, data) => {
            storage.upsertOutfit({ ...data, id });
        },
        renameProfile: (id, newName) => {
            const trimmed = newName.trim();
            if (!trimmed) return;
            const item = storage.getOutfits().find((o) => o.id === id);
            if (item) storage.upsertOutfit({ ...item, nameCN: trimmed });
        },
        deleteProfile: (id) => {
            storage.deleteOutfit(id);
            return storage.getOutfits()[0]?.id ?? '';
        },
        resetToDefault: () => {
            storage.saveOutfits([DEFAULT_OUTFIT_PROFILE]);
        }
    };
}

/**
 * 3. 方案启用规则预设适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 启用方案专属的 PresetToolbarAdapter
 */
export function createEnableSchemePresetAdapter(
    storage: CharacterStorage
): PresetToolbarAdapter<EnableSchemeProfile> {
    return {
        label: '启用方案',
        getProfiles: () =>
            storage.getSchemes().map((s) => ({
                id: s.id,
                name: s.name || s.id,
                data: s
            })),
        getInitialId: () => storage.getSchemes()[0]?.id ?? '',
        createProfile: (name, data) => {
            const newId = `scheme_${Date.now()}`;
            const trimmedName = name.trim() || '新启用方案';
            const newScheme: EnableSchemeProfile = {
                ...data,
                id: newId,
                name: trimmedName
            };
            storage.upsertScheme(newScheme);
            return newId;
        },
        saveProfile: (id, data) => {
            storage.upsertScheme({ ...data, id });
        },
        renameProfile: (id, newName) => {
            const trimmed = newName.trim();
            if (!trimmed) return;
            const item = storage.getSchemes().find((s) => s.id === id);
            if (item) storage.upsertScheme({ ...item, name: trimmed });
        },
        deleteProfile: (id) => {
            storage.deleteScheme(id);
            return storage.getSchemes()[0]?.id ?? '';
        },
        resetToDefault: () => {
            storage.saveSchemes([DEFAULT_ENABLE_SCHEME]);
        }
    };
}

/**
 * 4. 注入模板方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 注入模板专属的 PresetToolbarAdapter
 */
export function createInjectionTemplatePresetAdapter(
    storage: CharacterStorage
): PresetToolbarAdapter<InjectionTemplateScheme> {
    return {
        label: '注入模板',
        getProfiles: () =>
            storage.getTemplates().map((t) => ({
                id: t.id,
                name: t.name || t.id,
                data: t
            })),
        getInitialId: () => storage.getTemplates()[0]?.id ?? '',
        createProfile: (name, data) => {
            const newId = `tpl_${Date.now()}`;
            const trimmedName = name.trim() || '新注入模板';
            const newTpl: InjectionTemplateScheme = {
                ...data,
                id: newId,
                name: trimmedName
            };
            storage.upsertTemplate(newTpl);
            return newId;
        },
        saveProfile: (id, data) => {
            storage.upsertTemplate({ ...data, id });
        },
        renameProfile: (id, newName) => {
            const trimmed = newName.trim();
            if (!trimmed) return;
            const item = storage.getTemplates().find((t) => t.id === id);
            if (item) storage.upsertTemplate({ ...item, name: trimmed });
        },
        deleteProfile: (id) => {
            storage.deleteTemplate(id);
            return storage.getTemplates()[0]?.id ?? '';
        },
        resetToDefault: () => {
            storage.saveTemplates([DEFAULT_INJECTION_TEMPLATE]);
        }
    };
}

/**
 * 5. 正则宏公式方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 正则宏公式专属的 PresetToolbarAdapter
 */
export function createRegexFormulaPresetAdapter(
    storage: CharacterStorage
): PresetToolbarAdapter<RegexFormulaScheme> {
    return {
        label: '宏公式方案',
        getProfiles: () =>
            storage.getFormulas().map((f) => ({
                id: f.id,
                name: f.name || f.id,
                data: f
            })),
        getInitialId: () => storage.getActiveFormulaId(),
        createProfile: (name, data) => {
            const newId = `formula_${Date.now()}`;
            const trimmedName = name.trim() || '新正则宏公式';
            const newFormula: RegexFormulaScheme = {
                ...data,
                id: newId,
                name: trimmedName
            };
            storage.upsertFormula(newFormula);
            storage.setActiveFormulaId(newId);
            return newId;
        },
        saveProfile: (id, data) => {
            storage.upsertFormula({ ...data, id });
        },
        renameProfile: (id, newName) => {
            const trimmed = newName.trim();
            if (!trimmed) return;
            const item = storage.getFormulas().find((f) => f.id === id);
            if (item) storage.upsertFormula({ ...item, name: trimmed });
        },
        deleteProfile: (id) => {
            storage.deleteFormula(id);
            const remaining = storage.getFormulas()[0]?.id ?? '';
            storage.setActiveFormulaId(remaining);
            return remaining;
        },
        resetToDefault: () => {
            storage.saveFormulas([DEFAULT_REGEX_FORMULA_SCHEME]);
            storage.setActiveFormulaId(DEFAULT_REGEX_FORMULA_SCHEME.id);
        }
    };
}

export const createMacroFormulaPresetAdapter = createRegexFormulaPresetAdapter;
