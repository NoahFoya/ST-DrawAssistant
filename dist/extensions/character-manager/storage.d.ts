/**
 * @module extensions/character-manager/storage
 * @description 角色设定、服装设定、设定启用方案及注入模板方案的持久化存储管理器
 *
 * 设计原则：
 * - 全部默认数据均通过静态 import 于对应 JSON 预设文件加载，源码中不硬编码任何预设内容
 * - 角色/服装/方案/模板：localStorage 为空时自动从内置 JSON 预设解包填充（保证系统运行常态存在可用预设）
 */
import type { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, MacroTreeScheme } from './types';
export declare const DEFAULT_MACRO_TREE_SCHEME: MacroTreeScheme;
/** 默认角色预设（从 JSON 预设文件读取） */
export declare const DEFAULT_CHARACTER_PRESET: CharacterProfile;
/** 默认服装预设列表（从 JSON 预设文件读取） */
export declare const DEFAULT_OUTFIT_PRESETS: OutfitProfile[];
/** 默认设定启用方案（从 JSON 预设文件读取） */
export declare const DEFAULT_ENABLE_SCHEME_PRESET: EnableSchemeProfile;
/**
 * 读取所有角色预设（localStorage 为空时自动用 JSON 文件默认预设填充）
 */
export declare function getCharacterProfiles(): CharacterProfile[];
export declare function saveCharacterProfiles(profiles: CharacterProfile[]): void;
export declare function getCharacterProfileById(id: string): CharacterProfile | undefined;
export declare function upsertCharacterProfile(profile: CharacterProfile): void;
export declare function deleteCharacterProfile(id: string): void;
/**
 * 读取所有服装预设（localStorage 为空时自动用 JSON 文件默认预设填充）
 */
export declare function getOutfitProfiles(): OutfitProfile[];
export declare function saveOutfitProfiles(profiles: OutfitProfile[]): void;
export declare function getOutfitProfileById(id: string): OutfitProfile | undefined;
export declare function upsertOutfitProfile(profile: OutfitProfile): void;
export declare function deleteOutfitProfile(id: string): void;
/**
 * 读取所有设定启用方案（localStorage 为空时自动用 JSON 文件默认预设填充）
 */
export declare function getEnableSchemes(): EnableSchemeProfile[];
export declare function saveEnableSchemes(schemes: EnableSchemeProfile[]): void;
export declare function getEnableSchemeById(id: string): EnableSchemeProfile | undefined;
export declare function upsertEnableScheme(scheme: EnableSchemeProfile): void;
export declare function deleteEnableScheme(id: string): void;
/**
 * 将角色预设重置为 JSON 预设文件中的默认数据
 * （等效于删除用户数据后重新从预设文件初始化）
 */
export declare function resetCharacterProfilesToDefault(): CharacterProfile[];
/**
 * 将服装预设重置为 JSON 预设文件中的默认数据
 */
export declare function resetOutfitProfilesToDefault(): OutfitProfile[];
/**
 * 将设定启用方案重置为 JSON 预设文件中的默认数据
 */
export declare function resetEnableSchemesToDefault(): EnableSchemeProfile[];
/**
 * 一键重置角色管理器全量数据（角色 + 服装 + 启用方案）为 JSON 预设默认值
 */
export declare function resetCharacterManagerToDefault(): void;
/**
 * 读取注入模板列表
 *
 * 注入模板为系统功能性配置：localStorage 为空时自动从 JSON 预设填充两个内置模板，
 * 确保系统常态至少存在一个可用模板。
 */
export declare function getInjectionTemplates(): InjectionTemplateScheme[];
export declare function saveInjectionTemplates(templates: InjectionTemplateScheme[]): void;
export declare function getInjectionTemplateById(id: string): InjectionTemplateScheme | undefined;
export declare function upsertInjectionTemplate(template: InjectionTemplateScheme): void;
export declare function deleteInjectionTemplate(id: string): void;
export declare function getMacroTreeSchemes(): MacroTreeScheme[];
export declare function saveMacroTreeSchemes(schemes: MacroTreeScheme[]): void;
export declare function getActiveMacroTreeSchemeId(): string;
export declare function setActiveMacroTreeSchemeId(id: string): void;
export declare function getActiveMacroTreeScheme(): MacroTreeScheme;
export declare function getMacroTreeScheme(): MacroTreeScheme;
export declare function saveMacroTreeScheme(scheme: MacroTreeScheme): void;
export declare function upsertMacroTreeScheme(scheme: MacroTreeScheme): void;
export declare function deleteMacroTreeScheme(id: string): void;
export declare function exportMacroTreeScheme(id?: string): string;
export declare function importMacroTreeScheme(jsonStr: string): MacroTreeScheme;
export declare function resetMacroTreeScheme(): MacroTreeScheme;
//# sourceMappingURL=storage.d.ts.map