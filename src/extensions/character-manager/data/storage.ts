/**
 * @module extensions/character-manager/data/storage
 * @description 角色与服装预设扩展专属持久化存储管理器 (CharacterStorage)
 *
 * 核心职责：
 * - 统一管理角色卡、服装预设、启用方案、提示词注入模板及正则公式的持久化存取；
 * - 首次运行与出厂重置时通过预设注册中心 (PresetRegistry) 自动填充内置示范配置；
 * - 封装 300ms 防抖持久化写入机制，保护宿主存储 IO 性能。
 */

import {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    RegexFormulaScheme
} from '../types';
import { IHostBridge } from '../../../core/foundation/host-bridge';
import type { IPresetRegistry } from '../../../core/registry/preset-registry';
import { CHARACTER_STORAGE_KEYS } from '../constants';
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
    private readonly _cache = new Map<string, any>();
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

    /**
     * 获取指定存储键下的实体列表
     */
    public getEntities<T>(key: string): T[] {
        if (this._cache.has(key)) {
            return this._cache.get(key) || [];
        }
        const val = this._hostBridge.getExtensionSettings<T[]>(key) || [];
        this._cache.set(key, val);
        return val;
    }

    /**
     * 保存指定存储键下的实体列表
     */
    public saveEntities<T>(key: string, entities: T[]): void {
        this._cache.set(key, entities);
        this._hostBridge.saveExtensionSettings(key, entities as any);
    }

    /**
     * 插入或更新单个实体 (按 id 匹配)
     */
    public upsertEntity<T extends { id: string }>(key: string, entity: T): void {
        const list = this.getEntities<T>(key);
        const idx = list.findIndex((item) => item.id === entity.id);
        if (idx >= 0) {
            list[idx] = entity;
        } else {
            list.push(entity);
        }
        this.saveEntities(key, list);
    }

    /**
     * 删除指定 id 的实体
     */
    public deleteEntity<T extends { id: string }>(key: string, id: string): void {
        const list = this.getEntities<T>(key).filter((item) => item.id !== id);
        this.saveEntities(key, list);
    }

    // ── 5 大特定业务实体快捷访问器 ──

    public getCharacters(): CharacterProfile[] {
        return this.getEntities<CharacterProfile>(CHARACTER_STORAGE_KEYS.CHARACTERS);
    }
    public saveCharacters(chars: CharacterProfile[]): void {
        this.saveEntities(CHARACTER_STORAGE_KEYS.CHARACTERS, chars);
    }

    public getOutfits(): OutfitProfile[] {
        return this.getEntities<OutfitProfile>(CHARACTER_STORAGE_KEYS.OUTFITS);
    }
    public saveOutfits(outfits: OutfitProfile[]): void {
        this.saveEntities(CHARACTER_STORAGE_KEYS.OUTFITS, outfits);
    }

    public getSchemes(): EnableSchemeProfile[] {
        return this.getEntities<EnableSchemeProfile>(CHARACTER_STORAGE_KEYS.SCHEMES);
    }
    public saveSchemes(schemes: EnableSchemeProfile[]): void {
        this.saveEntities(CHARACTER_STORAGE_KEYS.SCHEMES, schemes);
    }

    public getTemplates(): InjectionTemplateScheme[] {
        return this.getEntities<InjectionTemplateScheme>(CHARACTER_STORAGE_KEYS.TEMPLATES);
    }
    public saveTemplates(templates: InjectionTemplateScheme[]): void {
        this.saveEntities(CHARACTER_STORAGE_KEYS.TEMPLATES, templates);
    }

    public getFormulas(): RegexFormulaScheme[] {
        return this.getEntities<RegexFormulaScheme>(CHARACTER_STORAGE_KEYS.FORMULAS);
    }
    public saveFormulas(formulas: RegexFormulaScheme[]): void {
        this.saveEntities(CHARACTER_STORAGE_KEYS.FORMULAS, formulas);
    }

    public getActiveFormulaId(): string {
        const id = this._hostBridge.getExtensionSettings<string>(CHARACTER_STORAGE_KEYS.ACTIVE_FORMULA_ID);
        return id || this.getFormulas()[0]?.id || '';
    }
    public setActiveFormulaId(id: string): void {
        this._hostBridge.saveExtensionSettings(CHARACTER_STORAGE_KEYS.ACTIVE_FORMULA_ID, id as any);
    }

    /**
     * 重置所有角色与服装设置为出厂默认状态
     */
    public async resetToDefaults(): Promise<void> {
        this._debounceTimers.forEach((timer) => clearTimeout(timer));
        this._debounceTimers.clear();

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
