/**
 * 绘图服务提供方与通信协议接口定义。
 *
 * @remarks
 * 采用服务提供方模式 Provider Pattern，为主流程对接异构绘图服务提供统一定义。
 * 主流程向绘图服务提供方传递通用绘图请求，各提供方自包含管理自身私有配置与协议细节。
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
 * 仅包含指令中提取的通用提示词文本与基本环境配置，不包含特定服务提供方的私有超参数。
 */
export interface GenerationRequest {
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本 */
    readonly negativePrompt?: string;
    /** 请求传输模式，缺省使用当前全局设置 */
    readonly transport?: TransportMode;
    /** 针对当前任务的临时覆盖参数，由各 Provider 自行解析 */
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
     * 中断正在执行的生成任务
     */
    interrupt?(): Promise<void>;

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
