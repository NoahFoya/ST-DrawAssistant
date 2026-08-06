/**
 * @module storage/character-store
 * @description 角色设定及服装设定预设的持久化存储管理器
 */
import type { CharacterProfile, OutfitProfile } from '../types/character';
/**
 * 获取所有角色预设
 */
export declare function getCharacterProfiles(): CharacterProfile[];
/**
 * 保存全量角色预设列表
 */
export declare function saveCharacterProfiles(profiles: CharacterProfile[]): void;
/**
 * 根据 ID 获取指定角色预设
 */
export declare function getCharacterProfileById(id: string): CharacterProfile | undefined;
/**
 * 保存/更新单个角色预设
 */
export declare function upsertCharacterProfile(profile: CharacterProfile): void;
/**
 * 删除角色预设
 */
export declare function deleteCharacterProfile(id: string): void;
/**
 * 获取所有服装预设
 */
export declare function getOutfitProfiles(): OutfitProfile[];
/**
 * 保存全量服装预设列表
 */
export declare function saveOutfitProfiles(profiles: OutfitProfile[]): void;
/**
 * 根据 ID 获取指定服装预设
 */
export declare function getOutfitProfileById(id: string): OutfitProfile | undefined;
/**
 * 保存/更新单个服装预设
 */
export declare function upsertOutfitProfile(profile: OutfitProfile): void;
/**
 * 删除服装预设
 */
export declare function deleteOutfitProfile(id: string): void;
//# sourceMappingURL=character-store.d.ts.map