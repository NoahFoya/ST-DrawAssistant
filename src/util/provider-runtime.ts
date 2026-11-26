/**
 * 绘图服务提供方运行时端口注册模块 (`provider-runtime.ts`)。
 *
 * @remarks
 * 用于在不让 `provider` 静态依赖 `store` 的前提下，向默认实例提供配置读取能力。
 */

import type { ProviderRuntimePort } from '@types';

let defaultProviderRuntime: ProviderRuntimePort | undefined;

/** 注册全局默认提供方运行时端口（通常由 store/settings-store 或应用入口注入） */
export function registerDefaultProviderRuntime(port: ProviderRuntimePort | undefined): void {
    defaultProviderRuntime = port;
}

/** 获取当前已注册的默认提供方运行时端口 */
export function getDefaultProviderRuntime(): ProviderRuntimePort | undefined {
    return defaultProviderRuntime;
}
