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
});
