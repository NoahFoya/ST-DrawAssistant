/**
 * @module storage/character-store
 * @description 角色设定、服装设定、设定启用方案及注入模板方案的持久化存储管理器
 */

import type { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, MacroTreeScheme } from '../types/character';

const CHARACTER_PROFILES_KEY = 'st_da_character_profiles_v1';
const OUTFIT_PROFILES_KEY = 'st_da_outfit_profiles_v1';
const ENABLE_SCHEMES_KEY = 'st_da_enable_schemes_v1';
const INJECTION_TEMPLATES_KEY = 'st_da_injection_templates_v1';
const MACRO_TREE_SCHEME_KEY = 'st_da_macro_tree_scheme_v1';

/** 默认的示例角色预设 */
const DEFAULT_CHARACTER: CharacterProfile = {
    id: 'default-char-1',
    nameCN: '示例角色',
    nameEN: 'Sample Character',
    characterTraits: '1girl, solo, masterpiece, best quality',
    facialFeatures: 'blue eyes, long silver hair, smiling',
    facialFeaturesBack: 'long silver hair from behind, hair ribbon',
    upperBodySFW: 'white shirt, red ribbon, school uniform',
    upperBodySFWBack: 'white shirt from behind',
    fullBodySFW: 'pleated skirt, black thighhighs, loafers',
    fullBodySFWBack: 'pleated skirt from behind',
    upperBodyNSFW: '',
    upperBodyNSFWBack: '',
    fullBodyNSFW: '',
    fullBodyNSFWBack: '',
    negativePrompt: 'bad anatomy, worst quality, low quality',
    outfitList: ['水手制服', '女仆装'],
    createdAt: Date.now(),
    updatedAt: Date.now()
};

/** 默认示例服装预设 */
const DEFAULT_OUTFITS: OutfitProfile[] = [
    {
        id: 'default-outfit-1',
        nameCN: '水手制服',
        nameEN: 'Sailor Uniform',
        upperBody: 'sailor collar, white shirt, necktie',
        upperBodyBack: 'sailor collar back',
        fullBody: 'pleated skirt, knee high socks',
        fullBodyBack: 'pleated skirt back',
        createdAt: Date.now(),
        updatedAt: Date.now()
    },
    {
        id: 'default-outfit-2',
        nameCN: '女仆装',
        nameEN: 'Maid Outfit',
        upperBody: 'maid dress, apron, frills',
        upperBodyBack: 'apron ribbon tie',
        fullBody: 'frilled skirt, white stockings',
        fullBodyBack: 'frilled skirt back',
        createdAt: Date.now(),
        updatedAt: Date.now()
    }
];

/** 默认示例设定启用方案 */
const DEFAULT_ENABLE_SCHEME: EnableSchemeProfile = {
    id: 'default-scheme-1',
    name: '默认全局启用方案',
    boundCharacterCards: '示例角色',
    boundChatId: '',
    characterRules: {
        'default-char-1': { enabled: true, rule: 'ALL' }
    },
    outfitRules: {
        'default-outfit-1': { enabled: true, rule: 'match' },
        'default-outfit-2': { enabled: true, rule: 'match' }
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
};

/** 默认注入模板方案 (系统预置 XML 格式) */
const DEFAULT_SYSTEM_INJECTION_TEMPLATE: InjectionTemplateScheme = {
    id: 'tpl-default-xml',
    name: 'Tavern XML 格式 (系统预置)',
    isSystemPreset: true,
    characterListTemplate: `<character name="{nameCN}">
  <name_en>{nameEN}</name_en>
  <traits>{traits}</traits>
  <facial>{facial}</facial>
  <upper_sfw>{upperSFW}</upper_sfw>
  <lower_sfw>{lowerSFW}</lower_sfw>
  <outfits>
{outfits}
  </outfits>
</character>`,
    innerOutfitTemplate: `    <outfit name="{nameCN}">
      <upper>{upperBody}</upper>
      <lower>{lowerBody}</lower>
    </outfit>`,
    commonCharacterListTemplate: '',
    enableOutfitListTemplate: `<outfit name="{nameCN}">
  <name_en>{nameEN}</name_en>
  <upper>{upperBody}</upper>
  <lower>{lowerBody}</lower>
</outfit>`
};

/** Markdown 极简方案预置 */
const MARKDOWN_INJECTION_TEMPLATE: InjectionTemplateScheme = {
    id: 'tpl-markdown-card',
    name: 'Markdown 极简卡片 (系统预置)',
    isSystemPreset: true,
    characterListTemplate: `### 👤 {nameCN} ({nameEN})
- 特征: {traits}
- 五官: {facial}
- 着装: {upperSFW}, {lowerSFW}
- 专属服装:
{outfits}`,
    innerOutfitTemplate: `  - [{nameCN}]: {upperBody}, {lowerBody}`,
    commonCharacterListTemplate: '',
    enableOutfitListTemplate: `### 👗 服装: {nameCN} ({nameEN})
- 样式: {upperBody}, {lowerBody}`
};

// ─── 角色预设存储 ─────────────────────────────────────────────────────────────

export function getCharacterProfiles(): CharacterProfile[] {
    try {
        const raw = localStorage.getItem(CHARACTER_PROFILES_KEY);
        if (!raw) {
            saveCharacterProfiles([DEFAULT_CHARACTER]);
            return [DEFAULT_CHARACTER];
        }
        const list = JSON.parse(raw) as CharacterProfile[];
        return list.length > 0 ? list : [DEFAULT_CHARACTER];
    } catch {
        return [DEFAULT_CHARACTER];
    }
}

export function saveCharacterProfiles(profiles: CharacterProfile[]): void {
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

// ─── 服装预设存储 ─────────────────────────────────────────────────────────────

export function getOutfitProfiles(): OutfitProfile[] {
    try {
        const raw = localStorage.getItem(OUTFIT_PROFILES_KEY);
        if (!raw) {
            saveOutfitProfiles(DEFAULT_OUTFITS);
            return DEFAULT_OUTFITS;
        }
        const list = JSON.parse(raw) as OutfitProfile[];
        return list.length > 0 ? list : DEFAULT_OUTFITS;
    } catch {
        return DEFAULT_OUTFITS;
    }
}

export function saveOutfitProfiles(profiles: OutfitProfile[]): void {
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

// ─── 设定启用方案存储 ─────────────────────────────────────────────────────────

export function getEnableSchemes(): EnableSchemeProfile[] {
    try {
        const raw = localStorage.getItem(ENABLE_SCHEMES_KEY);
        if (!raw) {
            saveEnableSchemes([DEFAULT_ENABLE_SCHEME]);
            return [DEFAULT_ENABLE_SCHEME];
        }
        const list = JSON.parse(raw) as EnableSchemeProfile[];
        return list.length > 0 ? list : [DEFAULT_ENABLE_SCHEME];
    } catch {
        return [DEFAULT_ENABLE_SCHEME];
    }
}

export function saveEnableSchemes(schemes: EnableSchemeProfile[]): void {
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

// ─── 注入模板方案存储 ─────────────────────────────────────────────────────────

export function getInjectionTemplates(): InjectionTemplateScheme[] {
    try {
        const raw = localStorage.getItem(INJECTION_TEMPLATES_KEY);
        const defaults = [DEFAULT_SYSTEM_INJECTION_TEMPLATE, MARKDOWN_INJECTION_TEMPLATE];
        if (!raw) {
            saveInjectionTemplates(defaults);
            return defaults;
        }
        const list = JSON.parse(raw) as InjectionTemplateScheme[];
        // 保证系统默认方案始终存在
        defaults.forEach(d => {
            if (!list.some(item => item.id === d.id)) {
                list.unshift(d);
            }
        });
        return list;
    } catch {
        return [DEFAULT_SYSTEM_INJECTION_TEMPLATE, MARKDOWN_INJECTION_TEMPLATE];
    }
}

export function saveInjectionTemplates(templates: InjectionTemplateScheme[]): void {
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
    const list = getInjectionTemplates().filter(t => t.id !== id || t.isSystemPreset);
    saveInjectionTemplates(list);
}

// ─── 树形宏模板匹配规则方案存储 ──────────────────────────────────────────────

export const DEFAULT_MACRO_TREE_SCHEME: MacroTreeScheme = {
    id: 'default-macro-tree-v1',
    name: 'Wai/Standard 2层树形宏匹配默认预设',
    isDefault: true,
    characterFixedVariables: ['nameEN', 'characterTraits'],
    outfitFixedVariables: ['nameEN'],
    characterTemplate: '{nameEN}, {facial}, {upperBody}, {fullBody}, {traits}',
    outfitTemplate: '{nameEN}, {upperBody}, {fullBody}',
    rootNodes: [
        {
            id: 'node-behind',
            name: '背面视角路由分支',
            pattern: '-from_behind',
            enabled: true,
            children: [
                {
                    id: 'node-behind-upper-sfw',
                    name: '背面 SFW 上半身',
                    pattern: '-sfw-upperbody',
                    enabled: true,
                    variables: ['facialFeaturesBack', 'upperBodySFWBack']
                },
                {
                    id: 'node-behind-upper-nsfw',
                    name: '背面 NSFW 上半身',
                    pattern: '-nsfw-upperbody',
                    enabled: true,
                    variables: ['facialFeaturesBack', 'upperBodyNSFWBack']
                },
                {
                    id: 'node-behind-lower-sfw',
                    name: '背面 SFW 下半身',
                    pattern: '-sfw-lowerbody',
                    enabled: true,
                    variables: ['fullBodySFWBack']
                },
                {
                    id: 'node-behind-lower-nsfw',
                    name: '背面 NSFW 下半身',
                    pattern: '-nsfw-lowerbody',
                    enabled: true,
                    variables: ['fullBodyNSFWBack']
                }
            ]
        },
        {
            id: 'node-front-upper-sfw',
            name: '正面 SFW 上半身',
            pattern: '-sfw-upperbody',
            enabled: true,
            variables: ['facialFeatures', 'upperBodySFW']
        },
        {
            id: 'node-front-upper-nsfw',
            name: '正面 NSFW 上半身',
            pattern: '-nsfw-upperbody',
            enabled: true,
            variables: ['facialFeatures', 'upperBodyNSFW']
        },
        {
            id: 'node-front-lower-sfw',
            name: '正面 SFW 下半身',
            pattern: '-sfw-lowerbody',
            enabled: true,
            variables: ['fullBodySFW']
        },
        {
            id: 'node-front-lower-nsfw',
            name: '正面 NSFW 下半身',
            pattern: '-nsfw-lowerbody',
            enabled: true,
            variables: ['fullBodyNSFW']
        }
    ]
};

export function getMacroTreeScheme(): MacroTreeScheme {
    try {
        const raw = localStorage.getItem(MACRO_TREE_SCHEME_KEY);
        if (!raw) {
            saveMacroTreeScheme(DEFAULT_MACRO_TREE_SCHEME);
            return DEFAULT_MACRO_TREE_SCHEME;
        }
        const scheme = JSON.parse(raw) as MacroTreeScheme;
        return scheme || DEFAULT_MACRO_TREE_SCHEME;
    } catch {
        return DEFAULT_MACRO_TREE_SCHEME;
    }
}

export function saveMacroTreeScheme(scheme: MacroTreeScheme): void {
    localStorage.setItem(MACRO_TREE_SCHEME_KEY, JSON.stringify(scheme));
}

export function resetMacroTreeScheme(): MacroTreeScheme {
    saveMacroTreeScheme(DEFAULT_MACRO_TREE_SCHEME);
    return DEFAULT_MACRO_TREE_SCHEME;
}
