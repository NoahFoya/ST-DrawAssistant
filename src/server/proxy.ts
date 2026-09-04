/**
 * @module server/proxy
 * @description 宿主服务端辅助 HTTP 反向代理中间件
 */

import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { Request, Response } from 'express';
import { ProxyRelayRequest, ProxyErrorResponse } from '../common';
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
/** 判断目标对象是否为标准可写流 (WritableStream) */
function isWritableStream(target: unknown): target is NodeJS.WritableStream {
    return Boolean(
        target &&
        typeof (target as any).write === 'function' &&
        typeof (target as any).on === 'function'
    );
}

/** 统一输出代理错误响应 */
function sendProxyError(res: Response, status: number, errorResponse: ProxyErrorResponse): void {
    res.status(status).json(errorResponse);
}

/** 全局活跃代理请求控制器集合，供 exit 函数统一终止 */
const _activeControllers = new Set<AbortController>();

/**
 * 终止所有当前活跃的代理请求连接
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
    const relayRequest = req.body as ProxyRelayRequest | undefined;

    if (!relayRequest || typeof relayRequest !== 'object' || !relayRequest.url) {
        sendProxyError(res, 400, {
            error: '无效的代理请求数据，缺少目标 url 参数',
            code: 'BAD_REQUEST'
        });
        return;
    }


    const serverConfig = getServerConfig();
    const targetUrl: string = relayRequest.url;
    const method: string = (relayRequest.method || 'GET').toUpperCase();
    const timeoutMs: number = typeof relayRequest.timeoutMs === 'number' && relayRequest.timeoutMs > 0
        ? relayRequest.timeoutMs
        : (serverConfig.serverOptions.proxyTimeoutMs || 180000);

    const validation = validateTargetUrl(targetUrl, serverConfig.serverOptions.allowedHosts);
    if (!validation.valid) {
        sendProxyError(res, 403, {
            error: validation.reason || '目标地址被安全策略拦截',
            code: 'SECURITY_BLOCKED',
            targetUrl
        });
        return;
    }

    const cleanedHeaders = sanitizeRequestHeaders(relayRequest.headers || {});

    // 服务端自动凭据注入：优先按请求 serviceType 或目标 URL 路径推导服务类型
    const targetHostname = new URL(targetUrl).hostname.toLowerCase();

    const serviceType = relayRequest.serviceType || (
        (targetHostname.includes('novelai') || targetUrl.includes('/novelai') || targetUrl.includes('/generate-image')) ? 'novelai' :
        (targetHostname.includes('openai.com')) ? 'openai' :
        (targetHostname.includes('googleapis.com')) ? 'gemini' :
        (targetHostname.includes('api.x.ai')) ? 'grok' : undefined
    );

    // 服务端自动凭据注入：针对 NovelAI 同时注入 Authorization (官方标准) 与 Token (第三方反代非标头)，
    // 使得同一配置在官方端点与第三方反代中转站间无缝通用
    if (serviceType === 'novelai' && serverConfig.apiKeys.novelai) {
        const hasAuth = Object.keys(cleanedHeaders).some(k => k.toLowerCase() === 'authorization');
        if (!hasAuth) {
            cleanedHeaders['Authorization'] = `Bearer ${serverConfig.apiKeys.novelai}`;
        }
        const hasToken = Object.keys(cleanedHeaders).some(k => k.toLowerCase() === 'token');
        if (!hasToken) {
            cleanedHeaders['Token'] = serverConfig.apiKeys.novelai;
        }
    } else if (serviceType === 'openai' && serverConfig.apiKeys.openai) {
        const hasAuth = Object.keys(cleanedHeaders).some(k => k.toLowerCase() === 'authorization');
        if (!hasAuth) {
            cleanedHeaders['Authorization'] = `Bearer ${serverConfig.apiKeys.openai}`;
        }
    } else if (serviceType === 'gemini' && serverConfig.apiKeys.gemini) {
        const hasKey = Object.keys(cleanedHeaders).some(k => k.toLowerCase() === 'x-goog-api-key');
        if (!hasKey) {
            cleanedHeaders['x-goog-api-key'] = serverConfig.apiKeys.gemini;
        }
    } else if (serviceType === 'grok' && serverConfig.apiKeys.grok) {
        const hasAuth = Object.keys(cleanedHeaders).some(k => k.toLowerCase() === 'authorization');
        if (!hasAuth) {
            cleanedHeaders['Authorization'] = `Bearer ${serverConfig.apiKeys.grok}`;
        }
    } else {
        // 官方固定域名兜底匹配
        for (const rule of CLOUD_AUTH_RULES) {
            if (targetHostname === rule.domain || targetHostname.endsWith(`.${rule.domain}`)) {
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
    }

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
    if (typeof res.on === 'function') {
        res.on('close', onClientClose);
    }

    try {
        const fetchOptions: RequestInit = {
            method,
            headers: cleanedHeaders,
            signal: controller.signal
        };

        if (method !== 'GET' && method !== 'HEAD' && relayRequest.body !== undefined) {
            fetchOptions.body = typeof relayRequest.body === 'string'
                ? relayRequest.body
                : JSON.stringify(relayRequest.body);
        }

        if (serverConfig.serverOptions.enableProxyLog) {
            console.info(`[ST-DrawAssistant][Proxy] ${method} -> ${targetUrl} (超时: ${timeoutMs}ms)`);
        }

        const upstreamResp = await fetch(targetUrl, fetchOptions);

        filterSafeResponseHeaders(upstreamResp.headers, res);
        res.status(upstreamResp.status);

        if (isWritableStream(res) && upstreamResp.body && typeof (Readable as any).fromWeb === 'function') {
            const nodeStream = (Readable as any).fromWeb(upstreamResp.body);
            try {
                await pipeline(nodeStream, res);
            } catch (streamErr: any) {
                if (streamErr?.code !== 'ERR_STREAM_PREMATURE_CLOSE' && streamErr?.name !== 'AbortError') {
                    console.error(`[ST-DrawAssistant][Proxy] 代理流式传输中断 [${targetUrl}]:`, streamErr);
                }
                if (!res.writableEnded) {
                    res.destroy(streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
                }
            }
        } else {
            const arrayBuffer = await upstreamResp.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
        }
    } catch (err: any) {
        if (res.headersSent || res.writableEnded) {
            return;
        }

        if (err?.name === 'AbortError') {
            if (isTimedOut) {
                sendProxyError(res, 504, {
                    error: `Gateway Timeout: 宿主服务端代理请求生图服务超时 (${timeoutMs}ms) [${targetUrl}]`,
                    code: 'GATEWAY_TIMEOUT',
                    targetUrl
                });
            } else {
                sendProxyError(res, 499, {
                    error: `Client Closed Request: 客户端已主动取消生图请求 [${targetUrl}]`,
                    code: 'CLIENT_CLOSED',
                    targetUrl
                });
            }
            return;
        }

        sendProxyError(res, 502, {
            error: `Bad Gateway: 宿主服务端无法连接至生图端点 [${targetUrl}]`,
            code: 'BAD_GATEWAY',
            targetUrl,
            details: err?.message || String(err)
        });
    } finally {
        clearTimeout(timer);
        req.removeListener('close', onClientClose);
        if (typeof res.removeListener === 'function') {
            res.removeListener('close', onClientClose);
        }
        _activeControllers.delete(controller);
    }
}
