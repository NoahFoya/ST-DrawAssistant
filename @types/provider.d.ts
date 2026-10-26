/**
 * 绘图服务提供方与通信协议接口定义。
 *
 * @remarks
 * 绘图服务提供方统一接口定义。
 * 主流程通过通用请求与提供方交互，具体协议细节由各提供方实现封装。
 */

import type { TaskProgressCallback } from './task';
import type { ImageGenerationMetadata } from './st/chat';

/** 绘图服务提供方类型标识 */
export type ProviderType = 'sdwebui' | 'comfyui' | 'novelai' | 'openai';

/** 请求传输模式：direct 为浏览器直连，relay 为宿主后端中继 */
export type TransportMode = 'direct' | 'relay';

/**
 * 主流程发起的通用绘图请求数据。
 *
 * @remarks
 * 聚焦承载单次生图的核心即时意图（提示词与可选原图等）。
 * 尺寸、步数、采样器、模型及工作流模板等常规超参数由各 Provider 每次生成时从配置中心加载其激活的参数预设；
 * parameters 仅用于指令中极少数的临时覆盖项（如指定种子），无需传递常规超参数字典。
 */
export interface GenerationRequest {
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本 */
    readonly negativePrompt?: string;
    /** 图生图或图像变换时的原图数据（Blob 二进制流或 Base64 字符串） */
    readonly sourceImage?: Blob | string;
    /** 单次任务的可选临时覆盖参数（如特定 seed），常规超参数优先从预设加载 */
    readonly parameters?: Record<string, unknown>;
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
     * @param onProgress 进度更新回调
     * @param signal 中止信号
     */
    generate(
        request: GenerationRequest,
        onProgress?: TaskProgressCallback,
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
