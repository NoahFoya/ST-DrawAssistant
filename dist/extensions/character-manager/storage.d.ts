/**
 * @module extensions/character-manager/storage
 * @description 角色设定、服装设定、启用方案、注入模板与正则宏公式的持久化存储管理器 (CharacterStorage)
 */
import { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, RegexFormulaScheme } from './types';
import { IHostBridge } from '../../core/foundation/host-bridge';
export declare const DEFAULT_CHARACTER_PROFILE: CharacterProfile;
export declare const DEFAULT_OUTFIT_PROFILE: OutfitProfile;
export declare const DEFAULT_ENABLE_SCHEME: EnableSchemeProfile;
export declare const DEFAULT_INJECTION_TEMPLATE: InjectionTemplateScheme;
export declare const DEFAULT_REGEX_FORMULA_SCHEME: RegexFormulaScheme;
export declare class CharacterStorage {
    private readonly _hostBridge;
    constructor(hostBridge: IHostBridge);
    /**
     * 首次安装引导检查：仅在初次安装运行时填充示范数据，后续不再静默兜底
     */
    private ensureInitialized;
    getCharacters(): CharacterProfile[];
    saveCharacters(characters: CharacterProfile[]): void;
    upsertCharacter(profile: CharacterProfile): void;
    deleteCharacter(id: string): void;
    getOutfits(): OutfitProfile[];
    saveOutfits(outfits: OutfitProfile[]): void;
    upsertOutfit(outfit: OutfitProfile): void;
    deleteOutfit(id: string): void;
    getSchemes(): EnableSchemeProfile[];
    saveSchemes(schemes: EnableSchemeProfile[]): void;
    upsertScheme(scheme: EnableSchemeProfile): void;
    deleteScheme(id: string): void;
    getTemplates(): InjectionTemplateScheme[];
    saveTemplates(templates: InjectionTemplateScheme[]): void;
    upsertTemplate(tpl: InjectionTemplateScheme): void;
    deleteTemplate(id: string): void;
    getFormulas(): RegexFormulaScheme[];
    saveFormulas(formulas: RegexFormulaScheme[]): void;
    upsertFormula(scheme: RegexFormulaScheme): void;
    deleteFormula(id: string): void;
    getActiveFormulaId(): string;
    setActiveFormulaId(id: string): void;
    /**
     * 重置所有方案至初始示范配置
     */
    resetAllToDefaults(): void;
}
//# sourceMappingURL=storage.d.ts.map