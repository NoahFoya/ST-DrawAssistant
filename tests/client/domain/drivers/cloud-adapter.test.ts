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
            defaultConfig: {
                apiKey: 'sk-fake-cloud-key'
            }
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

        expect(restored.model).toBe('grok-imagine-image-quality');
        expect(restored.provider).toBe('xai');
        expect(restored.size).toBe('1024x1792');
        expect(restored.style).toBe('vivid');
    });
});
