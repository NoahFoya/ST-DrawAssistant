/**
 * 网络请求客户端
 * 提供浏览器直连外部生图服务与宿主通信，处理超时控制、Mixed Content 检测与网络异常分类。
 */

import { Logger } from '../../utils/logger';
import {
    DEFAULT_HOST_TIMEOUT_MS,
    DEFAULT_DIRECT_TIMEOUT_MS,
    LOOPBACK_HOSTS
} from '../../constants';
import { NetworkError } from './error';
import { composeTimeoutSignal } from './signal';


export interface HttpRequestOptions extends RequestInit {
    timeoutMs?: number;
    skipCsrf?: boolean;
}

export interface NetworkClientOptions {
    csrfHeadersProvider?: () => Record<string, string>;
}

export function isLoopbackHost(hostname: string): boolean {
    return (LOOPBACK_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}

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

export class NetworkClient {
    private readonly _logger = new Logger('NetworkClient');
    private readonly _csrfHeadersProvider?: () => Record<string, string>;

    constructor(options: NetworkClientOptions = {}) {
        this._csrfHeadersProvider = options.csrfHeadersProvider;
    }

    /**
     * 检测目标地址是否会触发浏览器跨协议 Mixed Content 拦截。
     * 本地回环地址受安全上下文豁免，不触发该限制。
     */
    public isMixedContent(targetUrl: string): boolean {
        if (typeof window === 'undefined' || window.location?.protocol !== 'https:') return false;
        if (!targetUrl.startsWith('http:')) return false;

        try {
            const parsed = new URL(targetUrl);
            return !isLoopbackHost(parsed.hostname);
        } catch {
            return false;
        }
    }

    /**
     * 向宿主后端发起请求，自动附加 CSRF 防护头。
     */
    public async fetchHost(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_TIMEOUT_MS;
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

            return resp;
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                this._logger.debug(`宿主请求已中断 [${url}]`);
            } else {
                this._logger.error(`宿主请求异常 [${url}]`, err);
            }
            throw err;
        } finally {
            cleanup();
        }
    }

    /**
     * 直连外部生图服务。
     * 使用 credentials: 'omit' 避免向第三方泄露酒馆本地 Cookie，并消除多余的跨域凭据限制。
     */
    public async fetchExternal(targetUrl: string, options: HttpRequestOptions = {}): Promise<Response> {
        if (this.isMixedContent(targetUrl)) {
            const mixedError = new NetworkError({
                message: `Mixed Content 拦截: 当前酒馆页面为 HTTPS，浏览器安全机制禁止直连非安全 HTTP 端点 [${targetUrl}]`,
                code: 'MIXED_CONTENT',
                targetUrl,
                userAdvice: '请为绘图后端配置 HTTPS 反向代理，或使用 HTTP 协议访问酒馆。'
            });
            this._logger.error(mixedError.message);
            throw mixedError;
        }

        const timeoutMs = options.timeoutMs ?? DEFAULT_DIRECT_TIMEOUT_MS;
        const { signal, cleanup, isTimeout } = composeTimeoutSignal(timeoutMs, options.signal);

        try {
            const resp = await fetch(targetUrl, {
                ...options,
                credentials: 'omit',
                signal
            });
            return resp;
        } catch (err: any) {
            if (isTimeout()) {
                const timeoutError = new NetworkError({
                    message: `直连生图端点超时 (${timeoutMs}ms) [${targetUrl}]`,
                    code: 'TIMEOUT',
                    targetUrl,
                    cause: err,
                    userAdvice: `请求耗时超过 ${timeoutMs}ms 未响应。请检查生图后端负载是否过高、显存是否不足或等待队列过长。`
                });
                this._logger.error(timeoutError.message);
                throw timeoutError;
            }

            if (err?.name === 'AbortError') {
                this._logger.debug(`直连请求已中断 [${targetUrl}]`);
                throw err;
            }

            let isLoopback = false;
            try {
                isLoopback = isLoopbackHost(new URL(targetUrl).hostname);
            } catch {}

            const userAdvice = isLoopback
                ? '无法连接到本地生图服务。请检查：1. 对应服务（SD-WebUI/ComfyUI）是否已启动并监听正确端口；2. 是否开启了跨域支持（如 SD-WebUI 启动参数需加入 --cors-allow-origins=*）；3. 本地防火墙设置。'
                : '无法连接到远程生图服务。请检查：1. 网络连接与代理工具状态；2. 目标 API 地址是否正确；3. 目标接口是否允许当前来源跨域访问。';

            const networkError = new NetworkError({
                message: `直连生图端点失败 [${targetUrl}]: ${err?.message || '网络连接失败或跨域受限'}`,
                code: 'NETWORK_ERROR',
                targetUrl,
                cause: err,
                userAdvice
            });
            this._logger.error(networkError.message);
            throw networkError;
        } finally {
            cleanup();
        }
    }

    /**
     * 探测端点可用性与网络连通性。
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
                signal: options.signal
            });
            return {
                ok: resp.ok,
                status: resp.status,
                error: resp.ok ? undefined : `HTTP ${resp.status} ${resp.statusText}`
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
