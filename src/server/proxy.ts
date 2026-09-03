/**
 * @module server/proxy
 * @description 宿主服务端辅助 HTTP 反向代理中间件
 */

import type { Request, Response } from 'express';
import { ProxyRelayPayload, ProxyErrorPayload } from '../common';
import { validateTargetUrl, sanitizeRequestHeaders, filterSafeResponseHeaders } from './security';
import { getServerConfig, ServerConfig } from './server-config';

interface CloudAuthRule {
    domain: string;
    headerName: string;
    getHeaderValue: (keys: ServerConfig['apiKeys']) => string | undefined;
}

const CLOUD_AUTH_RULES: readonly CloudAuthRule[] = Object.freeze([
    {
        domain: 'image.novelai.net',
        headerName: 'Authorization',
        getHeaderValue: (keys) => keys.novelai ? `Bearer ${keys.novelai}` : undefined
    },
    {
        domain: 'api.openai.com',
        headerName: 'Authorization',
        getHeaderValue: (keys) => keys.openai ? `Bearer ${keys.openai}` : undefined
    },
    {
        domain: 'api.x.ai',
        headerName: 'Authorization',
        getHeaderValue: (keys) => keys.grok ? `Bearer ${keys.grok}` : undefined
    },
    {
        domain: 'generativelanguage.googleapis.com',
        headerName: 'x-goog-api-key',
        getHeaderValue: (keys) => keys.gemini || undefined
    }
]);

/** 全局活跃代理请求控制器集合，供 exit 函数统一终止 */
const _activeControllers = new Set<AbortController>();

/**
 * 终止所有当前活跃的代理请求连接 (插件重载或退出时调用)
 */
export function abortAllActiveProxyRequests(): void {
    console.info(`[ST-DrawAssistant][Proxy] 正在终止所有活跃代理请求 (共 ${_activeControllers.size} 个)...`);
    for (const controller of _activeControllers) {
        try {
            controller.abort();
        } catch {}
    }
    _activeControllers.clear();
}

/**
 * 反向代理请求处理入口
 */
export async function handleProxyRequest(req: Request, res: Response): Promise<void> {
    const payload = req.body as ProxyRelayPayload | undefined;

    if (!payload || typeof payload !== 'object' || !payload.url) {
        const errorResponse: ProxyErrorPayload = {
            error: '无效的代理请求数据，缺少目标 url 参数',
            code: 'BAD_REQUEST'
        };
        res.status(400).json(errorResponse);
        return;
    }

    const serverConfig = getServerConfig();
    const targetUrl: string = payload.url;
    const method: string = (payload.method || 'GET').toUpperCase();
    const timeoutMs: number = typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0
        ? payload.timeoutMs
        : (serverConfig.serverOptions.proxyTimeoutMs || 180000);

    // 校验目标地址合法性与安全策略
    const validation = validateTargetUrl(targetUrl, serverConfig.serverOptions.allowedHosts);
    if (!validation.valid) {
        const errorResponse: ProxyErrorPayload = {
            error: validation.reason || '目标地址被安全策略拦截',
            code: 'SECURITY_BLOCKED',
            targetUrl
        };
        res.status(403).json(errorResponse);
        return;
    }

    // 剥离敏感宿主会话凭据
    const cleanedHeaders = sanitizeRequestHeaders(payload.headers || {});

    // 自动附加服务端配置的 API 鉴权凭据
    const targetLower = targetUrl.toLowerCase();
    for (const rule of CLOUD_AUTH_RULES) {
        if (targetLower.includes(rule.domain)) {
            const hasHeader = Object.keys(cleanedHeaders).some(
                k => k.toLowerCase() === rule.headerName.toLowerCase()
            );
            if (!hasHeader) {
                const headerValue = rule.getHeaderValue(serverConfig.apiKeys);
                if (headerValue) {
                    cleanedHeaders[rule.headerName] = headerValue;
                }
            }
            break;
        }
    }

    // 关联客户端断连与请求超时控制
    const controller = new AbortController();
    _activeControllers.add(controller);

    let isTimedOut = false;
    const timer = setTimeout(() => {
        isTimedOut = true;
        controller.abort();
    }, timeoutMs);

    const onClientClose = () => {
        if (!res.writableEnded) {
            controller.abort();
        }
    };
    req.on('close', onClientClose);

    try {
        const fetchOptions: RequestInit = {
            method,
            headers: cleanedHeaders,
            signal: controller.signal
        };

        if (method !== 'GET' && method !== 'HEAD' && payload.body !== undefined) {
            fetchOptions.body = typeof payload.body === 'string'
                ? payload.body
                : JSON.stringify(payload.body);
        }

        if (serverConfig.serverOptions.enableProxyLog) {
            console.info(`[ST-DrawAssistant][Proxy] ${method} -> ${targetUrl} (超时: ${timeoutMs}ms)`);
        }

        const upstreamResp = await fetch(targetUrl, fetchOptions);

        filterSafeResponseHeaders(upstreamResp.headers, res);
        res.status(upstreamResp.status);

        const arrayBuffer = await upstreamResp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
    } catch (err: any) {
        if (res.headersSent || res.writableEnded) {
            return;
        }

        if (err?.name === 'AbortError') {
            if (isTimedOut) {
                const timeoutError: ProxyErrorPayload = {
                    error: `Gateway Timeout: 宿主服务端代理请求生图服务超时 (${timeoutMs}ms) [${targetUrl}]`,
                    code: 'GATEWAY_TIMEOUT',
                    targetUrl
                };
                res.status(504).json(timeoutError);
            } else {
                const clientClosedError: ProxyErrorPayload = {
                    error: `Client Closed Request: 客户端已主动取消生图请求 [${targetUrl}]`,
                    code: 'CLIENT_CLOSED',
                    targetUrl
                };
                res.status(499).json(clientClosedError);
            }
            return;
        }

        const badGatewayError: ProxyErrorPayload = {
            error: `Bad Gateway: 宿主服务端无法连接至生图端点 [${targetUrl}]`,
            code: 'BAD_GATEWAY',
            targetUrl,
            details: err?.message || String(err)
        };
        res.status(502).json(badGatewayError);
    } finally {
        clearTimeout(timer);
        req.removeListener('close', onClientClose);
        _activeControllers.delete(controller);
    }
}
