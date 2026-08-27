/**
 * @module extensions/character-manager/adapters
 * @description 角色管理器 5 大子面板预设方案操作适配器工厂
 */
import { PresetToolbarAdapter } from '../../ui/components/preset-toolbar';
import { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, RegexFormulaScheme } from './types';
import { CharacterStorage } from './storage';
/**
 * 1. 角色设定预设方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 角色设定专属的 PresetToolbarAdapter
 */
export declare function createCharacterPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<CharacterProfile>;
/**
 * 2. 服装设定预设方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 服装设定专属的 PresetToolbarAdapter
 */
export declare function createOutfitPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<OutfitProfile>;
/**
 * 3. 方案启用规则预设适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 启用方案专属的 PresetToolbarAdapter
 */
export declare function createEnableSchemePresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<EnableSchemeProfile>;
/**
 * 4. 注入模板方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 注入模板专属的 PresetToolbarAdapter
 */
export declare function createInjectionTemplatePresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<InjectionTemplateScheme>;
/**
 * 5. 正则宏公式方案适配器工厂
 *
 * @param storage 角色管理器存储服务实例
 * @returns 正则宏公式专属的 PresetToolbarAdapter
 */
export declare function createRegexFormulaPresetAdapter(storage: CharacterStorage): PresetToolbarAdapter<RegexFormulaScheme>;
export declare const createMacroFormulaPresetAdapter: typeof createRegexFormulaPresetAdapter;
//# sourceMappingURL=adapters.d.ts.map