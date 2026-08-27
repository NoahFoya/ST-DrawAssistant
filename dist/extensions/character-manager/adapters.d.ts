/**
 * @module extensions/character-manager/adapters
 * @description 角色管理器 5 大子面板预设方案操作适配器工厂 (基于泛型通用工厂实现)
 */
import { PresetToolbarAdapter } from '../../ui';
import { CharacterStorage } from './storage';
import type { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, RegexFormulaScheme } from './types';
export declare function createCharacterPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<CharacterProfile>;
export declare function createOutfitPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<OutfitProfile>;
export declare function createEnableSchemePresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<EnableSchemeProfile>;
export declare function createInjectionTemplatePresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<InjectionTemplateScheme>;
export declare function createRegexFormulaPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<RegexFormulaScheme>;
//# sourceMappingURL=adapters.d.ts.map