/**
 * 支持直连与宿主代理模式的 HTTP 网络客户端。
 *
 * @remarks
 * 提供向外部服务或 SillyTavern 宿主发送 HTTP 请求的能力，
 * 支持请求超时、中止信号管理以及瞬态网络波动的退避重试。
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
    const hostContext = (window as any).SillyTavern?.getContext?.();
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
                        details = await response.json();
                    } catch {
                        try {
                            details = await response.text();
                        } catch {
                            details = undefined;
                        }
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
            } catch (err) {
                lastError = err;
                // 若用户已主动取消，不执行重试
                if (userSignal?.aborted) {
                    throw err;
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

                throw err;
            } finally {
                cleanup();
            }
        }

        throw lastError;
    }

    /**
     * 执行经由 SillyTavern 宿主中继的接口请求。
     *
     * @remarks
     * 自动合并宿主环境 CSRF 请求头凭据，并复用超时管理与瞬态故障重试逻辑。
     */
    public async fetchHost(endpoint: string, options: HttpRequestOptions = {}): Promise<Response> {
        const hostHeaders = getHostRequestHeaders();
        const mergedHeaders: Record<string, string> = {
            ...hostHeaders,
            ...((options.headers as Record<string, string>) || {}),
        };

        return this.fetchExternal(endpoint, {
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
            };
        } catch (err: any) {
            return {
                ok: false,
                status: err instanceof HttpError ? err.status : undefined,
                latencyMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * 探测指定服务接口连通性与往返延迟（ping 的兼容别名）。
     *
     * @param url 待测试的服务地址
     * @param options 超时与中止配置
     */
    public async probeEndpoint(
        url: string,
        options: { timeoutMs?: number; signal?: AbortSignal } = {}
    ): Promise<PingResult> {
        return this.ping(url, { ...options, transport: 'direct' });
    }
}

/** 全局默认单例 HTTP 客户端 */
export const httpClient = new HttpClient();
