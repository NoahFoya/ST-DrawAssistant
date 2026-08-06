/**
 * @module storage/character-store
 * @description 角色设定、服装设定及设定启用方案的持久化存储管理器
 */

import type { CharacterProfile, OutfitProfile, EnableSchemeProfile } from '../types/character';

const CHARACTER_PROFILES_KEY = 'st_da_character_profiles_v1';
const OUTFIT_PROFILES_KEY = 'st_da_outfit_profiles_v1';
const ENABLE_SCHEMES_KEY = 'st_da_enable_schemes_v1';

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
