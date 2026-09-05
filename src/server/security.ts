/**
 * @module server/security
 * @description 服务端代理安全校验与请求头过滤
 */

import type { Response } from 'express';
import { DEFAULT_SERVER_OPTIONS } from './server-config';


/**
 * 转发请求时移除酒馆内部请求头
 * 避免将 Cookie、CSRF Token 等酒馆认证凭据发送给外部生图服务
 */
const FORBIDDEN_REQUEST_HEADERS = new Set([
    'cookie',
    'x-csrf-token',
    'x-requested-with',
    'host',
    'origin',
    'referer'
]);

/**
 * 回传前端时移除的响应头
 * 移除 connection 等逐跳头，并移除 set-cookie 避免外部服务影响酒馆站点的 Cookie
 */
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'content-length',
    'content-encoding',
    'set-cookie'
]);

export interface TargetValidationResult {
    valid: boolean;
    reason?: string;
}

/** 已知的安全云端生图服务域名 */
export const KNOWN_CLOUD_DOMAINS = new Set([
    'image.novelai.net',
    'api.openai.com',
    'api.x.ai',
    'generativelanguage.googleapis.com'
]);

/** 本地回环主机列表，允许服务端代理连接本地部署的 SD-WebUI / ComfyUI */
export const DEFAULT_LOOPBACK_HOSTS = new Set([
    '127.0.0.1',
    'localhost',
    '::1'
]);

/**
 * 解析 IPv4 字符串为 32 位无符号整数
 */
function parseIpv4(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let num = 0;
    for (let i = 0; i < 4; i++) {
        const p = parseInt(parts[i], 10);
        if (isNaN(p) || p < 0 || p > 255 || String(p) !== parts[i]) return null;
        num = (num << 8) | p;
    }
    return num >>> 0;
}

/**
 * 校验指定 IPv4 是否匹配 CIDR 网段规则 (如 192.168.0.0/16, 172.16.0.0/12)
 */
function matchCidr(ipStr: string, cidr: string): boolean {
    const [baseIp, prefixStr] = cidr.split('/');
    if (!baseIp || !prefixStr) return false;
    const prefix = parseInt(prefixStr, 10);
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

    const ipNum = parseIpv4(ipStr);
    const baseNum = parseIpv4(baseIp);
    if (ipNum === null || baseNum === null) return false;

    if (prefix === 0) return true;
    const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (baseNum & mask);
}

/**
 * 校验目标主机名是否符合安全策略
 *
 * 默认策略：若未显式指定限制白名单（即 allowedHosts 为空或含 '*'），则默认放行所有主机；
 * 若用户或管理员显式配置了主机白名单，则严格匹配白名单规则。
 *
 * @param hostname 目标主机名
 * @param allowedHosts 服务端配置的主机白名单
 */
export function isHostAllowed(
    hostname: string,
    allowedHosts: readonly string[] = []
): boolean {
    // 未配置白名单或包含 '*' 时默认放行所有主机
    if (!allowedHosts || allowedHosts.length === 0 || allowedHosts.includes('*')) {
        return true;
    }

    const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // 放行本地回环主机
    if (DEFAULT_LOOPBACK_HOSTS.has(lower)) {
        return true;
    }

    // 匹配内置受信任的云端生图服务域名
    for (const domain of KNOWN_CLOUD_DOMAINS) {
        if (lower === domain || lower.endsWith(`.${domain}`)) {
            return true;
        }
    }

    // 匹配显式配置的规则
    for (const rule of allowedHosts) {
        const cleanRule = rule.trim().toLowerCase().replace(/^\[|\]$/g, '');
        if (!cleanRule) continue;

        if (cleanRule.includes('/')) {
            if (matchCidr(lower, cleanRule)) {
                return true;
            }
            continue;
        }

        if (lower === cleanRule || lower.endsWith(`.${cleanRule}`)) {
            return true;
        }
    }

    return false;
}

/**
 * 校验反向代理目标地址是否合法与可用
 *
 * @param targetUrl 外部目标 URL 字符串
 * @param allowedHosts 允许的主机列表 (可选，未指定或为空时放行任意合法 HTTP/HTTPS 目标)
 */
export function validateTargetUrl(
    targetUrl: string,
    allowedHosts?: readonly string[]
): TargetValidationResult {
    if (!targetUrl || typeof targetUrl !== 'string') {
        return { valid: false, reason: '目标 URL 不能为空' };
    }

    let parsed: URL;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return { valid: false, reason: '目标 URL 格式不符合标准规范' };
    }

    // 仅允许标准 HTTP 与 HTTPS 协议
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
            valid: false,
            reason: `不支持的网络协议 [${parsed.protocol}]，仅允许 http: 与 https:`
        };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) {
        return { valid: false, reason: '目标 URL 缺少有效主机名' };
    }

    const effectiveAllowed = allowedHosts ?? DEFAULT_SERVER_OPTIONS.allowedHosts;
    if (!isHostAllowed(hostname, effectiveAllowed)) {
        return {
            valid: false,
            reason: `目标主机 [${hostname}] 不在服务端配置的安全白名单中`
        };
    }

    return { valid: true };
}

/**
 * 过滤外部请求头，移除酒馆自身的敏感会话字段
 */
export function sanitizeRequestHeaders(headers: Record<string, string> = {}): Record<string, string> {
    const cleaned: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        if (FORBIDDEN_REQUEST_HEADERS.has(lowerKey)) {
            continue;
        }
        cleaned[key] = value;
    }

    return cleaned;
}

/**
 * 复制上游生图服务的响应头至客户端响应，同时剔除逐跳传输与压缩相关头部
 */
export function filterSafeResponseHeaders(upstreamHeaders: Headers, res: Response): void {
    for (const [key, value] of upstreamHeaders.entries()) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_RESPONSE_HEADERS.has(lower)) {
            continue;
        }
        res.setHeader(key, value);
    }
}
