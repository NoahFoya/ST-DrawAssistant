/**
 * @module core/transport/transport-service
 * @description 网络请求与路由分发服务
 */

import { Logger } from '../logging/logger';
import {
    SERVER_PROXY_ENDPOINT,
    DEFAULT_HOST_TIMEOUT_MS,
    DEFAULT_DIRECT_TIMEOUT_MS
} from '../constants';

export interface HttpRequestOptions extends RequestInit {
    timeoutMs?: number;
    skipCsrf?: boolean;
}

/**
 * 网络请求管理服务
 * 负责同源请求附加安全标头、外部直连剥离敏感凭据，以及跨协议时的代理中继
 */
export class TransportService {
    private readonly _logger = new Logger('TransportService');
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
     * 判断目标地址在当前页面是否会触发浏览器的混合内容 (Mixed Content) 拦截
     */
    public isMixedContent(targetUrl: string): boolean {
        if (typeof window === 'undefined') return false;
        const isPageHttps = window.location?.protocol === 'https:';
        const isTargetHttp = targetUrl.startsWith('http:');
        return isPageHttps && isTargetHttp;
    }

    /**
     * 发送同源酒馆 API 请求 (自动附加 CSRF 安全标头)
     */
    public async fetchHost(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const onAbort = () => controller.abort();
        if (options.signal) {
            if (options.signal.aborted) {
                clearTimeout(timer);
                controller.abort();
            } else {
                options.signal.addEventListener('abort', onAbort, { once: true });
            }
        }

        const csrfHeaders = options.skipCsrf ? {} : this._csrfHeadersProvider();
        const mergedHeaders = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...csrfHeaders,
            ...((options.headers as Record<string, string>) || {})
        };

        try {
            let resp = await fetch(url, {
                ...options,
                headers: mergedHeaders,
                signal: controller.signal
            });

            // 遇 403 重新获取一次标头并重试
            if (resp.status === 403 && !options.skipCsrf) {
                this._logger.warn('遇到 403 CSRF 错误，刷新标头后重试...');
                const refreshedHeaders = {
                    ...mergedHeaders,
                    ...this._csrfHeadersProvider()
                };
                resp = await fetch(url, {
                    ...options,
                    headers: refreshedHeaders,
                    signal: controller.signal
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
            clearTimeout(timer);
            if (options.signal) {
                options.signal.removeEventListener('abort', onAbort);
            }
        }
    }

    /**
     * 发送外部生图服务请求 (根据配置决定直连或通过服务端反向代理转发)
     */
    public async fetchExternal(targetUrl: string, options: HttpRequestOptions = {}): Promise<Response> {
        const mustProxy = this.isMixedContent(targetUrl) || this._getProxyMode() === 'server';

        if (mustProxy) {
            this._logger.debug(`通过服务端代理转发 -> ${targetUrl}`);
            const method = options.method || 'GET';
            const headers = (options.headers as Record<string, string>) || {};
            const body = options.body ? String(options.body) : undefined;

            return await this.fetchHost(SERVER_PROXY_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify({
                    url: targetUrl,
                    method,
                    headers,
                    body,
                    timeoutMs: options.timeoutMs
                }),
                signal: options.signal
            });
        }

        // 直连外部生图服务，显式设置 credentials: 'omit' 避免附带敏感 Cookie
        const timeoutMs = options.timeoutMs ?? DEFAULT_DIRECT_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const onAbort = () => controller.abort();
        if (options.signal) {
            if (options.signal.aborted) {
                clearTimeout(timer);
                controller.abort();
            } else {
                options.signal.addEventListener('abort', onAbort, { once: true });
            }
        }

        try {
            const resp = await fetch(targetUrl, {
                ...options,
                credentials: 'omit',
                signal: controller.signal
            });
            return resp;
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                this._logger.debug(`直连请求已中止 [${targetUrl}]`);
            } else {
                this._logger.warn(`直连请求失败 [${targetUrl}]: ${err?.message}`);
            }
            throw err;
        } finally {
            clearTimeout(timer);
            if (options.signal) {
                options.signal.removeEventListener('abort', onAbort);
            }
        }
    }
}
