/**
 * @module domain/drivers/base-driver
 * @description 生图驱动抽象基类 (BaseDriver) 与统一异常模型 (DriverError)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { Logger } from '../../core/diagnostics/logger';
import { IDrawDriver, GenerationPayload, DriverBuildPayloadOptions, DriverAssetSyncResult } from './driver-contract';
export declare enum DriverErrorType {
    NETWORK_ERROR = "NETWORK_ERROR",
    TIMEOUT = "TIMEOUT",
    BACKEND_ERROR = "BACKEND_ERROR",
    INVALID_PARAMS = "INVALID_PARAMS",
    CANCELLED = "CANCELLED",
    AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
    NOT_FOUND = "NOT_FOUND",
    UNKNOWN = "UNKNOWN"
}
/** 驱动层统一业务异常 */
export declare class DriverError extends Error {
    readonly type: DriverErrorType;
    readonly statusCode?: number;
    readonly details?: unknown;
    constructor(type: DriverErrorType, message: string, statusCode?: number, details?: unknown);
}
/** 后端驱动基类 (封装通用 HTTP 请求、超时控制与任务取消机制) */
export declare abstract class BaseDriver implements IDrawDriver {
    abstract readonly id: string;
    abstract readonly name: string;
    protected readonly store: ObservableStore<DrawAssistantSettings>;
    protected readonly logger: Logger;
    protected _cancelled: boolean;
    protected _abortController: AbortController | null;
    constructor(store: ObservableStore<DrawAssistantSettings>, driverName: string);
    abstract ping(): Promise<boolean>;
    /** 检查后端连通性并返回耗时与状态 (无额外自定义 Header，杜绝 CORS Preflight 失败) */
    checkConnection(): Promise<{
        connected: boolean;
        latencyMs?: number;
        error?: string;
    }>;
    abstract formatPrompt(rawPrompt: string): string;
    /** 适配目标后端的 LoRA 标签语法 (通用基类默认实现) */
    formatLoraTag(lora: {
        name: string;
        weight?: number;
        clipWeight?: number;
        textWeight?: number;
        triggerWeight?: number;
    }): string;
    /** 同步拉取后端全量模型与 LoRA 资产并批量缓存至 Store (基类默认实现) */
    syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult>;
    abstract buildPayload(options: DriverBuildPayloadOptions): GenerationPayload;
    abstract generate(payload: GenerationPayload, onProgress: (progress: {
        percent: number;
        nodeName?: string;
        previewBlob?: Blob;
    }) => void): Promise<{
        imageBlobs: Blob[];
        metadata: Record<string, unknown>;
    }>;
    getModels(): Promise<string[]>;
    getSamplers(): Promise<string[]>;
    getSchedulers(): Promise<string[]>;
    getClips(): Promise<string[]>;
    getVaes(): Promise<string[]>;
    getLoras(): Promise<string[]>;
    protected resetCancelState(): void;
    protected checkCancelled(): void;
    protected abstract getEndpointUrl(): string;
    protected getBaseUrl(): string;
    /** 构建目标请求 URL (支持同源服务端代理模式) */
    protected buildUrl(path: string): string;
    interrupt(): Promise<void>;
    dispose(): void;
    protected getJson<T = unknown>(path: string, timeoutMs?: number, headers?: Record<string, string>): Promise<T>;
    protected getBlob(path: string, timeoutMs?: number): Promise<Blob>;
    protected postJson<T = unknown>(path: string, body: unknown, timeoutMs?: number, headers?: Record<string, string>): Promise<T>;
    /** 核心 HTTP 请求底层管道 (集成 AbortSignal 超时与自定义取消控制) */
    protected request<T>(method: string, path: string, body?: unknown, timeoutMs?: number, customHeaders?: Record<string, string>): Promise<T>;
    /** 将 Blob 二进制转为 Base64 字符串 */
    protected blobToBase64(blob: Blob): Promise<string>;
    /** 将 Base64 字符串解码为 Blob */
    protected base64ToBlob(base64: string, mimeType?: string): Blob;
}
//# sourceMappingURL=base-driver.d.ts.map