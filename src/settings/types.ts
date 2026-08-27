/**
 * DrawAssistantSettings 接口定义
 *
 * 所有用户可配置的参数汇聚于此。
 * 存储位置：extension_settings['draw-assistant']
 * 参考：docs/项目架构.md §3.2
 */

// ─── 后端提供者类型 ────────────────────────────────────────────────────────────

/** 支持的图像生成后端类型 */
export type ImageProvider = 'comfyui' | 'webui' | 'novelai';

// ─── ComfyUI Workflow 注入配置 ────────────────────────────────────────────────

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

// ─── 主设置接口 ───────────────────────────────────────────────────────────────

/**
 * 扩展完整设置结构
 * 所有字段均有默认值（见 defaults.ts），无需用户强制配置
 */
export interface DrawAssistantSettings {
    // ── 后端配置 ─────────────────────────────────────────────────────────────
    /** 当前使用的图像生成后端 */
    provider: ImageProvider;
    /** 后端服务地址（含协议和端口，如 http://127.0.0.1:8188） */
    serverUrl: string;
    /** API Key（仅云端 API 需要，如 NovelAI） */
    apiKey?: string;

    // ── Workflow 配置（ComfyUI 专用） ─────────────────────────────────────────
    /**
     * ComfyUI Workflow 的 API 格式 JSON 字符串
     * 在设置面板中粘贴从 ComfyUI 导出的 API 格式工作流
     * 为空时使用内置默认工作流
     */
    workflowJson: string;
    /** Workflow 参数注入点配置 */
    workflowInjection: WorkflowInjectionConfig;

    // ── 占位符配置 ────────────────────────────────────────────────────────────
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

    // ── 图像参数默认值 ────────────────────────────────────────────────────────
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

    // ── 提示词配置 ────────────────────────────────────────────────────────────
    /** 全局正向提示词前缀（追加在 AI 生成提示词之前） */
    promptPrefix: string;
    /** 全局负向提示词 */
    negativePrefix: string;

    // ── 行为配置 ──────────────────────────────────────────────────────────────
    /** 是否在 AI 回复后自动触发生图（默认关闭，避免意外消耗配额） */
    autoGenerate: boolean;
    /** 并发任务数上限（推荐 1，避免 CUDA OOM） */
    maxConcurrent: number;
    /** 请求超时时间（毫秒） */
    requestTimeout: number;
}
