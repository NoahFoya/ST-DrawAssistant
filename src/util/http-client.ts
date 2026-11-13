/**
 * HTTP 网络客户端 (HttpClient)。
 *
 * @remarks
 * 负责与外部生图后端及宿主代理的 HTTP 通信：
 * 1. 通信模式：支持浏览器直连模式与宿主中继模式 (relay)；
 * 2. 信号合成：组合任务取消信号与超时信号，并在请求完成后解绑监听；
 * 3. 瞬态重试：对 408、429、502/503/504 等瞬态故障支持指数退避重试。
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
export function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
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
                    `网络请求受阻 (Mixed Content): 当前 SillyTavern 宿主页面为 HTTPS 协议，浏览器安全策略禁止直接请求非安全 HTTP 服务 [${url}]。请在常规设置中将“连接方式”切换为“酒馆代理”，或为后端服务配置 HTTPS。`
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
                    let rawText = '';
                    try {
                        rawText = await response.text();
                        try {
                            details = JSON.parse(rawText);
                        } catch {
                            details = rawText || undefined;
                        }
                    } catch {
                        details = undefined;
                    }

                    if (response.status === 404 && rawText.includes('CORS proxy is disabled')) {
                        throw new HttpError(
                            404,
                            '酒馆 CORS 代理未开启：请在 SillyTavern 根目录的 config.yaml 中将 enableCorsProxy 设为 true 后重启酒馆，或在常规设置中切换为“浏览器直连 (Direct)”模式',
                            url,
                            details
                        );
                    }

                    // 遇到明确的端口连接拒绝或主机无法解析，判定为后端服务未就绪，直接阻断，禁止重试
                    const isConnectionRefused =
                        rawText.includes('ECONNREFUSED') ||
                        rawText.includes('ENOTFOUND') ||
                        rawText.includes('Failed to connect');
                    if (isConnectionRefused) {
                        throw new HttpError(
                            response.status,
                            `后端服务未启动或连接被拒绝 (ECONNREFUSED): 请检查生图服务是否在目标端口正常运行 [${url}]`,
                            url,
                            details
                        );
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
                // 若用户已主动取消或本次请求已达到超时阈值，不执行重试
                if (userSignal?.aborted || timeoutSignal?.aborted) {
                    throw err;
                }

                // HttpError 的重试决策已在 response.ok 判断分支中处理完毕，严禁在此二次重试
                if (err instanceof HttpError) {
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

        // FormData 请求必须由浏览器自动生成含 boundary 的 multipart/form-data，避免宿主默认 JSON 头破坏二进制上传
        if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
            delete mergedHeaders['Content-Type'];
            delete mergedHeaders['content-type'];
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

/**
 * 将 Blob 二进制对象转换为 Base64 编码字符串。
 *
 * @param blob 待转换的 Blob 对象
 * @param withPrefix 是否保留 `data:<mime>;base64,` 前缀，默认 false 返回纯净 Base64
 */
export async function blobToBase64(blob: Blob, withPrefix = false): Promise<string> {
    const mimeType = blob.type || 'image/png';

    if (typeof blob.arrayBuffer === 'function') {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        return withPrefix ? `data:${mimeType};base64,${base64}` : base64;
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const res = (reader.result as string) || '';
            if (!res) {
                resolve('');
                return;
            }
            if (withPrefix) {
                resolve(res);
            } else {
                const commaIdx = res.indexOf(',');
                resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
            }
        };
        reader.onerror = () => reject(reader.error || new Error('读取 Blob 转换 Base64 失败'));
        reader.readAsDataURL(blob);
    });
}

/**
 * 将 Blob 二进制或 Base64 图像输入规范化为标准纯净 Base64 字符串。
 *
 * @param input Blob 二进制或 Base64 字符串（支持 data URI）
 * @returns 纯净 Base64 编码字符串（不含 data URI 前缀）
 */
export async function imageInputToBase64(input: Blob | string): Promise<string> {
    if (typeof input === 'string') {
        if (input.startsWith('blob:') || input.startsWith('http:') || input.startsWith('https:')) {
            const fetchedBlob = await imageInputToBlob(input);
            return blobToBase64(fetchedBlob);
        }
        return input.includes(',') ? input.split(',')[1] : input;
    }
    return blobToBase64(input);
}

/**
 * 将 Blob 或 Base64 / URL 图像输入转换为二进制 Blob 对象。
 *
 * @param input Blob 二进制或 Base64 / URL 字符串
 * @param mimeType 转换后的图像 MIME 类型，默认为 'image/png'
 * @returns 二进制 Blob 对象
 */
export async function imageInputToBlob(input: Blob | string, mimeType = 'image/png'): Promise<Blob> {
    if (input instanceof Blob) {
        return input;
    }
    if (typeof input === 'string') {
        if (input.startsWith('blob:') || input.startsWith('http:') || input.startsWith('https:')) {
            const resp = await fetch(input);
            if (!resp.ok) {
                throw new Error(`图像资源拉取失败: HTTP ${resp.status}`);
            }
            return await resp.blob();
        }
        return base64ToBlob(input, mimeType);
    }
    throw new Error('不支持的图像输入格式');
}

/**
 * 依据二进制头部魔数识别图像真实 MIME 类型。
 */
export function detectImageMimeFromBytes(bytes: Uint8Array): string | undefined {
    if (bytes.length >= 8) {
        if (
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a
        ) {
            return 'image/png';
        }
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image/webp';
    }
    if (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
    ) {
        return 'image/gif';
    }
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
        return 'image/bmp';
    }
    if (
        bytes.length >= 12 &&
        bytes[4] === 0x66 &&
        bytes[5] === 0x74 &&
        bytes[6] === 0x79 &&
        bytes[7] === 0x70 &&
        bytes[8] === 0x61 &&
        bytes[9] === 0x76 &&
        bytes[10] === 0x69 &&
        bytes[11] === 0x66
    ) {
        return 'image/avif';
    }
    return undefined;
}

function isDisguisedErrorPayload(bytes: Uint8Array, declaredMime: string): boolean {
    const lowerMime = declaredMime.trim().toLowerCase().split(';')[0];
    if (
        lowerMime &&
        !lowerMime.startsWith('image/') &&
        (lowerMime.startsWith('text/') || lowerMime.includes('json') || lowerMime.includes('xml'))
    ) {
        return true;
    }

    const headText = new TextDecoder('utf-8')
        .decode(bytes.subarray(0, 128))
        .trimStart()
        .toLowerCase();

    return (
        headText.startsWith('<!doctype') ||
        headText.startsWith('<html') ||
        headText.startsWith('<head') ||
        headText.startsWith('<body') ||
        headText.startsWith('{"error"') ||
        headText.startsWith('{"message"') ||
        headText.startsWith('{"detail"') ||
        headText.startsWith('{"statuscode"')
    );
}

/**
 * 校验图像 Blob 非空且非 HTML/JSON 错误页，并在字节魔数明确时修正标准图像 MIME 类型。
 *
 * @param blob 待校验的图像 Blob
 * @param sourceName 来源服务名（用于错误提示）
 * @returns 经过校验与 MIME 规范化的图像 Blob
 */
export async function ensureValidImageBlob(
    blob: Blob | null | undefined,
    sourceName = '生图服务'
): Promise<Blob> {
    if (!blob || blob.size === 0) {
        throw new Error(`${sourceName} 返回了空图像数据 (0 字节)`);
    }

    const headBuffer = await blob.slice(0, 128).arrayBuffer();
    const headBytes = new Uint8Array(headBuffer);
    const detectedMime = detectImageMimeFromBytes(headBytes);

    if (!detectedMime && isDisguisedErrorPayload(headBytes, blob.type || '')) {
        throw new Error(`${sourceName} 返回非图像错误响应 (${blob.type || 'unknown'})`);
    }

    if (detectedMime && blob.type !== detectedMime) {
        return blob.slice(0, blob.size, detectedMime);
    }

    return blob;
}
