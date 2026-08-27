import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObservableStore } from '../src/core/state/store';
import { DrawAssistantSettings } from '../src/core/state/store-types';
import { ComfyUIDriver } from '../src/domain/drivers/comfyui-driver';
import { SDWebUIDriver } from '../src/domain/drivers/webui-driver';

describe('Batch 2: Drivers & Model Probe Tests', () => {
    let store: ObservableStore<DrawAssistantSettings>;

    beforeEach(() => {
        store = new ObservableStore<DrawAssistantSettings>({
            version: '0.3.4',
            enabled: true,
            provider: 'comfyui',
            serverUrl: 'http://127.0.0.1:8188',
            sdWebUrl: 'http://127.0.0.1:7860',
            width: 1024,
            height: 1024,
            steps: 28,
            cfgScale: 7,
            samplerName: 'euler',
            scheduler: 'normal',
            promptPrefix: '',
            negativePrefix: '',
            workflowJson: JSON.stringify({
                "3": { "class_type": "KSampler", "inputs": { "seed": 0, "steps": 20, "cfg": 7 } },
                "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "v1-5.safetensors" } },
                "5": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512 } },
                "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "" } },
                "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "" } }
            }),
            workflowInjection: {
                positiveNodeId: '6',
                negativeNodeId: '7',
                kSamplerNodeId: '3',
                widthNodeId: '5',
                saveImageNodeId: '9'
            }
        });
    });

    it('ComfyUIDriver should merge CheckpointLoaderSimple, UNETLoader and DiffusionModelLoader models', async () => {
        const driver = new ComfyUIDriver(store);

        // Mock fetch for /object_info/CheckpointLoaderSimple and UNETLoader
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/object_info/CheckpointLoaderSimple')) {
                return new Response(JSON.stringify({
                    CheckpointLoaderSimple: {
                        input: { required: { ckpt_name: [['sdxl_base.safetensors', 'anime_v3.safetensors']] } }
                    }
                }));
            }
            if (urlStr.includes('/object_info/UNETLoader')) {
                return new Response(JSON.stringify({
                    UNETLoader: {
                        input: { required: { unet_name: [['flux1-dev.safetensors', 'sdxl_base.safetensors']] } } // 含重复项
                    }
                }));
            }
            return new Response(JSON.stringify({}));
        });

        const models = await driver.getModels();
        expect(models).toContain('sdxl_base.safetensors');
        expect(models).toContain('anime_v3.safetensors');
        expect(models).toContain('flux1-dev.safetensors');
        expect(models.length).toBe(3); // 去重后只有 3 个

        fetchSpy.mockRestore();
    });

    it('SDWebUIDriver should format prompt and handle model/sampler lists', async () => {
        const driver = new SDWebUIDriver(store);

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/sdapi/v1/sd-models')) {
                return new Response(JSON.stringify([{ title: 'v1-5-pruned.safetensors' }]));
            }
            if (urlStr.includes('/sdapi/v1/samplers')) {
                return new Response(JSON.stringify([{ name: 'Euler a' }, { name: 'DPM++ 2M Karras' }]));
            }
            return new Response(JSON.stringify([]));
        });

        const models = await driver.getModels();
        expect(models).toContain('v1-5-pruned.safetensors');

        const samplers = await driver.getSamplers();
        expect(samplers).toContain('Euler a');
        expect(samplers).toContain('DPM++ 2M Karras');

        fetchSpy.mockRestore();
    });
});
