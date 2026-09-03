/**
 * @module core/network/error
 * @description 网络通信统一异常模型
 */

import { NetworkErrorCode } from '../../../common';

export { NetworkErrorCode };

export interface NetworkErrorOptions {
    message: string;
    code: NetworkErrorCode;
    targetUrl: string;
    status?: number;
    cause?: unknown;
}

export class NetworkError extends Error {
    public readonly code: NetworkErrorCode;
    public readonly targetUrl: string;
    public readonly status?: number;
    public readonly cause?: unknown;

    constructor(options: NetworkErrorOptions) {
        super(options.message);
        this.name = 'NetworkError';
        this.code = options.code;
        this.targetUrl = options.targetUrl;
        this.status = options.status;
        this.cause = options.cause;

        Object.setPrototypeOf(this, NetworkError.prototype);
    }
}

/** 常见的短时瞬态、可恢复 HTTP 状态码集合 (如超时、限流、网关短暂不可用) */
export const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

/**
 * 判断网络错误或 HTTP 状态码是否属于可重试的短时瞬态错误
 *
 * 覆盖 408、425、429、502、503、504 与 TIMEOUT 超时；
 * 4xx 客户端参数或鉴权错误不纳入瞬态范围。
 *
 * @param error 异常对象或 HTTP 状态码
 */
export function isTransientError(error: unknown): boolean {
    if (typeof error === 'number') {
        return TRANSIENT_HTTP_STATUSES.has(error);
    }
    if (error instanceof NetworkError) {
        if (error.code === 'TIMEOUT' || error.code === 'GATEWAY_ERROR') {
            return true;
        }
        if (typeof error.status === 'number') {
            return TRANSIENT_HTTP_STATUSES.has(error.status);
        }
        // 强类型 NetworkError 若未匹配到超时、网关故障或瞬态状态码，明确判定为不可重试，禁止向下穿透
        return false;
    }
    if (error && typeof error === 'object' && 'status' in error && typeof (error as any).status === 'number') {
        return TRANSIENT_HTTP_STATUSES.has((error as any).status);
    }
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (
            msg.includes('failed to fetch') ||
            msg.includes('econnreset') ||
            msg.includes('etimedout') ||
            msg.includes('timeout')
        ) {
            return true;
        }
    }
    return false;
}
