import { describe, it, expect } from 'vitest';
import { createCoreContext } from '../../../src/client/core';
import { createDomainContext, DomainContext } from '../../../src/client/domain';

describe('DomainContext (领域服务统一组装容器)', () => {
    it('应该自动完成注册中心初始化并挂载默认四大驱动适配器', () => {
        const core = createCoreContext();
        const domain = createDomainContext({ core });

        expect(domain).toBeInstanceOf(DomainContext);
        expect(domain.adapters).toBeDefined();
        expect(domain.pipeline).toBeDefined();
        expect(domain.tasks).toBeDefined();
        expect(domain.results).toBeDefined();

        // 验证四大官方驱动均已注册就绪
        expect(domain.adapters.has('sdwebui')).toBe(true);
        expect(domain.adapters.has('novelai')).toBe(true);
        expect(domain.adapters.has('comfyui')).toBe(true);
        expect(domain.adapters.has('cloud')).toBe(true);

        domain.dispose();
        core.dispose();
    });

    it('dispose 应该能安全释放任务管理器与注册中心资源', () => {
        const core = createCoreContext();
        const domain = createDomainContext({ core });

        expect(() => {
            domain.dispose();
        }).not.toThrow();

        core.dispose();
    });

    it('当配置中心提供自定义 serverUrl 时，各适配器应动态解析自定义端点', () => {
        const core = createCoreContext({
            engineConfigs: {
                novelai: {
                    serverUrl: 'https://custom.novelai-proxy.com'
                }
            }
        });
        const domain = createDomainContext({ core });

        const novelai = domain.adapters.get('novelai') as any;
        expect(novelai).toBeDefined();
        expect(novelai.baseUrl).toBe('https://custom.novelai-proxy.com');

        domain.dispose();
        core.dispose();
    });

    it('脱离任何扩展层时，插件本体具备完整自包含能力，能独立完成提示词处理与任务组装', async () => {
        const core = createCoreContext();
        const domain = createDomainContext({ core });

        expect(domain.hooks).toBeDefined();

        // 未挂载任何外部扩展时，本体流水线依然自包含可用，独立完成管道切分与生图请求组装
        const processed = await domain.pipeline.process({
            rawPrompt: 'masterpiece, 1girl in garden | worst quality',
            targetEngine: 'novelai',
            contextInfo: {
                characterName: 'Keqing'
            }
        });

        expect(processed.prompt).toBe('masterpiece, 1girl in garden');
        expect(processed.request.prompt).toBe('masterpiece, 1girl in garden');
        expect(processed.request.negativePrompt).toBe('worst quality');
        expect(processed.request.targetEngine).toBe('novelai');
        expect(processed.request.contextInfo?.characterName).toBe('Keqing');

        domain.dispose();
        core.dispose();
    });

    it('外部扩展可通过 domain.hooks 进行非侵入式挂载与生命周期管理', async () => {
        const core = createCoreContext();
        const domain = createDomainContext({ core });

        // 模拟外部角色扩展或修饰扩展通过公开 hooks 注入逻辑
        const extRegistration = domain.hooks.beforePromptBuild.register(
            'ext-custom-addon',
            (prompt) => `${prompt}, extra detail from addon`
        );

        const processed = await domain.pipeline.process({
            rawPrompt: '1girl, solo',
            targetEngine: 'sdwebui'
        });
        expect(processed.prompt).toBe('1girl, solo, extra detail from addon');

        // 卸载扩展后恢复原生行为
        extRegistration.dispose();

        const processedAfterUnload = await domain.pipeline.process({
            rawPrompt: '1girl, solo',
            targetEngine: 'sdwebui'
        });
        expect(processedAfterUnload.prompt).toBe('1girl, solo');

        domain.dispose();
        core.dispose();
    });
});
