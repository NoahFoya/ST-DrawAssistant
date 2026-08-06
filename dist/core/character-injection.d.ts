/**
 * @module core/character-injection
 * @description 角色与服装提示词注入引擎
 *
 * 职责：
 * - 动态解析活动的设定启用方案 (EnableSchemeProfile)，匹配多行 角色卡名称|chatId
 * - 根据规则 (ALL / match) 过滤仅为 enabled: true 的角色与服装实体
 * - 展开角色专属服装列表 {outfits}
 * - 容错匹配与替换占位符 ({{角色启用列表}}, {{服装启用列表}} 等别名)
 * - 空变量行与多余空行二次正则清洗
 */
import type { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme } from '../types/character';
/**
 * 根据当前角色卡名称与 chatId 获取活动的设定启用方案 (匹配第一个符合条件的方案)
 */
export declare function resolveActiveEnableScheme(characterCardName?: string, chatId?: string): EnableSchemeProfile;
/**
 * 筛选符合规则且启用的角色实体 (仅当 rule.enabled === true 时为启用)
 */
export declare function filterEnabledCharacters(scheme: EnableSchemeProfile, textContent: string): CharacterProfile[];
/**
 * 筛选符合规则且启用的通用服装实体 (仅当 rule.enabled === true 时为启用)
 */
export declare function filterEnabledOutfits(scheme: EnableSchemeProfile, textContent: string): OutfitProfile[];
/**
 * 展开角色专属服装列表 {outfits}
 */
export declare function resolveInnerOutfits(char: CharacterProfile, templateScheme: InjectionTemplateScheme): string;
/**
 * 清洗模板渲染后的多余空行与全空占位符行
 */
export declare function cleanRenderedText(text: string): string;
/**
 * 渲染角色与服装的结构化注入文本
 */
export declare function renderCharacterAndOutfitInjection(textContent: string): {
    characterListText: string;
    outfitListText: string;
};
/**
 * 在 Prompt / 文本中容错替换角色与服装占位符
 */
export declare function injectCharacterPlaceholders(promptText: string, textContent?: string): string;
/**
 * 动态刷新全局世界书 (window.world_info) 中的 {{角色启用列表}} 与 {{服装启用列表}} 占位符
 * 使酒馆原生的 Prompt 预发送视窗 (Inspect Prompt / 提示词预览) 能够直接展示解包渲染后的最新 Tag 实体
 */
export declare function updateGlobalWorldbookPlaceholders(textContent?: string): void;
//# sourceMappingURL=character-injection.d.ts.map