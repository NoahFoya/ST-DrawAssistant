/**
 * @module domain/types
 * @description 领域层数据模型、绘图驱动标准接口与异常类型定义
 */

import { IDisposable } from '../../common';
import { DrawAssistantSettings, ImageMetadata } from '../core/types';

export { IDisposable, DrawAssistantSettings, ImageMetadata };

/**
 * 生图任务请求数据结构
 * 承载用户意图与后端专有参数，由流水线组织后交付调度中心
 */
export interface GenerationRequest {
    /** 任务唯一标识 */
    readonly taskId: string;

    /** 目标绘图后端标识 (如 'comfyui' | 'sdwebui' | 'novelai' | 'cloud') */
    readonly targetEngine: string;

    /** 经语义整合后的正向提示词描述 (通用标准文本) */
    readonly prompt: string;

    /** 可选的负向提示词描述 */
    readonly negativePrompt?: string;

    /** 关联的会话上下文快照 (可选) */
    readonly contextInfo?: {
        characterId?: string | number;
        characterName?: string;
        messageId?: number;
        chatId?: string;
    };

    /** 关联的图像输入 (用于图生图、重绘蒙版与参考图) */
    readonly imageInputs?: {
        initImageBlob?: Blob;
        maskImageBlob?: Blob;
        referenceImageBlobs?: Blob[];
        denoiseStrength?: number;
    };

    /**
     * 当前后端的专属参数字典
     * 由前端根据用户当前所选引擎传入，直接交给对应引擎的驱动处理，上层逻辑不解析内部结构
     */
    readonly engineOptions: Record<string, unknown>;
}

/**
 * 生图任务统一返回结果
 */
export interface GenerationResult {
    readonly taskId: string;
    readonly engine: string;
    readonly images: Array<{
        blob: Blob;
        format: string;
        seed?: number;
        metadata?: Record<string, unknown>;
    }>;
    readonly durationMs: number;
}

/**
 * 生图后端可用资产目录 (由各驱动连接后端时动态获取与刷新)
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

/** 驱动层标准化错误类型枚举 */
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

/** 驱动层标准化异常类 */
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
 * 绘图引擎驱动标准接口
 * 调度中心统一面向此接口调用，具体后端的通信协议与专有参数由各驱动实现类自治
 */
export interface ImageEngineAdapter extends IDisposable {
    /** 驱动唯一标识 (如 'comfyui', 'sdwebui', 'novelai', 'cloud') */
    readonly id: string;
    /** 驱动显示名称 */
    readonly name: string;
    /** 驱动支持的能力特性声明 */
    readonly capabilities: EngineCapabilities;

    /** 校验专有配置项是否合法有效 */
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
