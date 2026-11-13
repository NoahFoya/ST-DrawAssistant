/**
 * 绘图服务提供方与通信协议接口定义。
 *
 * @remarks
 * 绘图服务提供方统一接口定义。
 * 主流程通过通用请求与提供方交互，具体协议细节由各提供方实现封装。
 */

import type { ImageGenerationMetadata } from './st/chat';

/** 绘图服务提供方类型标识 */
export type ProviderType = 'sdwebui' | 'comfyui' | 'novelai' | 'openai';

/** 请求传输模式：direct 为浏览器直连，relay 为宿主后端中继 */
export type TransportMode = 'direct' | 'relay';

/**
 * 单次调用的可选覆盖参数。
 */
export interface GenerationParameters {
    /** 生图模式：文生图 txt2img 或 局部重绘 inpaint */
    mode?: 'txt2img' | 'inpaint';
    /** 局部重绘遮罩蒙版（Blob 二进制流或 Base64 字符串，白色重绘，黑色保留） */
    maskImage?: Blob | string;
    /** 重绘幅度 (去噪强度，0.10 ~ 1.00) */
    denoiseStrength?: number;
    /** 蒙版边缘羽化半径 (0 ~ 32) */
    maskBlur?: number;
    /** 指定的局部重绘预设标识符 */
    inpaintPresetId?: string;
    /** 随机种子覆盖 */
    seed?: number;
    /** 采样步数覆盖 */
    steps?: number;
    /** 提示词引导系数 CFG Scale 覆盖 */
    cfgScale?: number;
    /** 采样器名称覆盖 */
    samplerName?: string;
    /** 调度器名称覆盖 */
    scheduler?: string;
    /** 画幅宽度覆盖 */
    width?: number;
    /** 画幅高度覆盖 */
    height?: number;
    /** 附加变量字典 */
    variables?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * 主流程发起的通用绘图请求数据。
 *
 * @remarks
 * 聚焦承载单次生图的核心即时意图（提示词、可选底图与蒙版等）。
 * 尺寸、步数、采样器、模型及工作流模板等常规超参数由各 Provider 每次生成时从配置中心加载其激活的参数预设；
 * parameters 仅用于指令中极少数的单次覆盖项（如指定种子、局部重绘等），无需传递常规超参数字典。
 */
export interface GenerationRequest {
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本 */
    readonly negativePrompt?: string;
    /** 图生图或局部重绘时的底图数据（Blob 二进制流或 Base64 字符串） */
    readonly sourceImage?: Blob | string;
    /** 局部重绘遮罩蒙版（Blob 二进制流或 Base64 字符串，白色重绘，黑色保留） */
    readonly maskImage?: Blob | string;
    /** 单次调用的可选覆盖参数，常规超参数优先从预设加载 */
    readonly parameters?: GenerationParameters;
}

/**
 * 绘图服务提供方返回的生成结果。
 *
 * @remarks
 * 包含生成的二进制图像数据与本次生成实际生效的技术参数快照。
 */
export interface GenerationResult {
    /** 图像二进制 Blob 数据 */
    readonly blob: Blob;
    /** 图像生成技术参数快照，用于写入资产记录与详情展示 */
    readonly metadata: ImageGenerationMetadata;
    /** 图像 Base64 文本 */
    readonly base64?: string;
}

/** 绘图服务提供方健康状态检查结果 */
export interface ProviderHealthResult {
    /** 连通状态 */
    readonly status: 'ok' | 'error';
    /** 响应耗时，单位毫秒 */
    readonly latencyMs?: number;
    /** 状态说明或版本信息 */
    readonly message?: string;
}

/** 绘图服务提供方本地持久化资产缓存模型 */
export interface ProviderAssetCache {
    /** 检查点主模型列表 */
    readonly checkpoints?: string[];
    /** ComfyUI UNet 模型列表 */
    readonly unets?: string[];
    /** VAE 模型列表 */
    readonly vaes?: string[];
    /** CLIP 模型列表 */
    readonly clips?: string[];
    /** LoRA 模型列表 */
    readonly loras?: string[];
    /** 采样器列表 */
    readonly samplers?: string[];
    /** 调度器列表 */
    readonly schedulers?: string[];
    /** 缓存最后更新时间戳 (毫秒) */
    readonly updatedAt?: number;
    /** 服务端指纹或特征版本 */
    readonly serverSignature?: string;
}

/** 单个服务商/端点独立暂存的连接信息与资产缓存快照 */
export interface CommonServiceProfile {
    /** 服务端基础接口地址 */
    readonly serverUrl?: string;
    /** 访问认证密钥 */
    readonly apiKey?: string;
    /** 该服务商最近一次拉取的模型与资产缓存 */
    readonly assetCache?: ProviderAssetCache;
}

/** 绘图服务提供方在配置中心统一持久化的连接与预设引用数据 */
export interface ProviderStoredConfig {
    /** 当前生效的服务端基础接口地址 */
    readonly serverUrl?: string;
    /** 当前生效的访问认证密钥 */
    readonly apiKey?: string;
    /** 当前选用的服务商模板标识 */
    readonly serviceId?: string;
    /** 当前激活的绘图预设 ID */
    readonly activeDrawingPresetId?: string;
    /** 当前生效的服务端资产本地持久化缓存 */
    readonly assetCache?: ProviderAssetCache;
    /** 各服务商切换时暂存的连接信息与模型缓存映射字典 */
    readonly serviceProfiles?: Record<string, CommonServiceProfile>;
}

/**
 * 绘图服务提供方标准接口。
 *
 * @remarks
 * 包含 SD-WebUI、ComfyUI、NovelAI 及 OpenAI 兼容服务等具体实现。
 */
export interface GenerationProvider {
    /** 绘图服务提供方唯一类型标识 */
    readonly providerType: ProviderType;
    /** 绘图服务提供方显示名称 */
    readonly name: string;

    /**
     * 执行图像生成
     * @param request 通用绘图请求
     * @param signal 中止信号
     */
    generate(
        request: GenerationRequest,
        signal?: AbortSignal
    ): Promise<GenerationResult>;

    /**
     * 检查后端服务连通性
     * @param signal 中止信号
     */
    checkHealth?(signal?: AbortSignal): Promise<ProviderHealthResult>;

    /**
     * 获取后端支持的模型列表
     * @param signal 中止信号
     */
    fetchModels?(signal?: AbortSignal): Promise<string[]>;

    /**
     * 获取按类别分组的主模型列表 (可选)
     * @param signal 中止信号
     */
    fetchCategorizedModels?(
        signal?: AbortSignal
    ): Promise<{ checkpoints: string[]; unets: string[] }>;

    /**
     * 获取后端支持的 VAE 编解码器列表 (可选)
     * @param signal 中止信号
     */
    fetchVaes?(signal?: AbortSignal): Promise<string[]>;

    /**
     * 获取后端支持的 CLIP 文本编码器列表 (可选)
     * @param signal 中止信号
     */
    fetchClips?(signal?: AbortSignal): Promise<string[]>;

    /**
     * 获取后端支持的采样器算法列表 (可选)
     * @param signal 中止信号
     */
    fetchSamplers?(signal?: AbortSignal): Promise<string[]>;

    /**
     * 获取后端支持的采样调度器规则列表 (可选)
     * @param signal 中止信号
     */
    fetchSchedulers?(signal?: AbortSignal): Promise<string[]>;

    /**
     * 获取后端已就绪的 LoRA 模型列表 (可选)
     * @param signal 中止信号
     */
    fetchLoras?(signal?: AbortSignal): Promise<string[]>;

    /**
     * 清理后端资产或对象元数据内存缓存 (可选能力)
     *
     * @remarks
     * 用户在设置面板显式点击“获取模型列表”时调用，
     * 清空当前提供方实例在内存中驻留的资产短时缓存与单飞状态，
     * 确保下一次资产读取直接向服务端发起真实网络请求。
     */
    clearAssetCache?(): void;
}

/** 绘图服务提供方注册与检索中心接口 */
export interface ProviderRegistry {
    /** 根据类型标识获取已注册的绘图服务提供方实例 */
    getProvider(type: ProviderType): GenerationProvider | undefined;
    /** 注册绘图服务提供方实例 */
    registerProvider(provider: GenerationProvider): void;
    /** 获取所有已就绪的绘图服务提供方标识列表 */
    getAvailableTypes(): ProviderType[];
}
