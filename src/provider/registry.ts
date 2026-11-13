/**
 * 绘图服务提供方注册中心 (ProviderRegistry)。
 *
 * @remarks
 * 维护 ProviderType 到各服务驱动实例的单例映射字典。
 * 支持通过 registerProvider 动态注册或覆盖驱动实现，便于模块扩展与测试验证。
 */

import type { GenerationProvider, ProviderRegistry, ProviderType } from '@types';
import { ComfyUIProvider } from './comfyui/comfyui-provider';
import { SdWebUIProvider } from './sdwebui/sdwebui-provider';
import { NovelAIProvider } from './novelai/novelai-provider';
import { OpenAIProvider } from './openai/openai-provider';

/**
 * 绘图服务提供方注册中心默认实现类。
 */
export class DefaultProviderRegistry implements ProviderRegistry {
    private readonly _providers = new Map<ProviderType, GenerationProvider>();

    /**
     * 注册绘图服务提供方实例。
     *
     * @remarks 同类型重复注册时覆盖旧实例，支持测试注入 mock 桩或运行时动态拓展。
     * @param provider 实现 GenerationProvider 接口的具体提供方实例
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
