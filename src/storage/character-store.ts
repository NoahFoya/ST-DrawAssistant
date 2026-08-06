/**
 * @module storage/character-store
 * @description 角色设定预设的持久化存储管理器
 */

import type { CharacterProfile } from '../types/character';

const CHARACTER_PROFILES_KEY = 'st_da_character_profiles_v1';

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
    outfitList: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
};

/**
 * 获取所有角色预设
 */
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

/**
 * 保存全量角色预设列表
 */
export function saveCharacterProfiles(profiles: CharacterProfile[]): void {
    localStorage.setItem(CHARACTER_PROFILES_KEY, JSON.stringify(profiles));
}

/**
 * 根据 ID 获取指定角色预设
 */
export function getCharacterProfileById(id: string): CharacterProfile | undefined {
    return getCharacterProfiles().find(p => p.id === id);
}

/**
 * 保存/更新单个角色预设
 */
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

/**
 * 删除角色预设
 */
export function deleteCharacterProfile(id: string): void {
    const list = getCharacterProfiles().filter(p => p.id !== id);
    saveCharacterProfiles(list);
}
