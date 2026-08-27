/**
 * @module extensions/character-manager/types
 * @description 角色设定、服装设定、启用方案、注入模板与正则宏公式数据结构与接口声明
 */
/**
 * 提示词规则匹配模式
 * - `ALL`: 无条件始终注入
 * - `match`: 仅当上下文名称匹配成功时才注入
 */
export type InjectionMatchRule = 'ALL' | 'match';
/**
 * 角色预设方案数据接口 (角色固有外貌与身体特征设定)
 */
export interface CharacterProfile {
    /** 预设唯一标识 UUID */
    id: string;
    /** 角色中文名称，绑定变量 {nameCN} */
    nameCN: string;
    /** 角色英文名称，绑定变量 {nameEN} */
    nameEN: string;
    /** 角色参考图 Base64 / DataURL */
    photoUrl?: string;
    /** 是否作为参考图发送给生图驱动 */
    sendPhoto?: boolean;
    /** 角色来源标识（官方既有Tag/原作名），绑定变量 {origin} */
    charOrigin?: string;
    /** 固有身体特征（肤色/身材体型/种族特征/固定印记），绑定变量 {bodyTraits} */
    bodyTraits: string;
    /** 五官外貌（正面），绑定变量 {facial} */
    facialFeatures: string;
    /** 头部背面，绑定变量 {facialBack} */
    facialFeaturesBack: string;
    /** 上半身 SFW（正面），绑定变量 {upperSFW} */
    upperBodySFW: string;
    /** 上半身 SFW（背面），绑定变量 {upperSFWBack} */
    upperBodySFWBack: string;
    /** 侧身身体 SFW，绑定变量 {sideSFW} */
    sideBodySFW: string;
    /** 下半身 SFW（正面），绑定变量 {lowerSFW} */
    lowerBodySFW: string;
    /** 下半身 SFW（背面），绑定变量 {lowerSFWBack} */
    lowerBodySFWBack: string;
    /** 上半身 NSFW（正面），绑定变量 {upperNSFW} */
    upperBodyNSFW: string;
    /** 上半身 NSFW（背面），绑定变量 {upperNSFWBack} */
    upperBodyNSFWBack: string;
    /** 下半身 NSFW（正面），绑定变量 {lowerNSFW} */
    lowerBodyNSFW: string;
    /** 下半身 NSFW（背面），绑定变量 {lowerNSFWBack} */
    lowerBodyNSFWBack: string;
    /** 负面提示词，绑定变量 {negative} */
    negativePrompt: string;
    /** 关联专属服装预设名称列表，绑定变量 {outfits} */
    outfitList: string[];
}
/**
 * 服装预设方案数据接口 (纯服饰配饰与鞋袜)
 */
export interface OutfitProfile {
    /** 预设唯一标识 UUID */
    id: string;
    /** 服装中文名称，绑定变量 {nameCN} */
    nameCN: string;
    /** 服装英文名称，绑定变量 {nameEN} */
    nameEN: string;
    /** 头部/面部饰品（帽子/发饰/眼镜/耳环），绑定变量 {headAcc} */
    headAccessory?: string;
    /** 上半身服装（正面），绑定变量 {upperBody} */
    upperBody: string;
    /** 上半身服装（背面），绑定变量 {upperBodyBack} */
    upperBodyBack: string;
    /** 下半身服装（正面），绑定变量 {lowerBody} */
    lowerBody: string;
    /** 下半身服装（背面），绑定变量 {lowerBodyBack} */
    lowerBodyBack: string;
    /** 腿部与鞋履（丝袜/过膝袜/乐福鞋/靴子），绑定变量 {footwear} */
    footwear?: string;
    /** 全身饰品与手部配件（手套/手镯/腰饰/挎包），绑定变量 {accessories} */
    accessories?: string;
}
/**
 * 设定启用方案数据结构 (纯白名单设计)
 */
export interface EnableSchemeProfile {
    /** 方案唯一标识 UUID */
    id: string;
    /** 方案中文名称 */
    name: string;
    /** 绑定的酒馆角色卡名称 (多张卡以逗号或换行分隔，留空为全局方案) */
    boundCharacterCards: string;
    /** 绑定的聊天记录 ID */
    boundChatId?: string;
    /** 启用的角色规则字典: Key 为 CharacterProfile.id, Value 为 'ALL' | 'match' */
    characterRules: Record<string, InjectionMatchRule>;
    /** 启用的服装规则字典: Key 为 OutfitProfile.id, Value 为 'ALL' | 'match' */
    outfitRules: Record<string, InjectionMatchRule>;
    /** 关联的注入模板 ID */
    injectionTemplateId?: string;
}
/**
 * 注入模板配置方案
 */
export interface InjectionTemplateScheme {
    id: string;
    name: string;
    /** 角色启用列表项模板 {{角色启用列表}} */
    characterListTemplate: string;
    /** 角色专属服装模板 {outfits} */
    innerOutfitTemplate: string;
    /** 通用角色列表项模板 {{通用角色启用列表}} */
    commonCharacterListTemplate: string;
    /** 通用服装列表项模板 {{通用服装启用列表}} */
    enableOutfitListTemplate: string;
}
/**
 * 宏调用后缀分支公式 (Regex Formula)
 */
export interface RegexFormula {
    id: string;
    name: string;
    enabled: boolean;
    pattern: string;
    outputVars: string[];
    customTag?: string;
}
/**
 * 设定提取字段映射公式 (Extract Formula)
 */
export interface ExtractFormula {
    id: string;
    name: string;
    enabled: boolean;
    pattern: string;
    targetField: string;
}
/**
 * 正则宏公式方案预设包 (Regex Formula Scheme)
 */
export interface RegexFormulaScheme {
    id: string;
    name: string;
    characterMacroRules: {
        fixedVars: string[];
        formulas: RegexFormula[];
    };
    outfitMacroRules: {
        fixedVars: string[];
        formulas: RegexFormula[];
    };
    characterExtractRules: ExtractFormula[];
    outfitExtractRules: ExtractFormula[];
}
export type CharacterRule = CharacterProfile & {
    hair?: string;
    eyes?: string;
    facial?: string;
    upperSFW?: string;
    lowerSFW?: string;
    upperNSFW?: string;
    lowerNSFW?: string;
    loraTag?: string;
};
export type OutfitRule = OutfitProfile;
//# sourceMappingURL=types.d.ts.map