/**
 * @module index
 * @description ST-DrawAssistant 插件统一引导入口与生命周期管理
 */

import { createCoreContext, CoreContext, EXTENSION_NAME, EXTENSION_VERSION } from './core';
import { createDomainContext, DomainContext } from './domain';

export * from './core';
export * from './domain';

let _activeCoreContext: CoreContext | null = null;
let _activeDomainContext: DomainContext | null = null;

/** 获取当前处于激活状态的基础设施服务容器 (供调试与状态检查使用) */
export function getActiveCoreContext(): CoreContext | null {
    return _activeCoreContext;
}

/** 获取当前处于激活状态的领域业务服务容器 (供业务调用与状态检查使用) */
export function getActiveDomainContext(): DomainContext | null {
    return _activeDomainContext;
}

/**
 * 插件全局引导入口
 *
 * 设计意图：按依赖顺序分步初始化系统。先建立核心基础设施服务（网络、存储、配置与宿主桥接），
 * 待宿主就绪并同步存储后，再组装领域层业务服务（驱动注册表、任务管理器、流水线），
 * 并在浏览器页面卸载时注册清理监听，确保所有后台任务与连接安全释放。
 */
export async function bootstrap(): Promise<{ core: CoreContext; domain: DomainContext }> {
    if (_activeCoreContext && _activeDomainContext) {
        console.warn(`[${EXTENSION_NAME}] 插件已处于初始化状态，跳过重复自启动。`);
        return { core: _activeCoreContext, domain: _activeDomainContext };
    }

    console.info(`[${EXTENSION_NAME}] v${EXTENSION_VERSION} 插件正在启动初始化...`);

    // 1. 初始化核心基础设施容器
    const core = createCoreContext();
    _activeCoreContext = core;

    // 2. 初始化领域业务服务容器
    const domain = createDomainContext({ core });
    _activeDomainContext = domain;

    // 3. 等待宿主就绪，同步本地已存配置并挂载本地存储数据库
    try {
        await core.host.whenReady();
        const savedSettings = core.host.getExtensionSettings();
        if (savedSettings) {
            core.store.update(savedSettings);
        }
        await core.storage.init();
        core.events.emit('host:ready', undefined);
        core.logger.info('ST-DrawAssistant 核心基础设施与领域业务服务已就绪');
    } catch (err) {
        core.logger.error('插件启动初始化检测异常', err);
    }

    // 4. 页面卸载或刷新时，按反向依赖顺序释放全局资源
    if (typeof window !== 'undefined') {
        window.addEventListener(
            'pagehide',
            () => {
                dispose();
            },
            { once: true }
        );
    }

    return { core, domain };
}

/**
 * 释放插件持有的所有全局资源
 * 优先释放领域层正在执行的任务与驱动连接，再释放底层存储与事件总线
 */
export function dispose(): void {
    if (_activeDomainContext) {
        try {
            _activeDomainContext.dispose();
        } catch (err) {
            console.error(`[${EXTENSION_NAME}] 释放领域层服务异常:`, err);
        } finally {
            _activeDomainContext = null;
        }
    }

    if (_activeCoreContext) {
        try {
            _activeCoreContext.dispose();
        } catch (err) {
            console.error(`[${EXTENSION_NAME}] 释放基础设施服务异常:`, err);
        } finally {
            _activeCoreContext = null;
            console.info(`[${EXTENSION_NAME}] 插件全部资源已释放。`);
        }
    }
}

if (typeof window !== 'undefined') {
    void bootstrap();
}
