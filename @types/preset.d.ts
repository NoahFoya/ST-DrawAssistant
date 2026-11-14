/**
 * ST-DrawAssistant 预设类型定义。
 *
 * @remarks
 * 声明预设数据模型及各类别预设数据类型，
 * 涵盖绘图参数、生图提示词模板、工作流、界面主题、素材库与酒馆提示词注入预设。
 */

import type { ProviderType } from './provider';

/** 预设所属的分类类型 */
export type PresetCategory =
    | 'drawing'
    | 'prompts'
    | 'workflows'
    | 'themes'
    | 'characters'
    | 'outfits'
    | 'material_activations'
    | 'material_extractions'
    | 'material_formats'
    | 'prompt_story'
    | 'prompt_character'
    | 'prompt_vocab'
    | 'prompt_material';

/** 提示词四大独立注入通道标识 */
export type PromptChannelId = 'story' | 'character' | 'vocab' | 'material';

/** 单个预设条目的统一标准化包装模型 */
export interface PresetItem<T = Record<string, unknown>> {
    /** 预设全局唯一标识符 */
    readonly id: string;
    /** 预设显示名称 (用户可自由修改) */
    name: string;
    /** 预设数据内容 */
    data: T;
    /** 备注或说明信息 (可选) */
    description?: string;
    /** 最近修改时间戳 (可选) */
    updatedAt?: number;
}

export interface DrawingPresetData {
    /** 主模型 / 基底模型文件名 (Checkpoint 或 UNet) */
    baseModel?: string;
    /** 级联额外模型文件名列表 */
    extraModels?: string[];
    /** 分立式 CLIP 模型文件名 */
    clipName?: string;
    /** 分立式 VAE 模型文件名 */
    vaeName?: string;
    /** CLIP 跳过层数 */
    clipSkip?: number;
    /** 采样算法名称 */
    samplerName?: string;
    /** 调度器名称 */
    scheduler?: string;
    /** 采样步数 */
    steps?: number;
    /** 提示词引导系数 CFG Scale */
    cfgScale?: number;
    /** 随机种子 (未指定时由引擎自动随机生成) */
    seed?: number;
    /** 图像生成宽度 (像素) */
    width?: number;
    /** 图像生成高度 (像素) */
    height?: number;
    /** 关联的提示词预设标识符 */
    promptPresetId?: string;
    /** 关联的文生图工作流预设标识符 */
    txt2imgWorkflowId?: string;
    /** 关联的局部重绘预设标识符 */
    inpaintPresetId?: string;
    /** 是否开启高清修复 (SD-WebUI) */
    enableHires?: boolean;
    /** 高清修复放大算法 (SD-WebUI) */
    hiresUpscaler?: string;
    /** 高清修复倍率 (SD-WebUI) */
    hiresScale?: number;
    /** 高清修复步数 (SD-WebUI) */
    hiresSteps?: number;
    /** 高清修复重绘幅度 (SD-WebUI) */
    hiresDenoise?: number;
    /** OpenAI 兼容生图画质档位 (如 standard / hd) */
    quality?: string;
    /** OpenAI 兼容生图画面风格 (如 vivid / natural) */
    style?: string;
    /** OpenAI 兼容自定义模型标识 */
    customModel?: string;
    /** OpenAI 兼容自定义请求体 JSON 字符串 */
    customBodyJson?: string;
    /** NovelAI 是否将权重语法自动转换为花括号 */
    convertSyntax?: boolean;
    /** NovelAI SMEA 采样增强模式 (仅限 V3 经典模型，smea_dyn / smea / none) */
    smeaMode?: string;
    /** NovelAI 是否启用焦黑抑制 (仅限 V3 经典模型，Decrisper) */
    decrisper?: boolean;
    /** NovelAI CFG 引导重缩放系数 */
    cfgRescale?: number;
    /** 引擎扩展参数通用键值 */
    [key: string]: unknown;
}

/** LoRA 语法模式：标准模式 ('standard') 与 WeiLin 扩展模式 ('weilin') */
export type LoraSyntaxMode = 'standard' | 'weilin';

/** LoRA 配置条目模型 */
export interface LoraConfigItem {
    /** LoRA 模型文件标识 */
    modelName?: string;
    /** 基础模型权重 */
    modelWeight?: number;
    /** 文本编码器权重 */
    clipWeight?: number;
    /** 触发权重（仅用于三权重模式） */
    triggerWeight?: number;
    enabled?: boolean;
}

/** 提示词预设数据模型 */
export interface PromptPresetData {
    /** 正向提示词前缀 */
    positivePrefix?: string;
    /** 正向提示词后缀 */
    positiveSuffix?: string;
    /** 负向提示词 */
    negativePrompt?: string;
    /** LoRA 语法模式，默认 'standard' */
    loraSyntaxMode?: LoraSyntaxMode;
    /** LoRA 配置列表 */
    loras?: LoraConfigItem[];
    [key: string]: unknown;
}

/** 工作流预设数据模型 (如 ComfyUI API 节点图) */
export interface WorkflowPresetData {
    workflow: Record<string, unknown>;
    [key: string]: unknown;
}

/** 界面外观与设计令牌主题预设数据模型 (现代三层 Token 规范) */
export interface ThemePresetData {
    // 1. 表面层级体系 (Surface Ladder)
    bgCanvas?: string;
    bgPrimary?: string;
    bgSecondary?: string;
    bgCard?: string;
    bgCardHover?: string;
    bgInput?: string;
    bgInputHover?: string;
    bgModal?: string;
    bgOverlay?: string;

    // 2. 品牌与强调色体系 (Brand & Accent)
    accent: string;
    accentSecondary?: string;
    accentHover?: string;
    accentGlow?: string;
    accentGradient?: string;

    // 3. 文本与内容层级体系 (Content & Typography)
    textPrimary?: string;
    textSecondary?: string;
    textMuted?: string;
    textOnAccent?: string;

    // 4. 边框与分割体系 (Borders & Separators)
    borderColor?: string;
    borderHighlight?: string;
    borderSubtle?: string;

    // 5. 几何形态与滤镜体系 (Geometry & Physics)
    borderRadius?: number;
    radiusModal?: number;
    radiusCard?: number;
    radiusInput?: number;
    blurModal?: number;
    blurPanel?: number;

    [key: string]: unknown;
}

/** 提示词条目或素材注入触发模式 */
export type ActivationTriggerMode = 'always' | 'keyword';

/** 角色部位英文键名（13 项自然生理结构部位） */
export type CharacterPartKey =
    | 'appearance'
    | 'hair'
    | 'face'
    | 'features'
    | 'chest'
    | 'upper_body'
    | 'waist'
    | 'hips'
    | 'legs'
    | 'feet'
    | 'hands'
    | 'accessories'
    | 'privates';

/** 角色 13 个按需部位字段 */
export interface CharacterParts {
    /** 外貌体态（种族、肤色、身材高矮胖瘦、整体身形基调） */
    appearance: string;
    /** 发型发色（发色、发长、发型、刘海、呆毛） */
    hair: string;
    /** 容貌五官（瞳色、眼型、表情神态、妆容泪痣/面印） */
    face: string;
    /** 特异特征（兽耳、尾巴、羽翼、犄角、光环等标志生物特征） */
    features: string;
    /** 胸部特征（胸围罩杯、胸型轮廓、乳首等胸部特征） */
    chest: string;
    /** 上身肩颈（肩颈线条、锁骨、手臂肌理） */
    upper_body: string;
    /** 腰腹曲线（腰线、小腹、肚脐、马甲线） */
    waist: string;
    /** 臀胯轮廓（臀部轮廓、腰臀比、胯骨线条） */
    hips: string;
    /** 腿部轮廓（大腿、小腿线条、肉腿、修长美腿） */
    legs: string;
    /** 足部细节（脚踝、脚掌、足底、赤足细节） */
    feet: string;
    /** 手部指掌（手指修长、手腕、美甲） */
    hands: string;
    /** 随身配饰（眼镜、常驻耳饰、项圈等不随换装摘除的随身标志物） */
    accessories: string;
    /** 私密细节（私密身体特征与性征细节） */
    privates: string;
    [key: string]: string;
}

/** 单个角色档案预设数据模型 */
export interface CharacterPresetData {
    /** 唯一名称（主调用名及列表展示名，支持中文或英文） */
    name: string;
    /** 别名列表，多个以 | 分隔（支持宏调用反查与上下文关键词命中） */
    aliases: string;
    /** 角色描述（多行文本域，支持输入人物性格背景与设定，注入模型上下文） */
    description: string;
    /** 本地 IndexedDB 立绘图片键名（未上传时为空字符串） */
    avatarId: string;
    /** 绑定的服装预设 ID 列表 */
    boundOutfitIds: string[];

    /** 角色专属触发词: 同人角色专属触发标签与作品 IP 英文标签，自设原创角色可留空（如 hatsune_miku, vocaloid） */
    trigger: string;

    /** 各生理部位细分标签 */
    parts: CharacterParts;
    [key: string]: unknown;
}

/** 服装部位英文键名（9 项标准穿戴部位） */
export type OutfitPartKey =
    | 'style'
    | 'headwear'
    | 'top'
    | 'bottom'
    | 'handwear'
    | 'socks'
    | 'shoes'
    | 'accessories'
    | 'underwear';

/** 服装 9 个按需部位字段 */
export interface OutfitParts {
    /** 整体风格（版型剪裁、设计主题、主色调、纹样质感） */
    style: string;
    /** 头饰发饰（女仆头饰、帽子、发带、发箍、头纱等头部服饰） */
    headwear: string;
    /** 上装（衬衫、外套、连衣裙、连体衣、领口袖型、围裙上半部等） */
    top: string;
    /** 下装（半身裙、裤装、短裤、百褶裙摆等分体下装） */
    bottom: string;
    /** 手饰袖套（手套、袖套、腕饰等） */
    handwear: string;
    /** 腿饰袜类（丝袜、过膝袜、连裤袜、吊带袜、短袜等） */
    socks: string;
    /** 鞋履鞋靴（高跟鞋、皮鞋、运动鞋、短靴、长筒靴、凉鞋等） */
    shoes: string;
    /** 服饰配件（领结、胸针、丝带蝴蝶结、披肩、腰带挂件等） */
    accessories: string;
    /** 贴身内衣（文胸、内裤、打底内衬等） */
    underwear: string;
    [key: string]: string;
}

/** 单个服装档案预设数据模型 */
export interface OutfitPresetData {
    /** 服装唯一名称（主调用名及列表展示名） */
    name: string;
    /** 服装别名，多个以 | 分隔 */
    aliases: string;
    /** 服装描述（注入 <image_database> 供 AI 选用） */
    description: string;
    /** 服装专属标识: 特定服饰专属英文标签与作品 IP 标签，通用搭配或自设服装可留空 */
    trigger: string;
    /** 本地 IndexedDB 服装预览图键名（未上传时为空字符串） */
    avatarId: string;
    /** 各部位按需 Tags */
    parts: OutfitParts;
    [key: string]: unknown;
}

/** 用户可配置的素材宏展开规则模型 */
export interface MaterialMacroRule {
    /** 规则唯一标识符 */
    readonly id: string;
    /** 宏调用名称（用户输入的后缀，如 '特写' 或 'closeup'） */
    name: string;
    /** 规则说明 */
    description?: string;
    /** 绑定的部位英文键列表 (按执行顺序合并) */
    targetParts: string[];
}

/** 单条角色或服装在启用预设中的激活规则 */
export interface MaterialItemActivationRule {
    /** 是否在该启用预设中开启此素材 */
    enabled: boolean;
    /** 触发方式：always 常驻注入 | keyword 上下文命中名称或别名动态注入 */
    triggerMode: ActivationTriggerMode;
    /** 是否绑定特定酒馆角色卡 */
    bindCharacterCard?: boolean;
    /** 绑定的酒馆角色卡标识/名称（如 characterId 或 name2） */
    boundCharacterCardName?: string;
}

/** 素材启用规则配置数据模型 */
export interface MaterialActivationPresetData {
    /** 角色激活规则字典（严格使用角色预设 id 作为键） */
    characterRules: Record<string, MaterialItemActivationRule>;
    /** 服装激活规则字典（严格使用服装预设 id 作为键） */
    outfitRules: Record<string, MaterialItemActivationRule>;
    /** 绑定的酒馆角色卡名称列表 */
    boundCardNames: string[];
    /** 关键词动态匹配时扫描最近聊天消息条数（默认 2；设为 0 表示不扫描聊天消息） */
    scanDepth: number;
    /** 角色触发时是否自动连带激活其绑定的关联服装 */
    includeBoundOutfits: boolean;
    [key: string]: unknown;
}

/**
 * 素材单层行级注入格式配置。
 *
 * @remarks
 * 配置角色与服装两类单条行渲染模板，分别产出 {{角色启用列表}} 与 {{服装启用列表}}；
 * 渲染结果注入「提示词 -> 素材注入」条目正文中定义的外层 <image_database> 容器。
 */
export interface MaterialFormatConfig {
    /** 单条角色渲染行模板（产出 {{角色启用列表}}） */
    characterTemplate: string;
    /** 单条服装渲染行模板（产出 {{服装启用列表}}） */
    outfitTemplate: string;
    /** 单条可用宏指令渲染行模板（产出 {{角色可用宏列表}} 与 {{服装可用宏列表}}） */
    macroTemplate?: string;
}

/** 楼层角色/服装档案提取规则配置 */
export interface CharacterExtractionConfig {
    /** 是否启用楼层角色与服装档案提取及折叠总开关 */
    enabled: boolean;
    /** 是否在 AI 回复渲染完成后自动扫描并弹出确认面板 */
    autoDetect: boolean;
    /** 是否将楼层中的原始档案文本块折叠为轻量可点击胶囊徽标 */
    collapseInFloor: boolean;
    /** 角色档案起始标记，默认 "<角色>" */
    charStartTag: string;
    /** 角色档案结束标记，默认 "</角色>" */
    charEndTag: string;
    /** 服装档案起始标记，默认 "<服装>" */
    outfitStartTag: string;
    /** 服装档案结束标记，默认 "</服装>" */
    outfitEndTag: string;
    /** 名称键别名列表，默认 "NAME|名称|角色名|服装名|CN_NAME|中文名" */
    nameKeys: string;
    /** 别名键列表，默认 "ALIASES|ALIAS|别名|EN_NAME|英文名" */
    aliasesKeys: string;
    /** 触发词/专属标识键列表（角色与服装通用），例如 "TRIGGER|IDENTITY|TAGS|触发词|身份标识|服装标识" */
    triggerKeys: string;
    /** 角色描述或服装描述键列表，例如 "DESCRIPTION|DESC|SUMMARY|角色描述|服装描述|说明|简介" */
    descriptionKeys: string;
    /** 基础特征键列表（角色对应 appearance 体貌特征，服装对应 style 服饰风格），例如 "APPEARANCE|STYLE|OVERALL|体貌|外貌|样式|风格" */
    baseTraitKeys: string;
    /** 专属服装键列表（仅角色有效），例如 "OUTFITS|OUTFIT|服装|绑定服装|专属服装" */
    outfitKeys: string;
    [key: string]: unknown;
}

/** 楼层角色/服装档案提取解析预设数据模型 */
export type MaterialExtractionPresetData = CharacterExtractionConfig;

/** 素材变量行模板与绘图宏预设数据模型 */
export interface MaterialFormatPresetData {
    /** 单条角色渲染行模板 */
    characterTemplate: string;
    /** 单条服装渲染行模板 */
    outfitTemplate: string;
    /** 单条可用宏指令渲染行模板 */
    macroTemplate?: string;
    /** 用户自定义角色宏规则列表 */
    characterMacros?: MaterialMacroRule[];
    /** 用户自定义服装宏规则列表 */
    outfitMacros?: MaterialMacroRule[];
    [key: string]: unknown;
}

/** 素材库全局运行配置 */
export interface MaterialLibraryConfig {
    /** 当前在角色管理子页选中的角色预设 ID */
    activeCharacterPresetId: string;
    /** 当前在服装管理子页选中的服装预设 ID */
    activeOutfitPresetId: string;
    /** 当前在启用设置子页选中的启用预设 ID */
    activeActivationPresetId: string;
    /** 当前在解析设置子页选中的解析预设 ID */
    activeExtractionPresetId?: string;
    /** 当前在变量与宏管理子页选中的变量与宏预设 ID */
    activeFormatPresetId?: string;
    /** 是否开启跟随酒馆当前角色卡自动切换启用预设 */
    autoSwitchByCard: boolean;
    /** 楼层档案提取规则配置 */
    extraction: CharacterExtractionConfig;
    /** 单层行级注入格式配置 */
    format: MaterialFormatConfig;
    /** 用户自定义角色宏规则列表 */
    characterMacros?: MaterialMacroRule[];
    /** 用户自定义服装宏规则列表 */
    outfitMacros?: MaterialMacroRule[];
}

/**
 * 提示词注入单条目模型。
 *
 * @remarks
 * position 对应宿主 setExtensionPrompt 参数约定：
 * - 0 = IN_PROMPT（主提示词后）
 * - 1 = IN_CHAT（聊天记录指定深度 @D）
 * - 2 = BEFORE_PROMPT（主提示词前）
 * role 对应消息角色身份：0 = SYSTEM, 1 = USER, 2 = ASSISTANT。
 */
export interface PromptInjectionEntry {
    /** 条目唯一标识 */
    id: string;
    /** 条目名称（如 "核心|插图规则"、"SFW|常用标签基础库"） */
    name: string;
    /** 是否启用该条目 */
    enabled: boolean;
    /** 触发方式：always 常驻注入 | keyword 关键词命中触发 */
    triggerMode: ActivationTriggerMode;
    /** 以 | 或逗号分隔的触发关键词（常驻模式下忽略） */
    keywords: string;
    /** 可选次要过滤器关键词（如果为空则忽略） */
    secondaryKeywords?: string;
    /** 关键字匹配逻辑：and_any 与任意 | and_all 与所有 | not_any 排除 */
    logicType?: 'and_any' | 'and_all' | 'not_any';
    /** 是否区分大小写匹配 */
    caseSensitive?: boolean;
    /** 英文/ASCII 关键词是否启用整词边界匹配 */
    matchWholeWords?: boolean;
    /** 关键词模式下的最近消息扫描条数（默认 2） */
    scanDepth: number;
    /** 注入位置：0 = IN_PROMPT, 1 = IN_CHAT (@D), 2 = BEFORE_PROMPT */
    position: 0 | 1 | 2;
    /** 聊天插入深度 @D（position = 1 时生效） */
    depth: number;
    /** 消息角色身份：0 = SYSTEM, 1 = USER, 2 = ASSISTANT */
    role: 0 | 1 | 2;
    /** 同位置/深度/角色分桶内的升序拼接权重 */
    order: number;
    /** 当条目引用的素材列表变量为空时，将空变量替换为空文本（若整条正文因此为空则跳过注入） */
    skipWhenEmpty?: boolean;
    /** 条目提示词正文（支持素材启用列表变量与 {{//...}} 酒馆注释） */
    content: string;
}

/** 提示词通道预设数据模型（故事插画 / 素材创作 / 词汇指导 / 素材注入通用） */
export interface PromptChannelPresetData {
    /** 预设内的多条提示词注入条目 */
    entries: PromptInjectionEntry[];
    [key: string]: unknown;
}

/** 单个提示词通道的独立开关与激活预设配置 */
export interface PromptChannelRuntimeConfig {
    /** 是否启用向酒馆宿主注入该通道 */
    enabled: boolean;
    /** 当前选中的预设 ID */
    activePresetId: string;
}

/** 提示词四大通道全局配置 */
export interface PromptInjectionConfig {
    /** 故事插画通道 */
    story: PromptChannelRuntimeConfig;
    /** 素材创作通道 */
    character: PromptChannelRuntimeConfig;
    /** 词汇指导通道 */
    vocab: PromptChannelRuntimeConfig;
    /** 素材注入通道 */
    material: PromptChannelRuntimeConfig;
}

/** IndexedDB 本地词库单文件元数据 */
export interface LocalLexiconFileMeta {
    /** 文件记录唯一标识 */
    id: string;
    /** 导入源文件名 */
    fileName: string;
    /** 识别出的文件格式 */
    format: 'tagcomplete-csv' | 'bilingual-csv' | 'json';
    /** 解析出的有效词条数 */
    entryCount: number;
    /** 原始文本字节大小 */
    byteSize: number;
    /** 是否启用参与本地提示词联想 */
    enabled: boolean;
    /** 导入时间戳 */
    importedAt: number;
}

/** IndexedDB 本地自定义词汇单条记录 */
export interface LocalCustomWordItem {
    /** 词条唯一标识 */
    id: string;
    /** 标准英文标签（如 cowboy_shot） */
    tag: string;
    /** 可选中文释义或联想别名 */
    cn?: string;
    /** 最近更新时间戳 */
    updatedAt: number;
}

/** 预设池整体持久化结构 */
export interface PresetSettings {
    /** 绘图预设字典，按绘图服务提供方划分独立命名空间 */
    drawing: Record<ProviderType | string, PresetItem<DrawingPresetData>[]>;
    /** 生图正负向提示词预设字典，按绘图服务提供方划分独立命名空间 */
    prompts: Record<ProviderType | string, PresetItem<PromptPresetData>[]>;
    /** 工作流模板列表 */
    workflows: PresetItem<WorkflowPresetData>[];
    /** 界面主题列表 */
    themes: PresetItem<ThemePresetData>[];
    /** 角色档案预设列表 */
    characters: PresetItem<CharacterPresetData>[];
    /** 服装档案预设列表 */
    outfits: PresetItem<OutfitPresetData>[];
    /** 素材启用预设列表 */
    material_activations: PresetItem<MaterialActivationPresetData>[];
    /** 楼层档案提取解析预设列表 */
    material_extractions: PresetItem<MaterialExtractionPresetData>[];
    /** 变量行模板与宏预设列表 */
    material_formats: PresetItem<MaterialFormatPresetData>[];
    /** 提示词 - 故事插画预设列表 */
    prompt_story: PresetItem<PromptChannelPresetData>[];
    /** 提示词 - 素材创作预设列表 */
    prompt_character: PresetItem<PromptChannelPresetData>[];
    /** 提示词 - 词汇指导预设列表 */
    prompt_vocab: PresetItem<PromptChannelPresetData>[];
    /** 提示词 - 素材注入预设列表 */
    prompt_material: PresetItem<PromptChannelPresetData>[];
}
