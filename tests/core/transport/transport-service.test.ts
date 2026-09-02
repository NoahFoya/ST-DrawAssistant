import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransportService } from '../../../src/core/transport/transport-service';

describe('TransportService', () => {
    let mockCsrfProvider: ReturnType<typeof vi.fn>;
    let mockGetProxyMode: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockCsrfProvider = vi.fn().mockReturnValue({ 'X-CSRF-Token': 'test-token-123' });
        mockGetProxyMode = vi.fn().mockReturnValue('browser');
    });

    describe('isMixedContent', () => {
        it('在非 HTTPS 环境下不应触发 Mixed Content 判定', () => {
            const transport = new TransportService({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });
            expect(transport.isMixedContent('http://127.0.0.1:8188')).toBe(false);
        });
    });

    describe('fetchHost (同源请求)', () => {
        it('应自动附加 CSRF 标头与 XMLHttpRequest 标识', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
            globalThis.fetch = mockFetch;

            const transport = new TransportService({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });

            await transport.fetchHost('/api/plugins/test');

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

            const transport = new TransportService({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: mockGetProxyMode
            });

            const resp = await transport.fetchHost('/api/test-403');
            expect(resp.status).toBe(200);
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockCsrfProvider).toHaveBeenCalledTimes(2);
        });
    });

    describe('fetchExternal (外部生图请求)', () => {
        it('在 browser 模式下应直连目标端点并显式设置 credentials: omit', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
            globalThis.fetch = mockFetch;

            const transport = new TransportService({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: () => 'browser'
            });

            await transport.fetchExternal('http://localhost:8188/prompt', { method: 'POST' });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[0]).toBe('http://localhost:8188/prompt');
            expect(callArgs[1].credentials).toBe('omit');
        });

        it('在 server 模式下应转发至服务端代理接口', async () => {
            const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
            globalThis.fetch = mockFetch;

            const transport = new TransportService({
                csrfHeadersProvider: mockCsrfProvider,
                getProxyMode: () => 'server'
            });

            await transport.fetchExternal('http://external-sd.com/sdapi/v1/txt2img', {
                method: 'POST',
                body: JSON.stringify({ prompt: 'cat' })
            });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[0]).toBe('/api/plugins/st-drawassistant/proxy');
            expect(callArgs[1].method).toBe('POST');
            const parsedBody = JSON.parse(callArgs[1].body);
            expect(parsedBody.url).toBe('http://external-sd.com/sdapi/v1/txt2img');
        });
    });
});
