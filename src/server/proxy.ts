/**
 * @module server/proxy
 * @description 宿主服务端辅助 HTTP 反向代理中间件
 */

import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
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
/** 判断目标对象是否为标准可写流 (WritableStream) */
function isWritableStream(target: unknown): target is NodeJS.WritableStream {
    return Boolean(
        target &&
        typeof (target as any).write === 'function' &&
        typeof (target as any).on === 'function'
    );
}

/** 统一输出代理错误响应 */
function sendProxyError(res: Response, status: number, payload: ProxyErrorPayload): void {
    res.status(status);
    if (typeof res.json === 'function') {
        res.json(payload);
    } else if (typeof res.send === 'function') {
        res.send(payload as any);
    }
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
    const payload = req.body as ProxyRelayPayload | undefined;

    if (!payload || typeof payload !== 'object' || !payload.url) {
        sendProxyError(res, 400, {
            error: '无效的代理请求数据，缺少目标 url 参数',
            code: 'BAD_REQUEST'
        });
        return;
    }

    const serverConfig = getServerConfig();
    const targetUrl: string = payload.url;
    const method: string = (payload.method || 'GET').toUpperCase();
    const timeoutMs: number = typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0
        ? payload.timeoutMs
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

    const cleanedHeaders = sanitizeRequestHeaders(payload.headers || {});

    // 目标主机命中已知云端生图服务且请求未附带凭据时，自动补充服务端保存的 API Key
    let targetHostname = '';
    try {
        targetHostname = new URL(targetUrl).hostname.toLowerCase();
    } catch {}

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
        } else if (typeof res.send === 'function') {
            const arrayBuffer = await upstreamResp.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
        } else {
            res.end();
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
