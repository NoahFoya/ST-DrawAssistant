/**
 * @module core/network/error
 * @description 网络通信统一异常模型
 */

export type NetworkErrorCode =
    | 'MIXED_CONTENT'      // 跨协议混合内容拦截
    | 'NETWORK_ERROR'       // 浏览器直连网络异常或 CORS 拦截
    | 'SECURITY_BLOCKED'   // 目标地址被安全网关策略拦截
    | 'GATEWAY_ERROR'       // 服务端中继连接目标失败
    | 'TIMEOUT'             // 请求超时
    | 'ABORTED'             // 客户端主动取消
    | 'HTTP_ERROR';         // 其他 HTTP 状态异常

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
