import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkClient, isLoopbackHost, NetworkError } from '../../../../src/client/core/network';

describe('NetworkClient', () => {
    let mockCsrfProvider: ReturnType<typeof vi.fn>;
    let mockGetProxyMode: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockCsrfProvider = vi.fn().mockReturnValue({ 'X-CSRF-Token': 'test-token-123' });
        mockGetProxyMode = vi.fn().mockReturnValue('browser');
    });

    describe('isLoopbackHost', () => {
        it('应准确识别本地回环主机名', () => {
            expect(isLoopbackHost('localhost')).toBe(true);
            expect(isLoopbackHost('127.0.0.1')).toBe(true);
            expect(isLoopbackHost('[::1]')).toBe(true);
            expect(isLoopbackHost('::1')).toBe(true);
            expect(isLoopbackHost('192.168.1.100')).toBe(false);
            expect(isLoopbackHost('api.openai.com')).toBe(false);
        });
    });

    describe('isMixedContent', () => {
        it('在非 HTTPS 环境下不应触发 Mixed Content 判定', () => {
            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });
            expect(client.isMixedContent('http://127.0.0.1:8188')).toBe(false);
            expect(client.isMixedContent('http://192.168.1.50:8188')).toBe(false);
        });

        it('在 HTTPS 环境下，本地回环地址享有豁免权，不判定为 Mixed Content', () => {
            const originalLocation = window.location;
            try {
                Object.defineProperty(window, 'location', {
                    value: { protocol: 'https:' },
                    writable: true,
                    configurable: true
                });

                const client = new NetworkClient({
                    csrfHeadersProvider: mockCsrfProvider,
                    getProxyMode: mockGetProxyMode
                });
                // 本地回环豁免
                expect(client.isMixedContent('http://127.0.0.1:8188/prompt')).toBe(false);
                expect(client.isMixedContent('http://localhost:8188/prompt')).toBe(false);
                // 远端 HTTP 正确识别为 Mixed Content
                expect(client.isMixedContent('http://192.168.1.100:8188')).toBe(true);
                // 远端 HTTPS 正常放行
                expect(client.isMixedContent('https://image.novelai.net')).toBe(false);
            } finally {
                Object.defineProperty(window, 'location', {
                    value: originalLocation,
                    writable: true,
                    configurable: true
                });
            }
        });
    });

    describe('fetchHost (同源请求)', () => {
        it('应自动附加 CSRF 标头与 XMLHttpRequest 标识', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
            globalThis.fetch = mockFetch;

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });

            await client.fetchHost('/api/plugins/test');

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[0]).toBe('/api/plugins/test');
            expect(callArgs[1].headers).toEqual(
                expect.objectContaining({
                    'X-CSRF-Token': 'test-token-123',
                    'X-Requested-With': 'XMLHttpRequest'
                })
            );
        });

        it('遇到 403 错误应刷新 CSRF 标头并自动重试一次', async () => {
            let callCount = 0;
            const mockFetch = vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve(new Response('Forbidden', { status: 403 }));
                }
                return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
            });
            globalThis.fetch = mockFetch;

            mockCsrfProvider
                .mockReturnValueOnce({ 'X-CSRF-Token': 'old-token' })
                .mockReturnValueOnce({ 'X-CSRF-Token': 'new-refreshed-token' });

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });

            const resp = await client.fetchHost('/api/test-403');
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockCsrfProvider).toHaveBeenCalledTimes(2);
        });

        it('当请求体为 FormData 时不应强制附加 application/json 标头', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
            globalThis.fetch = mockFetch;

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });

            const formData = new FormData();
            formData.append('file', new Blob(['data']), 'test.png');

            await client.fetchHost('/api/upload', {
                method: 'POST',
                body: formData
            });

            const callHeaders = mockFetch.mock.calls[0][1].headers;
            expect(callHeaders['Content-Type']).toBeUndefined();
            expect(callHeaders['X-Requested-With']).toBe('XMLHttpRequest');
        });

        it('应正确规范化标准 Headers 实例', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
            globalThis.fetch = mockFetch;

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });

            const headers = new Headers();
            headers.append('X-Custom-Foo', 'bar');

            await client.fetchHost('/api/custom-headers', {
                headers
            });

            const callHeaders = mockFetch.mock.calls[0][1].headers;
            expect(callHeaders['X-Custom-Foo']).toBe('bar');
        });
    });

    describe('fetchExternal (外部生图请求)', () => {
        it('在 browser 模式下应直连目标端点并显式设置 credentials: omit', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
            globalThis.fetch = mockFetch;

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: () => 'browser'
            });

            await client.fetchExternal('http://192.168.1.50:8188/prompt', { method: 'POST' });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[0]).toBe('http://192.168.1.50:8188/prompt');
            expect(callArgs[1].credentials).toBe('omit');
        });

        it('在 browser 模式下若遇远端 Mixed Content 应抛出 NetworkError (code: MIXED_CONTENT)', async () => {
            const originalLocation = window.location;
            try {
                Object.defineProperty(window, 'location', {
                    value: { protocol: 'https:' },
                    writable: true,
                    configurable: true
                });

                const client = new NetworkClient({
                    csrfHeadersProvider: mockCsrfProvider,
                    getProxyMode: () => 'browser'
                });

                try {
                    await client.fetchExternal('http://192.168.1.50:8188/prompt');
                    expect.unreachable('应抛出 NetworkError');
                } catch (err: any) {
                    expect(err).toBeInstanceOf(NetworkError);
                    expect(err.code).toBe('MIXED_CONTENT');
                }
            } finally {
                Object.defineProperty(window, 'location', {
                    value: originalLocation,
                    writable: true,
                    configurable: true
                });
            }
        });

        it('在 browser 模式下直连失败 (如 CORS 拦截) 应抛出 NetworkError (code: NETWORK_ERROR)', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: () => 'browser'
            });

            try {
                await client.fetchExternal('http://192.168.1.50:8188/prompt');
                expect.unreachable('应抛出 NetworkError');
            } catch (err: any) {
                expect(err).toBeInstanceOf(NetworkError);
                expect(err.code).toBe('NETWORK_ERROR');
                expect(err.message).toContain('直连生图端点失败');
            }
        });

        it('在 server 模式下应通过服务端代理接口中继请求并传递强类型参数', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
            globalThis.fetch = mockFetch;

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: () => 'server'
            });

            await client.fetchExternal('http://192.168.1.50:8188/sdapi/v1/txt2img', {
                method: 'POST',
                body: JSON.stringify({ prompt: 'cat' })
            });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[0]).toBe('/api/plugins/st-drawassistant/proxy');
            expect(callArgs[1].method).toBe('POST');
            const parsedBody = JSON.parse(callArgs[1].body);
            expect(parsedBody.url).toBe('http://192.168.1.50:8188/sdapi/v1/txt2img');
        });

        it('在 server 模式下若代理返回 502 应对称抛出 NetworkError (code: GATEWAY_ERROR)', async () => {
            const errorPayload = {
                error: 'Bad Gateway: 宿主服务端无法连接至生图端点',
                code: 'BAD_GATEWAY',
                details: 'ECONNREFUSED'
            };
            const mockFetch = vi.fn().mockResolvedValue(
                new Response(JSON.stringify(errorPayload), { status: 502 })
            );
            globalThis.fetch = mockFetch;

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: () => 'server'
            });

            try {
                await client.fetchExternal('http://192.168.1.50:8188/prompt');
                expect.unreachable('应抛出 NetworkError');
            } catch (err: any) {
                expect(err).toBeInstanceOf(NetworkError);
                expect(err.code).toBe('GATEWAY_ERROR');
                expect(err.status).toBe(502);
                expect(err.message).toContain('Bad Gateway');
            }
        });

        it('在 server 模式下若上游后端返回业务报错 (如 400 提示词校验失败) 应原样回传 Response', async () => {
            const upstreamError = {
                error: { type: 'prompt_outputs_failed', message: 'Prompt has no outputs' }
            };
            const mockFetch = vi.fn().mockResolvedValue(
                new Response(JSON.stringify(upstreamError), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                })
            );
            globalThis.fetch = mockFetch;

            const client = new NetworkClient({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: () => 'server'
            });

            const resp = await client.fetchExternal('http://192.168.1.50:8188/prompt');
            expect(resp.status).toBe(400);
            const data = await resp.json();
            expect(data).toEqual(upstreamError);
        });
    });
});
