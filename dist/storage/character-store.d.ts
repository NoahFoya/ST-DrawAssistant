/**
 * @module storage/character-store
 * @description 角色设定预设的持久化存储管理器
 */
import type { CharacterProfile } from '../types/character';
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
//# sourceMappingURL=character-store.d.ts.map