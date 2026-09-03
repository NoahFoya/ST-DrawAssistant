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
 * 插件全局引导入口
 *
 * 负责基础设施容器实例化、宿主异步就绪等待、持久化配置回填及底层存储挂载，
 * 并注册页面卸载时的资源释放监听，确保插件全生命周期闭环。
 */
export async function bootstrap(): Promise<CoreContext> {
    if (_activeCoreContext) {
        console.warn(`[${EXTENSION_NAME}] 插件已处于初始化状态，跳过重复自启动。`);
        return _activeCoreContext;
    }

    console.info(`[${EXTENSION_NAME}] v${EXTENSION_VERSION} 插件正在启动初始化...`);

    const context = createCoreContext();
    _activeCoreContext = context;

    // 等待宿主就绪，同步已存配置并挂载本地存储
    try {
        await context.host.whenReady();
        const savedSettings = context.host.getExtensionSettings();
        if (savedSettings) {
            context.store.update(savedSettings);
        }
        await context.storage.init();
        context.events.emit('host:ready', undefined);
        context.logger.info('ST-DrawAssistant 核心基础设施层已就绪');
    } catch (err) {
        context.logger.error('核心基础设施层启动自检异常', err);
    }

    // 页面卸载时释放所有全局资源
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

if (typeof window !== 'undefined') {
    void bootstrap();
}
