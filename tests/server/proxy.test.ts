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

    it('正常请求应完成转发并返回对应的状态码与响应内容', async () => {
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

    it('当响应端 res 触发 close 时也应即时中止上游请求并返回 499', async () => {
        let resAbortCallback: any = null;
        const req = {
            body: { url: 'http://127.0.0.1:8188/generate' },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        mockFetch.mockImplementationOnce((_url, options) => {
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const err = new Error('The operation was aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
                if (resAbortCallback) {
                    resAbortCallback();
                }
            });
        });

        let statusCode = 0;
        let jsonBody: any = null;
        const res = {
            writableEnded: false,
            on: vi.fn((event, cb) => {
                if (event === 'close') resAbortCallback = cb;
            }),
            removeListener: vi.fn(),
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

    it('当 URL 查询参数包含伪造域名时不应误附加 API Key 凭据', async () => {
        const { loadServerConfig } = await import('../../src/server/server-config');
        const originalConfig = loadServerConfig();
        originalConfig.apiKeys.novelai = 'secret-nai-token';

        mockFetch.mockResolvedValueOnce(
            new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
        );

        // 请求内网地址，但 Query 包含伪造的 image.novelai.net
        const req = {
            body: {
                url: 'http://127.0.0.1:8188/?fake=image.novelai.net',
                method: 'GET'
            },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            setHeader: vi.fn(),
            send: vi.fn()
        } as any;

        await handleProxyRequest(req, res);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const fetchArgs = mockFetch.mock.calls[0];
        expect(fetchArgs[1].headers.Authorization).toBeUndefined();
    });

    it('超大图像响应体 (如无损/高分辨率出图) 应能正常流式中继而不会被生硬阻断', async () => {
        const hugeBuffer = Buffer.alloc(1024 * 1024 * 2); // 2MB mock
        mockFetch.mockResolvedValueOnce(
            new Response(hugeBuffer, {
                status: 200,
                headers: {
                    'Content-Length': String(1024 * 1024 * 2),
                    'Content-Type': 'image/png'
                }
            })
        );

        const req = {
            body: {
                url: 'http://127.0.0.1:8188/view?filename=huge.png',
                method: 'GET'
            },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        let statusCode = 0;
        let sentBuffer: Buffer | null = null;
        const res = {
            status: (s: number) => {
                statusCode = s;
                return res;
            },
            setHeader: vi.fn(),
            send: (data: Buffer) => {
                sentBuffer = data;
                return res;
            }
        } as any;

        await handleProxyRequest(req, res);

        expect(statusCode).toBe(200);
        expect(sentBuffer).not.toBeNull();
    });

    it('当 res 为标准可写流时应通过 pipeline 流式转发上游响应', async () => {
        const fakeData = 'streaming chunk 123';
        mockFetch.mockResolvedValueOnce(
            new Response(fakeData, {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
            })
        );

        const req = {
            body: { url: 'http://127.0.0.1:8188/stream', method: 'GET' },
            on: vi.fn(),
            removeListener: vi.fn()
        } as any;

        const chunks: Buffer[] = [];
        const { Writable } = await import('stream');
        const res = new Writable({
            write(chunk, _encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            }
        }) as any;
        res.status = vi.fn().mockReturnThis();
        res.setHeader = vi.fn().mockReturnThis();

        await handleProxyRequest(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const output = Buffer.concat(chunks).toString('utf-8');
        expect(output).toBe('streaming chunk 123');
    });
});

