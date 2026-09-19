/**
 * ST-DrawAssistant 插件核心导出与生命周期激活入口。
 *
 * @remarks
 * 聚合导出领域类型、基础工具、存储中心、服务提供方及任务编排流水线，
 * 并提供符合 SillyTavern 扩展规范的单例激活与资源卸载函数。
 */

import { sessionLifecycle } from './pipeline/session-lifecycle';
import { urlPool } from './store/url-pool';
import { logger } from './util/logger';

export type * from '@types';
export * from './util';
export * from './store';
export * from './provider';
export * from './pipeline';

let isInitialized = false;

/**
 * 插件单例初始化函数。
 *
 * @remarks
 * 负责检测 SillyTavern 宿主环境并挂载全局生命周期事件监听器。
 * 具备幂等性保护，重复调用直接安全返回。
 */
export async function initOnce(): Promise<void> {
    if (isInitialized) {
        return;
    }

    if (typeof window === 'undefined') {
        return;
    }

    const hostContext = (window as any).SillyTavern?.getContext?.();
    if (!hostContext) {
        logger.info('未检测到 SillyTavern 宿主上下文，跳过生命周期挂载');
        return;
    }

    // 绑定会话生命周期监听器
    sessionLifecycle.bindHostEvents();

    isInitialized = true;
    logger.info('ST-DrawAssistant 扩展核心生命周期已就绪');
}

/**
 * SillyTavern 扩展清单规范激活钩子。
 *
 * @remarks
 * 由 manifest.json 中的 hooks.activate 配置项指定调用。
 */
export async function onActivate(): Promise<void> {
    await initOnce();
}

/**
 * 插件全局资源卸载与监听器清理函数。
 *
 * @remarks
 * 解绑全部宿主事件，释放临时图片资源，重置初始化状态。
 */
export function disposeExtension(): void {
    sessionLifecycle.unbindHostEvents();
    urlPool.revokeAll();
    isInitialized = false;
    logger.info('ST-DrawAssistant 扩展已安全卸载');
}

// 浏览器环境下自动检测并尝试自激活
if (typeof window !== 'undefined' && (window as any).SillyTavern?.getContext) {
    void initOnce();
}
