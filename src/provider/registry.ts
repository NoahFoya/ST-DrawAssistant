/**
 * 绘图服务提供方注册中心。
 *
 * @remarks
 * 维护已注册的提供方实例映射，支持按类型查询与动态替换。
 * 导出预配置的全局单例 providerRegistry，在模块加载时注册四个默认提供方实例。
 */

import type { GenerationProvider, ProviderRegistry, ProviderType } from '@types';
import { ComfyUIProvider } from './comfyui/comfyui-provider';
import { SdWebUIProvider } from './sdwebui/sdwebui-provider';
import { NovelAIProvider } from './novelai/novelai-provider';
import { OpenAIProvider } from './openai/openai-provider';

/**
 * 绘图服务提供方注册中心默认实现。
 */
export class DefaultProviderRegistry implements ProviderRegistry {
    private readonly _providers = new Map<ProviderType, GenerationProvider>();

    /**
     * 注册绘图服务提供方实例。
     *
     * @remarks 同类型注册时覆盖旧实例，用于测试替换或运行时动态切换。
     */
    public registerProvider(provider: GenerationProvider): void {
        this._providers.set(provider.providerType, provider);
    }

    /**
     * 根据类型标识获取已注册的提供方实例。
     *
     * @param type 提供方类型标识
     * @returns 对应实例，未注册时返回 undefined
     */
    public getProvider(type: ProviderType): GenerationProvider | undefined {
        return this._providers.get(type);
    }

    /**
     * 获取所有已注册的提供方类型标识列表。
     */
    public getAvailableTypes(): ProviderType[] {
        return Array.from(this._providers.keys());
    }
}

/**
 * 预配置的全局提供方注册中心单例。
 *
 * @remarks
 * 注册四个默认提供方实例（均使用各自的全局单例依赖）。
 * 测试中可通过 registerProvider 注入 mock 实例覆盖。
 */
export const providerRegistry: ProviderRegistry = (() => {
    const registry = new DefaultProviderRegistry();
    registry.registerProvider(new ComfyUIProvider());
    registry.registerProvider(new SdWebUIProvider());
    registry.registerProvider(new NovelAIProvider());
    registry.registerProvider(new OpenAIProvider());
    return registry;
})();
