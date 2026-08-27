/**
 * @module extensions/character-manager/data/preset-loader
 * @description 角色与服装预设方案加载器 (基于 PresetRegistry 统一检索)
 */

import { getPresetListFromRegistry } from '../../../core/config/config-loader';
import type { IPresetRegistry } from '../../../core/registry/preset-registry';
import {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    RegexFormulaScheme
} from '../types';

/** 获取所有角色预设列表 */
export async function fetchCharacters(reg?: IPresetRegistry): Promise<CharacterProfile[]> {
    return getPresetListFromRegistry<CharacterProfile>(reg, 'character-manager', 'characters').map((item) => ({
        ...(item.data || {}),
        id: item.id,
        name: item.name
    }));
}

/** 获取所有服装预设列表 */
export async function fetchOutfits(reg?: IPresetRegistry): Promise<OutfitProfile[]> {
    return getPresetListFromRegistry<OutfitProfile>(reg, 'character-manager', 'outfits').map((item) => ({
        ...(item.data || {}),
        id: item.id,
        name: item.name
    }));
}

/** 获取所有启用规则方案列表 */
export async function fetchEnableSchemes(reg?: IPresetRegistry): Promise<EnableSchemeProfile[]> {
    return getPresetListFromRegistry<EnableSchemeProfile>(reg, 'character-manager', 'enable-schemes').map((item) => ({
        ...(item.data || {}),
        id: item.id,
        name: item.name
    }));
}

/** 获取所有提示词注入模板列表 */
export async function fetchInjectionTemplates(reg?: IPresetRegistry): Promise<InjectionTemplateScheme[]> {
    return getPresetListFromRegistry<InjectionTemplateScheme>(reg, 'character-manager', 'injection-templates').map((item) => ({
        ...(item.data || {}),
        id: item.id,
        name: item.name
    }));
}

/** 获取所有正则宏公式方案列表 */
export async function fetchRegexFormulas(reg?: IPresetRegistry): Promise<RegexFormulaScheme[]> {
    return getPresetListFromRegistry<RegexFormulaScheme>(reg, 'character-manager', 'regex-formulas').map((item) => ({
        ...(item.data || {}),
        id: item.id,
        name: item.name
    }));
}
