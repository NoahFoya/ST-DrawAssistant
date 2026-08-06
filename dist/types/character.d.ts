/**
 * @module types/character
 * @description 角色与服装数据实体及契约模型规范
 */
/**
 * 实体注入规则模式: 'ALL' (无条件注入) | 'match' (上下文姓名/名称匹配成功才注入)
 */
export type InjectionMatchRule = 'ALL' | 'match';
/**
 * 角色预设实体与 Tag 变量数据契约
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
//# sourceMappingURL=character.d.ts.map