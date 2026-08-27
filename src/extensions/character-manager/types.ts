/**
 * @module extensions/character-manager/types
 * @description 角色与服装数据结构与接口类型声明
 */

/**
 * 提示词规则匹配模式
 * - `ALL`: 无条件始终注入
 * - `match`: 仅当上下文名称匹配成功时才注入
 */
export type InjectionMatchRule = 'ALL' | 'match';

/**
 * 角色预设方案数据接口
 */
export interface CharacterProfile {
    /** 预设唯一标识 UUID */
    id: string;
    /** 角色中文名称，绑定变量 {nameCN} */
    nameCN: string;
    /** 角色英文名称，绑定变量 {nameEN} */
    nameEN: string;
    /** 角色照片 Base64 / DataURL */
    photoUrl?: string;
    /** 是否作为参考图发送 */
    sendPhoto?: boolean;

    /** 11 项绘图 Tag 变量 */
    /** 角色特征，绑定变量 {traits} */
    characterTraits: string;
    /** 五官外貌（正面），绑定变量 {facial} */
    facialFeatures: string;
    /** 五官外貌（背面），绑定变量 {facialBack} */
    facialFeaturesBack: string;
    /** 上半身 SFW（正面），绑定变量 {upperSFW} */
    upperBodySFW: string;
    /** 上半身 SFW（背面），绑定变量 {upperSFWBack} */
    upperBodySFWBack: string;
    /** 下半身 SFW（正面），绑定变量 {lowerSFW} */
    fullBodySFW: string;
    /** 下半身 SFW（背面），绑定变量 {lowerSFWBack} */
    fullBodySFWBack: string;
    /** 上半身 NSFW（正面），绑定变量 {upperNSFW} */
    upperBodyNSFW: string;
    /** 上半身 NSFW（背面），绑定变量 {upperNSFWBack} */
    upperBodyNSFWBack: string;
    /** 下半身 NSFW（正面），绑定变量 {lowerNSFW} */
    fullBodyNSFW: string;
    /** 下半身 NSFW（背面），绑定变量 {lowerNSFWBack} */
    fullBodyNSFWBack: string;
    /** 负面提示词，绑定变量 {negative} */
    negativePrompt: string;

    /** 关联专属服装预设名称列表（每行一个服装名），绑定变量 {outfits} */
    outfitList: string[];

    /** 创建时间戳 */
    createdAt?: number;
    /** 更新时间戳 */
    updatedAt?: number;
}

/**
 * 服装预设实体与 Tag 变量数据契约
 */
export interface OutfitProfile {
    /** 预设唯一标识 UUID */
    id: string;
    /** 服装中文名称，绑定变量 {nameCN} */
    nameCN: string;
    /** 服装英文名称，绑定变量 {nameEN} */
    nameEN: string;
    /** 服装照片 Base64 / DataURL */
    photoUrl?: string;
    /** 是否作为参考图发送 */
    sendPhoto?: boolean;

    /** 服装 Tag 变量 */
    /** 上半身服装（正面），绑定变量 {upperBody} */
    upperBody: string;
    /** 上半身服装（背面），绑定变量 {upperBodyBack} */
    upperBodyBack: string;
    /** 下半身服装（正面），绑定变量 {lowerBody} */
    fullBody: string;
    /** 下半身服装（背面），绑定变量 {lowerBodyBack} */
    fullBodyBack: string;

    /** 创建时间戳 */
    createdAt?: number;
    /** 更新时间戳 */
    updatedAt?: number;
}

/**
 * 单个角色的规则设定
 */
export interface CharacterRuleConfig {
    enabled: boolean;
    rule: InjectionMatchRule;
}

/**
 * 单个服装的规则设定
 */
export interface OutfitRuleConfig {
    enabled: boolean;
    rule: InjectionMatchRule;
}

/**
 * 设定启用方案数据结构
 */
export interface EnableSchemeProfile {
    id: string;
    name: string;
    /** 绑定的酒馆角色卡名称 (如 context.name2) */
    boundCharacterCards: string;
    /** 绑定的聊天记录 ID (如 context.chatId)，用于防冲突多方案精细区分 */
    boundChatId?: string;

    /** 各角色预设的启用状态与匹配规则: Key 为 characterProfile.id */
    characterRules: Record<string, CharacterRuleConfig>;
    /** 各服装预设的启用状态与匹配规则: Key 为 outfitProfile.id */
    outfitRules: Record<string, OutfitRuleConfig>;
    /** 关联的注入模板 ID */
    injectionTemplateId?: string;
    templateId?: string;

    createdAt?: number;
    updatedAt?: number;
}

/**
 * 注入模板配置方案
 */
export interface InjectionTemplateScheme {
    id: string;
    name: string;
    isSystemPreset?: boolean;
    /** 角色启用列表项模板 {{角色启用列表}} */
    characterListTemplate: string;
    /** 角色专属服装模板 {outfits} */
    innerOutfitTemplate: string;
    /** 通用角色列表项模板 {{通用角色启用列表}} */
    commonCharacterListTemplate: string;
    /** 通用服装列表项模板 {{通用服装启用列表}} */
    enableOutfitListTemplate: string;
}

// ─── 2层树形宏模板匹配规则模型 ──────────────────────────────────────────────

/**
 * 2层限制的树形宏模板匹配规则节点 (Macro Rule Node)
 * 遵循互斥约束：父节点包含 children 时不可有 variables；只有叶子节点才拥有 variables 列表
 */
export interface MacroRuleNode {
    id: string;
    /** 节点的规则/分支名称 (如 "背面视角", "正面 SFW 上半身") */
    name: string;
    /** 匹配关键词 (如 "-from_behind", "-sfw-upperbody") */
    pattern: string;
    /** 节点启用状态 */
    enabled: boolean;
    /** 
     * 叶子节点绑定的 Tag 变量列表 (互斥约束：仅当无 children 时生效)
     * 例如: ['nameEN', 'facialFeatures', 'upperBodySFW', 'fullBodySFW']
     */
    variables?: string[];
    /** 当 variables 包含 'customTag' 时的自定义 Tag 字符串 */
    customTag?: string;
    /** 
     * 子分支节点列表 (限制最多 2 层深度；若拥有 children 则为路由节点，不能包含 variables)
     */
    children?: MacroRuleNode[];
    /** UI 界面节点折叠/展开状态 */
    isExpanded?: boolean;
}

/**
 * 树形宏模板方案预设包 (Macro Rule Tree Scheme)
 */
export interface MacroTreeScheme {
    id: string;
    name: string;
    isDefault?: boolean;
    /** 角色固定注入变量列表 (先于条件分支处理，如 ['nameEN', 'characterTraits']) */
    characterFixedVariables?: string[];
    /** 角色 2 层规则树根节点列表 */
    characterRootNodes: MacroRuleNode[];
    /** 服装固定注入变量列表 (先于条件分支处理，如 ['nameEN']) */
    outfitFixedVariables?: string[];
    /** 服装 2 层规则树根节点列表 */
    outfitRootNodes: MacroRuleNode[];
    /** 兼容字段 */
    rootNodes?: MacroRuleNode[];
}
