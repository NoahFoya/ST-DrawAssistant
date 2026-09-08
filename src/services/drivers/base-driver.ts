/**
 * 生图引擎驱动抽象基类
 * 封装浏览器直连请求、任务取消信号管理与错误模型转换。
 */

import { Logger } from '../../utils/logger';
import { NetworkClient, HttpRequestOptions } from '../network/client';
import { NetworkError } from '../network/error';
import {
    ImageEngineDriver,
    EngineCapabilities,
    GenerationRequest,
    GenerationResult,
    HealthCheckResult,
    ProviderAssetCatalog,
    ProgressCallback,
    DriverError,
    DriverErrorType
} from '../../types/driver';

export interface BaseDriverOptions {
    network: NetworkClient;
    driverName: string;
    getEndpointUrl?: () => string;
    baseUrl?: string;
    /** 动态读取引擎配置。子类发起请求时实时调用，避免用户在界面修改参数后因持有旧配置快照而需要刷新页面 */
    getConfig?: () => Record<string, unknown> | undefined;
    /** 静态配置（用于单测或独立实例化，存在 getConfig 时优先使用闭包） */
    defaultConfig?: Record<string, unknown>;
}

export interface DriverRequestOptions extends HttpRequestOptions {
    /** 是否跳过驱动内部当前任务的取消信号融合（用于 interrupt 等控制请求，防止因任务已中止导致请求无法送达后端） */
    skipTaskCancelSignal?: boolean;
}

export function extractStatusCode(err: unknown): number | undefined {
    if (!err || typeof err !== 'object') return undefined;
    if ('statusCode' in err && typeof (err as any).statusCode === 'number') {
        return (err as any).statusCode;
    }
    if ('status' in err && typeof (err as any).status === 'number') {
        return (err as any).status;
    }
    return undefined;
}

export abstract class BaseDriver implements ImageEngineDriver {
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
    protected _cachedCatalog: ProviderAssetCatalog | null = null;
    protected _isConnected = false;

    constructor(options: BaseDriverOptions) {
        this.network = options.network;
        this.logger = new Logger(options.driverName);
        this.getEndpointUrl = options.getEndpointUrl || (() => options.baseUrl || '');
        this._getConfig = options.getConfig ?? (options.defaultConfig ? () => options.defaultConfig : undefined);
    }

    public getAssetCatalog(): ProviderAssetCatalog | null {
        return this._cachedCatalog;
    }

    public isConnected(): boolean {
        return this._isConnected;
    }

    public setConnected(connected: boolean): void {
        this._isConnected = connected;
    }

    public getNetworkClient(): NetworkClient {
        return this.network;
    }

    public abstract checkHealth(): Promise<HealthCheckResult>;

    public async ping(): Promise<boolean> {
        try {
            const res = await this.checkHealth();
            this._isConnected = res.ok;
            return res.ok;
        } catch {
            this._isConnected = false;
            return false;
        }
    }

    public async syncAssets(): Promise<ProviderAssetCatalog> {
        if (this._syncingPromise) {
            this.logger.debug('已有资源同步任务在执行中，复用正在进行的请求');
            return this._syncingPromise;
        }

        this._syncingPromise = (async () => {
            try {
                const catalog = await this.doSyncAssets();
                this._cachedCatalog = catalog;
                this._isConnected = true;
                return catalog;
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

    public async interrupt(_taskId?: string): Promise<void> {
        this._cancelled = true;
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

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

    protected async getJson<T>(path: string, options: DriverRequestOptions = {}): Promise<T> {
        return this.requestJson<T>('GET', path, undefined, options);
    }

    protected async postJson<T>(path: string, body: unknown, options: DriverRequestOptions = {}): Promise<T> {
        return this.requestJson<T>('POST', path, body, options);
    }

    /**
     * 发送控制请求（如 /interrupt 或取消排队）。
     * 显式跳过当前任务的取消信号，确保在生图任务已处于中止状态时，中断请求仍能送达后端。
     */
    protected async postControlJson<T>(path: string, body: unknown, options: DriverRequestOptions = {}): Promise<T> {
        return this.requestJson<T>('POST', path, body, {
            ...options,
            skipTaskCancelSignal: true
        });
    }

    protected async getBlob(path: string, options: DriverRequestOptions = {}): Promise<Blob> {
        const url = this.buildUrl(path);
        const mergedSignal = options.skipTaskCancelSignal ? options.signal : this.composeWithCancelSignal(options.signal);

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

    protected async uploadFormData<T>(path: string, formData: FormData, options: DriverRequestOptions = {}): Promise<T> {
        const url = this.buildUrl(path);
        const mergedSignal = options.skipTaskCancelSignal ? options.signal : this.composeWithCancelSignal(options.signal);

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
        options: DriverRequestOptions
    ): Promise<T> {
        const url = this.buildUrl(path);
        const mergedSignal = options.skipTaskCancelSignal ? options.signal : this.composeWithCancelSignal(options.signal);

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
     * 将驱动内部中断信号与外部传入信号融合。
     * 优先使用原生 AbortSignal.any，避免长期持有外部信号监听器导致内存泄漏。
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

        if (err instanceof NetworkError) {
            if (err.code === 'TIMEOUT') {
                return new DriverError(DriverErrorType.TIMEOUT, `请求后端服务超时 [${targetUrl}]`, 504, err);
            }
            if (err.code === 'SECURITY_BLOCKED' || err.status === 403) {
                return new DriverError(DriverErrorType.AUTHENTICATION_ERROR, `请求被安全策略拦截: ${err.message}`, 403, err);
            }
            return new DriverError(DriverErrorType.NETWORK_ERROR, `网络通信失败: ${err.message}`, err.status, err);
        }

        const errObj = err as any;
        if (errObj?.name === 'TimeoutError' || errObj?.code === 'ETIMEDOUT' || errObj?.code === 'TIMEOUT') {
            return new DriverError(DriverErrorType.TIMEOUT, `请求后端服务超时 [${targetUrl}]`, 504, err);
        }

        if (this._cancelled) {
            return new DriverError(DriverErrorType.CANCELLED, '生图任务已被用户取消');
        }

        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('aborted') || msg.includes('AbortError')) {
            return new DriverError(DriverErrorType.CANCELLED, '请求已中止');
        }

        return new DriverError(DriverErrorType.UNKNOWN, msg, undefined, err);
    }
}
