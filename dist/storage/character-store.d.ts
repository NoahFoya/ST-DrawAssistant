/**
 * @module storage/character-store
 * @description 角色设定、服装设定及设定启用方案的持久化存储管理器
 */
import type { CharacterProfile, OutfitProfile, EnableSchemeProfile } from '../types/character';
export declare function getCharacterProfiles(): CharacterProfile[];
export declare function saveCharacterProfiles(profiles: CharacterProfile[]): void;
export declare function getCharacterProfileById(id: string): CharacterProfile | undefined;
export declare function upsertCharacterProfile(profile: CharacterProfile): void;
export declare function deleteCharacterProfile(id: string): void;
export declare function getOutfitProfiles(): OutfitProfile[];
export declare function saveOutfitProfiles(profiles: OutfitProfile[]): void;
export declare function getOutfitProfileById(id: string): OutfitProfile | undefined;
export declare function upsertOutfitProfile(profile: OutfitProfile): void;
export declare function deleteOutfitProfile(id: string): void;
export declare function getEnableSchemes(): EnableSchemeProfile[];
export declare function saveEnableSchemes(schemes: EnableSchemeProfile[]): void;
export declare function getEnableSchemeById(id: string): EnableSchemeProfile | undefined;
export declare function upsertEnableScheme(scheme: EnableSchemeProfile): void;
export declare function deleteEnableScheme(id: string): void;
//# sourceMappingURL=character-store.d.ts.map