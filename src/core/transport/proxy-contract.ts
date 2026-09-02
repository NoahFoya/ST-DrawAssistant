/**
 * @module core/transport/proxy-contract
 * @description 客户端与服务端插件通信数据格式定义
 */

/** 反向代理请求数据结构 */
export interface ProxyHttpRequest {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}

/** 反向代理响应数据结构 */
export interface ProxyHttpResponse<T = unknown> {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: T;
}

/** 服务端插件信息声明 */
export interface ServerPluginInfo {
    name: string;
    version: string;
    features: {
        httpProxy: boolean;
        configSync: boolean;
    };
}
