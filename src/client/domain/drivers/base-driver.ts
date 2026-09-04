/**
 * @module domain/drivers/base-driver
 * @description 生图后端适配器抽象基类
 *
 * 核心职责：
 * 1. 依托 NetworkClient 处理网络通信与协议分发（直连/代理）；
 * 2. 统一实现任务取消与外部 AbortSignal 协同；
 * 3. 集中化错误分类与异常归一化处理。
 */

import { blobToBase64, base64ToBlob } from '../../../common/utils/binary';
export { blobToBase64, base64ToBlob };
import { Logger } from '../../core/logger';
import { NetworkClient, HttpRequestOptions } from '../../core/network/client';
import { NetworkError } from '../../core/network/error';
import {
    ImageEngineAdapter,
    EngineCapabilities,
    GenerationRequest,
    GenerationResult,
    HealthCheckResult,
    ProviderAssetCatalog,
    ProgressCallback,
    DriverError,
    DriverErrorType
} from '../types';

export interface BaseDriverOptions {
    network: NetworkClient;
    driverName: string;
    getEndpointUrl?: () => string;
    baseUrl?: string;
}

/**
 * 生图驱动适配器基类
 * 负责通用网络通信、任务取消协同以及标准化错误转换
 */
export abstract class BaseDriver implements ImageEngineAdapter {
    public abstract readonly id: string;
    public abstract readonly name: string;
    public abstract readonly capabilities: EngineCapabilities;

    protected readonly network: NetworkClient;
    protected readonly logger: Logger;
    protected readonly getEndpointUrl: () => string;

    protected _cancelled = false;
    protected _isGenerating = false;
    protected _abortController: AbortController | null = null;
    protected _syncingPromise: Promise<ProviderAssetCatalog> | null = null;

    constructor(options: BaseDriverOptions) {
        this.network = options.network;
        this.logger = new Logger(options.driverName);
        this.getEndpointUrl = options.getEndpointUrl || (() => options.baseUrl || '');
    }

    /** 检测后端连通性 (实现类重写) */
    public abstract ping(): Promise<boolean>;

    /** 服务健康度检测与延迟统计 */
    public async checkHealth(): Promise<HealthCheckResult> {
        const startTime = performance.now();
        try {
            const ok = await this.ping();
            const latencyMs = Math.round(performance.now() - startTime);
            if (!ok) {
                return { ok: false, latencyMs, message: '服务未响应或返回异常状态' };
            }
            return { ok: true, latencyMs };
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - startTime);
            const statusCode = err instanceof DriverError
                ? err.statusCode
                : (err instanceof NetworkError ? err.status : undefined);
            return {
                ok: false,
                latencyMs,
                message: err?.message || '连接失败',
                statusCode
            };
        }
    }

    /**
     * 同步后端模型与可用资源列表
     */
    public async syncAssets(): Promise<ProviderAssetCatalog> {
        if (this._syncingPromise) {
            this.logger.debug('已有资源同步任务在执行中，复用在途请求');
            return this._syncingPromise;
        }

        this._syncingPromise = (async () => {
            try {
                return await this.doSyncAssets();
            } finally {
                this._syncingPromise = null;
            }
        })();

        return this._syncingPromise;
    }

    protected async doSyncAssets(): Promise<ProviderAssetCatalog> {
        return {
            models: []
        };
    }

    /**
     * 提交并执行生图请求
     *
     * @param request 生图请求对象
     * @param signalOrProgress 可选的中断信号或进度回调
     * @param onProgress 进度回调函数
     */
    public async generate(
        request: GenerationRequest,
        signalOrProgress?: AbortSignal | ProgressCallback,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        this.resetCancelState();
        this._isGenerating = true;
        let signal: AbortSignal | undefined;
        let progressCb: ProgressCallback | undefined;

        if (typeof signalOrProgress === 'function') {
            progressCb = signalOrProgress;
        } else if (signalOrProgress && typeof (signalOrProgress as any).addEventListener === 'function') {
            signal = signalOrProgress as AbortSignal;
            progressCb = onProgress;
        } else {
            progressCb = onProgress;
        }

        try {
            return await this.doGenerate(request, signal, progressCb);
        } finally {
            this._isGenerating = false;
        }
    }

    protected abstract doGenerate(
        request: GenerationRequest,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult>;

    /** 中断当前正在执行的生图请求 */
    public async interrupt(_taskId?: string): Promise<void> {
        this._cancelled = true;
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    /** 释放驱动持有的本地资源与监听句柄 */
    public dispose(): void {
        this._cancelled = true;
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    protected resetCancelState(): void {
        this._cancelled = false;
        this._abortController = new AbortController();
    }

    protected checkCancelled(): void {
        if (this._cancelled) {
            throw new DriverError(DriverErrorType.CANCELLED, '生图任务已被用户取消');
        }
    }

    public get baseUrl(): string {
        return this.getBaseUrl();
    }

    protected getBaseUrl(): string {
        const raw = this.getEndpointUrl();
        return (raw || '').replace(/\/+$/, '');
    }

    protected buildUrl(pathOrUrl: string): string {
        const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
        if (isAbsolute) return pathOrUrl;
        const base = this.getBaseUrl();
        const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
        return `${base}${cleanPath}`;
    }

    protected async getJson<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
        return this.requestJson<T>('GET', path, undefined, options);
    }

    protected async postJson<T>(path: string, body: unknown, options: HttpRequestOptions = {}): Promise<T> {
        return this.requestJson<T>('POST', path, body, options);
    }

    protected async getBlob(path: string, options: HttpRequestOptions = {}): Promise<Blob> {
        const url = this.buildUrl(path);
        const mergedSignal = this.composeWithCancelSignal(options.signal);

        try {
            const resp = await this.network.fetchExternal(url, {
                ...options,
                method: options.method || 'GET',
                signal: mergedSignal
            });

            if (!resp.ok) {
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `请求图像失败 [HTTP ${resp.status}] ${resp.statusText}`,
                    resp.status
                );
            }

            return await resp.blob();
        } catch (err) {
            throw this.normalizeError(err, url);
        }
    }

    protected async uploadFormData<T>(path: string, formData: FormData, options: HttpRequestOptions = {}): Promise<T> {
        const url = this.buildUrl(path);
        const mergedSignal = this.composeWithCancelSignal(options.signal);

        try {
            const resp = await this.network.fetchExternal(url, {
                ...options,
                method: 'POST',
                body: formData,
                signal: mergedSignal
            });

            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `上传数据失败 [HTTP ${resp.status}]: ${errText || resp.statusText}`,
                    resp.status,
                    errText
                );
            }

            return (await resp.json().catch(() => ({}))) as T;
        } catch (err) {
            throw this.normalizeError(err, url);
        }
    }

    private async requestJson<T>(
        method: string,
        path: string,
        body: unknown,
        options: HttpRequestOptions
    ): Promise<T> {
        const url = this.buildUrl(path);
        const mergedSignal = this.composeWithCancelSignal(options.signal);

        try {
            const hasBody = body !== undefined;
            const resp = await this.network.fetchExternal(url, {
                ...options,
                method,
                body: hasBody ? JSON.stringify(body) : undefined,
                headers: {
                    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
                    ...(options.headers as Record<string, string>)
                },
                signal: mergedSignal
            });

            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                let parsedErr: unknown = errText;
                try {
                    parsedErr = JSON.parse(errText);
                } catch {}

                let errorType = DriverErrorType.BACKEND_ERROR;
                if (resp.status === 401 || resp.status === 403) {
                    errorType = DriverErrorType.AUTHENTICATION_ERROR;
                } else if (resp.status === 404) {
                    errorType = DriverErrorType.NOT_FOUND;
                } else if (resp.status >= 400 && resp.status < 500) {
                    errorType = DriverErrorType.INVALID_PARAMS;
                }

                throw new DriverError(
                    errorType,
                    `后端服务返回错误 [HTTP ${resp.status}]: ${typeof parsedErr === 'string' ? parsedErr : JSON.stringify(parsedErr)}`,
                    resp.status,
                    parsedErr
                );
            }

            return (await resp.json()) as T;
        } catch (err) {
            throw this.normalizeError(err, url);
        }
    }

    /**
     * 将驱动内部的中断控制器信号与外部传入的父信号融合成单一下游信号
     */
    protected composeWithCancelSignal(parentSignal?: AbortSignal | null): AbortSignal | undefined {
        const mySignal = this._abortController?.signal;
        if (!mySignal && !parentSignal) return undefined;
        if (mySignal && !parentSignal) return mySignal;
        if (!mySignal && parentSignal) return parentSignal;

        const controller = new AbortController();
        const onAbort = () => controller.abort();

        if (mySignal!.aborted || parentSignal!.aborted) {
            controller.abort();
            return controller.signal;
        }

        mySignal!.addEventListener('abort', onAbort, { once: true });
        parentSignal!.addEventListener('abort', onAbort, { once: true });
        return controller.signal;
    }

    private normalizeError(err: unknown, targetUrl: string): Error {
        if (err instanceof DriverError) {
            return err;
        }

        if (this._cancelled) {
            return new DriverError(DriverErrorType.CANCELLED, '生图任务已被用户取消');
        }

        if (err instanceof NetworkError) {
            if (err.code === 'TIMEOUT') {
                return new DriverError(DriverErrorType.TIMEOUT, `请求后端服务超时 [${targetUrl}]`, 504, err);
            }
            if (err.code === 'SECURITY_BLOCKED' || err.status === 403) {
                return new DriverError(DriverErrorType.AUTHENTICATION_ERROR, `请求被安全策略拦截: ${err.message}`, 403, err);
            }
            return new DriverError(DriverErrorType.NETWORK_ERROR, `网络通信失败: ${err.message}`, err.status, err);
        }

        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('aborted') || msg.includes('AbortError')) {
            return new DriverError(DriverErrorType.CANCELLED, '请求已中止');
        }

        return new DriverError(DriverErrorType.UNKNOWN, msg, undefined, err);
    }
}

