/**
 * 生图引擎专有原生数据结构定义 (@types/engine-data)
 *
 * 核心功能：
 * 1. 严格按照各后端官方协议，定义发往各生图后端的原生请求数据结构 (RequestData)；
 * 2. 定义各后端返回的原生响应数据结构 (ResponseData)；
 * 3. 构造以 engine 为判别标签的强类型联合体 (EngineGenerationTaskParams)，保障类型安全。
 *
 * 注意事项：
 * 1. 各引擎专有字段严格隔离，杜绝跨引擎字段污染或无类型限制的弱类型字典；
 * 2. 字段类型与命名需对齐最新官方接口协议，参数缺省值需符合后端行为预期。
 */

import type { EngineType, TransportMode } from './generation';

/**
 * 通用基础生图参数意图
 */
export interface BaseEngineTaskParams {
    /** 最终经过清洗与宏展开的正向提示词 */
    prompt: string;
    /** 负向提示词 (若引擎支持) */
    negativePrompt?: string;
    /** 网络传输模式偏好 */
    transport?: TransportMode;
}

/**
 * LoRA 格式化项引用结构
 */
export interface LoraItemReference {
    name: string;
    weight?: number;
    clipWeight?: number;
    triggerWeight?: number;
}

// 1. SD-WebUI / Forge 引擎原生数据结构

/**
 * SD-WebUI 发往 /sdapi/v1/txt2img 或 /sdapi/v1/img2img 的原生请求数据结构
 */
export interface SdWebUIRequestData extends BaseEngineTaskParams {
    readonly engine: 'sdwebui';
    /** 最终正向提示词 (包含嵌入的 <lora:name:weight> 标签) */
    prompt: string;
    /** 负向提示词 */
    negative_prompt: string;
    /** 图像像素宽度 */
    width: number;
    /** 图像像素高度 */
    height: number;
    /** 随机种子 (-1 为随机) */
    seed: number;
    /** 采样迭代步数 */
    steps: number;
    /** 提示词引导系数 (CFG Scale) */
    cfg_scale: number;
    /** 采样器名称 (如 'Euler a', 'DPM++ 2M Karras') */
    sampler_name: string;
    /** 调度器算法 (如 'Automatic', 'Karras') */
    scheduler?: string;
    /** 临时覆盖全局配置 (如临时 Checkpoint, VAE, ClipSkip) */
    override_settings?: Record<string, unknown>;
    /** 任务执行完毕后服务端自动复原全局配置 */
    override_settings_restore_afterwards?: boolean;
    /** 面部修复开关 */
    restore_faces?: boolean;
    /** 无缝贴图开关 */
    tiling?: boolean;
    /** 图生图输入图片 (Base64 字符串数组) */
    init_images?: string[];
    /** 图生图重绘去噪幅度 (0.0 ~ 1.0) */
    denoising_strength?: number;
    /** 局部重绘黑白蒙版 (Base64 字符串) */
    mask?: string;
    /** 蒙版羽化模糊半径 (像素) */
    mask_blur?: number;
    /** 蒙版区域填充模式 (0: fill, 1: original, 2: latent noise, 3: latent nothing) */
    inpainting_fill?: number;
    /** 是否全分辨率重绘 (inpaint_full_res) */
    inpaint_full_res?: boolean;
    /** 全分辨率重绘边缘预留填充像素 (inpaint_full_res_padding) */
    inpaint_full_res_padding?: number;
    /** 蒙版遮罩反转 (0: 重绘蒙版区, 1: 重绘蒙版外) */
    inpainting_mask_invert?: number;
    /** 高清修复选项 (可选) */
    enable_hr?: boolean;
    hr_upscaler?: string;
    hr_scale?: number;
    hr_second_pass_steps?: number;
    /** LoRA 引用列表 (用于前端传递与提示词格式化) */
    loras?: LoraItemReference[];
}

/**
 * SD-WebUI 服务端接口原生响应数据结构
 */
export interface SdWebUIResponseData {
    /** 生成的图片 Base64 字符串数组 (首项为主图) */
    images: string[];
    /** 服务端回显的请求参数字典 */
    parameters: Record<string, unknown>;
    /** 详细生成元数据 JSON 序列化文本 (包含真实种子、子种子、全量参数说明) */
    info: string;
}

/**
 * SD-WebUI /sdapi/v1/progress 进度接口响应数据结构
 */
export interface SdWebUIProgressData {
    progress: number;
    eta_relative: number;
    current_image?: string;
}

// 2. ComfyUI 引擎原生数据结构

/**
 * ComfyUI 节点输入字典
 */
export interface ComfyNodeInputs {
    [key: string]: string | number | boolean | [string, number] | unknown;
}

/**
 * ComfyUI API 格式单一节点定义
 */
export interface ComfyNode {
    class_type: string;
    inputs: ComfyNodeInputs;
    _meta?: { title?: string };
}

/**
 * ComfyUI 任务内部强类型参数结构 (由构建器组装交付适配器)
 */
export interface ComfyUITaskData extends BaseEngineTaskParams {
    readonly engine: 'comfyui';
    /** 基础正向提示词 */
    prompt: string;
    /** 负向提示词 */
    negativePrompt?: string;
    /** API 格式的工作流节点图模板定义 */
    workflow: Record<string, ComfyNode>;
    /** 工作流占位变量字典 (保持原生数值与字符串类型，杜绝引号污染) */
    variables: {
        seed: number;
        width: number;
        height: number;
        steps: number;
        cfg: number;
        sampler_name: string;
        scheduler: string;
        model_name?: string;
        [key: string]: string | number | undefined;
    };
    /** WeiLin 格式 LoRA 项列表 */
    loras?: LoraItemReference[];
}

/**
 * ComfyUI 发往 POST /prompt 的原生请求数据结构
 */
export interface ComfyUIRequestData {
    /** 客户端长连接会话标识符 */
    client_id: string;
    /** 已完成变量注入的纯净 API 节点结构字典 */
    prompt: Record<string, ComfyNode>;
    /** 附加元数据 (可选) */
    extra_data?: {
        extra_pnginfo?: Record<string, unknown>;
    };
}

/**
 * ComfyUI WebSocket 实时消息帧结构
 */
export type ComfyUIWsMessageData =
    | { type: 'status'; data: { status: { exec_info: { queue_remaining: number } } } }
    | { type: 'progress'; data: { value: number; max: number; prompt_id: string; node: string } }
    | { type: 'executing'; data: { node: string | null; prompt_id: string } }
    | { type: 'executed'; data: { node: string; prompt_id: string; output: { images?: Array<{ filename: string; subfolder: string; type: string }> } } }
    | { type: 'execution_error'; data: { prompt_id: string; node_id: string; exception_message: string } };

/**
 * ComfyUI GET /history/{promptId} 接口响应数据结构
 */
export interface ComfyUIHistoryResponseData {
    [promptId: string]: {
        prompt: [number, string, Record<string, ComfyNode>, Record<string, unknown>];
        outputs: Record<string, {
            images?: Array<{
                filename: string;
                subfolder: string;
                type: 'output' | 'temp';
            }>;
        }>;
        status: {
            status_str: 'success' | 'error';
            completed: boolean;
            messages?: unknown[];
        };
    };
}

// 3. NovelAI 引擎原生数据结构

/**
 * NovelAI 嵌套超参数对象
 */
export interface NovelAIParametersData {
    /** 宽度：强制 64 的整数倍 */
    width: number;
    /** 高度：强制 64 的整数倍 */
    height: number;
    /** CFG 引导系数 (NovelAI 原生协议字段名为 scale) */
    scale: number;
    /** 官方采样算法枚举 (如 'k_euler', 'k_euler_ancestral') */
    sampler: string;
    /** 采样步数 (默认 28) */
    steps: number;
    /** 随机种子 (正整数) */
    seed: number;
    /** 单次生成图片张数 (固定为 1) */
    n_samples: 1;
    /** 负向预设档位 (0 为用户自定义) */
    ucPreset: number;
    /** 质量增强词开关 */
    qualityToggle: boolean;
    /** 负向提示词 (传统字段兼容) */
    uc: string;
    /** 负向提示词 (标准字段) */
    negative_prompt: string;
    /** 可选进阶选项 */
    cfg_rescale?: number;
    smea?: boolean;
    smea_dyn?: boolean;
    decrisper?: boolean;
}

/**
 * NovelAI 发往 POST /ai/generate-image 的原生请求数据结构
 */
export interface NovelAIRequestData extends BaseEngineTaskParams {
    readonly engine: 'novelai';
    /** 正向提示词文本 */
    input: string;
    /** 目标模型标识符 (如 'nai-diffusion-4-5-full', 'nai-diffusion-4-curated-preview') */
    model: string;
    /** 请求动作，固定为 'generate' */
    action: 'generate';
    /** 嵌套生图超参数对象 */
    parameters: NovelAIParametersData;
}

// 4. OpenAI 兼容引擎原生数据结构

/**
 * OpenAI 兼容服务发往 POST /v1/images/generations 的原生请求数据结构
 * 彻底剔除 steps、cfgScale、sampler 等无效冗余字段
 */
export interface OpenAIRequestData extends BaseEngineTaskParams {
    readonly engine: 'openai';
    /** 提示词描述 */
    prompt: string;
    /** 模型标识符 (如 'dall-e-3', 'dall-e-2') */
    model: string;
    /** 格式化尺寸字符串 (如 '1024x1024', '1024x1792', '1792x1024') */
    size: string;
    /** 响应数据格式，固定为 'b64_json' */
    response_format: 'b64_json';
    /** 生成图片数量，固定为 1 */
    n: 1;
    /** DALL-E 3 画质档位 ('standard' | 'hd') */
    quality?: 'standard' | 'hd';
    /** DALL-E 3 艺术风格 ('vivid' | 'natural') */
    style?: 'vivid' | 'natural';
    /** 第三方代理服务商专属扩展参数 (可选) */
    [customKey: string]: unknown;
}

/**
 * OpenAI 兼容接口响应数据结构
 */
export interface OpenAIResponseData {
    created: number;
    data: Array<{
        /** Base64 编码图片数据 */
        b64_json?: string;
        /** 兼容部分代理服务商返回的临时下载 URL */
        url?: string;
        /** DALL-E 3 自动重写后的真实提示词 */
        revised_prompt?: string;
    }>;
}

// 5. 统一任务数据模型 (判别联合体 Discriminated Union)

/**
 * 任务调度队列与编排器执行的统一强类型判别联合体
 * 通过 engine 属性进行静态类型判别与分支匹配，彻底消除 extraParams 弱类型字典
 */
export type EngineGenerationTaskParams =
    | SdWebUIRequestData
    | ComfyUITaskData
    | NovelAIRequestData
    | OpenAIRequestData;
