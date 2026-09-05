/**
 * @module common/types
 * @description 前后端通用的基础类型与接口定义
 */

/** 资源释放接口 */
export interface IDisposable {
    dispose(): void;
}

/**
 * 将清理函数包装为只执行一次的 IDisposable 对象
 * 内部会捕获并记录异常，避免影响其他资源的释放流程
 */
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

/**
 * 资源收集与批量清理容器 (DisposableStore)
 * 统一管理子项生命周期，支持级联与批量释放，防止内存泄露
 */
export class DisposableStore implements IDisposable {
    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    /** 容器是否已完成释放 */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /** 注册一个可释放对象进入容器管理 */
    public add<T extends IDisposable>(item: T): T {
        if (!item) {
            return item;
        }

        if (this._isDisposed) {
            try {
                item.dispose();
            } catch (error) {
                console.error('[DisposableStore] 释放已注销项时发生异常:', error);
            }
            return item;
        }

        this._disposables.push(item);
        return item;
    }

    /** 清空当前容器中管理的所有资源，并按注册逆序逐一执行 dispose() */
    public clear(): void {
        while (this._disposables.length > 0) {
            const item = this._disposables.pop();
            try {
                item?.dispose();
            } catch (error) {
                console.error('[DisposableStore] 清理资源时发生异常:', error);
            }
        }
    }

    /** 释放容器持有的所有资源，并将容器永久标记为已销毁 */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this.clear();
    }
}

/**
 * 服务端反向代理请求参数
 */
export interface ProxyRelayRequest {
    /** 目标服务绝对 URL 地址 */
    url: string;
    /** HTTP 请求方法，默认为 GET */
    method?: string;
    /** 转发请求头字典 (敏感内部头将在服务端网关被过滤移除) */
    headers?: Record<string, string>;
    /** 请求体内容 (字符串或待序列化的 JSON 对象) */
    body?: string | Record<string, unknown>;
    /** 请求超时控制毫秒数 */
    timeoutMs?: number;
    /**
     * 云端服务类型标识
     * 指定时由服务端自动根据配置安全注入对应的 Authorization/API-Key 凭据
     */
    serviceType?: 'novelai' | 'openai' | 'gemini' | 'grok';
}

/**
 * 服务端反向代理统一错误响应结构
 */
export interface ProxyErrorResponse {
    /** 人类可读的错误描述信息 */
    error: string;
    /**
     * 标准化错误分类代码
     * - BAD_REQUEST: 请求格式不合法或缺少关键参数 (400)
     * - BAD_GATEWAY: 无法连接目标服务或目标服务网络不可达 (502)
     * - GATEWAY_TIMEOUT: 代理请求目标服务等待超时 (504)
     * - SECURITY_BLOCKED: 目标地址未通过安全网关策略检验 (403)
     * - CLIENT_CLOSED: 客户端主动断开或取消连接 (499)
     */
    code: 'BAD_REQUEST' | 'BAD_GATEWAY' | 'GATEWAY_TIMEOUT' | 'SECURITY_BLOCKED' | 'CLIENT_CLOSED';
    /** 触发异常的目标 URL 地址 */
    targetUrl?: string;
    /** 调试诊断细节 (仅在服务端开启日志或非关键错误时携带) */
    details?: unknown;
}

/**
 * 客户端网络通信错误代码枚举
 * - MIXED_CONTENT: HTTPS 页面直连 HTTP 外部非回环服务被浏览器安全限制阻断
 * - TIMEOUT: 请求耗时超出设定阈值触发超时中断
 * - ABORTED: 用户或调度器主动取消任务
 * - GATEWAY_ERROR: 服务端代理请求失败 (如 502/504)
 * - SECURITY_BLOCKED: 目标地址被安全网关拦截 (403)
 * - NETWORK_ERROR: 网络无法连接、DNS 解析失败或浏览器跨域 (CORS) 拦截
 * - HTTP_ERROR: 上游服务返回 4xx/5xx 等异常状态码
 */
export type NetworkErrorCode =
    | 'MIXED_CONTENT'
    | 'TIMEOUT'
    | 'ABORTED'
    | 'GATEWAY_ERROR'
    | 'SECURITY_BLOCKED'
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR';
