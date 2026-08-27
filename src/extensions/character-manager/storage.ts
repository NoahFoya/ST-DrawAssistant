/**
 * @module extensions/character-manager/storage
 * @description 角色设定、服装设定、设定启用方案及注入模板方案的持久化存储管理器
 *
 * 设计原则：
 * - 全部默认数据均通过静态 import 于对应 JSON 预设文件加载，源码中不硬编码任何预设内容
 * - 角色/服装/方案/模板：localStorage 为空时自动从内置 JSON 预设解包填充（保证系统运行常态存在可用预设）
 */

import type { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, MacroTreeScheme } from './types';

// 静态导入预设 JSON 文件（Webpack 编译期内嵌）
import defaultCharacterJson from '../../config/presets/character-manager/default-character.json';
import defaultOutfitSailorJson from '../../config/presets/character-manager/default-outfit-sailor.json';
import defaultOutfitMaidJson from '../../config/presets/character-manager/default-outfit-maid.json';
import defaultEnableSchemeJson from '../../config/presets/character-manager/default-enable-scheme.json';
import tplTavernXmlJson from '../../config/presets/character-manager/tpl-tavern-xml.json';
import tplMarkdownCardJson from '../../config/presets/character-manager/tpl-markdown-card.json';
import standardTreePreset from '../../config/presets/macro-rules/standard-tree.json';

const CHARACTER_PROFILES_KEY = 'st_da_character_profiles_v1';
const OUTFIT_PROFILES_KEY = 'st_da_outfit_profiles_v1';
const ENABLE_SCHEMES_KEY = 'st_da_enable_schemes_v1';
const INJECTION_TEMPLATES_KEY = 'st_da_injection_templates_v1';
const MACRO_TREE_SCHEME_KEY = 'st_da_macro_tree_scheme_v1';

// 内置模板预设：从 JSON 文件加载而非硬编码
export const DEFAULT_MACRO_TREE_SCHEME: MacroTreeScheme = standardTreePreset as MacroTreeScheme;

/** 系统预置的默认注入模板列表（从 JSON 预设文件读取） */
const DEFAULT_INJECTION_TEMPLATES: InjectionTemplateScheme[] = [
    tplTavernXmlJson as InjectionTemplateScheme,
    tplMarkdownCardJson as InjectionTemplateScheme,
];

// ─── 从 JSON 预设文件导出的默认数据常量 ──────────────────────────────────────────
// 供 UI 层读取默认值展示，以及重置函数使用

/** 默认角色预设（从 JSON 预设文件读取） */
export const DEFAULT_CHARACTER_PRESET: CharacterProfile = {
    ...(defaultCharacterJson as unknown as CharacterProfile),
    createdAt: 0,
    updatedAt: 0,
};

/** 默认服装预设列表（从 JSON 预设文件读取） */
export const DEFAULT_OUTFIT_PRESETS: OutfitProfile[] = [
    { ...(defaultOutfitSailorJson as unknown as OutfitProfile), createdAt: 0, updatedAt: 0 },
    { ...(defaultOutfitMaidJson   as unknown as OutfitProfile), createdAt: 0, updatedAt: 0 },
];

/** 默认设定启用方案（从 JSON 预设文件读取） */
export const DEFAULT_ENABLE_SCHEME_PRESET: EnableSchemeProfile = {
    ...(defaultEnableSchemeJson as unknown as EnableSchemeProfile),
    createdAt: 0,
    updatedAt: 0,
};

// ─── 角色预设存储 ─────────────────────────────────────────────────────────────

/**
 * 读取所有角色预设（localStorage 为空时自动用 JSON 文件默认预设填充）
 */
export function getCharacterProfiles(): CharacterProfile[] {
    try {
        const raw = localStorage.getItem(CHARACTER_PROFILES_KEY);
        if (!raw) {
            const defaults = [{ ...DEFAULT_CHARACTER_PRESET, createdAt: Date.now(), updatedAt: Date.now() }];
            saveCharacterProfiles(defaults);
            return defaults;
        }
        const list = JSON.parse(raw) as CharacterProfile[];
        if (!Array.isArray(list) || list.length === 0) {
            const defaults = [{ ...DEFAULT_CHARACTER_PRESET, createdAt: Date.now(), updatedAt: Date.now() }];
            saveCharacterProfiles(defaults);
            return defaults;
        }
        return list;
    } catch {
        return [{ ...DEFAULT_CHARACTER_PRESET, createdAt: Date.now(), updatedAt: Date.now() }];
    }
}

export function saveCharacterProfiles(profiles: CharacterProfile[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CHARACTER_PROFILES_KEY, JSON.stringify(profiles));
}

export function getCharacterProfileById(id: string): CharacterProfile | undefined {
    return getCharacterProfiles().find(p => p.id === id);
}

export function upsertCharacterProfile(profile: CharacterProfile): void {
    const list = getCharacterProfiles();
    const idx = list.findIndex(p => p.id === profile.id);
    profile.updatedAt = Date.now();
    if (idx >= 0) {
        list[idx] = profile;
    } else {
        list.push(profile);
    }
    saveCharacterProfiles(list);
}

export function deleteCharacterProfile(id: string): void {
    const list = getCharacterProfiles().filter(p => p.id !== id);
    saveCharacterProfiles(list);
}

// ─── 服装预设存储 ────────────────────────────────────────────────────

/**
 * 读取所有服装预设（localStorage 为空时自动用 JSON 文件默认预设填充）
 */
export function getOutfitProfiles(): OutfitProfile[] {
    try {
        const raw = localStorage.getItem(OUTFIT_PROFILES_KEY);
        if (!raw) {
            const defaults = DEFAULT_OUTFIT_PRESETS.map(o => ({ ...o, createdAt: Date.now(), updatedAt: Date.now() }));
            saveOutfitProfiles(defaults);
            return defaults;
        }
        const list = JSON.parse(raw) as OutfitProfile[];
        if (!Array.isArray(list) || list.length === 0) {
            const defaults = DEFAULT_OUTFIT_PRESETS.map(o => ({ ...o, createdAt: Date.now(), updatedAt: Date.now() }));
            saveOutfitProfiles(defaults);
            return defaults;
        }
        return list;
    } catch {
        return DEFAULT_OUTFIT_PRESETS.map(o => ({ ...o, createdAt: Date.now(), updatedAt: Date.now() }));
    }
}

export function saveOutfitProfiles(profiles: OutfitProfile[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(OUTFIT_PROFILES_KEY, JSON.stringify(profiles));
}

export function getOutfitProfileById(id: string): OutfitProfile | undefined {
    return getOutfitProfiles().find(p => p.id === id);
}

export function upsertOutfitProfile(profile: OutfitProfile): void {
    const list = getOutfitProfiles();
    const idx = list.findIndex(p => p.id === profile.id);
    profile.updatedAt = Date.now();
    if (idx >= 0) {
        list[idx] = profile;
    } else {
        list.push(profile);
    }
    saveOutfitProfiles(list);
}

export function deleteOutfitProfile(id: string): void {
    const list = getOutfitProfiles().filter(p => p.id !== id);
    saveOutfitProfiles(list);
}

// ─── 设定启用方案存储 ─────────────────────────────────────────────────

/**
 * 读取所有设定启用方案（localStorage 为空时自动用 JSON 文件默认预设填充）
 */
export function getEnableSchemes(): EnableSchemeProfile[] {
    try {
        if (typeof localStorage === 'undefined') {
            return [{ ...DEFAULT_ENABLE_SCHEME_PRESET, createdAt: Date.now(), updatedAt: Date.now() }];
        }
        const raw = localStorage.getItem(ENABLE_SCHEMES_KEY);
        if (!raw) {
            const defaults = [{ ...DEFAULT_ENABLE_SCHEME_PRESET, createdAt: Date.now(), updatedAt: Date.now() }];
            saveEnableSchemes(defaults);
            return defaults;
        }
        const list = JSON.parse(raw) as EnableSchemeProfile[];
        if (!Array.isArray(list) || list.length === 0) {
            const defaults = [{ ...DEFAULT_ENABLE_SCHEME_PRESET, createdAt: Date.now(), updatedAt: Date.now() }];
            saveEnableSchemes(defaults);
            return defaults;
        }
        return list;
    } catch {
        return [{ ...DEFAULT_ENABLE_SCHEME_PRESET, createdAt: Date.now(), updatedAt: Date.now() }];
    }
}

export function saveEnableSchemes(schemes: EnableSchemeProfile[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ENABLE_SCHEMES_KEY, JSON.stringify(schemes));
}

export function getEnableSchemeById(id: string): EnableSchemeProfile | undefined {
    return getEnableSchemes().find(s => s.id === id);
}

export function upsertEnableScheme(scheme: EnableSchemeProfile): void {
    const list = getEnableSchemes();
    const idx = list.findIndex(s => s.id === scheme.id);
    scheme.updatedAt = Date.now();
    if (idx >= 0) {
        list[idx] = scheme;
    } else {
        list.push(scheme);
    }
    saveEnableSchemes(list);
}

export function deleteEnableScheme(id: string): void {
    const list = getEnableSchemes().filter(s => s.id !== id);
    saveEnableSchemes(list);
}

// ─── 角色管理器重置工具 ────────────────────────────────────────────────────────

/**
 * 将角色预设重置为 JSON 预设文件中的默认数据
 * （等效于删除用户数据后重新从预设文件初始化）
 */
export function resetCharacterProfilesToDefault(): CharacterProfile[] {
    const now = Date.now();
    const defaults: CharacterProfile[] = [{
        ...DEFAULT_CHARACTER_PRESET,
        createdAt: now,
        updatedAt: now,
    }];
    saveCharacterProfiles(defaults);
    return defaults;
}

/**
 * 将服装预设重置为 JSON 预设文件中的默认数据
 */
export function resetOutfitProfilesToDefault(): OutfitProfile[] {
    const now = Date.now();
    const defaults: OutfitProfile[] = DEFAULT_OUTFIT_PRESETS.map(o => ({
        ...o,
        createdAt: now,
        updatedAt: now,
    }));
    saveOutfitProfiles(defaults);
    return defaults;
}

/**
 * 将设定启用方案重置为 JSON 预设文件中的默认数据
 */
export function resetEnableSchemesToDefault(): EnableSchemeProfile[] {
    const now = Date.now();
    const defaults: EnableSchemeProfile[] = [{
        ...DEFAULT_ENABLE_SCHEME_PRESET,
        createdAt: now,
        updatedAt: now,
    }];
    saveEnableSchemes(defaults);
    return defaults;
}

/**
 * 一键重置角色管理器全量数据（角色 + 服装 + 启用方案）为 JSON 预设默认值
 */
export function resetCharacterManagerToDefault(): void {
    resetCharacterProfilesToDefault();
    resetOutfitProfilesToDefault();
    resetEnableSchemesToDefault();
}

// ─── 注入模板方案存储 ─────────────────────────────────────────────────


/**
 * 读取注入模板列表
 *
 * 注入模板为系统功能性配置：localStorage 为空时自动从 JSON 预设填充两个内置模板，
 * 确保系统常态至少存在一个可用模板。
 */
export function getInjectionTemplates(): InjectionTemplateScheme[] {
    try {
        if (typeof localStorage === 'undefined') {
            return [...DEFAULT_INJECTION_TEMPLATES];
        }
        const raw = localStorage.getItem(INJECTION_TEMPLATES_KEY);
        if (!raw) {
            saveInjectionTemplates(DEFAULT_INJECTION_TEMPLATES);
            return [...DEFAULT_INJECTION_TEMPLATES];
        }
        const list = JSON.parse(raw) as InjectionTemplateScheme[];
        // 保证系统内置模板始终存在于列表中
        DEFAULT_INJECTION_TEMPLATES.forEach(d => {
            if (!list.some(item => item.id === d.id)) {
                list.unshift(d);
            }
        });
        return list;
    } catch {
        return [...DEFAULT_INJECTION_TEMPLATES];
    }
}

export function saveInjectionTemplates(templates: InjectionTemplateScheme[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(INJECTION_TEMPLATES_KEY, JSON.stringify(templates));
}

export function getInjectionTemplateById(id: string): InjectionTemplateScheme | undefined {
    return getInjectionTemplates().find(t => t.id === id);
}

export function upsertInjectionTemplate(template: InjectionTemplateScheme): void {
    const list = getInjectionTemplates();
    const idx = list.findIndex(t => t.id === template.id);
    if (idx >= 0) {
        list[idx] = template;
    } else {
        list.push(template);
    }
    saveInjectionTemplates(list);
}

export function deleteInjectionTemplate(id: string): void {
    const list = getInjectionTemplates().filter(t => t.id !== id);
    // 至少保留第一个内置模板
    if (list.length === 0) {
        list.push(DEFAULT_INJECTION_TEMPLATES[0]);
    }
    saveInjectionTemplates(list);
}

// ─── 树形宏模板匹配规则方案存储 ──────────────────────────────────────────────

const ACTIVE_MACRO_SCHEME_ID_KEY = 'st_da_active_macro_scheme_id_v1';

export function getMacroTreeSchemes(): MacroTreeScheme[] {
    try {
        if (typeof localStorage === 'undefined') {
            return [DEFAULT_MACRO_TREE_SCHEME];
        }
        const raw = localStorage.getItem(MACRO_TREE_SCHEME_KEY);
        if (!raw) {
            saveMacroTreeSchemes([DEFAULT_MACRO_TREE_SCHEME]);
            return [DEFAULT_MACRO_TREE_SCHEME];
        }
        const list = JSON.parse(raw) as MacroTreeScheme[];
        if (!list || list.length === 0) {
            saveMacroTreeSchemes([DEFAULT_MACRO_TREE_SCHEME]);
            return [DEFAULT_MACRO_TREE_SCHEME];
        }
        return list;
    } catch {
        return [DEFAULT_MACRO_TREE_SCHEME];
    }
}

export function saveMacroTreeSchemes(schemes: MacroTreeScheme[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MACRO_TREE_SCHEME_KEY, JSON.stringify(schemes));
}

export function getActiveMacroTreeSchemeId(): string {
    if (typeof localStorage === 'undefined') return DEFAULT_MACRO_TREE_SCHEME.id;
    return localStorage.getItem(ACTIVE_MACRO_SCHEME_ID_KEY) || DEFAULT_MACRO_TREE_SCHEME.id;
}

export function setActiveMacroTreeSchemeId(id: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ACTIVE_MACRO_SCHEME_ID_KEY, id);
}

export function getActiveMacroTreeScheme(): MacroTreeScheme {
    const list = getMacroTreeSchemes();
    const activeId = getActiveMacroTreeSchemeId();
    const found = list.find(s => s.id === activeId);
    return found || list[0] || DEFAULT_MACRO_TREE_SCHEME;
}

export function getMacroTreeScheme(): MacroTreeScheme {
    return getActiveMacroTreeScheme();
}

export function saveMacroTreeScheme(scheme: MacroTreeScheme): void {
    const list = getMacroTreeSchemes();
    const idx = list.findIndex(s => s.id === scheme.id);
    if (idx >= 0) {
        list[idx] = scheme;
    } else {
        list.push(scheme);
    }
    saveMacroTreeSchemes(list);
    setActiveMacroTreeSchemeId(scheme.id);
}

export function upsertMacroTreeScheme(scheme: MacroTreeScheme): void {
    saveMacroTreeScheme(scheme);
}

export function deleteMacroTreeScheme(id: string): void {
    let list = getMacroTreeSchemes().filter(s => s.id !== id);
    if (list.length === 0) {
        list = [DEFAULT_MACRO_TREE_SCHEME];
    }
    saveMacroTreeSchemes(list);
    if (getActiveMacroTreeSchemeId() === id) {
        setActiveMacroTreeSchemeId(list[0].id);
    }
}

export function exportMacroTreeScheme(id?: string): string {
    const targetId = id || getActiveMacroTreeSchemeId();
    const list = getMacroTreeSchemes();
    const scheme = list.find(s => s.id === targetId) || getActiveMacroTreeScheme();
    return JSON.stringify(scheme, null, 2);
}

export function importMacroTreeScheme(jsonStr: string): MacroTreeScheme {
    const parsed = JSON.parse(jsonStr) as MacroTreeScheme;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('格式无效：非合法的 JSON 对象');
    }
    const newId = `imported-macro-scheme-${Date.now()}`;
    const newScheme: MacroTreeScheme = {
        ...parsed,
        id: newId,
        name: parsed.name ? `${parsed.name} (导入)` : `导入方案 ${new Date().toLocaleTimeString()}`,
        isDefault: false
    };
    upsertMacroTreeScheme(newScheme);
    setActiveMacroTreeSchemeId(newId);
    return newScheme;
}

export function resetMacroTreeScheme(): MacroTreeScheme {
    saveMacroTreeSchemes([DEFAULT_MACRO_TREE_SCHEME]);
    setActiveMacroTreeSchemeId(DEFAULT_MACRO_TREE_SCHEME.id);
    return DEFAULT_MACRO_TREE_SCHEME;
}
