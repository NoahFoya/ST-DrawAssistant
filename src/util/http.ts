/**
 * HTTP 客户端与网络诊断工具 (HttpClient)
 *
 * 功能：
 * 1. 封装原生 fetch 请求，提供超时自动中止、指数退避重试与多源取消信号合成；
 * 2. 自动注入宿主环境 CSRF 令牌，保障与 SillyTavern 宿主通信安全；
 * 3. 区分浏览器直连 (Direct) 与宿主代理中转 (Relay) 传输通道，提供连通性探测。
 *
 * Tips：
 * 1. 混合内容拦截：在 HTTPS 宿主环境下禁止直连 HTTP 外部地址，自动切换至 Relay 通道；
 * 2. 重试限制：重试仅针对网络抖动或服务端临时过载等瞬态故障，客户端 4xx 参数错误严禁无条件重试。
 */

import { Logger } from './logger';

export type NetworkErrorCode =
    | 'TIMEOUT'
    | 'ABORTED'
    | 'MIXED_CONTENT'
    | 'CORS_OR_NETWORK'
    | 'HTTP_ERROR';

export interface NetworkErrorOptions {
    message: string;
    code: NetworkErrorCode;
    targetUrl: string;
    status?: number;
    cause?: unknown;
    details?: unknown;
    userAdvice?: string;
}

export class NetworkError extends Error {
    public readonly code: NetworkErrorCode;
    public readonly targetUrl: string;
    public readonly status?: number;
    public readonly details?: unknown;
    public readonly userAdvice?: string;

    constructor(options: NetworkErrorOptions) {
        super(options.message);
        this.name = 'NetworkError';
        this.code = options.code;
        this.targetUrl = options.targetUrl;
        this.status = options.status;
        this.details = options.details;
        this.userAdvice = options.userAdvice;
        if (options.cause) {
            (this as any).cause = options.cause;
        }
        Object.setPrototypeOf(this, NetworkError.prototype);
    }
}

export interface HttpRequestOptions extends RequestInit {
    timeoutMs?: number;
    skipCsrf?: boolean;
    retries?: number;
    retryDelayMs?: number;
}

export interface TimeoutSignalResult {
    signal: AbortSignal;
    cleanup: () => void;
    isTimeout: () => boolean;
}

export const LOOPBACK_HOSTS = Object.freeze([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '[::1]',
    '::1'
]);

export const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

export function isLoopbackHost(hostname: string): boolean {
    return LOOPBACK_HOSTS.includes(hostname.toLowerCase());
}

/**
 * 规范化请求头对象为纯键值对。
 */
export function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers) return result;

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        headers.forEach((val, key) => {
            result[key] = val;
        });
    } else if (Array.isArray(headers)) {
        for (const [key, val] of headers) {
            if (key) {
                result[key] = val;
            }
        }
    } else if (typeof headers === 'object') {
        for (const [key, val] of Object.entries(headers)) {
            if (val !== undefined && val !== null) {
                result[key] = String(val);
            }
        }
    }
    return result;
}

/**
 * 级联编排超时控制与外部取消信号。
 * 针对现代浏览器优先使用 AbortSignal.any，老旧环境回退至事件手动转发。
 * 必须在请求生命周期结束（finally）时执行 cleanup 解绑监听器，防止闭包内存泄漏。
 */
export function composeTimeoutSignal(
    timeoutMs: number,
    parentSignal?: AbortSignal | null
): TimeoutSignalResult {
    let timedOut = false;
    const internalController = new AbortController();

    const timer = setTimeout(() => {
        timedOut = true;
        internalController.abort({ code: 'TIMEOUT', timeoutMs });
    }, timeoutMs);

    let onParentAbort: (() => void) | null = null;
    let cleanup = () => {
        clearTimeout(timer);
        if (parentSignal && onParentAbort) {
            parentSignal.removeEventListener('abort', onParentAbort);
        }
    };

    if (parentSignal) {
        if (parentSignal.aborted) {
            clearTimeout(timer);
            internalController.abort(parentSignal.reason);
        } else {
            onParentAbort = () => {
                clearTimeout(timer);
                internalController.abort(parentSignal.reason);
            };
            parentSignal.addEventListener('abort', onParentAbort, { once: true });
        }
    }

    return {
        signal: internalController.signal,
        cleanup,
        isTimeout: () => timedOut
    };
}

/**
 * 可中断的延迟等待函数，与主请求共享同一个 AbortSignal。
 */
export function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

export class HttpClient {
    private readonly _logger = new Logger('HttpClient');
    private readonly _csrfHeadersProvider?: () => Record<string, string>;

    constructor(options: { csrfHeadersProvider?: () => Record<string, string> } = {}) {
        this._csrfHeadersProvider = options.csrfHeadersProvider;
    }

    /**
     * 判断目标 URL 在当前页面环境下是否会被浏览器阻断为 Mixed Content。
     * 本地回环地址受安全上下文豁免，不计入阻断范围。
     */
    public isMixedContent(targetUrl: string): boolean {
        if (typeof window === 'undefined' || window.location?.protocol !== 'https:') {
            return false;
        }
        if (!targetUrl.startsWith('http:')) {
            return false;
        }
        try {
            const parsed = new URL(targetUrl);
            return !isLoopbackHost(parsed.hostname);
        } catch {
            return false;
        }
    }

    /**
     * 向宿主后端服务发起请求（同源或宿主内部代理）。
     * 自动注入宿主 CSRF 校验头与 X-Requested-With 标识。
     */
    public async fetchHost(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const timeoutMs = options.timeoutMs ?? 30000;
        const { signal, cleanup } = composeTimeoutSignal(timeoutMs, options.signal);

        const csrfHeaders = options.skipCsrf || !this._csrfHeadersProvider ? {} : this._csrfHeadersProvider();
        const customHeaders = normalizeHeaders(options.headers);

        const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
        const hasBody = options.body != null;
        const defaultHeaders: Record<string, string> = {
            'X-Requested-With': 'XMLHttpRequest',
            ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {})
        };

        const mergedHeaders: Record<string, string> = {
            ...defaultHeaders,
            ...csrfHeaders,
            ...customHeaders
        };

        try {
            const resp = await fetch(url, {
                ...options,
                headers: mergedHeaders,
                signal
            });

            if (!resp.ok) {
                let details: unknown = null;
                try {
                    details = await resp.json();
                } catch {
                    details = await resp.text().catch(() => null);
                }
                throw new NetworkError({
                    message: `宿主请求返回错误 [HTTP ${resp.status}]`,
                    code: 'HTTP_ERROR',
                    targetUrl: url,
                    status: resp.status,
                    details,
                    userAdvice: resp.status === 403 ? 'CSRF 校验失败或权限不足，请刷新页面重试。' : undefined
                });
            }

            return resp;
        } catch (err: any) {
            if (err instanceof NetworkError) {
                throw err;
            }
            if (err?.name === 'AbortError' || signal.aborted) {
                const abortReason = signal.reason;
                const isTimeout = abortReason && typeof abortReason === 'object' && abortReason.code === 'TIMEOUT';
                if (isTimeout) {
                    throw new NetworkError({
                        message: `宿主请求超时 (${timeoutMs}ms) [${url}]`,
                        code: 'TIMEOUT',
                        targetUrl: url,
                        cause: err,
                        userAdvice: '宿主服务响应超时，请检查服务状态。'
                    });
                }
                throw new NetworkError({
                    message: `宿主请求已取消 [${url}]`,
                    code: 'ABORTED',
                    targetUrl: url,
                    cause: err
                });
            }
            throw new NetworkError({
                message: `宿主网络请求失败 [${url}]: ${err?.message || '未知网络错误'}`,
                code: 'CORS_OR_NETWORK',
                targetUrl: url,
                cause: err
            });
        } finally {
            cleanup();
        }
    }

    /**
     * 直接请求外部生图服务（SD-WebUI / ComfyUI / NovelAI / 云端 API）。
     * 默认 credentials: 'omit'，避免凭据泄漏并规避多余跨域检查。
     */
    public async fetchExternal(targetUrl: string, options: HttpRequestOptions = {}): Promise<Response> {
        if (this.isMixedContent(targetUrl)) {
            const mixedError = new NetworkError({
                message: `Mixed Content 拦截: 当前页面为 HTTPS，浏览器禁止直接访问不安全 HTTP 服务地址 [${targetUrl}]`,
                code: 'MIXED_CONTENT',
                targetUrl,
                userAdvice: '请为生图后端配置 HTTPS 反向代理，或使用 HTTP 协议访问 SillyTavern。'
            });
            this._logger.error(mixedError.message);
            throw mixedError;
        }

        const maxRetries = Math.max(0, options.retries ?? 0);
        const baseRetryDelay = options.retryDelayMs ?? 1000;

        let attempt = 0;
        while (true) {
            const timeoutMs = options.timeoutMs ?? 120000;
            const { signal, cleanup, isTimeout } = composeTimeoutSignal(timeoutMs, options.signal);

            try {
                const resp = await fetch(targetUrl, {
                    ...options,
                    credentials: 'omit',
                    signal
                });

                if (!resp.ok) {
                    let details: unknown = null;
                    try {
                        details = await resp.json();
                    } catch {
                        details = await resp.text().catch(() => null);
                    }

                    const isTransient = TRANSIENT_HTTP_STATUSES.has(resp.status);
                    if (isTransient && attempt < maxRetries) {
                        attempt++;
                        const delay = Math.min(8000, baseRetryDelay * 2 ** (attempt - 1)) + Math.random() * 200;
                        this._logger.warn(`生图服务返回临时状态 HTTP ${resp.status}，正在进行第 ${attempt}/${maxRetries} 次重试... [${targetUrl}]`);
                        cleanup();
                        await sleepWithSignal(delay, options.signal);
                        continue;
                    }

                    throw new NetworkError({
                        message: `生图服务返回错误 [HTTP ${resp.status}]`,
                        code: 'HTTP_ERROR',
                        targetUrl,
                        status: resp.status,
                        details,
                        userAdvice: resp.status === 404 ? '请求 API 路径不存在，请核对生图后端地址与版本。' : undefined
                    });
                }

                cleanup();
                return resp;
            } catch (err: any) {
                cleanup();

                if (err instanceof NetworkError) {
                    throw err;
                }

                if (isTimeout()) {
                    throw new NetworkError({
                        message: `直连生图服务超时 (${timeoutMs}ms) [${targetUrl}]`,
                        code: 'TIMEOUT',
                        targetUrl,
                        cause: err,
                        userAdvice: `请求超过 ${timeoutMs}ms 未响应。请检查生图后端负载是否过高、显存是否不足或处于排队中。`
                    });
                }

                if (err?.name === 'AbortError' || options.signal?.aborted) {
                    throw new NetworkError({
                        message: `生图请求已取消 [${targetUrl}]`,
                        code: 'ABORTED',
                        targetUrl,
                        cause: err
                    });
                }

                // 网络层失败（Failed to fetch / 拒绝连接 / CORS 阻断）
                let isLoopback = false;
                try {
                    isLoopback = isLoopbackHost(new URL(targetUrl).hostname);
                } catch {}

                const userAdvice = isLoopback
                    ? '无法连接到本地生图服务。请检查：1. 对应后端（SD-WebUI/ComfyUI）是否已启动并监听对应端口；2. 是否开启了跨域支持（如 SD-WebUI 启动参数需包含 --cors-allow-origins=*）；3. 本地防火墙规则。'
                    : '无法连接到远程生图服务。请检查：1. 网络与代理设置；2. 目标 API 地址是否正确；3. 目标服务是否允许跨域请求。';

                throw new NetworkError({
                    message: `直连生图服务失败 [${targetUrl}]: ${err?.message || '网络连接失败或跨域受限'}`,
                    code: 'CORS_OR_NETWORK',
                    targetUrl,
                    cause: err,
                    userAdvice
                });
            }
        }
    }

    /**
     * 探测服务地址可用性与连通性。
     */
    public async probeEndpoint(
        targetUrl: string,
        options: { timeoutMs?: number; signal?: AbortSignal } = {}
    ): Promise<{ ok: boolean; status?: number; error?: string; userAdvice?: string }> {
        const timeoutMs = options.timeoutMs ?? 8000;
        try {
            const resp = await this.fetchExternal(targetUrl, {
                method: 'GET',
                timeoutMs,
                signal: options.signal,
                retries: 0
            });
            return {
                ok: resp.ok,
                status: resp.status
            };
        } catch (err: any) {
            return {
                ok: false,
                status: err?.status,
                error: err?.message || String(err),
                userAdvice: err instanceof NetworkError ? err.userAdvice : undefined
            };
        }
    }
}
