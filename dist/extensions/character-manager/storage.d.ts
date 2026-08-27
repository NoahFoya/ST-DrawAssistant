/**
 * @module extensions/character-manager/storage
 * @description 角色与服装预设扩展专属持久化存储管理器 (CharacterStorage)
 *
 * 核心职责：
 * - 统一管理角色卡、服装预设、启用方案、提示词注入模板及正则公式的持久化存取；
 * - 首次运行与出厂重置时通过微内核预设注册中心 (PresetRegistry) 自动填充内置示范配置；
 * - 封装 300ms 防抖持久化写入机制，保护宿主存储 IO 性能。
 */
import { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, RegexFormulaScheme } from './types';
import { IHostBridge } from '../../core/foundation/host-bridge';
import type { IPresetRegistry } from '../../core/registry/preset-registry';
export declare class CharacterStorage {
    private readonly _hostBridge;
    private readonly _presets?;
    private readonly _debounceTimers;
    /**
     * 创建角色与服装预设存储管理器实例
     *
     * @param hostBridge 宿主通信桥接实例
     * @param presets 预设方案注册中心 (可选，用于初次启动填充默认数据)
     */
    constructor(hostBridge: IHostBridge, presets?: IPresetRegistry);
    /**
     * 首次安装引导检查：初次运行时填充内置示范数据
     */
    private ensureInitialized;
    /** 获取指定 Key 的实体列表 */
    getEntities<T>(storageKey: string): T[];
    /** 保存指定 Key 的实体列表 (立即写入宿主存储) */
    saveEntities<T>(storageKey: string, list: T[]): void;
    /** 防抖保存指定 Key 的实体列表 (默认 300ms 防抖) */
    saveEntitiesDebounced<T>(storageKey: string, list: T[], delayMs?: number): void;
    /** 插入或更新单个实体 (按 id 匹配) */
    upsertEntity<T extends {
        id: string;
    }>(storageKey: string, item: T): void;
    /** 删除单个实体 (按 id 匹配) */
    deleteEntity<T extends {
        id: string;
    }>(storageKey: string, id: string): void;
    getCharacters(): CharacterProfile[];
    saveCharacters(list: CharacterProfile[]): void;
    upsertCharacter(profile: CharacterProfile): void;
    deleteCharacter(id: string): void;
    getOutfits(): OutfitProfile[];
    saveOutfits(list: OutfitProfile[]): void;
    upsertOutfit(outfit: OutfitProfile): void;
    deleteOutfit(id: string): void;
    getSchemes(): EnableSchemeProfile[];
    saveSchemes(list: EnableSchemeProfile[]): void;
    upsertScheme(scheme: EnableSchemeProfile): void;
    deleteScheme(id: string): void;
    getTemplates(): InjectionTemplateScheme[];
    saveTemplates(list: InjectionTemplateScheme[]): void;
    upsertTemplate(tpl: InjectionTemplateScheme): void;
    deleteTemplate(id: string): void;
    getFormulas(): RegexFormulaScheme[];
    saveFormulas(list: RegexFormulaScheme[]): void;
    upsertFormula(scheme: RegexFormulaScheme): void;
    deleteFormula(id: string): void;
    getActiveFormulaId(): string;
    setActiveFormulaId(id: string): void;
    /**
     * 重置所有方案至出厂内置示范配置
     */
    resetAllToDefaults(): Promise<void>;
}
//# sourceMappingURL=storage.d.ts.map