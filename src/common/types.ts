/**
 * @file src/common/types.ts
 * @description 前后端通用的基础类型与接口定义
 */

/** 资源释放接口 */
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
                } catch (err) {
                    console.warn('[ST-DrawAssistant] 资源释放回调执行异常:', err);
                }
            }
        }
    };
}

/** 服务端代理请求参数 */
export interface ProxyRelayPayload {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    timeoutMs?: number;
}

/** 服务端代理错误响应数据 */
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
