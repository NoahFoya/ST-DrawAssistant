/**
 * 支持直连与宿主代理模式的 HTTP 网络客户端 (HttpClient)。
 *
 * @remarks
 * 通信架构与网络安全机制：
 * 1. 混合内容拦截 (Mixed Content) 与本地回环豁免：
 *    - 当宿主处于 HTTPS 安全上下文时，向外部不安全 HTTP 发起的网络请求会被浏览器静默拦截并抛出通用 `Failed to fetch`；
 *    - 本地回环地址（localhost, 127.0.0.1, [::1]）遵循 W3C 规范被主流现代浏览器（Chromium/Firefox）判定为
 *      潜在可信源 (Potentially Trustworthy Origin)，因此享有混合内容直接通信豁免；
 *    - 对非回环外部 HTTP 地址，提示切换至宿主中继模式 (relay) 借由宿主后端转发解决跨域与安全协议阻断；
 * 2. 信号合成与生命周期管控 (composeAbortSignal)：
 *    - 动态组合任务取消信号 (userSignal) 与请求超时信号 (timeoutSignal)；
 *    - 响应返回后显式解绑 abort 监听器，规避长生命周期下的事件监听内存泄漏；
 * 3. 瞬态故障容错重试：
 *    - 识别 408 (Request Timeout)、429 (Too Many Requests)、502/503/504 等瞬态状态码；
 *    - 采用带随机抖动 (Jitter) 的指数退避策略执行重试，防止网络瞬断或拥塞导致任务直接失败。
 */

import type { TransportMode } from '@types';
import { logger } from './logger';

/** HTTP 请求异常结构 */
export class HttpError extends Error {
    public readonly status: number;
    public readonly statusText: string;
    public readonly details?: unknown;
    public readonly url: string;

    public constructor(status: number, statusText: string, url: string, details?: unknown) {
        super(`HTTP ${status} ${statusText}: ${url}`);
        this.name = 'HttpError';
        this.status = status;
        this.statusText = statusText;
        this.url = url;
        this.details = details;
    }
}

/** HTTP 请求通用配置项 */
export interface HttpRequestOptions extends RequestInit {
    /** 超时时间，单位毫秒，默认为 30000 */
    timeoutMs?: number;
    /** 针对瞬态故障的最大重试次数，默认为 1，0 为不重试 */
    retries?: number;
    /** 通信通道，direct 为浏览器直连，relay 为宿主中继，未指定时默认为 direct */
    transport?: TransportMode;
}

/** 接口 Ping 连通性与延迟测试配置项 */
export interface PingOptions {
    /** 超时时间，单位毫秒，默认为 5000 */
    timeoutMs?: number;
    /** 自定义请求头参数，如 Authorization 认证凭据 */
    headers?: Record<string, string>;
    /** 通信通道，direct 为浏览器直连，relay 为宿主中继，未指定时默认为 direct */
    transport?: TransportMode;
    /** 用户中止信号 */
    signal?: AbortSignal;
}

/** 接口 Ping 连通性与延迟测试结果 */
export interface PingResult {
    /** 接口是否可正常连通，返回 HTTP 2xx 视为成功 */
    readonly ok: boolean;
    /** HTTP 响应状态码 */
    readonly status?: number;
    /** 请求往返耗时，单位毫秒 */
    readonly latencyMs: number;
    /** 异常信息，失败时存在 */
    readonly error?: string;
}

/** 接口连通性测试结果类型别名 */
export type ProbeResult = PingResult;

/** 默认瞬态可重试状态码集合 */
const TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504]);

/**
 * 获取 SillyTavern 宿主环境的认证凭据与 CSRF Token 请求头。
 */
export function getHostRequestHeaders(): Record<string, string> {
    const hostContext = window.SillyTavern?.getContext?.();
    if (typeof hostContext?.getRequestHeaders === 'function') {
        try {
            return hostContext.getRequestHeaders() ?? {};
        } catch (err) {
            logger.warn('获取宿主 CSRF 请求头凭据异常:', err);
            return {};
        }
    }

    return {};
}

/**
 * 组合多个 AbortSignal。
 */
function composeAbortSignal(signals: (AbortSignal | null | undefined)[]): { signal: AbortSignal; cleanup: () => void } {
    const validSignals = signals.filter((s): s is AbortSignal => Boolean(s));
    const controller = new AbortController();

    const onAbort = () => controller.abort();
    for (const sig of validSignals) {
        if (sig.aborted) {
            controller.abort();
            break;
        }
        sig.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
        for (const sig of validSignals) {
            sig.removeEventListener('abort', onAbort);
        }
    };

    return { signal: controller.signal, cleanup };
}

/**
 * 带有超时与中断信号支持的异步休眠函数。
 */
function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
        }

        const timer = setTimeout(() => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

/**
 * 判定目标地址是否属于 SillyTavern 宿主本地同源端点。
 */
export function isHostOriginEndpoint(urlStr: string): boolean {
    if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
        return true;
    }
    if (typeof window !== 'undefined' && window.location?.origin) {
        try {
            const parsed = new URL(urlStr, window.location.origin);
            return parsed.origin === window.location.origin;
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * 判定目标地址是否属于本机回环地址。
 * 本地回环地址受浏览器安全策略保护与豁免。
 */
function isLoopbackHost(urlStr: string): boolean {
    try {
        const parsed = new URL(urlStr);
        const host = parsed.hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '0.0.0.0';
    } catch {
        return false;
    }
}

/**
 * 浏览器端 HTTP 请求客户端。
 *
 * @remarks
 * 统一承载插件内所有网络请求，内置支持 direct 浏览器直连与 relay 宿主中继模式，
 * 集中管理超时控制、中止信号组合、宿主 CSRF 认证凭据注入与瞬态故障重试。
 */
export class HttpClient {
    /**
     * 发送统一 HTTP 请求。
     *
     * @remarks
     * 支持 direct 浏览器直连或 relay 宿主中继，未指定时默认为 direct；
     * relay 模式下自动合并 SillyTavern 宿主环境的认证凭据与 CSRF 请求头；
     * 统一支持请求超时控制与瞬态故障指数退避重试。
     *
     * @param url 目标接口地址
     * @param options 请求配置项
     */
    public async fetch(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const transport = options.transport ?? 'direct';
        if (transport === 'relay') {
            return this.fetchHost(url, options);
        }
        return this.fetchExternal(url, options);
    }

    /**
     * 执行外部生图服务的直接 HTTP 请求。
     *
     * @remarks
     * 支持超时控制与瞬态网络故障退避重试。
     */
    public async fetchExternal(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        // 显式拦截 Mixed Content：HTTPS 宿主页面直连非安全外部 HTTP 服务时由浏览器安全策略直接阻断
        if (typeof window !== 'undefined' && window.location?.protocol === 'https:' && url.startsWith('http:')) {
            if (!isLoopbackHost(url)) {
                throw new Error(
                    `网络请求受阻 (Mixed Content): 当前 SillyTavern 宿主页面为 HTTPS 协议，浏览器安全策略禁止直接请求非安全 HTTP 服务 [${url}]。请在常规设置中将“网络连接方式”切换为“宿主中继”，或为后端服务配置 HTTPS。`
                );
            }
        }

        const { timeoutMs = 30000, retries = 1, signal: userSignal, transport: _ignored, ...init } = options;
        const maxAttempts = Math.max(1, retries + 1);

        let lastError: unknown;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const timeoutSignal = typeof AbortSignal.timeout === 'function'
                ? AbortSignal.timeout(timeoutMs)
                : undefined;

            const { signal, cleanup } = composeAbortSignal([userSignal, timeoutSignal]);

            try {
                const response = await fetch(url, { ...init, signal });

                if (!response.ok) {
                    let details: unknown;
                    try {
                        const rawText = await response.text();
                        try {
                            details = JSON.parse(rawText);
                        } catch {
                            details = rawText || undefined;
                        }
                    } catch {
                        details = undefined;
                    }

                    const error = new HttpError(response.status, response.statusText, url, details);

                    // 判断是否属于可重试的瞬态状态
                    if (attempt < maxAttempts - 1 && TRANSIENT_STATUSES.has(response.status)) {
                        lastError = error;
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 5000);
                        await sleepWithSignal(backoffMs, userSignal);
                        continue;
                    }

                    throw error;
                }

                return response;
            } catch (err: unknown) {
                lastError = err;
                // 若用户已主动取消，不执行重试
                if (userSignal?.aborted) {
                    throw err;
                }

                // 统一包装浏览器底层 Failed to fetch，转化为可定位排查的技术错误
                if (err instanceof TypeError && err.message?.includes('fetch')) {
                    const enhancedError = new Error(
                        `网络连接失败 (Failed to fetch): 无法访问服务地址 [${url}]。请确认后端服务是否已正常启动、地址与端口是否正确，或检查是否存在跨域 (CORS) 限制。如需规避跨域可在常规设置中切换为“酒馆代理”。`
                    );
                    lastError = enhancedError;
                    if (attempt >= maxAttempts - 1) {
                        throw enhancedError;
                    }
                }

                if (attempt < maxAttempts - 1) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 5000);
                    try {
                        await sleepWithSignal(backoffMs, userSignal);
                        continue;
                    } catch {
                        throw lastError;
                    }
                }

                throw lastError;
            } finally {
                cleanup();
            }
        }

        throw lastError;
    }

    /**
     * 执行经由 SillyTavern 宿主中继或宿主本地同源的接口请求。
     *
     * @remarks
     * 安全凭据与中继机制：
     * 1. 宿主同源路径（如 /api/...）：自动合并宿主环境 CSRF 认证头；
     * 2. 外部跨域目标（http:// 或 https://）：通过宿主 /proxy/:url 路由安全代理中转，并附带访问宿主所需的 CSRF 凭据，
     *    避免向第三方服务泄露宿主 CSRF 令牌。
     */
    public async fetchHost(endpoint: string, options: HttpRequestOptions = {}): Promise<Response> {
        const isHostOrigin = isHostOriginEndpoint(endpoint);
        let targetUrl = endpoint;
        const hostHeaders = getHostRequestHeaders();

        const mergedHeaders: Record<string, string> = {
            ...((options.headers as Record<string, string>) || {}),
        };

        if (isHostOrigin) {
            Object.assign(mergedHeaders, hostHeaders);
        } else if (endpoint.startsWith('http:') || endpoint.startsWith('https:')) {
            targetUrl = `/proxy/${endpoint}`;
            Object.assign(mergedHeaders, hostHeaders);
        }

        return this.fetchExternal(targetUrl, {
            ...options,
            headers: mergedHeaders,
        });
    }

    /**
     * 测试指定服务接口的连通性与往返延迟。
     *
     * @remarks
     * 内部使用统一 fetch 发起请求，自动处理 transport 通道与凭据合并；
     * 测试失败或超时不会抛出异常，而是返回包含错误信息的 PingResult 结构。
     *
     * @param url 待测试的服务接口地址
     * @param options 超时、请求头及通道配置项
     */
    public async ping(url: string, options: PingOptions = {}): Promise<PingResult> {
        const start = Date.now();
        const { timeoutMs = 5000, headers, transport, signal } = options;

        try {
            const response = await this.fetch(url, {
                method: 'GET',
                headers,
                timeoutMs,
                retries: 0,
                signal,
                transport,
            });

            return {
                ok: response.ok,
                status: response.status,
                latencyMs: Date.now() - start,
                error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
            };
        } catch (err: unknown) {
            return {
                ok: false,
                status: err instanceof HttpError ? err.status : undefined,
                latencyMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}

/** 全局默认单例 HTTP 客户端 */
export const httpClient = new HttpClient();

/**
 * 将 Base64 编码的图像字符串转换为 Blob 二进制对象。
 *
 * @param b64 Base64 编码图像字符串（支持包含 data URI 前缀）
 * @param mimeType 图像 MIME 类型，默认为 'image/png'
 * @returns 构造的二进制 Blob 对象
 */
export function base64ToBlob(b64: string, mimeType = 'image/png'): Blob {
    const raw = b64.includes(',') ? b64.split(',')[1] : b64;
    const binaryStr = atob(raw);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}
