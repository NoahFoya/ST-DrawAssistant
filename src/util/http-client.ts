/**
 * HTTP 网络客户端与宿主传输诊断工具 (HttpClient)。
 *
 * @remarks
 * 统一承载插件与外部生图后端、SillyTavern 宿主代理的 HTTP 通信：
 * 1. 宿主环境识别：检查 SillyTavern Web 宿主与 TauriTavern 外壳能力，明确提示不兼容的代理模式；
 * 2. 双传输通道：支持 browser direct 直连与 SillyTavern `/proxy/:url(*)` 中转，保真编码查询参数；
 * 3. 信号合成与重试：组合用户中止与超时信号，对 408、429、502/503/504 瞬态故障按次重试（传输/配置错误直接拦截不重试）。
 */

import type { ProviderType, TransportMode } from '@types';
import { logger } from './logger';

/** 宿主运行环境能力信息 */
export interface HostRuntimeInfo {
    /** 是否检测到 SillyTavern 上下文 */
    readonly hasSillyTavern: boolean;
    /** 是否运行在 TauriTavern 桌面或移动端外壳中 */
    readonly isTauriTavern: boolean;
    /** TauriTavern 平台标识（如 android / windows），仅在 TauriTavern 下有值 */
    readonly tauriPlatform?: string;
    /** TauriTavern 设备形态（desktop / mobile），仅在 TauriTavern 下有值 */
    readonly tauriKind?: string;
    /** 可读宿主描述文案 */
    readonly hostLabel: string;
    /** 当前页面协议（如 http: / https:） */
    readonly pageProtocol: string;
    /** 当前页面 Origin */
    readonly pageOrigin: string;
    /** 当前宿主是否具备 SillyTavern `/proxy/` 代理能力 */
    readonly supportsRelayProxy: boolean;
}

/** 传输与代理诊断信息构造选项 */
export interface HttpErrorOptions {
    /** 是否属于宿主代理或传输边界故障（如未开代理、TauriTavern 不支持、HTML 回退、私网拦截等） */
    readonly isTransportDiagnostic?: boolean;
    /** 是否属于接口鉴权失败（含 SillyTavern 将 401 改写为 400 Unauthorized 的场景） */
    readonly isAuthError?: boolean;
}

/** HTTP 请求异常结构 */
export class HttpError extends Error {
    public readonly status: number;
    public readonly statusText: string;
    public readonly details?: unknown;
    public readonly url: string;
    public readonly isTransportDiagnostic: boolean;
    public readonly isAuthError: boolean;

    public constructor(
        status: number,
        statusText: string,
        url: string,
        details?: unknown,
        options?: HttpErrorOptions
    ) {
        super(`HTTP ${status} ${statusText}: ${url}`);
        this.name = 'HttpError';
        this.status = status;
        this.statusText = statusText;
        this.url = url;
        this.details = details;
        this.isTransportDiagnostic = Boolean(options?.isTransportDiagnostic);
        this.isAuthError = Boolean(options?.isAuthError);
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
    /** 接口是否可正常连通（返回 HTTP 2xx 且非 SPA HTML 回退页） */
    readonly ok: boolean;
    /** HTTP 响应状态码 */
    readonly status?: number;
    /** 请求往返耗时，单位毫秒 */
    readonly latencyMs: number;
    /** 异常信息，失败时存在 */
    readonly error?: string;
    /** 是否属于宿主代理或传输边界故障（如未开代理、TauriTavern 不支持、HTML 回退、私网拦截等） */
    readonly isTransportDiagnostic?: boolean;
    /** 是否属于接口鉴权失败（含 SillyTavern 将 401 改写为 400 Unauthorized 的场景） */
    readonly isAuthError?: boolean;
}

/** 默认瞬态可重试状态码集合 */
const TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504]);

/** 连接方式选项列表（供设置页与快捷面板共用） */
export const TRANSPORT_MODE_OPTIONS: ReadonlyArray<{ label: string; value: TransportMode }> = [
    { label: '浏览器直连', value: 'direct' },
    { label: '酒馆代理', value: 'relay' },
];

interface TauriWindowProbe {
    readonly __TAURI_RUNNING__?: unknown;
    readonly __TAURITAVERN__?: unknown;
    readonly __TAURITAVERN_HOST__?: {
        readonly platform?: unknown;
        readonly kind?: unknown;
    };
}

/**
 * 识别当前前端页面的宿主环境与代理能力。
 */
export function detectHostRuntime(): HostRuntimeInfo {
    if (typeof window === 'undefined') {
        return {
            hasSillyTavern: false,
            isTauriTavern: false,
            hostLabel: '非浏览器环境',
            pageProtocol: '',
            pageOrigin: '',
            supportsRelayProxy: true,
        };
    }

    const hasSillyTavern = Boolean(window.SillyTavern?.getContext);
    const tauriWin = window as unknown as TauriWindowProbe;
    const tauriHostObj = tauriWin.__TAURITAVERN_HOST__;
    const tauriPlatform =
        tauriHostObj && typeof tauriHostObj.platform === 'string'
            ? tauriHostObj.platform
            : undefined;
    const tauriKind =
        tauriHostObj && typeof tauriHostObj.kind === 'string'
            ? tauriHostObj.kind
            : undefined;
    const isTauriTavern = Boolean(
        tauriWin.__TAURI_RUNNING__ || tauriWin.__TAURITAVERN__ || tauriHostObj
    );
    const pageProtocol = window.location?.protocol || '';
    const pageOrigin = window.location?.origin || '';

    let hostLabel = '独立浏览器环境';
    if (isTauriTavern) {
        const suffix = [tauriPlatform, tauriKind].filter(Boolean).join('/');
        hostLabel = suffix ? `TauriTavern (${suffix})` : 'TauriTavern';
    } else if (hasSillyTavern) {
        hostLabel = 'SillyTavern Web 宿主';
    }

    return {
        hasSillyTavern,
        isTauriTavern,
        tauriPlatform,
        tauriKind,
        hostLabel,
        pageProtocol,
        pageOrigin,
        supportsRelayProxy: !isTauriTavern,
    };
}

/**
 * 生成针对 TauriTavern 环境选错「酒馆代理」时的显式提示文案。
 */
export function getTauriRelayUnsupportedMessage(targetUrl?: string): string {
    const targetSuffix = targetUrl ? ` [${targetUrl}]` : '';
    return `当前宿主为 TauriTavern，未提供 SillyTavern /proxy/ 代理转发接口，无法通过「酒馆代理」访问外部服务${targetSuffix}。请到「插件设置 -> 连接方式」切换为「浏览器直连」；若目标服务不支持跨域请求，请为后端开启跨域响应头或填写允许跨域的中转服务地址。`;
}

/**
 * 获取连接方式说明提示（根据当前宿主环境自动补充兼容约束）。
 */
export function getTransportModeTooltip(hostRuntime: HostRuntimeInfo = detectHostRuntime()): string {
    const baseTip =
        '默认由浏览器直连生图服务；遇到跨域 (CORS) 拦截或远程 HTTPS 酒馆访问本地 HTTP 服务时，可切换为「酒馆代理」（需在 SillyTavern config.yaml 开启 enableCorsProxy: true；若同时启用 privateAddressWhitelist 且访问本机/内网服务，须将该地址加入 allowedRanges；注意 ComfyUI 局部重绘因须提交图片表单，不支持酒馆代理）。';
    if (hostRuntime.isTauriTavern) {
        return `${baseTip} 当前检测到 TauriTavern 宿主环境，暂不支持「酒馆代理」，请保持「浏览器直连」。`;
    }
    return baseTip;
}

/**
 * 关联已返回 Response 与当次请求 AbortSignal 的解绑回调。
 * 当调用方仅读取状态码（如 ping）而不读取响应体时，可在释放环节触发清理。
 */
const RESPONSE_CLEANUPS = new WeakMap<Response, () => void>();

/**
 * 在 AbortSignal 触发时立即以源中止原因拒绝等待中的响应读取 Promise。
 */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(
            signal.reason instanceof Error
                ? signal.reason
                : new DOMException(String(signal.reason || 'Aborted'), 'AbortError')
        );
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () =>
            reject(
                signal.reason instanceof Error
                    ? signal.reason
                    : new DOMException(String(signal.reason || 'Aborted'), 'AbortError')
            );
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (val) => {
                signal.removeEventListener('abort', onAbort);
                resolve(val);
            },
            (err) => {
                signal.removeEventListener('abort', onAbort);
                reject(err);
            }
        );
    });
}

/**
 * 为 Response 的正文读取方法绑定 AbortSignal 监听与幂等清理逻辑，
 * 保证响应头已返回后，在读取或下载大型二进制正文期间依然可即时响应中止并释放监听器。
 */
function attachResponseAbortCleanup(response: Response, signal: AbortSignal, cleanup: () => void): Response {
    let cleaned = false;
    const cleanupOnce = () => {
        if (cleaned) return;
        cleaned = true;
        RESPONSE_CLEANUPS.delete(response);
        cleanup();
    };
    RESPONSE_CLEANUPS.set(response, cleanupOnce);

    const methods = ['text', 'json', 'blob', 'arrayBuffer'] as const;
    for (const method of methods) {
        const original = (response as unknown as Record<string, unknown>)[method];
        if (typeof original !== 'function') {
            continue;
        }
        const wrapped = function (this: Response) {
            const inner = (original as (this: Response) => Promise<unknown>).call(this);
            return raceWithAbort(inner, signal).finally(cleanupOnce);
        };
        try {
            Object.defineProperty(response, method, {
                value: wrapped,
                configurable: true,
                writable: true,
            });
        } catch {
            // 部分测试替身对象若被冻结则保持原方法
        }
    }

    return response;
}

/**
 * 获取 SillyTavern 宿主环境的认证凭据与 CSRF Token 请求头。
 */
export function getHostRequestHeaders(): Record<string, string> {
    if (typeof window === 'undefined') {
        return {};
    }
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
 * 组合多个 AbortSignal，并转发首个中止信号原因。
 */
function composeAbortSignal(signals: (AbortSignal | null | undefined)[]): { signal: AbortSignal; cleanup: () => void } {
    const validSignals = signals.filter((s): s is AbortSignal => Boolean(s));
    const controller = new AbortController();

    const listeners = new Map<AbortSignal, () => void>();
    for (const sig of validSignals) {
        if (sig.aborted) {
            controller.abort(sig.reason);
            break;
        }
        const onAbort = () => controller.abort(sig.reason);
        listeners.set(sig, onAbort);
        sig.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
        for (const [sig, onAbort] of listeners.entries()) {
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
 * 判定目标地址是否属于 SillyTavern 宿主本地同源地址。
 */
function isHostOriginEndpoint(urlStr: string): boolean {
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
 * 判定目标地址是否属于本机或局域网私有 IP 网段（用于识别 SillyTavern privateAddressWhitelist 拦截场景）。
 */
function isPrivateOrLoopbackHost(urlStr: string): boolean {
    if (isLoopbackHost(urlStr)) {
        return true;
    }
    try {
        const host = new URL(urlStr).hostname.toLowerCase();
        if (
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            host.startsWith('169.254.') ||
            host.endsWith('.local')
        ) {
            return true;
        }
        const match172 = host.match(/^172\.(\d{1,3})\./);
        if (match172) {
            const secondOctet = Number(match172[1]);
            if (secondOctet >= 16 && secondOctet <= 31) {
                return true;
            }
        }
        if (host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80:')) {
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * 将外部绝对 URL 编码为 SillyTavern Express 4 `/proxy/:url(*)` 安全接受的路径格式。
 *
 * @remarks
 * 官方 SillyTavern 路由 `app.use('/proxy/:url(*)', corsProxyMiddleware)` 直接读取 `req.params.url`：
 * - Express 会在首个字面 `?` 处分割 `req.query`，浏览器会丢弃 `#` 片段，导致上游查询参数与签名失效；
 * - Express 匹配 `:url(*)` 时会对捕获结果执行一次 `decodeURIComponent()`。
 * 因此仅对 `%`、`?`、`#` 做单次转义（保留 `http(s)://` 与路径 `/` 原样兼容反代与既有用例），
 * 即可在 Express `skipCsrfProtection` 与单次解码后完整还原原始 URL。
 */
export function buildRelayProxyUrl(endpoint: string): string {
    if (endpoint.startsWith('/proxy/')) {
        return endpoint;
    }
    const encoded = endpoint
        .replace(/%/g, '%25')
        .replace(/\?/g, '%3F')
        .replace(/#/g, '%23');
    return `/proxy/${encoded}`;
}

/**
 * 将 `/proxy/` 后的编码目标地址还原为人类可读的原始 URL。
 * 按从左到右单遍匹配还原，行为与 Express 单次 `decodeURIComponent` 一致且不改写无关百分比序列。
 */
export function decodeRelayDisplayUrl(rawTarget: string): string {
    return rawTarget.replace(/%(25|3F|23)/gi, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
    );
}

interface HtmlFallbackInspection {
    readonly isTauriHtml: boolean;
    readonly title?: string;
    readonly snippet: string;
}

/** 判断文本前导特征是否属于 HTML 网页而非 API JSON/二进制响应 */
function looksLikeHtmlDocument(text: string): boolean {
    const trimmed = text.trimStart();
    if (!trimmed) {
        return false;
    }
    return (
        /^<!doctype\s+html/i.test(trimmed) ||
        /^<html[\s>]/i.test(trimmed) ||
        /^<head[\s>]/i.test(trimmed) ||
        /^<meta[\s>]/i.test(trimmed) ||
        /<title>[^<]*tauritavern/i.test(trimmed) ||
        /<meta[^>]+name=["']theme-color["']/i.test(trimmed)
    );
}

function extractHtmlTitle(text: string): string | undefined {
    const match = text.match(/<title>([^<]{1,120})<\/title>/i);
    const cleaned = match?.[1]?.trim();
    return cleaned || undefined;
}

async function readBoundedPrefixFromResponse(
    response: Response,
    maxChars: number,
    signal?: AbortSignal
): Promise<string> {
    if (typeof response.clone !== 'function') {
        return '';
    }
    const cloned = response.clone();
    if (cloned.body && typeof cloned.body.getReader === 'function') {
        const reader = cloned.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let collected = '';
        try {
            while (collected.length < maxChars) {
                const { value, done } = await raceWithAbort(reader.read(), signal);
                if (done || !value) break;
                collected += decoder.decode(value, { stream: true });
            }
            collected += decoder.decode();
        } finally {
            try {
                await reader.cancel();
            } catch {
                // 忽略流取消阶段残留异常
            }
        }
        return collected.slice(0, maxChars);
    }
    if (typeof cloned.text === 'function') {
        const full = await raceWithAbort(cloned.text(), signal);
        return full.slice(0, maxChars);
    }
    return '';
}

/**
 * 检查响应是否意外落入 SPA HTML 回退页（如 TauriTavern 未实现 `/proxy/` 时返回首页 HTML）。
 * 注意：SillyTavern `forwardFetchResponse()` 在 `200 OK` 时可能不复制上游 `Content-Type` 头，
 * 部分静态服务器也可能以 `text/plain` 返回回退 HTML；因此对空类型或 `text/plain` 必须结合内容前缀判定，
 * 严禁因缺失响应头误拒合法二进制/JSON 响应。
 */
async function inspectHtmlFallbackResponse(
    response: Response,
    signal?: AbortSignal
): Promise<HtmlFallbackInspection | null> {
    const rawHeader =
        typeof response.headers?.get === 'function' ? response.headers.get('content-type') : '';
    const contentType = (rawHeader || '').trim().toLowerCase().split(';')[0];

    const safeBinaryOrStructuredPrefixes = [
        'application/json',
        'application/zip',
        'application/x-zip',
        'application/octet-stream',
        'image/',
        'audio/',
        'video/',
    ];
    if (contentType && safeBinaryOrStructuredPrefixes.some((p) => contentType.startsWith(p))) {
        return null;
    }

    const isDeclaredHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml';
    if (!isDeclaredHtml && contentType && contentType !== 'text/plain') {
        return null;
    }

    const snippet = await readBoundedPrefixFromResponse(response, isDeclaredHtml ? 2048 : 512, signal);
    if (!isDeclaredHtml && !looksLikeHtmlDocument(snippet)) {
        return null;
    }

    const title = extractHtmlTitle(snippet);
    const isTauriHtml =
        /tauritavern/i.test(snippet) || (typeof title === 'string' && /tauritavern/i.test(title));
    return {
        isTauriHtml,
        title,
        snippet: snippet
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 200),
    };
}

function buildHtmlProxyFallbackMessage(displayUrl: string, inspection: HtmlFallbackInspection): string {
    if (inspection.isTauriHtml) {
        return getTauriRelayUnsupportedMessage(displayUrl);
    }
    const titleHint = inspection.title ? `（页面标题: ${inspection.title}）` : '';
    return `酒馆代理请求未命中服务端 /proxy/ 转发接口，宿主返回了 HTML 网页内容${titleHint} [${displayUrl}]。请检查：(1) 当前宿主是否为支持 /proxy/ 的 SillyTavern Node 服务（TauriTavern 等前端外壳不支持酒馆代理，请改用「浏览器直连」）；(2) 若前端部署在 Nginx/Caddy 等反向代理后方，请检查反代配置是否将 /proxy/ 路径回退到了前端 index.html。`;
}

function isGenericGatewayServerErrorText(rawText: string): boolean {
    const trimmed = rawText.trim();
    return !trimmed || trimmed === 'Internal Server Error' || /^Error in CORS proxy/i.test(trimmed);
}

function isAuthFailureSignal(
    status: number,
    statusText: string,
    rawText: string,
    isRelayMode: boolean
): boolean {
    if (status === 401 || status === 403) {
        return true;
    }
    // 官方 SillyTavern util.js forwardFetchResponse() 会刻意将上游 401 改写为 400 并保留 statusText/响应体
    if (isRelayMode && status === 400) {
        if (statusText.trim().toLowerCase() === 'unauthorized') {
            return true;
        }
        return /unauthorized|incorrect access key|invalid[\s_-]*(api[\s_-]*)?key|invalid[\s_-]*token|authentication failed|not authorized/i.test(
            rawText
        );
    }
    return false;
}

/**
 * 从 HttpError.details 或纯文本中提取简洁可读的错误摘要。
 */
export function extractBriefErrorDetail(details: unknown, maxLen = 260): string | undefined {
    if (!details) return undefined;
    if (typeof details === 'string') {
        const cleaned = details.replace(/\s+/g, ' ').trim();
        return cleaned ? cleaned.slice(0, maxLen) : undefined;
    }
    if (typeof details === 'object' && !Array.isArray(details)) {
        const rec = details as Record<string, unknown>;
        const nestedErr =
            typeof rec.error === 'object' && rec.error !== null
                ? (rec.error as Record<string, unknown>)
                : undefined;
        const candidate =
            (typeof rec.error === 'string' && rec.error) ||
            (typeof nestedErr?.message === 'string' && nestedErr.message) ||
            (typeof rec.message === 'string' && rec.message) ||
            (typeof rec.detail === 'string' && rec.detail) ||
            (typeof rec.msg === 'string' && rec.msg);
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim().slice(0, maxLen);
        }
    }
    return undefined;
}

/**
 * 统一解析生图请求抛出的 HttpError：
 * - 若属于代理/宿主传输边界诊断错误，优先返回完整原因与排错方案，避免被上层包装吞没；
 * - 若属于服务端业务响应错误，则交由各提供方解析器提取上游错误详情并平滑回退。
 */
export function resolveHttpErrorMessage(
    err: HttpError,
    extractUpstreamDetail?: (details: unknown) => string | undefined | null
): string {
    if (err.isTransportDiagnostic && err.statusText) {
        return err.statusText;
    }
    const upstream = extractUpstreamDetail?.(err.details) ?? extractBriefErrorDetail(err.details);
    if (upstream) {
        return upstream;
    }
    if (err.statusText && err.statusText.trim()) {
        return `HTTP ${err.status} ${err.statusText.trim()}`;
    }
    return `HTTP ${err.status}`;
}

/**
 * 按当前连接通道、宿主环境与生图服务生成上下文精准的连接排查指引。
 */
export function buildTransportTroubleshootingLines(options: {
    readonly transport: TransportMode;
    readonly providerType?: ProviderType;
    readonly hostRuntime?: HostRuntimeInfo;
}): string[] {
    const runtime = options.hostRuntime ?? detectHostRuntime();
    const providerType = options.providerType;
    const isLocalSelfHosted = providerType === 'comfyui' || providerType === 'sdwebui';

    if (options.transport === 'relay') {
        if (runtime.isTauriTavern) {
            return [
                '1. 当前宿主为 TauriTavern，原生不提供 SillyTavern /proxy/ 转发接口，无法使用「酒馆代理」；',
                '2. 请前往「插件设置 -> 连接方式」切换为「浏览器直连」；',
                isLocalSelfHosted
                    ? '3. 切换直连后，请确认本机生图服务已启动且启用跨域参数（ComfyUI 加 --enable-cors-header *；SD-WebUI 加 --api --cors-allow-origins=*）。'
                    : '3. 若切为浏览器直连后遇跨域拦截，请改用支持跨域的中转服务地址或在桌面端/支持跨域的客户端运行。',
            ];
        }

        const lines = [
            '1. 确认已在 SillyTavern 根目录 config.yaml 中设置 enableCorsProxy: true 并重启酒馆（或启动命令附加 --corsProxy）；',
            '2. 若目标地址为本机或局域网（127.0.0.1 / 192.168.x.x）且出现 500 错误，请检查 config.yaml 中 privateAddressWhitelist：关闭或将目标 IP 加入 allowedRanges，并查看酒馆终端报错日志；',
        ];
        if (isLocalSelfHosted) {
            lines.push(
                providerType === 'comfyui'
                    ? '3. 注意 ComfyUI 局部重绘因需表单上传文件不支持「酒馆代理」，如需重绘或降低延迟请配置 --enable-cors-header * 并切回「浏览器直连」。'
                    : '3. 请确认 SD-WebUI / Forge 已启动且带 --api 参数，并可在酒馆所在机器直接访问上方地址。'
            );
        } else {
            lines.push(
                '3. 请核对服务端地址（Base URL）、API Key 是否有效，以及酒馆后台所在网络能否正常连通目标接口。'
            );
        }
        return lines;
    }

    if (isLocalSelfHosted) {
        return [
            '1. 请确认本地/局域网生图服务（ComfyUI / SD-WebUI / Forge）已启动，并在浏览器直接打开上方地址确认可访问；',
            '2. 浏览器直连须配置跨域启动参数并重启服务：ComfyUI 添加 --enable-cors-header *（局域网另加 --listen 0.0.0.0），SD-WebUI 添加 --api --cors-allow-origins=*；',
            runtime.supportsRelayProxy
                ? '3. 若酒馆位于远程 HTTPS 域名而本地服务为 HTTP，请在「插件设置」切换为「酒馆代理」（需开启 enableCorsProxy: true）。'
                : '3. 当前 TauriTavern 宿主不支持「酒馆代理」，跨主机或远程场景请使用「浏览器直连」并确保服务端正确返回 CORS 响应头或配置 HTTPS。',
        ];
    }

    return [
        '1. 请核对上方服务商地址 (Base URL) 与 API Key 是否有效（注意官方与第三方中转密钥不可混用）；',
        '2. 若浏览器控制台出现 CORS 跨域或网络拦截错误，请确认服务商支持浏览器直连或更换支持跨域的自定义反代地址；',
        runtime.supportsRelayProxy
            ? '3. 若直连受浏览器跨域限制，可尝试在「插件设置」切换为「酒馆代理」（需酒馆开启 enableCorsProxy: true）。'
            : '3. 当前 TauriTavern 宿主不支持「酒馆代理」，请使用支持跨域的中转接口配合「浏览器直连」。',
    ];
}

/**
 * 大小写不敏感地向请求头字典写入键值（自动覆盖同名不同大小写的旧键）。
 */
function setHeaderCaseInsensitive(
    target: Record<string, string>,
    key: string,
    value: string
): void {
    const lower = key.toLowerCase();
    for (const existingKey of Object.keys(target)) {
        if (existingKey.toLowerCase() === lower && existingKey !== key) {
            delete target[existingKey];
        }
    }
    target[key] = value;
}

/**
 * 大小写不敏感地从请求头字典删除指定键。
 */
function deleteHeaderCaseInsensitive(target: Record<string, string>, key: string): void {
    const lower = key.toLowerCase();
    for (const existingKey of Object.keys(target)) {
        if (existingKey.toLowerCase() === lower) {
            delete target[existingKey];
        }
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
     * 执行外部服务请求（直连或已包装为 `/proxy/...` 的宿主中转请求）。
     *
     * @remarks
     * 负责 Mixed Content 校验、中止与超时组合、HTML 回退页拦截、宿主/代理诊断与瞬态故障重试。
     */
    public async fetchExternal(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const isProxied = url.startsWith('/proxy/http:') || url.startsWith('/proxy/https:');
        const displayUrl = isProxied ? decodeRelayDisplayUrl(url.slice('/proxy/'.length)) : url;
        const isRelayMode = isProxied || options.transport === 'relay';
        const hostRuntime = detectHostRuntime();

        // 显式拦截 Mixed Content：HTTPS 宿主页面直连非安全外部 HTTP 服务时由浏览器安全策略直接阻断
        if (
            !isRelayMode &&
            typeof window !== 'undefined' &&
            window.location?.protocol === 'https:' &&
            url.startsWith('http:')
        ) {
            if (!isLoopbackHost(url)) {
                const guidance = hostRuntime.supportsRelayProxy
                    ? '请在「插件设置 -> 连接方式」切换为“酒馆代理”（需酒馆 config.yaml 开启 enableCorsProxy: true），或为后端服务配置 HTTPS。'
                    : '当前宿主环境不支持“酒馆代理”，请为后端服务配置 HTTPS 或使用本地回环地址访问。';
                throw new Error(
                    `网络请求受阻 (Mixed Content): 当前页面为 HTTPS 协议，浏览器禁止直接请求非安全 HTTP 服务 [${url}]。${guidance}`
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
            let handoffToResponse = false;

            try {
                const response = await fetch(url, { ...init, signal });

                if (!response.ok) {
                    let details: unknown;
                    let rawText = '';
                    try {
                        rawText = await raceWithAbort(response.text(), signal);
                        try {
                            details = JSON.parse(rawText);
                        } catch {
                            details = rawText || undefined;
                        }
                    } catch (readErr: unknown) {
                        if (userSignal?.aborted || timeoutSignal?.aborted) {
                            throw readErr;
                        }
                        details = undefined;
                    }

                    if (response.status === 404 && rawText.includes('CORS proxy is disabled')) {
                        throw new HttpError(
                            404,
                            '酒馆 CORS 代理未开启 (CORS proxy is disabled)：请在 SillyTavern 根目录的 config.yaml 中将 enableCorsProxy 设为 true 后重启酒馆（或启动参数加 --corsProxy），或在「插件设置」中切换为“浏览器直连 (Direct)”模式',
                            displayUrl,
                            details,
                            { isTransportDiagnostic: true }
                        );
                    }

                    if (
                        isProxied &&
                        response.status === 400 &&
                        rawText.includes('Circular requests are not allowed')
                    ) {
                        throw new HttpError(
                            400,
                            `酒馆代理拒绝回环自请求 (Circular requests are not allowed) [${displayUrl}]：目标地址与当前 SillyTavern 同源，请直接访问同源路径或使用“浏览器直连”模式`,
                            displayUrl,
                            details,
                            { isTransportDiagnostic: true }
                        );
                    }

                    if (
                        isRelayMode &&
                        response.status === 403 &&
                        /csrf|forbidden/i.test(rawText || response.statusText)
                    ) {
                        throw new HttpError(
                            403,
                            `酒馆宿主 CSRF 校验失败或会话已过期 (HTTP 403)：请刷新 SillyTavern 页面获取最新认证令牌后重试 [${displayUrl}]`,
                            displayUrl,
                            details,
                            { isTransportDiagnostic: true }
                        );
                    }

                    // 遇到明确的端口连接拒绝或主机无法解析，判定为后端服务未就绪，直接阻断，禁止重试
                    const isConnectionRefused =
                        rawText.includes('ECONNREFUSED') ||
                        rawText.includes('ENOTFOUND') ||
                        rawText.includes('Failed to connect');
                    if (isConnectionRefused) {
                        const prefix = isProxied
                            ? '酒馆代理转发失败，后端服务未启动或连接被拒绝 (ECONNREFUSED)'
                            : '后端服务未启动或连接被拒绝 (ECONNREFUSED)';
                        throw new HttpError(
                            response.status,
                            `${prefix}: 请检查生图服务是否在目标端口正常运行 [${displayUrl}]`,
                            displayUrl,
                            details,
                            { isTransportDiagnostic: true }
                        );
                    }

                    // 官方 SillyTavern corsProxy.js 在代理 fetch 抛异常（如 privateAddressWhitelist 拦截、ECONNREFUSED、TLS/DNS 错误）时统一返回 HTTP 500 Internal Server Error
                    if (
                        isProxied &&
                        response.status === 500 &&
                        isGenericGatewayServerErrorText(rawText)
                    ) {
                        const hint = isPrivateOrLoopbackHost(displayUrl)
                            ? `酒馆代理转发本地/内网地址失败 (HTTP 500) [${displayUrl}]：可能原因包括 (1) 目标生图服务未启动或端口不可达；(2) SillyTavern 开启了 SSRF 防护 (privateAddressWhitelist.enabled: true) 拦截了本机或内网访问，请在 config.yaml 的 privateAddressWhitelist.allowedRanges 中放行该地址，或同机改用“浏览器直连”；(3) 请查看 SillyTavern 终端日志确认具体报错。`
                            : `酒馆代理转发请求失败 (HTTP 500) [${displayUrl}]：SillyTavern 后台请求上游服务时发生连接异常（超时、DNS 解析失败、TLS 证书错误或后台 requestProxy 配置异常），请查看 SillyTavern 终端输出确认详细错误。`;
                        throw new HttpError(500, hint, displayUrl, details, {
                            isTransportDiagnostic: true,
                        });
                    }

                    const isAuthError = isAuthFailureSignal(
                        response.status,
                        response.statusText,
                        rawText,
                        isRelayMode
                    );
                    const error = new HttpError(
                        response.status,
                        response.statusText,
                        displayUrl,
                        details,
                        isAuthError ? { isAuthError: true } : undefined
                    );

                    // 判断是否属于可重试的瞬态状态
                    if (attempt < maxAttempts - 1 && TRANSIENT_STATUSES.has(response.status)) {
                        lastError = error;
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 5000);
                        await sleepWithSignal(backoffMs, userSignal);
                        continue;
                    }

                    throw error;
                }

                // 宿主 /proxy/* 路由若缺失，静态前端（如 TauriTavern）或反代回退会返回 200 HTML；须显式拦截且不重试
                if (isProxied) {
                    const htmlFallback = await inspectHtmlFallbackResponse(response, signal);
                    if (htmlFallback) {
                        throw new HttpError(
                            502,
                            buildHtmlProxyFallbackMessage(displayUrl, htmlFallback),
                            displayUrl,
                            htmlFallback.snippet || undefined,
                            { isTransportDiagnostic: true }
                        );
                    }
                }

                handoffToResponse = true;
                return attachResponseAbortCleanup(response, signal, cleanup);
            } catch (err: unknown) {
                lastError = err;
                // 若用户已主动取消或本次请求已达到超时阈值，不执行重试
                if (userSignal?.aborted || timeoutSignal?.aborted) {
                    throw err;
                }

                // HttpError 的重试决策已在 response.ok 判断分支中处理完毕，不在此处二次重试
                if (err instanceof HttpError) {
                    throw err;
                }

                // 统一包装浏览器底层 Failed to fetch，区分酒馆代理与浏览器直连给出准确排查指引
                if (err instanceof TypeError && err.message?.includes('fetch')) {
                    const directRelayHint = hostRuntime.supportsRelayProxy
                        ? '如需规避跨域可在「插件设置」中切换为“酒馆代理”（需酒馆开启 enableCorsProxy: true）。'
                        : '当前宿主为 TauriTavern，不支持“酒馆代理”，请为生图后端配置跨域头 (CORS) 或改用支持跨域的中转服务地址。';
                    const enhancedError = new Error(
                        isRelayMode
                            ? `网络连接失败 (Failed to fetch): 无法连接宿主代理接口 [${url}]（目标地址: ${displayUrl}）。请确认 SillyTavern 服务端正在运行且网络连接正常。`
                            : `网络连接失败 (Failed to fetch): 无法访问服务地址 [${url}]。请确认后端服务是否已正常启动、地址与端口是否正确，或检查是否存在跨域 (CORS) 限制。${directRelayHint}`
                    );
                    lastError = enhancedError;
                    if (attempt >= maxAttempts - 1) {
                        throw enhancedError;
                    }
                }

                if (attempt < maxAttempts - 1) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 5000);
                    await sleepWithSignal(backoffMs, userSignal);
                    continue;
                }

                throw lastError;
            } finally {
                if (!handoffToResponse) {
                    cleanup();
                }
            }
        }

        throw lastError;
    }

    /**
     * 执行经由 SillyTavern 宿主代理或宿主本地同源的接口请求。
     *
     * @remarks
     * 1. 若检测到 TauriTavern 外壳且目标为外部 `http(s)://` 地址，显式报错拒绝，不做隐性降级；
     * 2. 宿主同源路径（如 `/api/...`）：自动合并宿主环境 CSRF 认证头；
     * 3. 外部跨域目标：通过 `buildRelayProxyUrl()` 编码 `%`/`?`/`#` 后经 `/proxy/:url(*)` 中转，保留查询参数并附带宿主 CSRF 凭据；
     * 4. 请求头大小写归一化合并，且在无请求体（GET / HEAD）或 `FormData` 时自动剔除宿主默认附带的 `Content-Type`。
     */
    public async fetchHost(endpoint: string, options: HttpRequestOptions = {}): Promise<Response> {
        const alreadyProxied =
            endpoint.startsWith('/proxy/http:') || endpoint.startsWith('/proxy/https:');
        const isHostOrigin = alreadyProxied || isHostOriginEndpoint(endpoint);
        let targetUrl = endpoint;
        const mergedHeaders: Record<string, string> = {};

        if (isHostOrigin) {
            for (const [k, v] of Object.entries(getHostRequestHeaders())) {
                setHeaderCaseInsensitive(mergedHeaders, k, v);
            }
        } else if (endpoint.startsWith('http:') || endpoint.startsWith('https:')) {
            const hostRuntime = detectHostRuntime();
            if (!hostRuntime.supportsRelayProxy) {
                throw new HttpError(
                    501,
                    getTauriRelayUnsupportedMessage(endpoint),
                    endpoint,
                    undefined,
                    { isTransportDiagnostic: true }
                );
            }
            targetUrl = buildRelayProxyUrl(endpoint);
            for (const [k, v] of Object.entries(getHostRequestHeaders())) {
                setHeaderCaseInsensitive(mergedHeaders, k, v);
            }
        }

        // 无请求体的 GET/HEAD 请求不保留宿主 getRequestHeaders() 默认附带的 Content-Type: application/json
        const methodUpper = (options.method || 'GET').toUpperCase();
        if (
            (options.body === undefined || options.body === null) &&
            (methodUpper === 'GET' || methodUpper === 'HEAD')
        ) {
            deleteHeaderCaseInsensitive(mergedHeaders, 'Content-Type');
        }

        // 调用方显式请求头大小写不敏感覆盖宿主默认头（支持 Headers 实例、二维数组与普通键值对象）
        if (options.headers) {
            if (typeof Headers !== 'undefined' && options.headers instanceof Headers) {
                options.headers.forEach((value, key) => {
                    setHeaderCaseInsensitive(mergedHeaders, key, value);
                });
            } else if (Array.isArray(options.headers)) {
                for (const [key, value] of options.headers) {
                    setHeaderCaseInsensitive(mergedHeaders, key, value);
                }
            } else {
                for (const [key, value] of Object.entries(options.headers as Record<string, string>)) {
                    setHeaderCaseInsensitive(mergedHeaders, key, value);
                }
            }
        }

        // FormData 请求必须由浏览器自动生成含 boundary 的 multipart/form-data，避免默认 JSON 头破坏二进制上传
        if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
            deleteHeaderCaseInsensitive(mergedHeaders, 'Content-Type');
        }

        return this.fetchExternal(targetUrl, {
            ...options,
            transport: 'relay',
            headers: mergedHeaders,
        });
    }

    /**
     * 测试指定服务接口的连通性与往返延迟。
     *
     * @remarks
     * 内部使用统一 fetch 发起请求，自动识别 HTML 假阳性、代理异常及 401->400 鉴权改写；
     * 测试失败或超时不会抛出异常，而是返回结构化 `PingResult`。
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
            const rawCt =
                typeof response.headers?.get === 'function'
                    ? (response.headers.get('content-type') || '').toLowerCase()
                    : '';
            if (
                response.ok &&
                (rawCt.includes('text/html') || rawCt.includes('application/xhtml+xml'))
            ) {
                RESPONSE_CLEANUPS.get(response)?.();
                return {
                    ok: false,
                    status: response.status,
                    latencyMs: Date.now() - start,
                    isTransportDiagnostic: true,
                    error: `目标地址返回了 HTML 网页而非 API 接口响应 [${url}]：请检查服务地址、接口路径是否正确，或确认服务已正常开启 API`,
                };
            }
            RESPONSE_CLEANUPS.get(response)?.();

            return {
                ok: response.ok,
                status: response.status,
                latencyMs: Date.now() - start,
                error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
            };
        } catch (err: unknown) {
            if (err instanceof HttpError) {
                const brief = extractBriefErrorDetail(err.details, 200);
                const message = err.isTransportDiagnostic
                    ? err.statusText
                    : `HTTP ${err.status}${err.statusText ? ` ${err.statusText}` : ''}${brief && brief !== err.statusText ? ` (${brief})` : ''}`;
                return {
                    ok: false,
                    status: err.status,
                    latencyMs: Date.now() - start,
                    error: message,
                    isTransportDiagnostic: err.isTransportDiagnostic,
                    isAuthError: err.isAuthError,
                };
            }
            return {
                ok: false,
                status: undefined,
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
    const rawSegment = b64.includes(',') ? b64.split(',')[1] : b64;
    const normalized = rawSegment
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const binaryStr = atob(normalized);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

/**
 * 将 Data URL 字符串解码还原为 Blob 对象。
 *
 * @param dataUrl 完整 `data:...` 字符串（支持 Base64 与纯文本百分比编码）
 * @returns 解码后的 Blob；输入无效或格式异常时返回 null
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return null;
    }

    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) {
        return null;
    }

    const header = dataUrl.slice(0, commaIdx);
    const body = dataUrl.slice(commaIdx + 1).trim();
    if (!body) {
        return null;
    }

    const mimeMatch = header.match(/^data:([^;,]+)/i);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/webp';
    const isBase64 = /;base64/i.test(header);

    try {
        if (!isBase64) {
            return new Blob([decodeURIComponent(body)], { type: mimeType });
        }
        return base64ToBlob(body, mimeType);
    } catch {
        return null;
    }
}

/**
 * 将 Blob 二进制对象转换为 Base64 编码字符串。
 *
 * @param blob 待转换的 Blob 对象
 * @param withPrefix 是否保留 `data:<mime>;base64,` 前缀，默认 false 返回不含前缀的 Base64
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
 * 图像输入转换配置项
 */
export interface ImageInputOptions {
    /** 中止信号 */
    signal?: AbortSignal;
    /** 超时时间（毫秒），默认 60000 */
    timeoutMs?: number;
    /** 传输通道（direct | relay） */
    transport?: TransportMode;
    /** 指定转换 MIME 类型，默认为 'image/png' */
    mimeType?: string;
}

/** 判断输入字符串是否为宿主本地同源静态资源路径（注意避开 JPEG Raw Base64 的 /9j/ 前缀） */
function isHostRelativeAssetPath(input: string): boolean {
    if (!input.startsWith('/') || input.startsWith('//') || input.startsWith('/9j/')) {
        return false;
    }
    return (
        /^\/(?:images|user\/images|assets|api|backgrounds|characters)\//.test(input) ||
        /^(?:\/[^/?#\s]+)+\.(?:png|jpe?g|webp|gif|bmp|avif)(?:[?#].*)?$/i.test(input)
    );
}

/**
 * 将 Blob 二进制或 Base64 / URL 图像输入转换为不含前缀的 Base64 字符串。
 *
 * @param input Blob 二进制或 Base64 / URL 字符串（支持 data URI 与宿主相对路径）
 * @param options 转换与拉取选项（AbortSignal、超时与通道）
 * @returns 不含 data URI 前缀的 Base64 编码字符串
 */
export async function imageInputToBase64(input: Blob | string, options?: ImageInputOptions): Promise<string> {
    if (typeof input === 'string') {
        if (
            input.startsWith('blob:') ||
            input.startsWith('http:') ||
            input.startsWith('https:') ||
            isHostRelativeAssetPath(input)
        ) {
            const fetchedBlob = await imageInputToBlob(input, options);
            return blobToBase64(fetchedBlob);
        }
        return input.includes(',') ? input.split(',')[1] : input;
    }
    return blobToBase64(input);
}

/**
 * 将 Blob 或 Base64 / URL 图像输入转换为二进制 Blob 对象。
 *
 * @param input Blob 二进制或 Base64 / URL 字符串（支持宿主相对静态路径）
 * @param mimeTypeOrOptions 图像 MIME 类型或完整转换选项对象
 * @param extraOptions 附加转换选项对象
 * @returns 二进制 Blob 对象
 */
export async function imageInputToBlob(
    input: Blob | string,
    mimeTypeOrOptions: string | ImageInputOptions = 'image/png',
    extraOptions?: ImageInputOptions
): Promise<Blob> {
    if (input instanceof Blob) {
        return input;
    }
    const opts: ImageInputOptions =
        typeof mimeTypeOrOptions === 'string'
            ? { ...extraOptions, mimeType: mimeTypeOrOptions }
            : mimeTypeOrOptions;
    const mimeType = opts.mimeType ?? 'image/png';

    if (typeof input === 'string') {
        if (input.startsWith('http:') || input.startsWith('https:')) {
            const resp = await httpClient.fetch(input, {
                method: 'GET',
                signal: opts.signal,
                timeoutMs: opts.timeoutMs ?? 60000,
                transport: opts.transport,
                retries: 0,
            });
            return await resp.blob();
        }
        if (isHostRelativeAssetPath(input)) {
            const resp = await httpClient.fetchHost(input, {
                method: 'GET',
                signal: opts.signal,
                timeoutMs: opts.timeoutMs ?? 60000,
                retries: 0,
            });
            return await resp.blob();
        }
        if (input.startsWith('blob:')) {
            const resp = await fetch(input, { signal: opts.signal });
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
