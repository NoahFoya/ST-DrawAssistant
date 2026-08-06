/**
 * @module core/character-injection
 * @description 角色与服装提示词注入与生图 Prompt 编译核心引擎
 *
 * 核心逻辑区块架构：
 * - BLOCK 1: 【路径 A - 世界书只读注入路径】 (响应 WORLDINFO_ENTRIES_LOADED 钩子只读替换 globalLore 占位符)
 * - BLOCK 2: 【路径 B-1 - 动态设定提取与居中 Toast 提示】 (扫描 <人物>/<服装> 结构化标签，去重弹窗存档/覆盖更新/启用)
 * - BLOCK 3: 【路径 B-2 - 动态提示词 $...$ 宏解包与二次清洗】 (在生图多段拼接前优先解包动态 Tag，二次正则清洗)
 */
import type { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme } from '../types/character';
/**
 * 根据当前角色卡名称与 chatId 获取活动的设定启用方案 (匹配第一个符合条件的方案，无匹配或未选中角色卡时返回 null)
 */
export declare function resolveActiveEnableScheme(characterCardName?: string, chatId?: string): EnableSchemeProfile | null;
/**
 * 筛选符合规则且启用的角色实体 (仅当 rule.enabled === true 时为启用)
 */
export declare function filterEnabledCharacters(scheme: EnableSchemeProfile | null, textContent: string): CharacterProfile[];
/**
 * 筛选符合规则且启用的通用服装实体 (仅当 rule.enabled === true 时为启用)
 */
export declare function filterEnabledOutfits(scheme: EnableSchemeProfile | null, textContent: string): OutfitProfile[];
/**
 * 展开角色专属服装列表 {outfits}
 */
export declare function resolveInnerOutfits(char: CharacterProfile, tplScheme: InjectionTemplateScheme): string;
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
/**
 * 响应 SillyTavern 官方 WORLDINFO_ENTRIES_LOADED 事件，只读解包替换 globalLore
 */
export declare function processWorldInfoLoadedData(data?: {
    globalLore?: Array<{
        content?: string;
        _rawContent?: string;
    }>;
}, textContent?: string): void;
/**
 * 从预处理后的文本块中解析人物参数字典 (对齐 st-chatu8 标准字段映射)
 */
export declare function parseCharacterData(content: string): CharacterProfile | null;
/**
 * 从预处理后的文本块中解析服装参数字典 (对齐 st-chatu8 标准字段映射)
 */
export declare function parseOutfitData(content: string): OutfitProfile | null;
/**
 * 从 AI 消息文本或测试文本中自动提取 <人物> 与 <服装> 实体结构
 */
export declare function extractCharacterAndOutfitTags(messageText: string): {
    characters: Array<CharacterProfile & {
        matchedOutfits: OutfitProfile[];
    }>;
    outfits: OutfitProfile[];
};
/**
 * 非阻塞式角色与服装设定提取确认浮层 UI (顶部居中 18% 定位，主题自适应 CSS Tokens，绝不阻塞 JS 主线程)
 */
export declare function showExtractionToast(title: string, badgeText: string, isOverwrite: boolean, detailsHtml: string, confirmText: string, onConfirm: () => void): void;
/**
 * 监听 AI 回复/编辑消息自动提取角色与服装标签，智能提示存档、同名覆盖更新与方案启用 (哈希去重 + 居中自适应 UI)
 */
export declare function processExtractedCharacterTags(messageText: string): void;
/**
 * 动态提示词预处理与 2 层树形宏解包引擎
 * 严格执行步骤时序性：
 * Step 1: 精准匹配实体 Name；未匹配则返回 0 字符空字符串 "" (绝不出引双引号)
 * Step 2: 先处理【固定注入内容】 (fixedVariables, 如 nameEN, characterTraits)
 * Step 3: 再处理【条件分支内容】 (2 层树形多分支 variables 求值)
 */
export declare function processCharacterPrompt(promptText: string): string;
//# sourceMappingURL=character-injection.d.ts.map