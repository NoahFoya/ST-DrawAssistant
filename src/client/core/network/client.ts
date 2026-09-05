/**
 * @module core/network/client
 * @description 网络请求客户端 (支持浏览器直连与服务端代理模式)
 */

import { Logger } from '../logger';
import {
    SERVER_PROXY_ENDPOINT,
    DEFAULT_HOST_TIMEOUT_MS,
    DEFAULT_DIRECT_TIMEOUT_MS,
    DEFAULT_PROXY_TIMEOUT_MS,
    LOOPBACK_HOSTS
} from '../constants';
import { ProxyRelayRequest, ProxyErrorResponse } from './types';
import { NetworkError, NetworkErrorCode } from './error';
import { composeTimeoutSignal } from './signal';

export interface HttpRequestOptions extends RequestInit {
    timeoutMs?: number;
    skipCsrf?: boolean;
    serviceType?: ProxyRelayRequest['serviceType'];
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
 * 网络请求客户端
 * 负责向服务端接口或外部生图服务发送 HTTP 请求（支持浏览器直连与服务端代理模式）
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
     * 向宿主服务发起同源 HTTP 请求
     *
     * 自动附加 CSRF 防护请求头与 X-Requested-With 标识。
     *
     * @param url 宿主相对或绝对路径
     * @param options 请求配置选项
     */
    public async fetchHost(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_TIMEOUT_MS;
        const { signal, cleanup } = composeTimeoutSignal(timeoutMs, options.signal);

        const csrfHeaders = options.skipCsrf ? {} : this._csrfHeadersProvider();
        const customHeaders = normalizeHeaders(options.headers);

        // FormData 需由运行环境自动生成带 boundary 的请求头；无 Body 的请求不附加 Content-Type
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
     * 向外部生图后端发送网络请求
     *
     * 说明：
     * 1. 服务端代理模式 (server)：
     *    通过服务端插件转发请求，解决浏览器跨域 (CORS) 以及 HTTPS 页面无法访问外部 HTTP 的限制，并在服务端附加 API Key；
     * 2. 浏览器直连模式 (browser)：
     *    由浏览器直接发起请求，不携带 Cookie 凭据；若当前是 HTTPS 页面且目标为非本机 HTTP，会提前给出提示。
     *
     * @param targetUrl 目标生图服务端点 URL
     * @param options 请求配置选项
     */
    public async fetchExternal(targetUrl: string, options: HttpRequestOptions = {}): Promise<Response> {
        const mode = this._getProxyMode();

        if (mode === 'server') {
            this._logger.debug(`通过服务端代理转发 -> ${targetUrl}`);
            const proxyTimeout = options.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS;
            const relayRequest: ProxyRelayRequest = {
                url: targetUrl,
                method: options.method || 'GET',
                headers: normalizeHeaders(options.headers),
                body: options.body != null
                    ? (typeof options.body === 'string' ? options.body : (options.body as unknown as Record<string, unknown>))
                    : undefined,
                timeoutMs: proxyTimeout,
                serviceType: options.serviceType
            };

            const resp = await this.fetchHost(SERVER_PROXY_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify(relayRequest),
                timeoutMs: proxyTimeout + 5000,
                signal: options.signal
            });

            if (!resp.ok) {
                let errorResponse: ProxyErrorResponse | null = null;
                try {
                    const cloned = await resp.clone().json();
                    if (cloned && typeof cloned === 'object' && 'code' in cloned && 'error' in cloned) {
                        errorResponse = cloned as ProxyErrorResponse;
                    }
                } catch {}

                const isProxyMiddlewareError = Boolean(
                    errorResponse &&
                    (errorResponse.code === 'BAD_GATEWAY' ||
                     errorResponse.code === 'GATEWAY_TIMEOUT' ||
                     errorResponse.code === 'SECURITY_BLOCKED' ||
                     errorResponse.code === 'CLIENT_CLOSED' ||
                     errorResponse.code === 'BAD_REQUEST')
                );

                if (isProxyMiddlewareError) {
                    const status = resp.status;
                    let code: NetworkErrorCode = 'HTTP_ERROR';
                    if (status === 502) code = 'GATEWAY_ERROR';
                    else if (status === 504) code = 'TIMEOUT';
                    else if (status === 499) code = 'ABORTED';
                    else if (status === 403) code = 'SECURITY_BLOCKED';

                    const message = errorResponse!.error;
                    const networkError = new NetworkError({
                        message,
                        code,
                        targetUrl,
                        status,
                        cause: errorResponse?.details
                    });
                    this._logger.error(message, networkError);
                    throw networkError;

                }

                // 响应结果直接返回给调用方
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

            if (err?.name === 'AbortError') {
                this._logger.debug(`直连请求已中止 [${targetUrl}]`);
                throw err;
            }

            const explicitError = new NetworkError({
                message: `直连生图端点失败 [${targetUrl}]: 无法建立连接。可能原因: 1. 生图服务未启动或端口不通 (请先确认在浏览器能否直接访问该地址); 2. 浏览器跨域 (CORS) 限制 (后端需开启跨域或在设置中切换为 [服务端代理 (server)] 模式); 3. 网络离线。原因详情: ${err?.message || err}`,
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

    /**
     * 测试生图服务端点的连通性
     *
     * @param targetUrl 目标端点地址
     * @param options 探测选项 (默认 8000ms 超时)
     */
    public async probeEndpoint(
        targetUrl: string,
        options: { timeoutMs?: number; signal?: AbortSignal } = {}
    ): Promise<{ ok: boolean; status?: number; error?: string }> {
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
                error: err?.message || String(err)
            };
        }
    }
}
