import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleProxyRequest, abortAllActiveProxyRequests } from '../../src/server/proxy';

describe('Server HTTP Proxy Middleware', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
        globalThis.fetch = mockFetch;
    });

    it('缺少 url 参数应返回 400', async () => {
        const req = { body: {} } as any;
        let statusCode = 200;
        let jsonBody: any = null;

        const res = {
            status: (s: number) => {
                statusCode = s;
                return res;
            },
            json: (data: any) => {
                jsonBody = data;
                return res;
            }
        } as any;

        await handleProxyRequest(req, res);
        expect(statusCode).toBe(400);
        expect(jsonBody.error).toContain('缺少目标 url');
    });

    it('目标地址被安全网关拦截应返回 403', async () => {
        const req = {
            body: { url: 'http://169.254.169.254/latest/meta-data' },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        let statusCode = 200;
        let jsonBody: any = null;

        const res = {
            status: (s: number) => {
                statusCode = s;
                return res;
            },
            json: (data: any) => {
                jsonBody = data;
                return res;
            }
        } as any;

        await handleProxyRequest(req, res);
        expect(statusCode).toBe(403);
    });

    it('正常请求应完成非流式完整转发并原样透传状态码与响应体', async () => {
        const fakeData = JSON.stringify({ prompt_id: 'test-123' });
        mockFetch.mockResolvedValueOnce(
            new Response(fakeData, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': '999',
                    'Transfer-Encoding': 'chunked'
                }
            })
        );

        const req = {
            body: {
                url: 'http://127.0.0.1:8188/prompt',
                method: 'POST',
                body: { prompt: { 1: { class_type: 'KSampler' } } }
            },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        let statusCode = 0;
        let sentBuffer: Buffer | null = null;
        const setHeaders: Record<string, string> = {};

        const res = {
            status: (s: number) => {
                statusCode = s;
                return res;
            },
            setHeader: (k: string, v: string) => {
                setHeaders[k.toLowerCase()] = v;
                return res;
            },
            send: (buf: Buffer) => {
                sentBuffer = buf;
                return res;
            }
        } as any;

        await handleProxyRequest(req, res);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(statusCode).toBe(200);
        expect(setHeaders['content-type']).toBe('application/json');
        expect(setHeaders['content-length']).toBeUndefined();
        expect(setHeaders['transfer-encoding']).toBeUndefined();
        expect(sentBuffer).not.toBeNull();
        expect(JSON.parse(sentBuffer!.toString())).toEqual({ prompt_id: 'test-123' });
    });

    it('上游网络不可达时应返回 502 Bad Gateway', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const req = {
            body: { url: 'http://127.0.0.1:9999/unreachable' },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        let statusCode = 0;
        let jsonBody: any = null;

        const res = {
            status: (s: number) => {
                statusCode = s;
                return res;
            },
            json: (data: any) => {
                jsonBody = data;
                return res;
            }
        } as any;

        await handleProxyRequest(req, res);
        expect(statusCode).toBe(502);
        expect(jsonBody.error).toContain('Bad Gateway');
    });

    it('客户端主动断开请求时应返回 499 Client Closed Request', async () => {
        let abortCallback: any = null;
        const req = {
            body: { url: 'http://127.0.0.1:8188/generate' },
            on: vi.fn((event, cb) => {
                if (event === 'close') abortCallback = cb;
            }),
            removeListener: vi.fn()
        } as any;

        mockFetch.mockImplementationOnce((_url, options) => {
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const err = new Error('The operation was aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
                // 模拟客户端主动断开
                if (abortCallback) {
                    abortCallback();
                }
            });
        });

        let statusCode = 0;
        let jsonBody: any = null;

        const res = {
            writableEnded: false,
            status: (s: number) => {
                statusCode = s;
                return res;
            },
            json: (data: any) => {
                jsonBody = data;
                return res;
            }
        } as any;

        await handleProxyRequest(req, res);
        expect(statusCode).toBe(499);
        expect(jsonBody.error).toContain('Client Closed Request');
    });

    it('abortAllActiveProxyRequests 应能安全执行无异常', () => {
        expect(() => {
            abortAllActiveProxyRequests();
        }).not.toThrow();
    });

    it('当转发至目标服务且本地配置有 API Key 时应自动附加 Bearer 鉴权凭据', async () => {
        const { loadServerConfig } = await import('../../src/server/server-config');
        // 模拟已配置本地 API Key
        const originalConfig = loadServerConfig();
        originalConfig.apiKeys.novelai = 'test-novelai-token-xyz';

        mockFetch.mockResolvedValueOnce(
            new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
        );

        const req = {
            body: {
                url: 'https://image.novelai.net/ai/generate-image',
                method: 'POST'
            },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        let statusCode = 0;
        const res = {
            status: (s: number) => {
                statusCode = s;
                return res;
            },
            setHeader: vi.fn(),
            send: vi.fn()
        } as any;

        await handleProxyRequest(req, res);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const fetchArgs = mockFetch.mock.calls[0];
        expect(fetchArgs[1].headers).toHaveProperty('Authorization', 'Bearer test-novelai-token-xyz');
    });
});

