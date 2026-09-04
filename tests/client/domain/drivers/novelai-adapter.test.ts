import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    NovelAIAdapter,
    convertToNovelAIPromptSyntax,
    snapTo64,
    extractImageFromZipBuffer,
    GenerationRequest
} from '../../../../src/client/domain';
import { NetworkClient } from '../../../../src/client/core/network/client';

describe('NovelAIAdapter', () => {
    let mockFetchExternal: ReturnType<typeof vi.fn>;
    let networkClient: NetworkClient;
    let adapter: NovelAIAdapter;

    beforeEach(() => {
        mockFetchExternal = vi.fn();
        networkClient = {
            fetchExternal: mockFetchExternal
        } as unknown as NetworkClient;

        adapter = new NovelAIAdapter({
            network: networkClient,
            driverName: 'TestNovelAI',
            getEndpointUrl: () => 'https://image.novelai.net',
            defaultConfig: {
                apiKey: 'pst-fake-token-123'
            }
        });
    });

    it('应声明正确的能力与标识', () => {
        expect(adapter.id).toBe('novelai');
        expect(adapter.name).toBe('NovelAI');
        expect(adapter.capabilities.txt2img).toBe(true);
        expect(adapter.capabilities.img2img).toBe(false);
        expect(adapter.capabilities.interrupt).toBe(false);
        expect(adapter.capabilities.syntaxType).toBe('tagBased');
    });

    it('convertToNovelAIPromptSyntax 应将 SD 加权格式转换为花括号与方括号', () => {
        expect(convertToNovelAIPromptSyntax('(1girl:1.3), (masterpiece), (bad hands:0.7)'))
            .toBe('{1girl}, {masterpiece}, [bad hands]');
        expect(convertToNovelAIPromptSyntax('solo, simple background'))
            .toBe('solo, simple background');
    });

    it('snapTo64 应将尺寸正确规整为 64 的整倍数', () => {
        expect(snapTo64(800)).toBe(832);
        expect(snapTo64(1200)).toBe(1216);
        expect(snapTo64(512)).toBe(512);
        expect(snapTo64(30, 832)).toBe(64); // 最小 64
        expect(snapTo64(undefined, 832)).toBe(832);
    });

    it('extractImageFromZipBuffer 应支持直接解析原生 PNG 格式', async () => {
        // PNG 文件头：0x89, 0x50, 0x4E, 0x47
        const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const blob = await extractImageFromZipBuffer(pngHeader.buffer);
        expect(blob.type).toBe('image/png');
        expect(blob.size).toBe(8);
    });

    it('执行 V4 生图时应携带 Bearer Token 并规范化请求体', async () => {
        const fakePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: async () => fakePngBytes.buffer
        });

        const request: GenerationRequest = {
            taskId: 'task-nai-v4',
            targetEngine: 'novelai',
            prompt: '(masterpiece:1.2), 1girl, smiling',
            negativePrompt: '(worst quality:0.8), blurry',
            engineOptions: {
                model: 'nai-diffusion-4-full',
                width: 800,
                height: 1200,
                scale: 5.5,
                sampler: 'k_euler',
                steps: 28,
                seed: 88888
            }
        };

        const result = await adapter.generate(request);

        expect(result.taskId).toBe('task-nai-v4');
        expect(result.engine).toBe('novelai');
        expect(result.images).toHaveLength(1);
        expect(result.images[0].seed).toBe(88888);

        const [url, opts] = mockFetchExternal.mock.calls[0];
        expect(url).toBe('https://image.novelai.net/ai/generate-image');
        expect(opts.headers['Authorization']).toBe('Bearer pst-fake-token-123');
        const body = JSON.parse(opts.body);
        expect(body.input).toBe('{masterpiece}, 1girl, smiling');
        expect(body.parameters.negative_prompt).toBe('[worst quality], blurry');
        expect(body.parameters.width).toBe(832);
        expect(body.parameters.height).toBe(1216);
        expect(body.parameters.scale).toBe(5.5);
        expect(body.parameters.sampler).toBe('k_euler');
        // V4 模型不应包含 legacy SMEA 参数
        expect(body.parameters.sm).toBeUndefined();
        expect(body.parameters.sm_dyn).toBeUndefined();
    });

    it('执行 V3 生图时应正确传递 SMEA 参数', async () => {
        const fakePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: async () => fakePngBytes.buffer
        });

        const request: GenerationRequest = {
            taskId: 'task-nai-v3',
            targetEngine: 'novelai',
            prompt: '1girl',
            engineOptions: {
                model: 'nai-diffusion-3',
                smea: true,
                smeaDyn: true
            }
        };

        await adapter.generate(request);

        const [, opts] = mockFetchExternal.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.parameters.sm).toBe(true);
        expect(body.parameters.sm_dyn).toBe(true);
    });

    it('ping 在返回 405 Method Not Allowed 时应判定服务连通且鉴权通过', async () => {
        mockFetchExternal.mockResolvedValueOnce({
            ok: false,
            status: 405,
            text: async () => 'Method Not Allowed'
        });

        const ok = await adapter.ping();
        expect(ok).toBe(true);
    });

    it('extractMetadata 与 restoreParameters 应实现参数双向还原', () => {
        const request: GenerationRequest = {
            taskId: 'task-nai-meta',
            targetEngine: 'novelai',
            prompt: 'scenery',
            engineOptions: {
                model: 'nai-diffusion-4-curated',
                scale: 6.0,
                sampler: 'k_dpmpp_2m',
                steps: 32,
                width: 832,
                height: 1216,
                seed: 7777,
                smea: false
            }
        };

        const result = {
            taskId: 'task-nai-meta',
            engine: 'novelai',
            images: [{ blob: new Blob([]), format: 'image/png', seed: 7777 }],
            durationMs: 1500
        };

        const extracted = adapter.extractMetadata(request, result);
        expect(extracted.model).toBe('nai-diffusion-4-curated');
        expect(extracted.scale).toBe(6.0);
        expect(extracted.steps).toBe(32);
        expect(extracted.width).toBe(832);
        expect(extracted.height).toBe(1216);
        expect(extracted.seed).toBe(7777);

        const restored = adapter.restoreParameters({
            assetId: 'asset-nai',
            engine: 'novelai',
            createdAt: Date.now(),
            prompt: 'scenery',
            engineParams: extracted
        });

        expect(restored.model).toBe('nai-diffusion-4-curated');
        expect(restored.scale).toBe(6.0);
        expect(restored.steps).toBe(32);
        expect(restored.width).toBe(832);
        expect(restored.height).toBe(1216);
        expect(restored.seed).toBe(7777);
    });
});
