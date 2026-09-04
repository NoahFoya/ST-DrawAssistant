import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { NovelAIAdapter, resolveNovelAIEndpoint } from '../../src/client/domain/drivers/novelai-adapter';
import { NetworkClient } from '../../src/client/core/network/client';
import { loadServerConfig } from '../../src/server/server-config';
import { ConfigStore } from '../../src/client/core/config/config-store';

describe('NovelAI 现场真实出图与凭据存储集成测试', () => {
    it('应成功连接反代端点并完成真实文生图，保存结果图片至 output/ 目录', async () => {
        // 1. 读取本地 YAML 真实配置或环境变量
        const serverConfig = loadServerConfig();
        const apiKey = process.env.ST_DRAW_NOVELAI_API_KEY || serverConfig.apiKeys.novelai;
        if (!apiKey) {
            console.warn('[跳过测试] 未配置 NovelAI API Key，跳过现场真实在线生图测试');
            return;
        }

        const baseUrl = process.env.ST_DRAW_NOVELAI_ENDPOINT || serverConfig.endpoints.novelai || 'https://std.loliyc.com/novelai';
        const targetEndpoint = resolveNovelAIEndpoint(baseUrl);
        console.log(`[NAI Live Test] 目标生图端点: ${targetEndpoint}`);

        // 2. 初始化网络客户端与 NovelAI 适配器 (模拟前端运行时环境)
        const network = new NetworkClient({
            csrfHeadersProvider: () => ({}),
            getProxyMode: () => 'browser' // 直连反代端点测试真实可用性
        });

        const adapter = new NovelAIAdapter({
            driverName: 'NovelAI',
            baseUrl,
            network,
            defaultConfig: {
                apiKey,
                model: 'nai-diffusion-4-full',
                width: 832,
                height: 1216,
                steps: 28,
                scale: 6.0,
                convertPromptSyntax: true
            }
        });

        // 3. 执行健康检查
        console.log('[NAI Live Test] 正在执行端点健康检查...');
        const health = await adapter.checkHealth();
        console.log('[NAI Live Test] 健康检查结果:', health);

        // 4. 执行文生图请求 (测试轻量高质量提示词)
        console.log('[NAI Live Test] 正在发起文生图请求...');
        const startTime = performance.now();
        const result = await adapter.generate({
            prompt: '1girl, masterpiece, best quality, beautiful detailed eyes, solo, cinematic lighting',
            negativePrompt: 'low quality, worst quality, blurry',
            width: 832,
            height: 1216,
            engineOptions: {
                model: 'nai-diffusion-4-full'
            }
        });

        const duration = Math.round(performance.now() - startTime);
        console.log(`[NAI Live Test] 出图成功！耗时: ${duration}ms，共生成 ${result.images.length} 张图片`);

        expect(result.images.length).toBeGreaterThan(0);
        const imageRecord = result.images[0];
        expect(imageRecord.blob).toBeDefined();
        expect(imageRecord.blob.size).toBeGreaterThan(10240); // 大于 10KB

        // 5. 保存结果图像到 output/ 目录
        const outputDir = path.resolve(process.cwd(), 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const outputPath = path.join(outputDir, 'novelai_live_test.png');
        const arrayBuffer = await imageRecord.blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(outputPath, buffer);
        console.log(`[NAI Live Test] 图片已成功存盘至: ${outputPath} (文件大小: ${(buffer.length / 1024).toFixed(1)} KB)`);

        // 验证 PNG 头魔数 (89 50 4E 47 0D 0A 1A 0A)
        expect(buffer[0]).toBe(0x89);
        expect(buffer[1]).toBe(0x50);
        expect(buffer[2]).toBe(0x4E);
        expect(buffer[3]).toBe(0x47);

        // 6. 同步验证前端存储密文机制 (断言宿主持久化数据绝不包含明文)
        let persistedState: any = null;
        const store = new ConfigStore(undefined, {
            onSave: (state) => {
                persistedState = state;
            }
        });
        await store.ready;

        store.setEngineConfig('novelai', {
            model: 'nai-diffusion-4-full',
            apiKey
        });
        store.flush();
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(persistedState).toBeDefined();
        const persistedKey = persistedState.engineConfigs.novelai.apiKey;
        expect(persistedKey.startsWith('enc:v1:')).toBe(true);
        expect(persistedKey).not.toContain(apiKey);
        console.log('[NAI Live Test] 凭据存储安全性验证通过：前端宿主存储落盘为密文，绝无明文泄露。');
    }, 180000); // 3 分钟超时
});
