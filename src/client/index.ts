/**
 * @module index
 * @description ST-DrawAssistant 插件统一引导入口与生命周期管理
 */

import { createCoreContext, CoreContext, EXTENSION_NAME, EXTENSION_VERSION } from './core';
import { createDomainContext, DomainContext } from './domain';
import { createUIContext, UIContext } from './ui';

export * from './core';
export * from './domain';
export * from './ui';
export type { LoraItem } from './domain';

let _activeCoreContext: CoreContext | null = null;
let _activeDomainContext: DomainContext | null = null;
let _activeUIContext: UIContext | null = null;

/** 获取当前处于激活状态的核心服务容器 (供调试与状态检查使用) */
export function getActiveCoreContext(): CoreContext | null {
    return _activeCoreContext;
}

/** 获取当前处于激活状态的领域服务容器 (供业务调用与状态检查使用) */
export function getActiveDomainContext(): DomainContext | null {
    return _activeDomainContext;
}

/** 获取当前处于激活状态的 UI 表现层容器 (供界面调用与状态检查使用) */
export function getActiveUIContext(): UIContext | null {
    return _activeUIContext;
}

/**
 * 插件初始化入口
 *
 * 初始化流程：
 * 1. 先初始化核心服务（网络、存储、配置与宿主通信）；
 * 2. 宿主就绪后加载已保存配置并初始化本地数据库；
 * 3. 创建领域层服务（驱动注册表、任务调度管理器与流水线）；
 * 4. 创建并挂载 UI 表现层（主题、Tab 注册、主模态框、原生抽屉、悬浮球与楼层生图按钮）；
 * 5. 页面关闭或刷新时自动按逆序释放资源。
 */
export async function bootstrap(): Promise<{ core: CoreContext; domain: DomainContext; ui: UIContext }> {
    if (_activeCoreContext && _activeDomainContext && _activeUIContext) {
        console.warn(`[${EXTENSION_NAME}] 插件已处于初始化状态，跳过重复自启动。`);
        return { core: _activeCoreContext, domain: _activeDomainContext, ui: _activeUIContext };
    }

    console.info(`[${EXTENSION_NAME}] v${EXTENSION_VERSION} 插件正在启动初始化...`);

    const core = createCoreContext();
    _activeCoreContext = core;

    // 等待配置存储初始化就绪
    await core.store.ready;

    const domain = createDomainContext({ core });
    _activeDomainContext = domain;

    // 等待宿主环境完全挂载，同步宿主已存配置并初始化本地存储
    try {
        await core.host.whenReady();
        const savedSettings = core.host.getExtensionSettings();
        if (savedSettings) {
            await core.store.loadSettings(savedSettings);
        }
        await core.storage.init();
        core.events.emit('host:ready', undefined);
        core.logger.info('ST-DrawAssistant 核心服务与领域服务已就绪');
    } catch (err) {
        core.logger.error('插件启动初始化检测异常', err);
    }

    // 挂载 UI 表现层
    const ui = createUIContext({ core, domain });
    _activeUIContext = ui;
    core.logger.info('ST-DrawAssistant UI 表现层已挂载就绪');

    // 页面卸载或刷新时，释放全局持有的任务与连接资源
    if (typeof window !== 'undefined') {
        window.addEventListener(
            'pagehide',
            () => {
                dispose();
            },
            { once: true }
        );
    }

    return { core, domain, ui };
}

/**
 * 释放插件持有的所有全局资源 (按 LIFO 逆序释放)
 * 1. 优先释放 UI 表现层 DOM 节点与事件监听；
 * 2. 再释放领域层正在执行的任务与驱动连接；
 * 3. 最后释放底层存储与核心事件总线。
 */
export function dispose(): void {
    if (_activeUIContext) {
        try {
            _activeUIContext.dispose();
        } catch (err) {
            console.error(`[${EXTENSION_NAME}] 释放 UI 表现层服务异常:`, err);
        } finally {
            _activeUIContext = null;
        }
    }

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
            console.error(`[${EXTENSION_NAME}] 释放核心服务异常:`, err);
        } finally {
            _activeCoreContext = null;
            console.info(`[${EXTENSION_NAME}] 插件全部资源已释放。`);
        }
    }
}

if (typeof window !== 'undefined') {
    void bootstrap();
}
