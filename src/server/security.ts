/**
 * @module server/security
 * @description 服务端代理安全校验与请求头清洗过滤
 */

import type { Response } from 'express';
import { DEFAULT_SERVER_OPTIONS } from './server-config';

/** 限制访问的云服务元数据端点地址 */
const FORBIDDEN_METADATA_HOSTS = new Set([
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.internal',
    '100.100.100.200',
    '[fd00:ec2::254]'
]);

/** 转发外部请求时需移除的酒馆内部会话头，防止敏感凭据外泄 */
const FORBIDDEN_REQUEST_HEADERS = new Set([
    'cookie',
    'x-csrf-token',
    'x-requested-with',
    'host',
    'origin',
    'referer'
]);

/**
 * 回传客户端时需移除的逐跳传输头 (Hop-by-hop Headers) 及安全隔离字段
 * 包含连接控制、压缩长度字段以及 set-cookie (防止外部服务或第三方反代污染酒馆宿主 Cookie)
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

/** 预置受信任的本地回环主机，允许服务端代理连接同机部署的 SD-WebUI / ComfyUI */
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
 * 校验目标主机名是否符合受信任的安全策略
 *
 * 支持通配放行、本地回环主机、内置已知云服务域名、CIDR 子网掩码与主机名/泛域名精确匹配。
 *
 * @param hostname 目标主机名
 * @param allowedHosts 服务端配置的主机白名单
 */
export function isHostAllowed(
    hostname: string,
    allowedHosts: readonly string[] = []
): boolean {
    const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // 若白名单包含 '*'，则全局放行任意主机
    for (const rule of allowedHosts) {
        if (rule.trim() === '*') {
            return true;
        }
    }

    // 放行本地回环主机 (便于连接同机部署的 SD-WebUI 或 ComfyUI)
    if (DEFAULT_LOOPBACK_HOSTS.has(lower)) {
        return true;
    }

    // 匹配内置受信任的云端生图服务域名
    for (const domain of KNOWN_CLOUD_DOMAINS) {
        if (lower === domain || lower.endsWith(`.${domain}`)) {
            return true;
        }
    }

    // 匹配服务端配置的受信任主机列表（支持 CIDR 子网与主机名/泛域名）
    for (const rule of allowedHosts) {
        const cleanRule = rule.trim().toLowerCase().replace(/^\[|\]$/g, '');
        if (!cleanRule) continue;

        // CIDR 掩码匹配 (如 192.168.0.0/16)
        if (cleanRule.includes('/')) {
            if (matchCidr(lower, cleanRule)) {
                return true;
            }
            continue;
        }

        // 主机名/IP 精确匹配或子域名泛解析匹配
        if (lower === cleanRule || lower.endsWith(`.${cleanRule}`)) {
            return true;
        }
    }

    return false;
}

/**
 * 校验反向代理目标地址是否合法与安全
 *
 * @param targetUrl 外部目标 URL 字符串
 * @param allowedHosts 允许的主机列表 (支持 IP、域名与 CIDR 掩码)
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

    if (FORBIDDEN_METADATA_HOSTS.has(hostname)) {
        return {
            valid: false,
            reason: `禁止访问云端元数据敏感地址 [${hostname}]`
        };
    }

    if (hostname.startsWith('169.254.')) {
        return {
            valid: false,
            reason: `禁止访问链路本地保留地址 [${hostname}]`
        };
    }

    const effectiveAllowed = allowedHosts ?? DEFAULT_SERVER_OPTIONS.allowedHosts;
    if (!isHostAllowed(hostname, effectiveAllowed)) {
        return {
            valid: false,
            reason: `目标主机 [${hostname}] 不在服务端安全白名单中`
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
