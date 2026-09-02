/**
 * @module index
 * @description ST-DrawAssistant 前端扩展引导与生命周期入口 (Bootstrap)
 */

import { createCoreContext, CoreContext, EXTENSION_NAME, EXTENSION_VERSION } from './core';

export * from './core';

let _activeCoreContext: CoreContext | null = null;

/** 获取当前处于激活状态的核心基础设施上下文 (供调试使用) */
export function getActiveCoreContext(): CoreContext | null {
    return _activeCoreContext;
}

/**
 * 插件全局引导入口函数
 */
export async function bootstrap(): Promise<CoreContext> {
    if (_activeCoreContext) {
        console.warn(`[${EXTENSION_NAME}] 插件已处于初始化状态，跳过重复自启动。`);
        return _activeCoreContext;
    }

    console.info(`[${EXTENSION_NAME}] v${EXTENSION_VERSION} 插件正在启动初始化...`);

    // 1. 初始化核心基础设施层上下文
    const context = createCoreContext();
    _activeCoreContext = context;

    // 2. 宿主环境就绪等待与本地存储初始化
    try {
        await context.host.whenReady();
        await context.storage.init();
        context.events.emit('host:ready', undefined);
        context.logger.info('ST-DrawAssistant 核心基础设施层已就绪');
    } catch (err) {
        context.logger.error('核心基础设施层启动自检异常', err);
    }

    // 3. 监听页面卸载与生命周期安全清理
    if (typeof window !== 'undefined') {
        window.addEventListener(
            'pagehide',
            () => {
                dispose();
            },
            { once: true }
        );
    }

    return context;
}

/**
 * 释放插件持有的所有全局资源
 */
export function dispose(): void {
    if (!_activeCoreContext) return;
    try {
        _activeCoreContext.dispose();
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 释放插件资源异常:`, err);
    } finally {
        _activeCoreContext = null;
        console.info(`[${EXTENSION_NAME}] 插件资源已释放。`);
    }
}

// 浏览器环境自动引导自启动
if (typeof window !== 'undefined') {
    void bootstrap();
}
