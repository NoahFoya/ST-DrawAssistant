/**
 * @module domain/types
 * @description 领域数据类型、绘图驱动接口与异常类型定义
 */

import { IDisposable } from '../../common';
import {
    DrawAssistantSettings,
    ImageMetadata,
    GenerationRequest,
    GenerationResult,
    TaskStatus
} from '../core/types';

export {
    IDisposable,
    DrawAssistantSettings,
    ImageMetadata,
    GenerationRequest,
    GenerationResult,
    TaskStatus
};

/**
 * 生图后端可用资源信息 (包含模型、采样器、调度器、LoRA 等)
 */
export interface ProviderAssetCatalog {
    /** 可选 Checkpoint 模型列表 */
    models: string[];
    /** 可用采样算法列表 */
    samplers?: string[];
    /** 可用调度算法列表 */
    schedulers?: string[];
    /** 本地已安装的 LoRA 列表 */
    loras?: string[];
    /** 可用放大算法列表 */
    upscalers?: string[];
}

/** 生图运行模式 */
export type GenerationMode = 'txt2img' | 'img2img' | 'inpaint';

/** 服务连通性与响应耗时检测结果 */
export interface HealthCheckResult {
    ok: boolean;
    latencyMs: number;
    message?: string;
    statusCode?: number;
}

/** 执行进度回调函数签名 */
export type ProgressCallback = (progress: number, previewUrl?: string) => void;

/** LoRA 描述项 */
export interface LoraItem {
    name: string;
    weight?: number;
    clipWeight?: number;
    textWeight?: number;
    triggerWeight?: number;
    enabled?: boolean;
}

/** 绘图驱动支持能力声明 */
export interface EngineCapabilities {
    /** 是否支持文生图 */
    readonly txt2img: boolean;
    /** 是否支持图生图或重绘 */
    readonly img2img: boolean;
    /** 是否支持 LoRA 模型语法 */
    readonly lora?: boolean;
    /** 是否支持基于 WebSocket 的进度监听 */
    readonly progressWebSocket?: boolean;
    /** 是否支持向后端发送取消中断信号 */
    readonly interrupt?: boolean;
    /** 提示词语法偏好: natural (自然语言) | tagBased (标签加权) | nodeGraph (节点工作流) */
    readonly syntaxType?: 'natural' | 'tagBased' | 'nodeGraph';
}

/** 驱动错误类型枚举 */
export enum DriverErrorType {
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',
    BACKEND_ERROR = 'BACKEND_ERROR',
    INVALID_PARAMS = 'INVALID_PARAMS',
    CANCELLED = 'CANCELLED',
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
    NOT_FOUND = 'NOT_FOUND',
    UNKNOWN = 'UNKNOWN'
}

/** 驱动异常类 */
export class DriverError extends Error {
    public readonly type: DriverErrorType;
    public readonly statusCode?: number;
    public readonly details?: unknown;

    constructor(type: DriverErrorType, message: string, statusCode?: number, details?: unknown) {
        super(message);
        this.name = 'DriverError';
        this.type = type;
        this.statusCode = statusCode;
        this.details = details;
    }
}

/**
 * 绘图引擎驱动接口
 * 任务管理器统一面向此接口调用，具体后端的通信协议与特定参数由各驱动实现类自行处理
 */
export interface ImageEngineAdapter extends IDisposable {
    /** 驱动唯一标识 (如 'comfyui', 'sdwebui', 'novelai', 'cloud') */
    readonly id: string;
    /** 驱动显示名称 */
    readonly name: string;
    /** 驱动支持的能力特性声明 */
    readonly capabilities: EngineCapabilities;

    /** 校验配置项是否合法有效 */
    validateConfig?(config: unknown): Promise<{ valid: boolean; error?: string }>;

    /** 同步获取后端的可用模型与算法列表 */
    syncAssets?(): Promise<ProviderAssetCatalog>;

    /** 服务连通性与网络延迟探测 */
    checkHealth(): Promise<HealthCheckResult>;

    /** 提交并执行生图请求 */
    generate(
        request: GenerationRequest,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult>;

    /** 取消当前正在执行的任务 (可选支持) */
    interrupt?(taskId?: string): Promise<void>;
}
