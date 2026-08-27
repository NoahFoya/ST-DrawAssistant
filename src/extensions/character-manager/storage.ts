/**
 * @module extensions/character-manager/storage
 * @description 角色与服装预设扩展专属持久化存储管理器 (CharacterStorage)
 *
 * 核心职责：
 * - 统一管理角色卡、服装预设、启用方案、提示词注入模板及正则公式的持久化存取；
 * - 首次运行与出厂重置时通过微内核预设注册中心 (PresetRegistry) 自动填充内置示范配置；
 * - 封装 300ms 防抖持久化写入机制，保护宿主存储 IO 性能。
 */

import {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    RegexFormulaScheme
} from './types';
import { IHostBridge } from '../../core/foundation/host-bridge';
import type { IPresetRegistry } from '../../core/registry/preset-registry';
import { CHARACTER_STORAGE_KEYS } from './constants';
import {
    fetchCharacters,
    fetchOutfits,
    fetchEnableSchemes,
    fetchInjectionTemplates,
    fetchRegexFormulas
} from './preset-loader';

export class CharacterStorage {
    private readonly _hostBridge: IHostBridge;
    private readonly _presets?: IPresetRegistry;
    private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * 创建角色与服装预设存储管理器实例
     *
     * @param hostBridge 宿主通信桥接实例
     * @param presets 预设方案注册中心 (可选，用于初次启动填充默认数据)
     */
    constructor(hostBridge: IHostBridge, presets?: IPresetRegistry) {
        this._hostBridge = hostBridge;
        this._presets = presets;
        this.ensureInitialized();
    }

    /**
     * 首次安装引导检查：初次运行时填充内置示范数据
     */
    private async ensureInitialized(): Promise<void> {
        const isInitialized = this._hostBridge.getExtensionSettings<boolean>(CHARACTER_STORAGE_KEYS.INITIALIZED);
        if (!isInitialized) {
            const [chars, outfits, schemes, templates, formulas] = await Promise.all([
                fetchCharacters(this._presets),
                fetchOutfits(this._presets),
                fetchEnableSchemes(this._presets),
                fetchInjectionTemplates(this._presets),
                fetchRegexFormulas(this._presets)
            ]);

            if (chars.length > 0) this.saveEntities(CHARACTER_STORAGE_KEYS.CHARACTERS, chars);
            if (outfits.length > 0) this.saveEntities(CHARACTER_STORAGE_KEYS.OUTFITS, outfits);
            if (schemes.length > 0) this.saveEntities(CHARACTER_STORAGE_KEYS.SCHEMES, schemes);
            if (templates.length > 0) this.saveEntities(CHARACTER_STORAGE_KEYS.TEMPLATES, templates);
            if (formulas.length > 0) {
                this.saveEntities(CHARACTER_STORAGE_KEYS.FORMULAS, formulas);
                this.setActiveFormulaId(formulas[0]?.id || 'standard-formula');
            }

            this._hostBridge.saveExtensionSettings(CHARACTER_STORAGE_KEYS.INITIALIZED, true as any);
        }
    }

    // ── 通用泛型实体持久化引擎 (含 300ms 防抖保存) ──────────────────────────

    /** 获取指定 Key 的实体列表 */
    public getEntities<T>(storageKey: string): T[] {
        const data = this._hostBridge.getExtensionSettings<T[]>(storageKey);
        return Array.isArray(data) ? data : [];
    }

    /** 保存指定 Key 的实体列表 (立即写入宿主存储) */
    public saveEntities<T>(storageKey: string, list: T[]): void {
        const existingTimer = this._debounceTimers.get(storageKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this._debounceTimers.delete(storageKey);
        }
        this._hostBridge.saveExtensionSettings(storageKey, list as any);
    }

    /** 防抖保存指定 Key 的实体列表 (默认 300ms 防抖) */
    public saveEntitiesDebounced<T>(storageKey: string, list: T[], delayMs = 300): void {
        const existingTimer = this._debounceTimers.get(storageKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        const timer = setTimeout(() => {
            this._debounceTimers.delete(storageKey);
            this._hostBridge.saveExtensionSettings(storageKey, list as any);
        }, delayMs);
        this._debounceTimers.set(storageKey, timer);
    }

    /** 插入或更新单个实体 (按 id 匹配) */
    public upsertEntity<T extends { id: string }>(storageKey: string, item: T): void {
        const list = this.getEntities<T>(storageKey);
        const idx = list.findIndex((x) => x.id === item.id);
        if (idx >= 0) list[idx] = item;
        else list.push(item);
        this.saveEntities(storageKey, list);
    }

    /** 删除单个实体 (按 id 匹配) */
    public deleteEntity<T extends { id: string }>(storageKey: string, id: string): void {
        const list = this.getEntities<T>(storageKey).filter((x) => x.id !== id);
        this.saveEntities(storageKey, list);
    }

    // ── 语义化业务访问接口 ───────────────────────────────────────────────

    // 1. 角色预设
    public getCharacters(): CharacterProfile[] {
        return this.getEntities<CharacterProfile>(CHARACTER_STORAGE_KEYS.CHARACTERS);
    }
    public saveCharacters(list: CharacterProfile[]): void { this.saveEntities(CHARACTER_STORAGE_KEYS.CHARACTERS, list); }
    public upsertCharacter(profile: CharacterProfile): void { this.upsertEntity(CHARACTER_STORAGE_KEYS.CHARACTERS, profile); }
    public deleteCharacter(id: string): void { this.deleteEntity(CHARACTER_STORAGE_KEYS.CHARACTERS, id); }

    // 2. 服装预设
    public getOutfits(): OutfitProfile[] {
        return this.getEntities<OutfitProfile>(CHARACTER_STORAGE_KEYS.OUTFITS);
    }
    public saveOutfits(list: OutfitProfile[]): void { this.saveEntities(CHARACTER_STORAGE_KEYS.OUTFITS, list); }
    public upsertOutfit(outfit: OutfitProfile): void { this.upsertEntity(CHARACTER_STORAGE_KEYS.OUTFITS, outfit); }
    public deleteOutfit(id: string): void { this.deleteEntity(CHARACTER_STORAGE_KEYS.OUTFITS, id); }

    // 3. 启用方案
    public getSchemes(): EnableSchemeProfile[] {
        return this.getEntities<EnableSchemeProfile>(CHARACTER_STORAGE_KEYS.SCHEMES);
    }
    public saveSchemes(list: EnableSchemeProfile[]): void { this.saveEntities(CHARACTER_STORAGE_KEYS.SCHEMES, list); }
    public upsertScheme(scheme: EnableSchemeProfile): void { this.upsertEntity(CHARACTER_STORAGE_KEYS.SCHEMES, scheme); }
    public deleteScheme(id: string): void { this.deleteEntity(CHARACTER_STORAGE_KEYS.SCHEMES, id); }

    // 4. 注入模板
    public getTemplates(): InjectionTemplateScheme[] {
        return this.getEntities<InjectionTemplateScheme>(CHARACTER_STORAGE_KEYS.TEMPLATES);
    }
    public saveTemplates(list: InjectionTemplateScheme[]): void { this.saveEntities(CHARACTER_STORAGE_KEYS.TEMPLATES, list); }
    public upsertTemplate(tpl: InjectionTemplateScheme): void { this.upsertEntity(CHARACTER_STORAGE_KEYS.TEMPLATES, tpl); }
    public deleteTemplate(id: string): void { this.deleteEntity(CHARACTER_STORAGE_KEYS.TEMPLATES, id); }

    // 5. 正则公式
    public getFormulas(): RegexFormulaScheme[] {
        return this.getEntities<RegexFormulaScheme>(CHARACTER_STORAGE_KEYS.FORMULAS);
    }
    public saveFormulas(list: RegexFormulaScheme[]): void { this.saveEntities(CHARACTER_STORAGE_KEYS.FORMULAS, list); }
    public upsertFormula(scheme: RegexFormulaScheme): void { this.upsertEntity(CHARACTER_STORAGE_KEYS.FORMULAS, scheme); }
    public deleteFormula(id: string): void { this.deleteEntity(CHARACTER_STORAGE_KEYS.FORMULAS, id); }

    public getActiveFormulaId(): string {
        const id = this._hostBridge.getExtensionSettings<string>(CHARACTER_STORAGE_KEYS.ACTIVE_FORMULA_ID);
        return id || this.getFormulas()[0]?.id || '';
    }

    public setActiveFormulaId(id: string): void {
        this._hostBridge.saveExtensionSettings(CHARACTER_STORAGE_KEYS.ACTIVE_FORMULA_ID, id as any);
    }

    /**
     * 重置所有方案至出厂内置示范配置
     */
    public async resetAllToDefaults(): Promise<void> {
        const [chars, outfits, schemes, templates, formulas] = await Promise.all([
            fetchCharacters(this._presets),
            fetchOutfits(this._presets),
            fetchEnableSchemes(this._presets),
            fetchInjectionTemplates(this._presets),
            fetchRegexFormulas(this._presets)
        ]);

        if (chars.length > 0) this.saveCharacters(chars);
        if (outfits.length > 0) this.saveOutfits(outfits);
        if (schemes.length > 0) this.saveSchemes(schemes);
        if (templates.length > 0) this.saveTemplates(templates);
        if (formulas.length > 0) {
            this.saveFormulas(formulas);
            this.setActiveFormulaId(formulas[0]?.id || 'standard-formula');
        }
    }
}
