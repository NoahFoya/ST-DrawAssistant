import { describe, it, expect } from 'vitest';
import {
    NetworkError,
    isTransientError,
    TRANSIENT_HTTP_STATUSES
} from '../../../../src/client/core/network/error';

describe('Network Error Model & Transient Classifier', () => {
    it('TRANSIENT_HTTP_STATUSES 应包含常见的短时可恢复状态码', () => {
        expect(TRANSIENT_HTTP_STATUSES.has(408)).toBe(true);
        expect(TRANSIENT_HTTP_STATUSES.has(425)).toBe(true);
        expect(TRANSIENT_HTTP_STATUSES.has(429)).toBe(true);
        expect(TRANSIENT_HTTP_STATUSES.has(502)).toBe(true);
        expect(TRANSIENT_HTTP_STATUSES.has(503)).toBe(true);
        expect(TRANSIENT_HTTP_STATUSES.has(504)).toBe(true);

        // 绝不包含不可恢复的客户端/业务错误
        expect(TRANSIENT_HTTP_STATUSES.has(400)).toBe(false);
        expect(TRANSIENT_HTTP_STATUSES.has(401)).toBe(false);
        expect(TRANSIENT_HTTP_STATUSES.has(403)).toBe(false);
        expect(TRANSIENT_HTTP_STATUSES.has(404)).toBe(false);
        expect(TRANSIENT_HTTP_STATUSES.has(200)).toBe(false);
    });

    it('isTransientError 应能准确识别数值状态码', () => {
        expect(isTransientError(429)).toBe(true);
        expect(isTransientError(503)).toBe(true);
        expect(isTransientError(504)).toBe(true);

        expect(isTransientError(400)).toBe(false);
        expect(isTransientError(404)).toBe(false);
        expect(isTransientError(200)).toBe(false);
    });

    it('isTransientError 应能准确识别 NetworkError 实例中的错误码与状态码', () => {
        const timeoutError = new NetworkError({
            message: '请求超时',
            code: 'TIMEOUT',
            targetUrl: 'http://localhost:8188'
        });
        expect(isTransientError(timeoutError)).toBe(true);

        const gatewayError = new NetworkError({
            message: '网关错误',
            code: 'GATEWAY_ERROR',
            targetUrl: 'http://localhost:8188',
            status: 502
        });
        expect(isTransientError(gatewayError)).toBe(true);

        const badRequestError = new NetworkError({
            message: '参数错误',
            code: 'HTTP_ERROR',
            targetUrl: 'http://localhost:8188',
            status: 400
        });
        expect(isTransientError(badRequestError)).toBe(false);
    });

    it('CORS 拦截或网络配置错误生成的 NetworkError 绝不能被误判为瞬态错误', () => {
        // 模拟 client.ts 中直连被 CORS 拦截时生成的标准 NetworkError
        const corsError = new NetworkError({
            message: '直连生图端点失败 [http://192.168.1.50:8188/prompt]: 无法建立连接。可能原因: 1. 端口不通; 2. 浏览器跨域 (CORS) 限制; 原因详情: Failed to fetch',
            code: 'NETWORK_ERROR',
            targetUrl: 'http://192.168.1.50:8188/prompt',
            cause: new TypeError('Failed to fetch')
        });

        // 强类型断言：绝不向下穿透误判为可重试瞬态错误
        expect(isTransientError(corsError)).toBe(false);

        const mixedContentError = new NetworkError({
            message: 'Mixed Content 拦截',
            code: 'MIXED_CONTENT',
            targetUrl: 'http://192.168.1.50:8188'
        });
        expect(isTransientError(mixedContentError)).toBe(false);
    });

    it('底层网络原生抖动异常 (ECONNRESET/ETIMEDOUT) 应被识别为瞬态错误', () => {
        expect(isTransientError(new Error('read ECONNRESET'))).toBe(true);
        expect(isTransientError(new Error('connect ETIMEDOUT'))).toBe(true);
    });

    it('对未知对象或非瞬态输入应安全返回 false', () => {
        expect(isTransientError(null)).toBe(false);
        expect(isTransientError(undefined)).toBe(false);
        expect(isTransientError('some string')).toBe(false);
        expect(isTransientError({ message: 'random' })).toBe(false);
    });
});
