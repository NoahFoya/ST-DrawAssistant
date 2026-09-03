/**
 * @module server/security
 * @description 服务端辅助插件安全网关与标头过滤处理
 */

import type { Response } from 'express';

/** 限制访问的云服务元数据端点地址 */
const FORBIDDEN_METADATA_HOSTS = new Set([
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.internal',
    '100.100.100.200',
    '[fd00:ec2::254]'
]);

/** 需显式剥离的酒馆宿主内部敏感会话标头 */
const FORBIDDEN_REQUEST_HEADERS = new Set([
    'cookie',
    'x-csrf-token',
    'x-requested-with',
    'host',
    'origin',
    'referer'
]);

/** 响应中必须剥离的逐跳传输标头与报头压缩控制标头 */
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
    'content-encoding'
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
 * 校验指定 IPv4 是否匹配 CIDR 网段规则 (如 192.168.0.0/16)
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
 * 校验目标主机名是否符合受信任的白名单策略
 */
export function isHostAllowed(hostname: string, allowedHosts: readonly string[] = []): boolean {
    const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // 匹配内置受信任的云端生图服务域名
    for (const domain of KNOWN_CLOUD_DOMAINS) {
        if (lower === domain || lower.endsWith(`.${domain}`)) {
            return true;
        }
    }

    // 匹配服务端配置的受信任主机列表（支持通配符、CIDR 子网与域名泛解析）
    for (const rule of allowedHosts) {
        const cleanRule = rule.trim().toLowerCase().replace(/^\[|\]$/g, '');
        if (!cleanRule) continue;

        if (cleanRule === '*') {
            return true;
        }

        // CIDR 掩码匹配 (如 192.168.0.0/16)
        if (cleanRule.includes('/')) {
            if (matchCidr(lower, cleanRule)) {
                return true;
            }
            continue;
        }

        // 主机名/IP 精确或泛域名匹配
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

    // 拦截云服务元数据敏感地址
    if (FORBIDDEN_METADATA_HOSTS.has(hostname)) {
        return {
            valid: false,
            reason: `禁止访问云端元数据敏感地址 [${hostname}]`
        };
    }

    // 拦截链路本地私有保留网段
    if (hostname.startsWith('169.254.')) {
        return {
            valid: false,
            reason: `禁止访问链路本地保留地址 [${hostname}]`
        };
    }

    // 白名单校验 (若提供了 allowedHosts 则强校验)
    if (allowedHosts && allowedHosts.length > 0) {
        if (!isHostAllowed(hostname, allowedHosts)) {
            return {
                valid: false,
                reason: `目标主机 [${hostname}] 不在服务端安全白名单中`
            };
        }
    }

    return { valid: true };
}

/**
 * 清洗外部请求头，剥离酒馆宿主自身敏感会话标头
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
 * 复制上游生图服务的响应标头至客户端响应，剥离逐跳传输与报文压缩标头
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
