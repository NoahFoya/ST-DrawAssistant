/**
 * 引擎适配器注册表 (src/function/adapter/registry.ts)
 *
 * 核心功能：
 * 1. 注册与单例缓存各绘图引擎适配器实例 (sdwebui, comfyui, novelai, openai)；
 * 2. 提供强类型重载的适配器获取方法 `getAdapter(type)`；
 * 3. 允许动态注入或替换适配器（用于扩展或单元测试 Mock）。
 *
 * 注意事项：
 * 1. 适配器实例在模块加载时即注册默认单例；
 * 2. 检索未注册引擎类型时显式抛出 Error。
 */

import type { EngineType, IEngineAdapter, ImageGenerationParams } from '@types';
import { SdWebUIAdapter } from './sdwebui';
import { ComfyUIAdapter } from './comfyui';
import { NovelAIAdapter } from './novelai';
import { OpenAIAdapter } from './openai';

const adapterRegistry: Map<EngineType, IEngineAdapter> = new Map();

// 初始化默认适配器单例
adapterRegistry.set('sdwebui', new SdWebUIAdapter());
adapterRegistry.set('comfyui', new ComfyUIAdapter());
adapterRegistry.set('novelai', new NovelAIAdapter());
adapterRegistry.set('openai', new OpenAIAdapter());

/**
 * 根据引擎类型获取对应的适配器实例（支持具体引擎类型的强类型推导）
 */
export function getAdapter(type: 'sdwebui'): SdWebUIAdapter;
export function getAdapter(type: 'comfyui'): ComfyUIAdapter;
export function getAdapter(type: 'novelai'): NovelAIAdapter;
export function getAdapter(type: 'openai'): OpenAIAdapter;
export function getAdapter<TParams extends ImageGenerationParams = ImageGenerationParams>(type: EngineType): IEngineAdapter<TParams>;
export function getAdapter(type: EngineType): IEngineAdapter {
    const adapter = adapterRegistry.get(type);
    if (!adapter) {
        throw new Error(`未找到已注册的引擎适配器: ${type}`);
    }
    return adapter;
}

/**
 * 获取所有已注册的引擎适配器列表
 */
export function getAllAdapters(): IEngineAdapter[] {
    return Array.from(adapterRegistry.values());
}

/**
 * 注册或覆盖引擎适配器实例（可用于运行时扩展或单元测试 Mock 注入）
 */
export function registerAdapter(adapter: IEngineAdapter): void {
    adapterRegistry.set(adapter.id, adapter);
}
