import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    CloudAdapter,
    GenerationRequest
} from '../../../../src/client/domain';
import { NetworkClient } from '../../../../src/client/core/network/client';

describe('CloudAdapter', () => {
    let mockFetchExternal: ReturnType<typeof vi.fn>;
    let networkClient: NetworkClient;
    let adapter: CloudAdapter;

    beforeEach(() => {
        mockFetchExternal = vi.fn();
        networkClient = {
            fetchExternal: mockFetchExternal
        } as unknown as NetworkClient;

        adapter = new CloudAdapter({
            network: networkClient,
            driverName: 'TestCloud',
            getEndpointUrl: () => 'https://api.openai.com/v1',
            getConfig: () => ({
                apiKey: 'sk-fake-cloud-key'
            })
        });
    });

    it('应声明正确的能力与标识', () => {
        expect(adapter.id).toBe('cloud');
        expect(adapter.name).toBe('Cloud Multimodal');
        expect(adapter.capabilities.txt2img).toBe(true);
        expect(adapter.capabilities.syntaxType).toBe('natural');
    });

    it('调用 Google Gemini 时应按 generateContent 协议组装多模态参考图与提取图像 Blob', async () => {
        const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                candidates: [
                    {
                        content: {
                            parts: [
                                { text: 'Here is the generated image:' },
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: fakePngB64
                                    }
                                }
                            ]
                        }
                    }
                ]
            })
        });

        const refBlob = new Blob(['fake-ref-image'], { type: 'image/jpeg' });

        const request: GenerationRequest = {
            taskId: 'task-gemini-1',
            targetEngine: 'cloud',
            prompt: 'A photorealistic shot of an astronaut riding a white horse on Mars, cinematic lighting',
            imageInputs: {
                referenceImageBlobs: [refBlob]
            },
            engineOptions: {
                model: 'gemini-3.1-flash-image-preview',
                apiKey: 'test-google-key'
            }
        };

        const result = await adapter.generate(request);

        expect(result.taskId).toBe('task-gemini-1');
        expect(result.engine).toBe('cloud');
        expect(result.images).toHaveLength(1);
        expect(result.images[0].blob).toBeInstanceOf(Blob);

        const [url, opts] = mockFetchExternal.mock.calls[0];
        expect(url).toContain('/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
        expect(url).toContain('key=test-google-key');
        const body = JSON.parse(opts.body);
        expect(body.contents[0].parts[0].text).toBe(request.prompt);
        // 验证参考图已作为 inlineData 传入
        expect(body.contents[0].parts[1].inlineData).toBeDefined();
        expect(body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
    });

    it('调用 OpenAI 兼容接口时应调用 /images/generations 并提取 b64_json', async () => {
        const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                created: Date.now(),
                data: [{ b64_json: fakePngB64 }]
            })
        });

        const request: GenerationRequest = {
            taskId: 'task-openai-1',
            targetEngine: 'cloud',
            prompt: 'Oil painting of a tranquil mountain lake during sunrise',
            engineOptions: {
                model: 'gpt-image-2',
                size: '1024x1024',
                quality: 'hd'
            }
        };

        const result = await adapter.generate(request);

        expect(result.taskId).toBe('task-openai-1');
        expect(result.images).toHaveLength(1);
        expect(result.images[0].blob).toBeInstanceOf(Blob);

        const [url, opts] = mockFetchExternal.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/images/generations');
        expect(opts.headers['Authorization']).toBe('Bearer sk-fake-cloud-key');
        const body = JSON.parse(opts.body);
        expect(body.model).toBe('gpt-image-2');
        expect(body.prompt).toBe(request.prompt);
        expect(body.response_format).toBe('b64_json');
        expect(body.quality).toBe('hd');
    });

    it('当选用 Grok 模型且未指定自定义反代时，应自动解析为 xAI 官方端点 https://api.x.ai/v1/images/generations', async () => {
        // 创建一个默认未配置 endpoint 的 adapter
        const defaultCloudAdapter = new CloudAdapter({
            network: networkClient,
            driverName: 'TestCloud',
            getConfig: () => ({ apiKey: 'xai-key-123' })
        });

        const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                created: Date.now(),
                data: [{ b64_json: fakePngB64 }]
            })
        });

        await defaultCloudAdapter.generate({
            taskId: 'task-grok-1',
            targetEngine: 'cloud',
            prompt: 'Cyberpunk street view with neon lights',
            engineOptions: {
                model: 'grok-imagine-image'
            }
        });

        const [url, opts] = mockFetchExternal.mock.calls[0];
        expect(url).toBe('https://api.x.ai/v1/images/generations');
        expect(opts.serviceType).toBe('grok');
        expect(opts.headers['Authorization']).toBe('Bearer xai-key-123');
    });

    it('extractMetadata 与 restoreParameters 应实现参数双向还原', () => {
        const request: GenerationRequest = {
            taskId: 'task-cloud-meta',
            targetEngine: 'cloud',
            prompt: 'sunset',
            engineOptions: {
                model: 'grok-imagine-image-quality',
                provider: 'xai',
                size: '1024x1792',
                style: 'vivid'
            }
        };

        const result = {
            taskId: 'task-cloud-meta',
            engine: 'cloud',
            images: [{ blob: new Blob([]), format: 'image/png' }],
            durationMs: 1100
        };

        const extracted = adapter.extractMetadata(request, result);
        expect(extracted.model).toBe('grok-imagine-image-quality');
        expect(extracted.provider).toBe('xai');
        expect(extracted.size).toBe('1024x1792');
        expect(extracted.style).toBe('vivid');

        const restored = adapter.restoreParameters({
            assetId: 'asset-cloud',
            engine: 'cloud',
            createdAt: Date.now(),
            prompt: 'sunset',
            engineParams: extracted
        });

        expect(restored.style).toBe('vivid');
    });

    it('ping 与 checkHealth 应正确请求端点并携带 Authorization 请求头', async () => {
        let sentHeaders: any = null;
        mockFetchExternal.mockImplementation((_url: string, opts?: any) => {
            sentHeaders = opts?.headers;
            return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        });

        const openaiAdapter = new CloudAdapter({
            network: networkClient,
            driverName: 'TestOpenAI',
            getConfig: () => ({
                model: 'gpt-image-1',
                apiKey: 'sk-fake-cloud-key'
            })
        });

        const health = await openaiAdapter.checkHealth();
        expect(health.ok).toBe(true);
        expect(sentHeaders?.['Authorization']).toBe('Bearer sk-fake-cloud-key');

        const pingOk = await openaiAdapter.ping();
        expect(pingOk).toBe(true);
    });

    it('xAI Grok Imagine 应正确映射 aspect_ratio 与 resolution，并忽略 negativePrompt', async () => {
        let sentBody: any = null;
        mockFetchExternal.mockImplementation((_url: string, opts?: any) => {
            sentBody = JSON.parse(opts?.body || '{}');
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                    data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }]
                })
            });
        });

        const grokAdapter = new CloudAdapter({
            network: networkClient,
            driverName: 'TestGrok',
            getConfig: () => ({
                model: 'grok-imagine-image',
                apiKey: 'xai-fake-key'
            })
        });

        const res = await grokAdapter.generate({
            taskId: 'task-grok',
            targetEngine: 'cloud',
            prompt: 'sunset ocean',
            negativePrompt: 'blurry, clouds', // 应被安全忽略
            engineOptions: {
                aspectRatio: '16:9',
                quality: 'high'
            }
        });

        expect(res.images.length).toBe(1);
        expect(sentBody.aspect_ratio).toBe('16:9');
        expect(sentBody.resolution).toBe('2k');
        expect(sentBody.prompt).toBe('sunset ocean');
        // 不应将 negative_prompt 传入
        expect(sentBody.negative_prompt).toBeUndefined();
    });

    it('Google Gemini 生图应在 generationConfig 中携带 aspectRatio 参数', async () => {
        let sentBody: any = null;
        mockFetchExternal.mockImplementation((_url: string, opts?: any) => {
            sentBody = JSON.parse(opts?.body || '{}');
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{
                        content: {
                            parts: [{
                                inlineData: {
                                    mimeType: 'image/png',
                                    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
                                }
                            }]
                        }
                    }]
                })
            });
        });

        const geminiAdapter = new CloudAdapter({
            network: networkClient,
            driverName: 'TestGemini',
            getConfig: () => ({
                model: 'gemini-3.1-flash-image-preview',
                apiKey: 'fake-gemini-key'
            })
        });

        const res = await geminiAdapter.generate({
            taskId: 'task-gemini-ratio',
            targetEngine: 'cloud',
            prompt: 'majestic castle',
            engineOptions: {
                aspectRatio: '9:16'
            }
        });

        expect(res.images.length).toBe(1);
        expect(sentBody.generationConfig?.aspectRatio).toBe('9:16');
    });
});
