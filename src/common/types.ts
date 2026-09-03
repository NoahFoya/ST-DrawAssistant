/**
 * @file src/common/types.ts
 * @description 跨端共享通用基础类型与通信契约定义
 */

/** 可注销与可释放资源的通用接口 */
export interface IDisposable {
    dispose(): void;
}

export function toDisposable(fn: () => void): IDisposable {
    let isDisposed = false;
    return {
        dispose: () => {
            if (!isDisposed) {
                isDisposed = true;
                try {
                    fn();
                } catch {
                    // 捕获清理回调抛出的异常，避免中断后续全局资源的释放流程
                }
            }
        }
    };
}

/** 跨端反向代理中继请求载荷 */
export interface ProxyRelayPayload {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    timeoutMs?: number;
}

/** 反向代理错误响应载荷 */
export interface ProxyErrorPayload {
    error: string;
    code: 'BAD_REQUEST' | 'BAD_GATEWAY' | 'GATEWAY_TIMEOUT' | 'SECURITY_BLOCKED' | 'CLIENT_CLOSED';
    targetUrl?: string;
    details?: unknown;
}

/** 网络通信错误代码枚举 */
export type NetworkErrorCode =
    | 'MIXED_CONTENT'
    | 'TIMEOUT'
    | 'ABORTED'
    | 'GATEWAY_ERROR'
    | 'SECURITY_BLOCKED'
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR';
