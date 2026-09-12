/**
 * 引擎适配器注册中心与工厂
 * 提供生图引擎单例字典检索与统一访问。
 */

import type { EngineType, IEngineAdapter } from '@types';
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
 * 根据引擎类型获取对应的适配器实例
 */
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
