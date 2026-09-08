/**
 * 生图引擎驱动契约与错误模型
 */

import { IDisposable } from './common';
import type { ImageMetadata } from './settings';

export type { ImageMetadata };

/**
 * 模型资产描述项
 */
export interface ModelAssetItem {
    /** 模型唯一标识/文件名 (如 moodyAnimaMix_v10.safetensors, v1-5-pruned-emaonly.safetensors) */
    name: string;
    /** 显示标题 (如 SD-WebUI 带 hash 的完整 title) */
    title?: string;
    /** 模型格式类型: checkpoint / unet / gguf / nf4 / diffusers 等 */
    type?: 'checkpoint' | 'unet' | 'gguf' | 'nf4' | 'diffusers' | string;
    /** 基础模型架构: sd15, sd21, sdxl, flux, sd3, pony, illustrious, qwen, wan 等 */
    architecture?: 'sd15' | 'sd21' | 'sdxl' | 'flux' | 'sd3' | 'pony' | 'illustrious' | 'qwen' | 'wan' | string;
    /** 模型哈希值 (可选) */
    hash?: string;
    /** 文件物理路径 (可选) */
    filename?: string;
}

/**
 * 生图后端资产目录（模型、采样器、调度算法与 LoRA 等）
 */
export interface ProviderAssetCatalog {
    models: Array<string | ModelAssetItem>;
    samplers?: string[];
    schedulers?: string[];
    loras?: string[];
    upscalers?: string[];
    vaes?: string[];
    clips?: string[];
}

/** 生图运行模式 */
export type GenerationMode = 'txt2img' | 'img2img' | 'inpaint';

/** 服务连通性检测结果 */
export interface HealthCheckResult {
    ok: boolean;
    latencyMs: number;
    message?: string;
    statusCode?: number;
}

/** 任务生成进度回调 (progress: 0 ~ 1, previewUrl: 实时预览图 Object URL) */
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

/** 驱动能力声明 */
export interface EngineCapabilities {
    readonly txt2img: boolean;
    readonly img2img: boolean;
    readonly lora?: boolean;
    readonly interrupt?: boolean;
    readonly syntaxType?: 'natural' | 'tagBased' | 'nodeGraph';
}

/**
 * 生图任务请求对象
 */
export interface GenerationRequest {
    readonly taskId: string;
    readonly targetEngine: string;
    readonly prompt: string;
    readonly negativePrompt?: string;
    readonly contextInfo?: {
        readonly characterId?: string | number;
        readonly characterName?: string;
        readonly userName?: string;
        readonly messageId?: number;
        readonly chatId?: string;
        readonly swipeId?: number;
        readonly buttonIndex?: number;
    };
    readonly imageInputs?: {
        readonly initImageBlob?: Blob;
        readonly maskImageBlob?: Blob;
        readonly referenceImageBlobs?: Blob[];
        readonly denoiseStrength?: number;
    };
    readonly engineOptions: Record<string, unknown>;
}

/**
 * 生图任务返回结果
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

/** 驱动错误类型 */
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

/**
 * 统一驱动异常类
 */
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
 * 生图引擎驱动契约接口
 * 各后端（ComfyUI, SD-WebUI, NovelAI, OpenAI）实现此接口，封装通信协议与数据格式转换
 */
export interface ImageEngineDriver extends IDisposable {
    readonly id: string;
    readonly name: string;
    readonly capabilities: EngineCapabilities;

    validateConfig?(config: unknown): Promise<{ valid: boolean; error?: string }>;
    syncAssets?(): Promise<ProviderAssetCatalog>;
    checkHealth(): Promise<HealthCheckResult>;
    generate(
        request: GenerationRequest,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult>;
    interrupt?(taskId?: string): Promise<void>;
    getAssetCatalog?(): ProviderAssetCatalog | null;
    isConnected?(): boolean;
    getNetworkClient?(): any;
}
