/**
 * 网络请求异常分类与重试检测
 */

import { NetworkErrorCode } from '../../types/common';

export { NetworkErrorCode };

export interface NetworkErrorOptions {
    message: string;
    code: NetworkErrorCode;
    targetUrl: string;
    status?: number;
    cause?: unknown;
    userAdvice?: string;
}

export class NetworkError extends Error {
    public readonly code: NetworkErrorCode;
    public readonly targetUrl: string;
    public readonly status?: number;
    public readonly cause?: unknown;
    public readonly userAdvice?: string;

    constructor(options: NetworkErrorOptions) {
        super(options.message);
        this.name = 'NetworkError';
        this.code = options.code;
        this.targetUrl = options.targetUrl;
        this.status = options.status;
        this.cause = options.cause;
        this.userAdvice = options.userAdvice;

        Object.setPrototypeOf(this, NetworkError.prototype);
    }
}

/** 临时网络抖动或服务端过载状态码，供重试策略参考 */
export const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

/**
 * 判断是否属于临时性可重试错误（超时、网关故障、限流）。
 * 4xx 客户端错误（参数错误、鉴权失败）不可重试。
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
