/**
 * 统一生图参数、响应结果与传输模式类型定义
 * 来源规范：st-image-gen 规范（意图与后端载荷分离、双通道请求、结果归一化）
 */

/** 生图引擎类型标识 */
export type EngineType = 'sdwebui' | 'comfyui' | 'novelai' | 'openai';

/**
 * 请求传输方式：
 * - relay: 经由 SillyTavern 宿主后端 /api/sd/... 中继（携带 CSRF 凭据）
 * - direct: 浏览器前端直接调用目标引擎服务地址（支持 WebSocket 实时通知）
 * - auto: 由适配器或配置根据服务地址协议和连通性自动协商
 */
export type TransportMode = 'relay' | 'direct' | 'auto';

/** 统一生图请求参数对象（领域意图，独立于各后端私有请求结构） */
export interface ImageGenerationParams {
    /** 正向提示词 */
    prompt: string;
    /** 负向提示词 */
    negativePrompt?: string;
    /** 图像宽度（像素） */
    width: number;
    /** 图像高度（像素） */
    height: number;
    /** 随机种子（-1 表示由后端随机生成） */
    seed: number;
    /** 采样迭代步数 */
    steps?: number;
    /** 提示词引导系数 (CFG Scale) */
    cfgScale?: number;
    /** 采样算法名称 */
    sampler?: string;
    /** 调度器算法名称 */
    scheduler?: string;
    /** 传输通道偏好 */
    transport?: TransportMode;
    /** 图生图或重绘输入图片（Base64 或 Blob 引用） */
    sourceImage?: Blob | string;
    /** 重绘去噪强度 (0.0 ~ 1.0) */
    denoisingStrength?: number;
    /** 引擎私有专属参数容器（如 ComfyUI 工作流片段或 NovelAI 特殊配置） */
    extraParams?: Record<string, unknown>;
}

/** 统一格式化生图响应结果 */
export interface ImageGenerationResult {
    /** 图片二进制数据 */
    blob: Blob;
    /** 媒体 MIME 类型，通常为 'image/png' 或 'image/jpeg' */
    mimeType: string;
    /** 实际输出宽度 */
    width: number;
    /** 实际输出高度 */
    height: number;
    /** 实际使用的随机种子 */
    seed: number;
    /** 生图耗时（毫秒） */
    durationMs: number;
    /** 引擎返回的额外原始元数据（如生图信息参数、模型哈希等） */
    metadata?: Record<string, unknown>;
}

/** 引擎能力描述结构 */
export interface EngineCapabilities {
    /** 是否支持文生图 */
    readonly txt2img: boolean;
    /** 是否支持图生图 */
    readonly img2img: boolean;
    /** 是否支持局部重绘 */
    readonly inpaint: boolean;
    /** 是否支持 LoRA 模型参数注入 */
    readonly lora: boolean;
    /** 是否支持生成进度回调轮询或流式推送 */
    readonly progress: boolean;
    /** 是否支持主动中止正在执行的生图作业 */
    readonly interrupt: boolean;
    /** 是否支持自定义工作流模板注入（如 ComfyUI JSON 蓝图） */
    readonly customWorkflow: boolean;
}
