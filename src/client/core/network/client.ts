/**
 * @module core/network/client
 * @description 网络请求客户端 (封装浏览器直连与宿主服务端代理分发，对外提供统一接口)
 */

import { Logger } from '../logger';
import {
    SERVER_PROXY_ENDPOINT,
    DEFAULT_HOST_TIMEOUT_MS,
    DEFAULT_DIRECT_TIMEOUT_MS,
    DEFAULT_PROXY_TIMEOUT_MS,
    LOOPBACK_HOSTS
} from '../constants';
import { ProxyRelayPayload, ProxyErrorPayload } from './types';
import { NetworkError, NetworkErrorCode } from './error';
import { composeTimeoutSignal } from './signal';

export interface HttpRequestOptions extends RequestInit {
    timeoutMs?: number;
    skipCsrf?: boolean;
}

/**
 * 检查目标主机名是否为本地回环地址
 */
export function isLoopbackHost(hostname: string): boolean {
    return (LOOPBACK_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}

/**
 * 规范化 HeadersInit 为标准的纯字符串键值字典
 * 兼容标准 Web API Headers 实例、[string, string][] 二维数组与普通对象
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
 * 网络请求管理客户端
 * 负责同源宿主通信与外部生图服务通信 (内部封装直连与服务端反向代理双通道)
 */
export class NetworkClient {
    private readonly _logger = new Logger('NetworkClient');
    private readonly _csrfHeadersProvider: () => Record<string, string>;
    private readonly _getProxyMode: () => 'browser' | 'server';

    constructor(options: {
        csrfHeadersProvider: () => Record<string, string>;
        getProxyMode: () => 'browser' | 'server';
    }) {
        this._csrfHeadersProvider = options.csrfHeadersProvider;
        this._getProxyMode = options.getProxyMode;
    }

    /**
     * 检查目标地址是否会触发跨协议 Mixed Content 限制
     * 本地回环地址属于安全源，不受此限制
     */
    public isMixedContent(targetUrl: string): boolean {
        if (typeof window === 'undefined') return false;
        const isPageHttps = window.location?.protocol === 'https:';
        if (!isPageHttps) return false;
        if (!targetUrl.startsWith('http:')) return false;

        try {
            const parsed = new URL(targetUrl);
            if (isLoopbackHost(parsed.hostname)) {
                return false;
            }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 向宿主服务发起同源 HTTP 请求
     *
     * 自动附加 CSRF 安全标头与 XMLHttpRequest 标识，
     * 若遇到 403 令牌失效则自动刷新凭据并重试一次。
     *
     * @param url 宿主相对或绝对路径
     * @param options 请求配置选项
     */
    public async fetchHost(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_TIMEOUT_MS;
        const { signal, cleanup } = composeTimeoutSignal(timeoutMs, options.signal);

        const csrfHeaders = options.skipCsrf ? {} : this._csrfHeadersProvider();
        const customHeaders = normalizeHeaders(options.headers);

        // FormData 载荷需保留原生 boundary 分隔符，缺省 Content-Type 让运行环境自动识别注入
        const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
        const defaultHeaders: Record<string, string> = {
            'X-Requested-With': 'XMLHttpRequest',
            ...(isFormData ? {} : { 'Content-Type': 'application/json' })
        };

        const mergedHeaders: Record<string, string> = {
            ...defaultHeaders,
            ...csrfHeaders,
            ...customHeaders
        };

        try {
            let resp = await fetch(url, {
                ...options,
                headers: mergedHeaders,
                signal
            });

            // 宿主会话令牌失效时自动刷新凭据重试一次
            if (resp.status === 403 && !options.skipCsrf) {
                this._logger.warn('遇到 403 CSRF 错误，刷新标头后重试...');
                const refreshedHeaders = {
                    ...mergedHeaders,
                    ...this._csrfHeadersProvider()
                };
                resp = await fetch(url, {
                    ...options,
                    headers: refreshedHeaders,
                    signal
                });
            }

            return resp;
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                this._logger.debug(`请求已中止 [${url}]`);
            } else {
                this._logger.error(`请求异常 [${url}]`, err);
            }
            throw err;
        } finally {
            cleanup();
        }
    }

    /**
     * 向外部生图后端发起网络请求
     *
     * 支持双通道网络分发路由：
     * - server 模式：通过宿主服务端反向代理中继，规避浏览器 Mixed Content 限制并由服务端隔离注入鉴权凭据；
     * - browser 模式：前端浏览器直接连接目标端点，剥离宿主凭据并执行协议安全检查。
     *
     * @param targetUrl 目标生图服务端点 URL
     * @param options 请求配置选项
     */
    public async fetchExternal(targetUrl: string, options: HttpRequestOptions = {}): Promise<Response> {
        const mode = this._getProxyMode();

        if (mode === 'server') {
            this._logger.debug(`通过服务端代理转发 -> ${targetUrl}`);
            const proxyTimeout = options.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS;
            const payload: ProxyRelayPayload = {
                url: targetUrl,
                method: options.method || 'GET',
                headers: normalizeHeaders(options.headers),
                body: options.body != null
                    ? (typeof options.body === 'string' ? options.body : (options.body as unknown as Record<string, unknown>))
                    : undefined,
                timeoutMs: proxyTimeout
            };

            const resp = await this.fetchHost(SERVER_PROXY_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify(payload),
                timeoutMs: proxyTimeout + 5000,
                signal: options.signal
            });

            if (!resp.ok) {
                let errorPayload: ProxyErrorPayload | null = null;
                try {
                    const cloned = await resp.clone().json();
                    if (cloned && typeof cloned === 'object' && 'code' in cloned && 'error' in cloned) {
                        errorPayload = cloned as ProxyErrorPayload;
                    }
                } catch {}

                const isProxyMiddlewareError = Boolean(
                    errorPayload &&
                    (errorPayload.code === 'BAD_GATEWAY' ||
                     errorPayload.code === 'GATEWAY_TIMEOUT' ||
                     errorPayload.code === 'SECURITY_BLOCKED' ||
                     errorPayload.code === 'CLIENT_CLOSED' ||
                     errorPayload.code === 'BAD_REQUEST')
                );

                if (isProxyMiddlewareError) {
                    const status = resp.status;
                    let code: NetworkErrorCode = 'HTTP_ERROR';
                    if (status === 502) code = 'GATEWAY_ERROR';
                    else if (status === 504) code = 'TIMEOUT';
                    else if (status === 499) code = 'ABORTED';
                    else if (status === 403) code = 'SECURITY_BLOCKED';

                    const message = errorPayload!.error;
                    const networkError = new NetworkError({
                        message,
                        code,
                        targetUrl,
                        status,
                        cause: errorPayload?.details
                    });
                    this._logger.error(networkError.message);
                    throw networkError;
                }

                // 目标生图后端业务层响应原样交付调用方解析
                return resp;
            }

            return resp;
        }

        if (this.isMixedContent(targetUrl)) {
            const mixedError = new NetworkError({
                message: `Mixed Content 拦截: 当前页面为 HTTPS，浏览器安全限制禁止直连远端 HTTP 端点 [${targetUrl}]。请将网络模式切换为 [服务端代理 (server)] 模式，或使用 HTTP 访问酒馆。`,
                code: 'MIXED_CONTENT',
                targetUrl
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
            if (err?.name === 'AbortError') {
                if (isTimeout()) {
                    const timeoutError = new NetworkError({
                        message: `直连生图端点超时 (${timeoutMs}ms) [${targetUrl}]`,
                        code: 'TIMEOUT',
                        targetUrl,
                        cause: err
                    });
                    this._logger.error(timeoutError.message);
                    throw timeoutError;
                }
                this._logger.debug(`直连请求已中止 [${targetUrl}]`);
                throw err;
            }

            const explicitError = new NetworkError({
                message: `直连生图端点失败 [${targetUrl}]: 连接失败或被浏览器跨域 (CORS) 拦截。若后端未开启允许跨域，请在设置中将请求模式切换为 [服务端代理 (server)]。原因: ${err?.message || err}`,
                code: 'NETWORK_ERROR',
                targetUrl,
                cause: err
            });
            this._logger.error(explicitError.message);
            throw explicitError;
        } finally {
            cleanup();
        }
    }
}
