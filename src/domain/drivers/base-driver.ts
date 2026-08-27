/**
 * @module domain/drivers/base-driver
 * @description 生图驱动抽象基类 (BaseDriver) 与统一异常模型 (DriverError)
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    LoraItem,
    DEFAULT_HTTP_TIMEOUT_MS,
    DEFAULT_DOWNLOAD_TIMEOUT_MS,
    Logger,
    IDrawDriver,
    GenerationPayload,
    DriverBuildPayloadOptions,
    DriverAssetSyncResult,
    DriverCapabilities
} from '../../core';

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

/** 驱动层统一业务异常 */
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

/** 后端驱动基类 (封装通用 HTTP 请求、超时控制与任务取消机制) */
export abstract class BaseDriver implements IDrawDriver {
    public abstract readonly id: string;
    public abstract readonly name: string;
    public abstract readonly capabilities: DriverCapabilities;

    protected readonly store: ObservableStore<DrawAssistantSettings>;
    protected readonly logger: Logger;

    protected _cancelled = false;
    protected _abortController: AbortController | null = null;

    constructor(store: ObservableStore<DrawAssistantSettings>, driverName: string) {
        this.store = store;
        this.logger = new Logger(driverName);
    }

    public abstract ping(): Promise<boolean>;

    /** 检查后端连通性并返回耗时与状态 (无额外自定义 Header，杜绝 CORS Preflight 失败) */
    public async checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
        const startTime = performance.now();
        try {
            const ok = await this.ping();
            const latencyMs = Math.round(performance.now() - startTime);
            return { connected: ok, latencyMs };
        } catch (err: any) {
            return { connected: false, error: err?.message || '连接失败' };
        }
    }

    public abstract formatPrompt(rawPrompt: string): string;

    /** 适配目标后端的 LoRA 标签语法 (通用基类默认实现) */
    public formatLoraTag(lora: LoraItem): string {
        const cleanName = (lora.name || '').replace(/\.(safetensors|pt|ckpt|pth)$/i, '');
        if (!cleanName) return '';
        const weight = lora.weight ?? 1.0;
        return `<lora:${cleanName}:${weight}>`;
    }

    /** 同步拉取后端全量模型与 LoRA 资产并批量缓存至 Store (基类默认实现) */
    public async syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult> {
        const models = await this.getModels();
        if (models.length > 0) store.set('cachedModels', models);
        return {
            updatedCount: models.length,
            summary: `已成功自动更新：${models.length} 个模型。`,
            details: { models: models.length }
        };
    }

    /**
     * 根据当前引擎设置组装生图载荷 (GenerationPayload)
     *
     * @param options 参数组装选项
     * @returns 统一生图请求载荷
     */
    public abstract buildPayload(options: DriverBuildPayloadOptions): GenerationPayload;

    /**
     * 执行生图流程：统一处理取消状态重置并调用底层 doGenerate 实现
     *
     * @param payload 统一生图请求数据 (txt2img / inpaint)
     * @returns 生成的图像 Blob 数组与元数据
     */
    public async generate(
        payload: GenerationPayload
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        this.resetCancelState();
        return this.doGenerate(payload);
    }

    /**
     * 各生图引擎专属的底层生图实现
     *
     * @param payload 统一生图请求数据
     */
    protected abstract doGenerate(
        payload: GenerationPayload
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }>;

    public async getModels(): Promise<string[]> { return []; }
    public async getSamplers(): Promise<string[]> { return []; }
    public async getSchedulers(): Promise<string[]> { return []; }
    public async getClips(): Promise<string[]> { return []; }
    public async getVaes(): Promise<string[]> { return []; }
    public async getLoras(): Promise<string[]> { return []; }

    protected resetCancelState(): void {
        this._cancelled = false;
        this._abortController = new AbortController();
    }

    protected checkCancelled(): void {
        if (this._cancelled) {
            throw new DriverError(DriverErrorType.CANCELLED, '生图任务已被用户取消');
        }
    }

    protected abstract getEndpointUrl(): string;

    protected getBaseUrl(): string {
        const rawUrl = this.getEndpointUrl();
        return (rawUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    }

    /** 构建目标请求 URL (支持相对路径、绝对 URL 与同源服务端代理模式) */
    protected buildUrl(pathOrUrl: string): string {
        const settings = this.store.getState();
        const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
        const targetUrl = isAbsolute
            ? pathOrUrl
            : `${this.getBaseUrl()}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;

        if (settings.requestMode === 'server') {
            return `/api/plugins/st-drawassistant/proxy?target=${encodeURIComponent(targetUrl)}`;
        }

        return targetUrl;
    }

    public async interrupt(): Promise<void> {
        this._cancelled = true;
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    public dispose(): void {
        void this.interrupt();
    }

    protected async getJson<T = unknown>(path: string, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, headers?: Record<string, string>): Promise<T> {
        return this.request<T>('GET', path, undefined, timeoutMs, headers);
    }

    /**
     * 创建级联超时与父级中断的 AbortSignal
     */
    private _createScopedSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
        const controller = new AbortController();
        const effectiveTimeout = timeoutMs > 0 ? timeoutMs : DEFAULT_HTTP_TIMEOUT_MS;
        const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

        const parentSignal = this._abortController?.signal;
        const onParentAbort = () => controller.abort();

        if (parentSignal) {
            if (parentSignal.aborted) {
                controller.abort();
            } else {
                parentSignal.addEventListener('abort', onParentAbort, { once: true });
            }
        }

        const cleanup = () => {
            clearTimeout(timeoutId);
            if (parentSignal) {
                parentSignal.removeEventListener('abort', onParentAbort);
            }
        };

        return { signal: controller.signal, cleanup };
    }

    /** 获取 SillyTavern 宿主环境认证与 CSRF Token 请求头 */
    protected getHostRequestHeaders(): Record<string, string> {
        if (typeof window !== 'undefined') {
            const st = (window as any).SillyTavern?.getContext?.();
            if (typeof st?.getRequestHeaders === 'function') {
                try {
                    return st.getRequestHeaders();
                } catch {}
            }
            if (typeof (window as any).getRequestHeaders === 'function') {
                try {
                    return (window as any).getRequestHeaders();
                } catch {}
            }
        }
        return {};
    }

    protected async getBlob(path: string, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS): Promise<Blob> {
        this.checkCancelled();
        const url = this.buildUrl(path);
        const effectiveTimeout = timeoutMs > 0 ? timeoutMs : DEFAULT_DOWNLOAD_TIMEOUT_MS;
        const { signal, cleanup } = this._createScopedSignal(effectiveTimeout);

        const headers: Record<string, string> = {};
        if (url.startsWith('/api/')) {
            Object.assign(headers, this.getHostRequestHeaders());
        }

        try {
            const resp = await fetch(url, { headers, signal });
            if (!resp.ok) {
                if (resp.status === 404 && url.includes('/api/plugins/st-drawassistant/proxy')) {
                    throw new DriverError(
                        DriverErrorType.NOT_FOUND,
                        '未检测到 SillyTavern 服务端插件代理路由 (/api/plugins/st-drawassistant/proxy)。请确认 SillyTavern 的 config.yaml 中已开启 enableServerPlugins: true，或在设置中将请求模式切换为【直接请求 (client)】。',
                        404
                    );
                }
                throw new DriverError(DriverErrorType.BACKEND_ERROR, `获取图片 Blob 失败 (HTTP ${resp.status}): ${url}`);
            }
            return await resp.blob();
        } catch (err: any) {
            if (err instanceof DriverError) throw err;
            if (signal.aborted || this._cancelled) {
                throw new DriverError(DriverErrorType.CANCELLED, '获取图片 Blob 请求已被取消或超时');
            }
            throw new DriverError(DriverErrorType.NETWORK_ERROR, `获取 Blob 失败: ${err.message}`);
        } finally {
            cleanup();
        }
    }

    protected async postJson<T = unknown>(path: string, body: unknown, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, headers?: Record<string, string>): Promise<T> {
        return this.request<T>('POST', path, body, timeoutMs, headers);
    }

    /** 核心 HTTP 请求底层管道 (集成 AbortSignal 超时与自定义取消控制) */
    protected async request<T>(
        method: string,
        path: string,
        body?: unknown,
        timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
        customHeaders?: Record<string, string>
    ): Promise<T> {
        this.checkCancelled();

        const url = this.buildUrl(path);
        const { signal, cleanup } = this._createScopedSignal(timeoutMs);

        const headers: Record<string, string> = {
            Accept: 'application/json',
            ...(url.startsWith('/api/') ? this.getHostRequestHeaders() : {}),
            ...(customHeaders || {})
        };

        let requestBody: string | undefined;
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            requestBody = typeof body === 'string' ? body : JSON.stringify(body);
        }

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: requestBody,
                signal
            });

            if (!response.ok) {
                let errorDetails: string;
                try {
                    errorDetails = await response.text();
                } catch {
                    errorDetails = response.statusText;
                }

                if (response.status === 401 || response.status === 403) {
                    throw new DriverError(
                        DriverErrorType.AUTHENTICATION_ERROR,
                        `鉴权失败 (HTTP ${response.status}): ${errorDetails}`,
                        response.status,
                        errorDetails
                    );
                }

                if (response.status === 404) {
                    if (url.includes('/api/plugins/st-drawassistant/proxy')) {
                        throw new DriverError(
                            DriverErrorType.NOT_FOUND,
                            '未检测到 SillyTavern 服务端插件代理路由 (/api/plugins/st-drawassistant/proxy)。请确认 SillyTavern 的 config.yaml 中已开启 enableServerPlugins: true，或在设置中将请求模式切换为【直接请求 (client)】。',
                            404,
                            errorDetails
                        );
                    }
                    throw new DriverError(
                        DriverErrorType.NOT_FOUND,
                        `接口未找到 (HTTP 404): ${url}`,
                        404,
                        errorDetails
                    );
                }

                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `后端服务异常 (HTTP ${response.status}): ${errorDetails}`,
                    response.status,
                    errorDetails
                );
            }

            return (await response.json()) as T;
        } catch (error: any) {
            if (error instanceof DriverError) throw error;

            if (signal.aborted || this._cancelled) {
                throw new DriverError(DriverErrorType.CANCELLED, '请求已被取消或超时');
            }

            throw new DriverError(
                DriverErrorType.NETWORK_ERROR,
                `网络请求失败: ${error?.message || '未知错误'}`
            );
        } finally {
            cleanup();
        }
    }

    /** 将 Blob 二进制转为 Base64 字符串 */
    protected async blobToBase64(blob: Blob): Promise<string> {
        if (typeof FileReader !== 'undefined') {
            return new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const res = reader.result as string;
                    const commaIdx = res.indexOf(',');
                    resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
        const buffer = await blob.arrayBuffer();
        return Buffer.from(buffer).toString('base64');
    }

    /** 将 Base64 字符串解码为 Blob */
    protected base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
        const cleanBase64 = base64.startsWith('data:')
            ? base64.slice(base64.indexOf(',') + 1)
            : base64;
        const binStr = typeof atob !== 'undefined'
            ? atob(cleanBase64)
            : Buffer.from(cleanBase64, 'base64').toString('binary');
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
        }
        return new Blob([bytes], { type: mimeType });
    }
}
