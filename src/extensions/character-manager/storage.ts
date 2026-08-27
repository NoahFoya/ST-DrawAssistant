/**
 * @module extensions/character-manager/storage
 * @description 角色设定、服装设定、启用方案、注入模板与正则宏公式的持久化存储管理器 (CharacterStorage)
 */

import {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    RegexFormulaScheme
} from './types';
import { IHostBridge } from '../../core/foundation/host-bridge';

const STORAGE_KEY_INITIALIZED = 'st_da_cm_initialized_v1';
const STORAGE_KEY_CHARACTERS = 'st_da_character_profiles_v1';
const STORAGE_KEY_OUTFITS = 'st_da_outfit_profiles_v1';
const STORAGE_KEY_SCHEMES = 'st_da_enable_schemes_v1';
const STORAGE_KEY_TEMPLATES = 'st_da_injection_templates_v1';
const STORAGE_KEY_FORMULAS = 'st_da_regex_formula_schemes_v1';
const STORAGE_KEY_ACTIVE_FORMULA_ID = 'st_da_active_regex_formula_scheme_id_v1';

export const DEFAULT_CHARACTER_PROFILE: CharacterProfile = {
    id: 'default-character',
    nameCN: '默认角色',
    nameEN: 'default_girl',
    bodyTraits: '1girl, slender, fair skin',
    facialFeatures: 'cute face, blue eyes, long silver hair',
    facialFeaturesBack: 'silver hair from behind, long hair braid',
    upperBodySFW: 'white shirt, collarbone',
    upperBodySFWBack: 'white shirt from behind, slender back',
    sideBodySFW: 'side profile, slender waist',
    lowerBodySFW: 'pleated skirt, bare legs',
    lowerBodySFWBack: 'pleated skirt from behind',
    upperBodyNSFW: 'bare chest, nipples, soft breasts',
    upperBodyNSFWBack: 'bare back, shoulder blades',
    lowerBodyNSFW: 'pussy, bare hips, thighs',
    lowerBodyNSFWBack: 'bare ass, round buttocks',
    negativePrompt: 'bad anatomy, bad hands, missing fingers',
    outfitList: ['default-outfit']
};

export const DEFAULT_OUTFIT_PROFILE: OutfitProfile = {
    id: 'default-outfit',
    nameCN: '水手服',
    nameEN: 'sailor_suit',
    headAccessory: 'hair ribbon',
    upperBody: 'navy sailor collar shirt, red necktie',
    upperBodyBack: 'sailor collar from behind',
    lowerBody: 'navy pleated skirt',
    lowerBodyBack: 'pleated skirt back',
    footwear: 'white socks, brown loafers',
    accessories: 'school bag'
};

export const DEFAULT_ENABLE_SCHEME: EnableSchemeProfile = {
    id: 'default-scheme',
    name: '全局通用方案',
    boundCharacterCards: '',
    characterRules: { 'default-character': 'ALL' },
    outfitRules: { 'default-outfit': 'ALL' },
    injectionTemplateId: 'default-template'
};

export const DEFAULT_INJECTION_TEMPLATE: InjectionTemplateScheme = {
    id: 'default-template',
    name: '标准注入模板',
    characterListTemplate: '{nameEN}, {bodyTraits}, {facial}, {upperSFW}, {lowerSFW}',
    innerOutfitTemplate: '{headAcc}, {upperBody}, {lowerBody}, {footwear}, {accessories}',
    commonCharacterListTemplate: '{nameEN}, {bodyTraits}, {facial}',
    enableOutfitListTemplate: '{upperBody}, {lowerBody}, {accessories}'
};

export const DEFAULT_REGEX_FORMULA_SCHEME: RegexFormulaScheme = {
    id: 'standard-formula',
    name: '标准正则公式方案',
    characterMacroRules: {
        fixedVars: ['nameEN'],
        formulas: [
            {
                id: 'char-back',
                name: '背面特征分支',
                enabled: true,
                pattern: '-from_behind',
                outputVars: ['facialFeaturesBack', 'upperBodySFWBack', 'lowerBodySFWBack']
            },
            {
                id: 'char-nsfw',
                name: 'NSFW 分支',
                enabled: true,
                pattern: '-nsfw',
                outputVars: ['upperBodyNSFW', 'lowerBodyNSFW']
            }
        ]
    },
    outfitMacroRules: {
        fixedVars: ['nameEN'],
        formulas: [
            {
                id: 'outfit-back',
                name: '背面服装分支',
                enabled: true,
                pattern: '-from_behind',
                outputVars: ['upperBodyBack', 'lowerBodyBack']
            }
        ]
    },
    characterExtractRules: [],
    outfitExtractRules: []
};

export class CharacterStorage {
    private readonly _hostBridge: IHostBridge;

    constructor(hostBridge: IHostBridge) {
        this._hostBridge = hostBridge;
        this.ensureInitialized();
    }

    /**
     * 首次安装引导检查：仅在初次安装运行时填充示范数据，后续不再静默兜底
     */
    private ensureInitialized(): void {
        const isInitialized = this._hostBridge.getExtensionSettings<boolean>(STORAGE_KEY_INITIALIZED);
        if (!isInitialized) {
            this.saveCharacters([DEFAULT_CHARACTER_PROFILE]);
            this.saveOutfits([DEFAULT_OUTFIT_PROFILE]);
            this.saveSchemes([DEFAULT_ENABLE_SCHEME]);
            this.saveTemplates([DEFAULT_INJECTION_TEMPLATE]);
            this.saveFormulas([DEFAULT_REGEX_FORMULA_SCHEME]);
            this.setActiveFormulaId('standard-formula');
            this._hostBridge.saveExtensionSettings(STORAGE_KEY_INITIALIZED, true as any);
        }
    }

    // ── 1. 角色预设 ──
    public getCharacters(): CharacterProfile[] {
        const data = this._hostBridge.getExtensionSettings<CharacterProfile[]>(STORAGE_KEY_CHARACTERS);
        return Array.isArray(data) ? data : [];
    }

    public saveCharacters(characters: CharacterProfile[]): void {
        this._hostBridge.saveExtensionSettings(STORAGE_KEY_CHARACTERS, characters as any);
    }

    public upsertCharacter(profile: CharacterProfile): void {
        const list = this.getCharacters();
        const idx = list.findIndex((c) => c.id === profile.id);
        if (idx >= 0) list[idx] = profile;
        else list.push(profile);
        this.saveCharacters(list);
    }

    public deleteCharacter(id: string): void {
        const list = this.getCharacters().filter((c) => c.id !== id);
        this.saveCharacters(list);
    }

    // ── 2. 服装预设 ──
    public getOutfits(): OutfitProfile[] {
        const data = this._hostBridge.getExtensionSettings<OutfitProfile[]>(STORAGE_KEY_OUTFITS);
        return Array.isArray(data) ? data : [];
    }

    public saveOutfits(outfits: OutfitProfile[]): void {
        this._hostBridge.saveExtensionSettings(STORAGE_KEY_OUTFITS, outfits as any);
    }

    public upsertOutfit(outfit: OutfitProfile): void {
        const list = this.getOutfits();
        const idx = list.findIndex((o) => o.id === outfit.id);
        if (idx >= 0) list[idx] = outfit;
        else list.push(outfit);
        this.saveOutfits(list);
    }

    public deleteOutfit(id: string): void {
        const list = this.getOutfits().filter((o) => o.id !== id);
        this.saveOutfits(list);
    }

    // ── 3. 启用方案 ──
    public getSchemes(): EnableSchemeProfile[] {
        const data = this._hostBridge.getExtensionSettings<EnableSchemeProfile[]>(STORAGE_KEY_SCHEMES);
        return Array.isArray(data) ? data : [];
    }

    public saveSchemes(schemes: EnableSchemeProfile[]): void {
        this._hostBridge.saveExtensionSettings(STORAGE_KEY_SCHEMES, schemes as any);
    }

    public upsertScheme(scheme: EnableSchemeProfile): void {
        const list = this.getSchemes();
        const idx = list.findIndex((s) => s.id === scheme.id);
        if (idx >= 0) list[idx] = scheme;
        else list.push(scheme);
        this.saveSchemes(list);
    }

    public deleteScheme(id: string): void {
        const list = this.getSchemes().filter((s) => s.id !== id);
        this.saveSchemes(list);
    }

    // ── 4. 注入模板 ──
    public getTemplates(): InjectionTemplateScheme[] {
        const data = this._hostBridge.getExtensionSettings<InjectionTemplateScheme[]>(STORAGE_KEY_TEMPLATES);
        return Array.isArray(data) ? data : [];
    }

    public saveTemplates(templates: InjectionTemplateScheme[]): void {
        this._hostBridge.saveExtensionSettings(STORAGE_KEY_TEMPLATES, templates as any);
    }

    public upsertTemplate(tpl: InjectionTemplateScheme): void {
        const list = this.getTemplates();
        const idx = list.findIndex((t) => t.id === tpl.id);
        if (idx >= 0) list[idx] = tpl;
        else list.push(tpl);
        this.saveTemplates(list);
    }

    public deleteTemplate(id: string): void {
        const list = this.getTemplates().filter((t) => t.id !== id);
        this.saveTemplates(list);
    }

    // ── 5. 正则宏公式方案 ──
    public getFormulas(): RegexFormulaScheme[] {
        const data = this._hostBridge.getExtensionSettings<RegexFormulaScheme[]>(STORAGE_KEY_FORMULAS);
        return Array.isArray(data) ? data : [];
    }

    public saveFormulas(formulas: RegexFormulaScheme[]): void {
        this._hostBridge.saveExtensionSettings(STORAGE_KEY_FORMULAS, formulas as any);
    }

    public upsertFormula(scheme: RegexFormulaScheme): void {
        const list = this.getFormulas();
        const idx = list.findIndex((f) => f.id === scheme.id);
        if (idx >= 0) list[idx] = scheme;
        else list.push(scheme);
        this.saveFormulas(list);
    }

    public deleteFormula(id: string): void {
        const list = this.getFormulas().filter((f) => f.id !== id);
        this.saveFormulas(list);
    }

    public getActiveFormulaId(): string {
        const id = this._hostBridge.getExtensionSettings<string>(STORAGE_KEY_ACTIVE_FORMULA_ID);
        return id || this.getFormulas()[0]?.id || '';
    }

    public setActiveFormulaId(id: string): void {
        this._hostBridge.saveExtensionSettings(STORAGE_KEY_ACTIVE_FORMULA_ID, id as any);
    }

    /**
     * 重置所有方案至初始示范配置
     */
    public resetAllToDefaults(): void {
        this.saveCharacters([DEFAULT_CHARACTER_PROFILE]);
        this.saveOutfits([DEFAULT_OUTFIT_PROFILE]);
        this.saveSchemes([DEFAULT_ENABLE_SCHEME]);
        this.saveTemplates([DEFAULT_INJECTION_TEMPLATE]);
        this.saveFormulas([DEFAULT_REGEX_FORMULA_SCHEME]);
        this.setActiveFormulaId('standard-formula');
    }
}
