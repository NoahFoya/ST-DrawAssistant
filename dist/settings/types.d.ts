/**
 * @module settings/types
 * @description DrawAssistantSettings 设置项全局接口与数据模型定义
 *
 * 职责：
 * - 声明全量扩展设置项结构 DrawAssistantSettings
 * - 声明模型预设 (ModelProfileData)、提示词预设 (PromptProfileData) 与全局方案结构
 * - 声明工作流变量注入配置 WorkflowInjectionConfig
 */
/** 支持的图像生成后端类型 */
export type ImageProvider = 'comfyui' | 'webui' | 'novelai';
/**
 * ComfyUI Workflow 中各参数注入点配置
 * 以节点 ID + 字段名 定位需要替换的位置
 */
export interface WorkflowInjectionConfig {
    /** 正向提示词注入的节点 ID（如 "113"） */
    positiveNodeId: string;
    /** 正向提示词在该节点 inputs 中的字段名（如 "positive" 或 "text"） */
    positiveField: string;
    /** 负向提示词注入的节点 ID（如 "12"） */
    negativeNodeId: string;
    /** 负向提示词在该节点 inputs 中的字段名（如 "text"） */
    negativeField: string;
    /** 宽度注入的节点 ID（如 "119"） */
    widthNodeId: string;
    /** 宽度在该节点 inputs 中的字段名（如 "value"） */
    widthField: string;
    /** 高度注入的节点 ID（如 "118"） */
    heightNodeId: string;
    /** 高度在该节点 inputs 中的字段名（如 "value"） */
    heightField: string;
    /** KSampler 节点 ID（如 "63"），用于注入 seed/steps/cfg/sampler_name */
    kSamplerNodeId: string;
    /** SaveImage 节点 ID（如 "99"），用于从 /history 中找到输出图像 */
    saveImageNodeId: string;
}
/**
 * 扩展完整设置结构
 * 所有字段均有默认值（见 defaults.ts），无需用户强制配置
 */
export interface DrawAssistantSettings {
    /** 当前使用的图像生成后端 */
    provider: ImageProvider;
    /** 引擎调用方式：'browser' 浏览器直连 (Mode B) vs 'server' 酒馆服务端代理 (Mode A) */
    requestMode: 'browser' | 'server';
    /** 后端服务地址（含协议和端口，如 http://127.0.0.1:8188） */
    serverUrl: string;
    /** API Key（仅云端 API 需要，如 NovelAI） */
    apiKey?: string;
    /** 插件整体启用开关 */
    enabled: boolean;
    /** 是否在设置项标题旁边显示 ❓ 帮助说明图标 */
    showHelp: boolean;
    /** 调试日志级别：TRACE / DEBUG / INFO / WARN / ERROR */
    logLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    /**
     * ComfyUI Workflow 的 API 格式 JSON 字符串
     * 在设置面板中粘贴从 ComfyUI 导出的 API 格式工作流
     * 为空时使用内置默认工作流
     */
    workflowJson: string;
    /** ComfyUI Inpaint 局部重绘 Workflow 的 API 格式 JSON 字符串 */
    inpaintWorkflowJson?: string;
    /** Workflow 参数注入点配置 */
    workflowInjection: WorkflowInjectionConfig;
    /**
     * 生图触发标记的起始标识
     * AI 回复中出现 `{placeholderStart}提示词{placeholderEnd}` 时触发生图
     * 默认：image###
     */
    placeholderStart: string;
    /**
     * 生图触发标记的结束标识
     * 默认：###
     */
    placeholderEnd: string;
    /** 生成图像宽度（像素） */
    width: number;
    /** 生成图像高度（像素） */
    height: number;
    /** 采样步数 */
    steps: number;
    /** CFG Scale（提示词引导强度） */
    cfgScale: number;
    /** 采样器名称 */
    samplerName: string;
    /** 调度器名称 */
    scheduler: string;
    /** 全局正向提示词前缀（追加在 AI 生成提示词之前） */
    promptPrefix: string;
    /** 全局负向提示词 */
    negativePrefix: string;
    /** 是否在 AI 消息生成完毕后自动触发楼层生图（默认关闭） */
    autoGenerate: boolean;
    /** 是否在点击生成图像时触发全屏大图 Lightbox 弹出 */
    lightboxEnabled: boolean;
    /** 是否将生成的图片数据自动持久化写入酒馆聊天记录 extra 字段 */
    persistToChat: boolean;
    /** 另外在 Chat (chat.json) 中也额外保存完整 Base64 副本（供单文件直接导出迁移） */
    extraSaveToChat?: boolean;
    /** 存储图片格式：'original' 保持原无损 PNG vs 'webp' 转码 WebP vs 'jpeg' */
    imageFormat?: 'original' | 'webp' | 'jpeg';
    /** 压缩质量系数 (0.1 ~ 1.0，仅当格式为 webp/jpeg 时生效) */
    imageQuality?: number;
    /** 并发任务数上限（推荐 1，避免 CUDA OOM） */
    maxConcurrent: number;
    /** 请求超时时间（毫秒） */
    requestTimeout: number;
    /** 扩展独立皮肤预设 ID */
    themePreset?: string;
    /** 悬浮球是否显示 */
    fabVisible?: boolean;
    /** 悬浮球透明度 (0.3 ~ 1.0) */
    fabOpacity?: number;
    /** 悬浮球图标 Emoji / 文本 */
    fabIcon?: string;
    /** 悬浮球自定义图片图标 (Base64 数据串或图片 URL) */
    fabCustomIcon?: string;
    /** 记忆的悬浮球最后拖拽位置（未设置时为 null） */
    fabPosition?: {
        x: number;
        y: number;
    } | null;
    /** 用户保存的自定义主题方案列表 */
    customThemes?: CustomThemeScheme[];
    /** 当前选中的全局方案预设 ID */
    globalProfileId?: string;
    /** 保存的全局方案预设列表 */
    globalProfiles?: PresetProfileItem<GlobalProfileData>[];
    /** 绑定的模型参数预设 ID */
    comfyModelProfileId?: string;
    /** 绑定的提示词预设 ID */
    comfyPromptProfileId?: string;
    /** 绑定的文生图工作流预设 ID */
    comfyTxt2ImgWorkflowId?: string;
    /** 绑定的重绘工作流预设 ID */
    comfyInpaintWorkflowId?: string;
    /** 选中的通用工作流预设 ID (C5 方案库选中项) */
    comfyWorkflowProfileId?: string;
    /** Checkpoint 专属正向起手式 */
    checkpointPositivePrefix?: string;
    /** Checkpoint 专属负向起手式 */
    checkpointNegativePrefix?: string;
    /** 提示词后缀 (Suffix) */
    promptSuffix?: string;
    /** 追加的 Lora 列表 */
    loras?: LoraItem[];
    /** 选中模型 (Checkpoint / UNet / Diffusion Model) 名称 */
    ckptName?: string;
    /** 选中 CLIP 模型名称 */
    clipName?: string;
    /** 选中 VAE 模型名称 */
    vaeName?: string;
    /** 保存的模型参数预设列表 */
    comfyModelProfiles?: PresetProfileItem<ModelProfileData>[];
    /** 保存的提示词预设列表 */
    comfyPromptProfiles?: PresetProfileItem<PromptProfileData>[];
    /** 保存的统一工作流预设列表（文生图与重绘共用） */
    comfyWorkflows?: PresetProfileItem<WorkflowProfileData>[];
}
/** 全局组合方案预设数据结构 */
export interface GlobalProfileData {
    modelProfileId?: string;
    promptProfileId?: string;
    txt2imgWorkflowId?: string;
    inpaintWorkflowId?: string;
}
/** 模型参数预设数据结构 */
export interface ModelProfileData {
    ckptName?: string;
    clipName?: string;
    vaeName?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    samplerName?: string;
    scheduler?: string;
    checkpointPositivePrefix?: string;
    checkpointNegativePrefix?: string;
}
/** Lora 项配置 */
export interface LoraItem {
    name: string;
    weight: number;
}
/** 提示词预设数据结构 */
export interface PromptProfileData {
    promptPrefix?: string;
    negativePrefix?: string;
    promptSuffix?: string;
    loras?: LoraItem[];
}
/** 工作流预设数据结构 */
export interface WorkflowProfileData {
    json?: string;
}
/** 通用预设方案项接口 */
export interface PresetProfileItem<T = Record<string, unknown>> {
    id: string;
    name: string;
    isBuiltIn?: boolean;
    data: T;
}
/** 自定义主题方案结构 */
export interface CustomThemeScheme {
    id: string;
    name: string;
    isBuiltIn?: boolean;
    bgPrimary: string;
    bgSecondary: string;
    bgInput: string;
    bgHover: string;
    textPrimary: string;
    textSecondary: string;
    borderColor: string;
    accentColor: string;
    blurRadius: number;
    borderRadius: number;
}
//# sourceMappingURL=types.d.ts.map