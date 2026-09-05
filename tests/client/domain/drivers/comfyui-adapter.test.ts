import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    ComfyUIAdapter,
    substituteWorkflowVariables,
    GenerationRequest
} from '../../../../src/client/domain';
import { NetworkClient } from '../../../../src/client/core/network/client';

describe('ComfyUIAdapter', () => {
    let mockFetchExternal: ReturnType<typeof vi.fn>;
    let networkClient: NetworkClient;
    let adapter: ComfyUIAdapter;

    beforeEach(() => {
        mockFetchExternal = vi.fn();
        networkClient = {
            fetchExternal: mockFetchExternal
        } as unknown as NetworkClient;

        adapter = new ComfyUIAdapter({
            network: networkClient,
            driverName: 'TestComfyUI',
            getEndpointUrl: () => 'http://mock.comfyui.local'
        });
    });

    it('应声明正确的能力与标识', () => {
        expect(adapter.id).toBe('comfyui');
        expect(adapter.name).toBe('ComfyUI');
        expect(adapter.capabilities.txt2img).toBe(true);
        expect(adapter.capabilities.progressWebSocket).toBe(false);
        expect(adapter.capabilities.syntaxType).toBe('nodeGraph');
    });

    it('getClientId 应动态返回配置中的 clientId 或会话随机标识', () => {
        // 未配置时返回 st-da- 前缀的会话标识
        expect(adapter.getClientId()).toMatch(/^st-da-/);

        // 动态配置了 clientId 时优先返回配置中的值
        let currentCfg: any = {};
        const dynamicAdapter = new ComfyUIAdapter({
            network: networkClient,
            driverName: 'DynamicComfyUI',
            getEndpointUrl: () => 'http://mock.comfyui.local',
            getConfig: () => currentCfg
        });

        expect(dynamicAdapter.getClientId()).toMatch(/^st-da-/);
        currentCfg = { clientId: 'custom-session-123' };
        expect(dynamicAdapter.getClientId()).toBe('custom-session-123');
    });

    it('substituteWorkflowVariables 应安全替换数字与包含特殊字符的字符串变量', () => {
        const sampleWorkflow = {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": "%seed%",
                    "steps": "%steps%",
                    "cfg": "%cfg%",
                    "sampler_name": "%sampler_name%",
                    "positive": ["6", 0]
                }
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "%prompt%"
                }
            }
        };

        const request: GenerationRequest = {
            taskId: 'test-comfy-sub',
            targetEngine: 'comfyui',
            // 包含换行与双引号的提示词
            prompt: 'a girl in "cyberpunk" jacket\nwith glowing eyes',
            negativePrompt: 'low quality',
            engineOptions: {
                steps: 25,
                cfgScale: 7.0,
                samplerName: 'euler',
                seed: 987654321
            }
        };

        const result = substituteWorkflowVariables(
            sampleWorkflow,
            request,
            request.engineOptions
        ) as any;

        expect(result["3"].inputs.steps).toBe(25);
        expect(result["3"].inputs.cfg).toBe(7.0);
        expect(result["3"].inputs.seed).toBe(987654321);
        expect(result["3"].inputs.sampler_name).toBe('euler');
        expect(result["6"].inputs.text).toBe('a girl in "cyberpunk" jacket\nwith glowing eyes');
    });

    it('生图流程应正确调用 /prompt、轮询 /history 并通过 /view 提取图像 Blob', async () => {
        const fakeWorkflow = {
            "3": { "class_type": "KSampler", "inputs": { "steps": "%steps%" } }
        };

        // 模拟各端点响应
        mockFetchExternal.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompt')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ prompt_id: 'pid-12345', number: 1 })
                });
            }
            if (url.includes('/history/pid-12345')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        'pid-12345': {
                            status: { completed: true },
                            outputs: {
                                "9": {
                                    images: [
                                        { filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }
                                    ]
                                }
                            }
                        }
                    })
                });
            }
            if (url.includes('/view?')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    blob: async () => new Blob(['fake-image-bytes'], { type: 'image/png' })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const request: GenerationRequest = {
            taskId: 'task-comfy-gen',
            targetEngine: 'comfyui',
            prompt: 'masterpiece landscape',
            engineOptions: {
                workflowJson: fakeWorkflow,
                steps: 20,
                seed: 5555
            }
        };

        const result = await adapter.generate(request);

        expect(result.taskId).toBe('task-comfy-gen');
        expect(result.engine).toBe('comfyui');
        expect(result.images).toHaveLength(1);
        expect(result.images[0].blob).toBeInstanceOf(Blob);

        // 验证各调用端点序列
        const calledUrls = mockFetchExternal.mock.calls.map((c: any) => c[0]);
        expect(calledUrls.some((u: string) => u.includes('/prompt'))).toBe(true);
        expect(calledUrls.some((u: string) => u.includes('/history/pid-12345'))).toBe(true);
        expect(calledUrls.some((u: string) => u.includes('/view?filename=ComfyUI_00001_.'))).toBe(true);
    });

    it('syncAssets 应解析 /object_info 并提取模型、采样器与 LoRA 资产', async () => {
        mockFetchExternal.mockImplementation((url: string) => {
            if (url.includes('/object_info')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        CheckpointLoaderSimple: {
                            input: { required: { ckpt_name: [['sd_xl_base.safetensors', 'sd_15.safetensors']] } }
                        },
                        KSampler: {
                            input: {
                                required: {
                                    sampler_name: [['euler', 'dpmpp_2m']],
                                    scheduler: [['karras', 'normal']]
                                }
                            }
                        },
                        LoraLoader: {
                            input: { required: { lora_name: [['lora_style.safetensors']] } }
                        }
                    })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const catalog = await adapter.syncAssets();

        expect(catalog.models).toContain('sd_xl_base.safetensors');
        expect(catalog.samplers).toContain('euler');
        expect(catalog.schedulers).toContain('karras');
        expect(catalog.loras).toContain('lora_style.safetensors');
    });

    it('formatLoraTag 应将 LoRA 配置项格式化为标准的 WeiLin 4段式标签语法', () => {
        // 单权重
        const tag1 = adapter.formatLoraTag({ name: 'anima_style', weight: 0.8 });
        expect(tag1).toBe('<wlr:anima_style:0.8:0.8:1>');

        // 三维权重 (模型、CLIP、触发词)
        const tag2 = adapter.formatLoraTag({
            name: 'detail_booster',
            weight: 0.7,
            clipWeight: 0.5,
            triggerWeight: 0.9
        });
        expect(tag2).toBe('<wlr:detail_booster:0.7:0.5:0.9>');

        // 文件后缀安全处理
        const tag3 = adapter.formatLoraTag({ name: 'my_character.safetensors', weight: 1.0 });
        expect(tag3).toBe('<wlr:my_character:1:1:1>');

        // 空名称处理
        expect(adapter.formatLoraTag({ name: '' })).toBe('');
    });

    it('doGenerate 应正确将启用的结构化 loras 注入到最终工作流 prompt 变量中', async () => {
        let submittedPrompt = '';
        mockFetchExternal.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompt')) {
                const body = JSON.parse(opts.body);
                submittedPrompt = body.prompt['6'].inputs.text;
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ prompt_id: 'pid-lora-test', number: 1 })
                });
            }
            if (url.includes('/history/pid-lora-test')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        'pid-lora-test': {
                            status: { completed: true },
                            outputs: {
                                "9": {
                                    images: [
                                        { filename: 'ComfyUI_00002_.png', subfolder: '', type: 'output' }
                                    ]
                                }
                            }
                        }
                    })
                });
            }
            if (url.includes('/view?')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    blob: async () => new Blob(['fake-image-bytes'], { type: 'image/png' })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const workflow = {
            "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "%prompt%" } }
        };

        const request: GenerationRequest = {
            taskId: 'task-lora-inject',
            targetEngine: 'comfyui',
            prompt: '1girl, fantasy forest',
            engineOptions: {
                workflowJson: workflow,
                loras: [
                    { name: 'style_boost', weight: 0.8, enabled: true },
                    { name: 'disabled_lora', weight: 0.5, enabled: false }
                ]
            }
        };

        await adapter.generate(request);

        expect(submittedPrompt).toContain('1girl, fantasy forest');
        expect(submittedPrompt).toContain('<wlr:style_boost:0.8:0.8:1>');
        expect(submittedPrompt).not.toContain('disabled_lora');
    });

    it('extractMetadata 与 restoreParameters 应实现参数双向还原', () => {
        const testLoras = [{ name: 'style_lora', weight: 0.8, enabled: true }];
        const request: GenerationRequest = {
            taskId: 'task-comfy-meta',
            targetEngine: 'comfyui',
            prompt: 'sunset',
            engineOptions: {
                steps: 28,
                cfgScale: 6.5,
                samplerName: 'dpmpp_2m',
                scheduler: 'karras',
                width: 1024,
                height: 1024,
                seed: 1234,
                ckptName: 'sd_xl_base.safetensors',
                loras: testLoras
            }
        };

        const result = {
            taskId: 'task-comfy-meta',
            engine: 'comfyui',
            images: [{ blob: new Blob([]), format: 'image/png' }],
            durationMs: 2000
        };

        const extracted = adapter.extractMetadata(request, result);
        expect(extracted.steps).toBe(28);
        expect(extracted.cfgScale).toBe(6.5);
        expect(extracted.samplerName).toBe('dpmpp_2m');
        expect(extracted.scheduler).toBe('karras');
        expect(extracted.ckptName).toBe('sd_xl_base.safetensors');
        expect(extracted.loras).toEqual(testLoras);

        const restored = adapter.restoreParameters({
            assetId: 'asset-comfy',
            engine: 'comfyui',
            createdAt: Date.now(),
            prompt: 'sunset',
            engineParams: extracted
        });

        expect(restored.steps).toBe(28);
        expect(restored.cfgScale).toBe(6.5);
        expect(restored.samplerName).toBe('dpmpp_2m');
        expect(restored.scheduler).toBe('karras');
        expect(restored.ckptName).toBe('sd_xl_base.safetensors');
        expect(restored.loras).toEqual(testLoras);
    });

    it('当 HTTP 轮询 /history 检测到任务状态为 error 时应立即抛出崩溃原因', async () => {
        mockFetchExternal.mockImplementation((url: string) => {
            if (url.includes('/prompt')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ prompt_id: 'err-prompt-123' })
                });
            }
            if (url.includes('/history/err-prompt-123')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        'err-prompt-123': {
                            status: {
                                status_str: 'error',
                                messages: ['CUDA out of memory']
                            }
                        }
                    })
                });
            }
            return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        });

        const request: GenerationRequest = {
            taskId: 'task-comfy-err',
            targetEngine: 'comfyui',
            prompt: 'masterpiece',
            engineOptions: {
                workflowJson: { "3": { "class_type": "KSampler", "inputs": {} } }
            }
        };

        await expect(adapter.generate(request)).rejects.toThrow(/ComfyUI 任务执行异常崩溃: CUDA out of memory/);
    });

    it('当传入底图或遮罩时，上传至 ComfyUI 的文件名应包含 taskId 前缀防止并发覆盖', async () => {
        let uploadedInitFilename = '';
        let uploadedMaskFilename = '';
        let submittedWorkflow: any = null;

        mockFetchExternal.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/upload/image')) {
                const formData = opts.body as any;
                const file = formData?.get?.('image');
                const filename = file?.name || '';
                if (filename.includes('_init.png')) {
                    uploadedInitFilename = filename;
                } else if (filename.includes('_mask.png')) {
                    uploadedMaskFilename = filename;
                }
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ name: filename || 'mock.png' })
                });
            }
            if (url.includes('/prompt')) {
                const body = JSON.parse(opts.body);
                submittedWorkflow = body.prompt;
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ prompt_id: 'pid-upload-test', number: 1 })
                });
            }
            if (url.includes('/history/')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        'pid-upload-test': {
                            status: { completed: true },
                            outputs: {
                                "9": { images: [{ filename: 'output.png', subfolder: '', type: 'output' }] }
                            }
                        }
                    })
                });
            }
            if (url.includes('/view?')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    blob: async () => new Blob(['fake-img'], { type: 'image/png' })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const request: GenerationRequest = {
            taskId: 'task_unique_123',
            targetEngine: 'comfyui',
            prompt: 'inpaint a cat',
            imageInputs: {
                initImageBlob: new Blob(['init'], { type: 'image/png' }),
                maskImageBlob: new Blob(['mask'], { type: 'image/png' }),
                denoiseStrength: 0.65
            },
            engineOptions: {
                workflowJson: {
                    "1": { "inputs": { "image": "%inpaint_image%" } },
                    "2": { "inputs": { "mask": "%inpaint_mask%" } }
                }
            }
        };

        const result = await adapter.generate(request);

        expect(result.taskId).toBe('task_unique_123');
        expect(uploadedInitFilename).toBe('task_unique_123_init.png');
        expect(uploadedMaskFilename).toBe('task_unique_123_mask.png');
        expect(submittedWorkflow['1'].inputs.image).toBe('task_unique_123_init.png');
        expect(submittedWorkflow['2'].inputs.mask).toBe('task_unique_123_mask.png');
    });

    it('waitViaHttpPolling 应在收到 AbortSignal 时立即退出并抛出 CANCELLED 错误', async () => {
        mockFetchExternal.mockImplementation((url: string) => {
            if (url.includes('/prompt')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ prompt_id: 'pid-poll-abort' })
                });
            }
            if (url.includes('/history/pid-poll-abort')) {
                // 历史记录始终为空，持续等待中
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({})
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const controller = new AbortController();
        const request: GenerationRequest = {
            taskId: 'task-poll-abort',
            targetEngine: 'comfyui',
            prompt: 'scenery',
            engineOptions: {
                workflowJson: { "1": { "class_type": "KSampler" } }
            }
        };

        // 50ms 后中止任务
        setTimeout(() => {
            controller.abort();
        }, 50);

        await expect(adapter.generate(request, controller.signal)).rejects.toThrow('ComfyUI 任务已取消');
    });

    it('当 ComfyUI 提交返回 node_errors 时，应准确解析具体节点并抛出包含详细原因的错误', async () => {
        mockFetchExternal.mockImplementation((url: string) => {
            if (url.includes('/prompt')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        node_errors: {
                            "3": {
                                class_type: "KSampler",
                                errors: [{ message: "Value not in list: sampler_name 'invalid_sampler'" }]
                            }
                        }
                    })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const request: GenerationRequest = {
            taskId: 'task-node-err',
            targetEngine: 'comfyui',
            prompt: 'scenery'
        };

        await expect(adapter.generate(request)).rejects.toThrow('节点 #3 [KSampler]: Value not in list');
    });

    it('当 ComfyUI 任务在后端崩溃且历史记录 status_str 为 error 时，应抛出后端崩溃错误', async () => {
        mockFetchExternal.mockImplementation((url: string) => {
            if (url.includes('/prompt')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ prompt_id: 'pid-crash' })
                });
            }
            if (url.includes('/history/pid-crash')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        'pid-crash': {
                            status: {
                                status_str: 'error',
                                messages: ['CUDA out of memory']
                            }
                        }
                    })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const request: GenerationRequest = {
            taskId: 'task-crash',
            targetEngine: 'comfyui',
            prompt: 'scenery'
        };

        await expect(adapter.generate(request)).rejects.toThrow('ComfyUI 任务执行异常崩溃: CUDA out of memory');
    });
});
