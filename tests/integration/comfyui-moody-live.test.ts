import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ComfyUIAdapter } from '../../src/client/domain/drivers/comfyui-adapter';
import { NetworkClient } from '../../src/client/core/network/client';
import { GenerationRequest } from '../../src/client/domain/types';

describe('ComfyUI 真实后端现场生图测试 (Moody 预设)', () => {
    const COMFYUI_URL = 'http://127.0.0.1:8188';

    it('调用 ComfyUI (127.0.0.1:8188) 使用 Moody 预设执行文生图并保存结果', async () => {
        // 1. 健康检查，若 ComfyUI 未启动则跳过测试
        let isOnline = false;
        try {
            const res = await fetch(`${COMFYUI_URL}/system_stats`, { signal: AbortSignal.timeout(3000) });
            isOnline = res.ok;
        } catch {
            isOnline = false;
        }

        if (!isOnline) {
            console.warn(`[跳过测试] ComfyUI 服务未在 ${COMFYUI_URL} 运行`);
            return;
        }

        console.log(`[ComfyUI] 服务在线，开始准备 Moody 预设参数...`);

        // 2. 读取旧版本中的 Moody 预设文件
        const rootDir = process.cwd();
        const workflowFilePath = path.join(rootDir, '_backup_legacy/config/presets/comfyui/workflows-txt2img/Moody  Anima 工作流.json');
        const modelPresetPath = path.join(rootDir, '_backup_legacy/config/presets/comfyui/models/moody-anima.json');
        const promptPresetPath = path.join(rootDir, '_backup_legacy/config/presets/comfyui/prompts/moody-aesthetic.json');

        expect(fs.existsSync(workflowFilePath)).toBe(true);
        expect(fs.existsSync(modelPresetPath)).toBe(true);
        expect(fs.existsSync(promptPresetPath)).toBe(true);

        const workflowData = JSON.parse(fs.readFileSync(workflowFilePath, 'utf-8'));
        const modelPreset = JSON.parse(fs.readFileSync(modelPresetPath, 'utf-8'));
        const promptPreset = JSON.parse(fs.readFileSync(promptPresetPath, 'utf-8'));

        // 3. 构建提示词 (前缀 + 用户测试主体)
        const positivePrefix = promptPreset.data?.promptPrefix || '';
        const negativePrefix = promptPreset.data?.negativePrefix || '';
        const userPrompt = '1girl, solo, silver hair, blue eyes, smiling, soft lighting, upper body';
        const fullPositive = positivePrefix ? `${positivePrefix}, ${userPrompt}` : userPrompt;
        const fullNegative = negativePrefix;

        console.log(`[ComfyUI] 正向提示词: ${fullPositive}`);
        console.log(`[ComfyUI] 负向提示词: ${fullNegative}`);

        // 4. 初始化 NetworkClient 与 ComfyUIAdapter
        const network = new NetworkClient({
            csrfHeadersProvider: () => ({}),
            getProxyMode: () => 'browser'
        });

        const adapter = new ComfyUIAdapter({
            network,
            driverName: 'ComfyUI',
            getEndpointUrl: () => COMFYUI_URL,
            defaultConfig: {
                workflowJson: workflowData.json, // 传入工作流 JSON 模板字符串
                ckptName: modelPreset.data.ckptName,
                clipName: modelPreset.data.clipName,
                vaeName: modelPreset.data.vaeName,
                steps: modelPreset.data.steps,
                cfgScale: modelPreset.data.cfgScale,
                samplerName: modelPreset.data.samplerName,
                scheduler: modelPreset.data.scheduler,
                width: modelPreset.data.width,
                height: modelPreset.data.height,
                seed: Math.floor(Math.random() * 1000000000000) // 动态随机种子验证真实生成链路
            }
        });

        // 验证驱动 Ping 联通性
        const health = await adapter.checkHealth();
        console.log('[ComfyUI Health Result]', health);
        expect(health.ok).toBe(true);
        console.log(`[ComfyUI] Adapter Ping 连通成功!`);

        // 5. 构建生图请求
        const request: GenerationRequest = {
            taskId: `live_test_${Date.now()}`,
            targetEngine: 'comfyui',
            prompt: fullPositive,
            negativePrompt: fullNegative,
            engineOptions: {}
        };

        const progressUpdates: number[] = [];
        const onProgress = (progress: number) => {
            const percent = Math.round(progress * 100);
            progressUpdates.push(percent);
            console.log(`[ComfyUI 任务进度] ${percent}%`);
        };

        console.log(`[ComfyUI] 正在提交任务并等待出图 (模型 steps: ${modelPreset.data.steps}, 采样器: ${modelPreset.data.samplerName})...`);
        const startTime = Date.now();

        // 6. 执行生图
        const result = await adapter.generate(request, undefined, onProgress);
        const duration = Date.now() - startTime;

        console.log(`[ComfyUI] 任务执行完成! 耗时: ${duration}ms, 输出图片数: ${result.images.length}`);

        expect(result).toBeDefined();
        expect(result.images.length).toBeGreaterThan(0);

        const firstImage = result.images[0];
        expect(firstImage.blob).toBeDefined();
        expect(firstImage.format).toBe('image/png');

        // 7. 将生成的 Blob 转换为 Buffer 写入输出目录
        const imageBuffer = Buffer.from(await firstImage.blob.arrayBuffer());
        expect(imageBuffer.length).toBeGreaterThan(1000); // 确保是有效的大于 1KB 的图像文件

        const outputDir = path.join(rootDir, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPath = path.join(outputDir, 'comfyui_moody_test.png');
        fs.writeFileSync(outputPath, imageBuffer);

        console.log(`[ComfyUI 现场测试成功] 图片已成功保存至: ${outputPath}`);
        console.log(`[文件大小] ${(imageBuffer.length / 1024).toFixed(2)} KB`);

        adapter.dispose();
    }, 180000);

    it('调用 ComfyUI 挂载结构化 WeiLin LoRA 进行生图并保存结果', async () => {
        let isOnline = false;
        try {
            const res = await fetch(`${COMFYUI_URL}/system_stats`, { signal: AbortSignal.timeout(3000) });
            isOnline = res.ok;
        } catch {
            isOnline = false;
        }

        if (!isOnline) {
            console.warn(`[跳过测试] ComfyUI 服务未在 ${COMFYUI_URL} 运行`);
            return;
        }

        const rootDir = process.cwd();
        const workflowFilePath = path.join(rootDir, '_backup_legacy/config/presets/comfyui/workflows-txt2img/Moody  Anima 工作流.json');
        const modelPresetPath = path.join(rootDir, '_backup_legacy/config/presets/comfyui/models/moody-anima.json');
        const promptPresetPath = path.join(rootDir, '_backup_legacy/config/presets/comfyui/prompts/moody-aesthetic.json');

        const workflowData = JSON.parse(fs.readFileSync(workflowFilePath, 'utf-8'));
        const modelPreset = JSON.parse(fs.readFileSync(modelPresetPath, 'utf-8'));
        const promptPreset = JSON.parse(fs.readFileSync(promptPresetPath, 'utf-8'));

        const positivePrefix = promptPreset.data?.promptPrefix || '';
        const negativePrefix = promptPreset.data?.negativePrefix || '';
        const userPrompt = '1girl, solo, silver hair, red eyes, cat ears, gothic dress, moon night';
        const fullPositive = positivePrefix ? `${positivePrefix}, ${userPrompt}` : userPrompt;
        const fullNegative = negativePrefix;

        const network = new NetworkClient({
            csrfHeadersProvider: () => ({}),
            getProxyMode: () => 'browser'
        });

        const adapter = new ComfyUIAdapter({
            network,
            driverName: 'ComfyUI',
            getEndpointUrl: () => COMFYUI_URL,
            defaultConfig: {
                workflowJson: workflowData.json,
                ckptName: modelPreset.data.ckptName,
                clipName: modelPreset.data.clipName,
                vaeName: modelPreset.data.vaeName,
                steps: modelPreset.data.steps,
                cfgScale: modelPreset.data.cfgScale,
                samplerName: modelPreset.data.samplerName,
                scheduler: modelPreset.data.scheduler,
                width: modelPreset.data.width,
                height: modelPreset.data.height,
                seed: Math.floor(Math.random() * 1000000000000)
            }
        });

        // 验证 formatLoraTag 输出符合 WeiLin 规范
        const loraItem = {
            name: 'anima-highres-aesthetic-boost',
            weight: 0.8,
            clipWeight: 0.7,
            triggerWeight: 1.0,
            enabled: true
        };
        const generatedTag = adapter.formatLoraTag(loraItem);
        expect(generatedTag).toBe('<wlr:anima-highres-aesthetic-boost:0.8:0.7:1>');
        console.log(`[WeiLin LoRA 格式化标签验证]: ${generatedTag}`);

        // 构建带有结构化 LoRA 的生图请求
        const request: GenerationRequest = {
            taskId: `live_lora_test_${Date.now()}`,
            targetEngine: 'comfyui',
            prompt: fullPositive,
            negativePrompt: fullNegative,
            engineOptions: {
                loras: [loraItem]
            }
        };

        console.log(`[ComfyUI] 正在提交带有 WeiLin LoRA 的任务并等待出图...`);
        const startTime = Date.now();

        const result = await adapter.generate(request, undefined, (p) => {
            console.log(`[ComfyUI LoRA 生图进度] ${Math.round(p * 100)}%`);
        });

        const duration = Date.now() - startTime;
        console.log(`[ComfyUI] LoRA 生图任务执行完成! 耗时: ${duration}ms, 输出图片数: ${result.images.length}`);

        expect(result.images.length).toBe(1);
        const imageBlob = result.images[0].blob;
        const imageBuffer = Buffer.from(await imageBlob.arrayBuffer());

        const outputDir = path.join(rootDir, 'output');
        const outputPath = path.join(outputDir, 'comfyui_moody_lora_test.png');
        fs.writeFileSync(outputPath, imageBuffer);

        console.log(`[WeiLin LoRA 现场生图成功] 图片已保存至: ${outputPath}`);
        console.log(`[文件大小] ${(imageBuffer.length / 1024).toFixed(2)} KB`);

        adapter.dispose();
    }, 180000);
});
