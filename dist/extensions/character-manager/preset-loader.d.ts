/**
 * @module extensions/character-manager/preset-loader
 * @description 角色与服装预设方案加载器 (基于 PresetRegistry 统一检索)
 */
import type { IPresetRegistry } from '../../core/registry/preset-registry';
import { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, RegexFormulaScheme } from './types';
/** 获取所有角色预设列表 */
export declare function fetchCharacters(reg?: IPresetRegistry): Promise<CharacterProfile[]>;
/** 获取所有服装预设列表 */
export declare function fetchOutfits(reg?: IPresetRegistry): Promise<OutfitProfile[]>;
/** 获取所有启用规则方案列表 */
export declare function fetchEnableSchemes(reg?: IPresetRegistry): Promise<EnableSchemeProfile[]>;
/** 获取所有提示词注入模板列表 */
export declare function fetchInjectionTemplates(reg?: IPresetRegistry): Promise<InjectionTemplateScheme[]>;
/** 获取所有正则宏公式方案列表 */
export declare function fetchRegexFormulas(reg?: IPresetRegistry): Promise<RegexFormulaScheme[]>;
//# sourceMappingURL=preset-loader.d.ts.map