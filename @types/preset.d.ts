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
    /** 关联的提示词预设标识符（当值为 '__polling__' 时启用提示词轮询） */
    promptPresetId?: string;
    /** 提示词轮询候选池配置（空数组或未设置时默认从当前服务全部提示词预设中随机抽取） */
    promptPollingPool?: PromptPollingPoolItem[];
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
    /** OpenAI 兼容生图画质档位 (如 standard / hd / low / medium / high / auto) */
    quality?: string;
    /** OpenAI 兼容生图画面风格 (如 vivid / natural) */
    style?: string;
    /** OpenAI GPT Image 背景透明控制 (auto / transparent / opaque) */
    background?: string;
    /** OpenAI GPT Image 输出图像格式 (png / jpeg / webp) */
    outputFormat?: string;
    /** 原生画幅比例标识 (Gemini aspectRatio / Grok aspect_ratio，如 '1:1' | '16:9') */
    aspectRatio?: string;
    /** Gemini 原生图像分辨率档位 ('512' | '1K' | '2K' | '4K') */
    imageSize?: string;
    /** Grok 原生图像分辨率档位 ('1k' | '2k') */
    resolution?: string;
    /** 云端服务自定义模型标识（覆盖基础下拉选择） */
    customModel?: string;
    /** 云端服务自定义请求体 JSON 字符串 */
    customBodyJson?: string;
    /** NovelAI 是否启用权重语法自动转换（V4+ 转为 weight::tag::，V3 兼容转为 {}/[]） */
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

/** 提示词预设轮询候选池单条目 */
export interface PromptPollingPoolItem {
    /** 关联的提示词预设 ID */
    readonly presetId: string;
    /** 预设名称快照（用于失效排查或跨环境按名回退匹配） */
    readonly presetName?: string;
    /** 是否在当前轮询池中启用（关闭时跳过抽取但保留条目） */
    enabled: boolean;
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

    [key: string]: unknown;
}

/** 提示词条目或素材注入触发模式 */
export type ActivationTriggerMode = 'always' | 'keyword';

/** 角色部位固定状态后缀 */
export type CharacterPartState = 'clothed' | 'exposed' | 'nude';

/** 服装部位固定状态后缀 */
export type OutfitPartState = 'intact' | 'disheveled';

/** 素材部位统一状态后缀 */
export type MaterialPartState = CharacterPartState | OutfitPartState;

/** 角色部位英文键名（16 项按真实解剖结构划分的部位） */
export type CharacterPartKey =
    | 'appearance'
    | 'hair'
    | 'face'
    | 'features'
    | 'accessories'
    | 'neck_shoulders'
    | 'breasts'
    | 'upper_back'
    | 'abdomen'
    | 'arms'
    | 'hands'
    | 'hips'
    | 'genitals'
    | 'anus'
    | 'legs'
    | 'feet';

/** 角色 16 个按需部位字段（支持 `通用tags|[clothed]tags|[exposed]tags|[nude]tags` 分层） */
export interface CharacterParts {
    /** 外貌与体型（种族、肤色、身高体型与整体体态） */
    appearance: string;
    /** 发型与发色（发色、发长、发型、刘海、呆毛） */
    hair: string;
    /** 面部五官（瞳色、眼型、眉唇与固定面部标记） */
    face: string;
    /** 特殊特征（兽耳、尾巴、翅膀、角、光环或永久体表纹身） */
    features: string;
    /** 常驻配饰（眼镜、常驻耳饰、项圈等随身饰品） */
    accessories: string;
    /** 颈肩与锁骨（脖颈、锁骨、肩部轮廓） */
    neck_shoulders: string;
    /** 胸部/乳房（胸围体型；裸露或半裸层补充乳头与乳晕细节） */
    breasts: string;
    /** 背部（肩胛、脊背线条、背部纹身等背面特征） */
    upper_back: string;
    /** 腰腹与肚脐（腰线、小腹、马甲线与肚脐） */
    abdomen: string;
    /** 手臂（大臂、小臂线条与上肢特征） */
    arms: string;
    /** 手部（手型比例、手指、手腕与固定美甲） */
    hands: string;
    /** 臀部（臀部曲线、腰臀比与骨盆轮廓） */
    hips: string;
    /** 生殖器（阴部/生殖构造与阴毛形态） */
    genitals: string;
    /** 肛门/后庭（后庭与肛周形态特征） */
    anus: string;
    /** 腿部（大腿、小腿线条与腿部轮廓） */
    legs: string;
    /** 足部（脚踝、足弓、脚趾与赤足细节） */
    feet: string;
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

/** 服装部位英文键名（10 项标准穿戴部位） */
export type OutfitPartKey =
    | 'style'
    | 'headwear'
    | 'outerwear'
    | 'top'
    | 'bottom'
    | 'bra'
    | 'panties'
    | 'legwear'
    | 'shoes'
    | 'accessories';

/** 服装 10 个按需部位字段（支持 `通用tags|[intact]tags|[disheveled]tags` 分层） */
export interface OutfitParts {
    /** 整体风格（套装主题标签与主配色，无固定套装主题可留空） */
    style: string;
    /** 头饰（帽子、发箍、发带、头纱、配套耳饰） */
    headwear: string;
    /** 外套（大衣、夹克、开衫、披肩等外搭服饰） */
    outerwear: string;
    /** 上衣与连体衣（衬衫、T恤或连衣裙、泳衣、连体服主件） */
    top: string;
    /** 下装（半身裙、裤装、短裤等分体下装；连体服时留空） */
    bottom: string;
    /** 文胸/内衣上装（文胸、抹胸、吊带内衬） */
    bra: string;
    /** 内裤/底裤（内裤、丁字裤、安全裤） */
    panties: string;
    /** 袜子（短袜、过膝袜、连裤袜、丝袜、腿环） */
    legwear: string;
    /** 鞋子（皮鞋、运动鞋、高跟鞋、靴子、凉鞋） */
    shoes: string;
    /** 配饰（手套、袖套、腕饰、领结、腰带、胸针与包袋） */
    accessories: string;
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
    /** 角色档案起始标记，默认 "<character>" */
    charStartTag: string;
    /** 角色档案结束标记，默认 "</character>" */
    charEndTag: string;
    /** 服装档案起始标记，默认 "<outfit>" */
    outfitStartTag: string;
    /** 服装档案结束标记，默认 "</outfit>" */
    outfitEndTag: string;
    /** 名称键别名列表，默认 "NAME|名称|角色名|服装名|CN_NAME|中文名" */
    nameKeys: string;
    /** 别名键列表，默认 "ALIASES|ALIAS|别名|EN_NAME|英文名" */
    aliasesKeys: string;
    /** 触发词/专属标识键列表（角色与服装通用），例如 "TRIGGER|IDENTITY|TAGS|触发词|身份标识|服装标识" */
    triggerKeys: string;
    /** 角色描述或服装描述键列表，例如 "DESCRIPTION|DESC|SUMMARY|角色描述|服装描述|说明|简介" */
    descriptionKeys: string;
    /** 基础外观与风格特征键列表（角色对应 appearance 体貌特征，服装对应 style 服饰风格），例如 "APPEARANCE|STYLE|OVERALL|体貌|外貌|样式|风格" */
    appearanceStyleKeys: string;
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
    /** 仅用于素材注入通道：未命中任何角色或服装时隐藏整个通道注入（默认 true） */
    hideWhenEmpty?: boolean;
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
    /** 关联的预置词库分片 ID（手动导入文件无此字段） */
    presetPackId?: string;
}

/** 预置静态词库单个分片元数据 */
export interface StaticLexiconPackMeta {
    /** 分片唯一标识（如 'general-meta-1'、'copyright'） */
    id: string;
    /** 对应静态 CSV 文件名 */
    fileName: string;
    /** 列表中展示的中文词库名称 */
    displayName: string;
    /** 词条数量 */
    entryCount: number;
}

/** 预置静态词库总清单结构 (config/lexicon/manifest.json) */
export interface StaticLexiconManifest {
    /** 清单版本 */
    version: string;
    /** 全部预置分片总词条数 */
    totalEntries: number;
    /** 分片清单 */
    packs: StaticLexiconPackMeta[];
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
