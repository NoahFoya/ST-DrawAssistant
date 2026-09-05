/**
 * @module domain/drivers/base-driver
 * @description 生图后端适配器基类
 *
 * 1. 封装通用的网络请求（支持直连或代理）；
 * 2. 统一支持任务取消（AbortSignal）；
 * 3. 统一处理并转换各类网络和业务错误。
 */

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
    /** 运行时动态读取引擎配置的闭包，替代构造时的一次性快照。
     * 子类在 doGenerate / checkHealth 等方法中通过 this._getConfig?.() 读取当前配置，
     * 确保用户在 UI 修改引擎参数后不需刷新就能即时生效。 */
    getConfig?: () => Record<string, unknown> | undefined;
    /** 静态配置（可选，便于单测或独立实例化，存在 getConfig 时优先使用闭包） */
    defaultConfig?: Record<string, unknown>;
}

/**
 * 生图驱动适配器基类
 * 负责网络通信、任务取消与错误转换
 */
export abstract class BaseDriver implements ImageEngineAdapter {
    public abstract readonly id: string;
    public abstract readonly name: string;
    public abstract readonly capabilities: EngineCapabilities;

    protected readonly network: NetworkClient;
    protected readonly logger: Logger;
    protected readonly getEndpointUrl: () => string;
    protected readonly _getConfig: (() => Record<string, unknown> | undefined) | undefined;

    protected _cancelled = false;
    protected _isGenerating = false;
    protected _abortController: AbortController | null = null;
    protected _syncingPromise: Promise<ProviderAssetCatalog> | null = null;

    constructor(options: BaseDriverOptions) {
        this.network = options.network;
        this.logger = new Logger(options.driverName);
        this.getEndpointUrl = options.getEndpointUrl || (() => options.baseUrl || '');
        this._getConfig = options.getConfig ?? (options.defaultConfig ? () => options.defaultConfig : undefined);
    }

    /** 检测服务连通性与响应耗时 */
    public abstract checkHealth(): Promise<HealthCheckResult>;

    /** 检测后端连通性 */
    public async ping(): Promise<boolean> {
        try {
            const res = await this.checkHealth();
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * 同步后端模型与可用资源列表
     */
    public async syncAssets(): Promise<ProviderAssetCatalog> {
        if (this._syncingPromise) {
            this.logger.debug('已有资源同步任务在执行中，复用正在进行的请求');
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
     * @param signal 可选的中断信号
     * @param onProgress 进度回调函数
     */
    public async generate(
        request: GenerationRequest,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        this.resetCancelState();
        this._isGenerating = true;
        try {
            return await this.doGenerate(request, signal, onProgress);
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

    /** 释放驱动持有的资源 */
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

            return (await resp.json()) as T;
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
     * 优先使用原生 AbortSignal.any 规范方案，规避长时间持有父信号导致的事件监听器泄漏
     */
    protected composeWithCancelSignal(parentSignal?: AbortSignal | null): AbortSignal | undefined {
        const mySignal = this._abortController?.signal;
        if (!mySignal && !parentSignal) return undefined;
        if (mySignal && !parentSignal) return mySignal;
        if (!mySignal && parentSignal) return parentSignal;

        if (typeof (AbortSignal as any).any === 'function') {
            return (AbortSignal as any).any([mySignal, parentSignal]);
        }

        const controller = new AbortController();
        if (mySignal!.aborted || parentSignal!.aborted) {
            controller.abort();
            return controller.signal;
        }

        const onAbort = () => controller.abort();
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

