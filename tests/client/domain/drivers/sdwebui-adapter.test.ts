import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    SdWebUIAdapter,
    GenerationRequest,
    DriverError,
    DriverErrorType
} from '../../../../src/client/domain';
import { NetworkClient } from '../../../../src/client/core/network/client';

describe('SdWebUIAdapter', () => {
    let mockFetchExternal: ReturnType<typeof vi.fn>;
    let networkClient: NetworkClient;
    let adapter: SdWebUIAdapter;

    beforeEach(() => {
        mockFetchExternal = vi.fn();
        networkClient = {
            fetchExternal: mockFetchExternal
        } as unknown as NetworkClient;

        adapter = new SdWebUIAdapter({
            network: networkClient,
            driverName: 'TestSdWebUI',
            getEndpointUrl: () => 'http://127.0.0.1:7860'
        });
    });

    it('应声明正确的能力与基本元信息', () => {
        expect(adapter.id).toBe('sdwebui');
        expect(adapter.name).toBe('SD WebUI');
        expect(adapter.capabilities.txt2img).toBe(true);
        expect(adapter.capabilities.img2img).toBe(true);
        expect(adapter.capabilities.lora).toBe(true);
        expect(adapter.capabilities.interrupt).toBe(true);
        expect(adapter.capabilities.syntaxType).toBe('tagBased');
    });

    it('formatLoraTag 应正确将 LoRA 项格式化为 SD-WebUI 语法标签', () => {
        expect(adapter.formatLoraTag({ name: 'anime_style.safetensors', weight: 0.8 }))
            .toBe('<lora:anime_style:0.8>');
        expect(adapter.formatLoraTag({ name: 'detail_fix.pt', weight: 1.0, clipWeight: 0.7 }))
            .toBe('<lora:detail_fix:1:0.7>');
        expect(adapter.formatLoraTag({ name: '' })).toBe('');
    });

    it('执行文生图时应正确组装参数并提取 Base64 图像', async () => {
        // 模拟 1x1 透明 PNG Base64
        const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const fakeApiResponse = {
            images: [fakePngB64],
            parameters: { prompt: '1girl, sunset' },
            info: JSON.stringify({ seed: 123456 })
        };

        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => fakeApiResponse
        });

        const request: GenerationRequest = {
            taskId: 'task-sd-1',
            targetEngine: 'sdwebui',
            prompt: '1girl, sunset',
            negativePrompt: 'lowres, bad anatomy',
            engineOptions: {
                steps: 25,
                cfgScale: 7.5,
                samplerName: 'DPM++ 2M Karras',
                width: 512,
                height: 768,
                seed: 123456,
                model: 'v1-5-pruned.safetensors',
                loras: [{ name: 'cool_style', weight: 0.9, enabled: true }]
            }
        };

        const result = await adapter.generate(request);

        expect(result.taskId).toBe('task-sd-1');
        expect(result.engine).toBe('sdwebui');
        expect(result.images).toHaveLength(1);
        expect(result.images[0].seed).toBe(123456);
        expect(result.images[0].format).toBe('image/png');
        expect(result.images[0].blob).toBeInstanceOf(Blob);

        // 验证请求体
        expect(mockFetchExternal).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetchExternal.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img');
        const body = JSON.parse(opts.body);
        expect(body.prompt).toContain('1girl, sunset <lora:cool_style:0.9>');
        expect(body.negative_prompt).toBe('lowres, bad anatomy');
        expect(body.steps).toBe(25);
        expect(body.cfg_scale).toBe(7.5);
        expect(body.sampler_name).toBe('DPM++ 2M Karras');
        expect(body.override_settings.sd_model_checkpoint).toBe('v1-5-pruned.safetensors');
    });

    it('当传入 initImageBlob 时应自动切换为 /sdapi/v1/img2img 模式', async () => {
        const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ images: [fakePngB64] })
        });

        const initBlob = new Blob(['fake-init-image'], { type: 'image/png' });
        const maskBlob = new Blob(['fake-mask-image'], { type: 'image/png' });

        const request: GenerationRequest = {
            taskId: 'task-inpaint-1',
            targetEngine: 'sdwebui',
            prompt: 'masterpiece, repaint face',
            imageInputs: {
                initImageBlob: initBlob,
                maskImageBlob: maskBlob,
                denoiseStrength: 0.65
            },
            engineOptions: {}
        };

        const result = await adapter.generate(request);

        expect(result.taskId).toBe('task-inpaint-1');
        const [url, opts] = mockFetchExternal.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:7860/sdapi/v1/img2img');
        const body = JSON.parse(opts.body);
        expect(body.init_images).toBeDefined();
        expect(body.init_images).toHaveLength(1);
        expect(body.mask).toBeDefined();
        expect(body.denoising_strength).toBe(0.65);
    });

    it('开启高清修复时应正确组装 enable_hr 与二阶段超分参数', async () => {
        const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ images: [fakePngB64] })
        });

        const request: GenerationRequest = {
            taskId: 'task-hires-1',
            targetEngine: 'sdwebui',
            prompt: 'scenery, landscape',
            engineOptions: {
                enableHires: true,
                hiresScale: 1.75,
                hiresUpscaler: 'Latent',
                hiresSteps: 20,
                hiresDenoise: 0.45
            }
        };

        await adapter.generate(request);

        const [, opts] = mockFetchExternal.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.enable_hr).toBe(true);
        expect(body.hr_scale).toBe(1.75);
        expect(body.hr_upscaler).toBe('Latent');
        expect(body.hr_second_pass_steps).toBe(20);
        expect(body.denoising_strength).toBe(0.45);
    });

    it('interrupt 应协同调用后端的 /sdapi/v1/interrupt', async () => {
        mockFetchExternal.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({})
        });

        await adapter.interrupt();

        expect(mockFetchExternal).toHaveBeenCalledWith(
            'http://127.0.0.1:7860/sdapi/v1/interrupt',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('extractMetadata 与 restoreParameters 应正确双向提取与还原生成参数 (含 loras)', () => {
        const testLoras: LoraItem[] = [
            { name: 'detail_lora', weight: 0.8, clipWeight: 0.8, enabled: true }
        ];

        const request: GenerationRequest = {
            taskId: 'task-meta-1',
            targetEngine: 'sdwebui',
            prompt: 'cyberpunk girl',
            engineOptions: {
                steps: 30,
                cfgScale: 8.0,
                samplerName: 'Euler',
                width: 768,
                height: 1024,
                seed: 9999,
                model: 'cyber_realistic.safetensors',
                loras: testLoras,
                enableHires: true,
                hiresScale: 1.5
            }
        };

        const mockResult = {
            taskId: 'task-meta-1',
            engine: 'sdwebui',
            images: [{ blob: new Blob([]), format: 'image/png', seed: 9999 }],
            durationMs: 1200
        };

        const extracted = adapter.extractMetadata(request, mockResult);
        expect(extracted.steps).toBe(30);
        expect(extracted.cfgScale).toBe(8.0);
        expect(extracted.samplerName).toBe('Euler');
        expect(extracted.width).toBe(768);
        expect(extracted.height).toBe(1024);
        expect(extracted.seed).toBe(9999);
        expect(extracted.model).toBe('cyber_realistic.safetensors');
        expect(extracted.loras).toEqual(testLoras);

        const restored = adapter.restoreParameters({
            assetId: 'asset-1',
            engine: 'sdwebui',
            createdAt: Date.now(),
            prompt: 'cyberpunk girl',
            engineParams: extracted
        });

        expect(restored.steps).toBe(30);
        expect(restored.cfgScale).toBe(8.0);
        expect(restored.samplerName).toBe('Euler');
        expect(restored.width).toBe(768);
        expect(restored.height).toBe(1024);
        expect(restored.seed).toBe(9999);
        expect(restored.model).toBe('cyber_realistic.safetensors');
        expect(restored.loras).toEqual(testLoras);
        expect(restored.enableHires).toBe(true);
    });

    it('syncAssets 应并发拉取 Checkpoint、采样器与 LoRA 并归一化目录', async () => {
        mockFetchExternal.mockImplementation((url: string) => {
            if (url.includes('/sd-models')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => [{ title: 'modelA.safetensors' }, { title: 'modelB.safetensors' }]
                });
            }
            if (url.includes('/samplers')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => [{ name: 'Euler a' }, { name: 'DPM++ 2M' }]
                });
            }
            if (url.includes('/schedulers')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => [{ name: 'karras' }, { name: 'exponential' }]
                });
            }
            if (url.includes('/upscalers')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => [{ name: 'R-ESRGAN 4x+' }]
                });
            }
            if (url.includes('/loras')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => [{ name: 'detail_lora' }]
                });
            }
            return Promise.resolve({ ok: true, json: async () => [] });
        });

        const catalog = await adapter.syncAssets();

        expect(catalog.models).toEqual(['modelA.safetensors', 'modelB.safetensors']);
        expect(catalog.samplers).toEqual(['Euler a', 'DPM++ 2M']);
        expect(catalog.schedulers).toEqual(['karras', 'exponential']);
        expect(catalog.upscalers).toEqual(['R-ESRGAN 4x+']);
        expect(catalog.loras).toEqual(['detail_lora']);
    });
});
