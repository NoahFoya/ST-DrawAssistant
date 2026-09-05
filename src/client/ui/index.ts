/**
 * @module ui
 * @description UI 表现层统一导出入口
 */

export * from './foundation';
export * from './feedback';
export * from './layout';
export * from './controls';
export * from './views';
export * from './media';

import { IDisposable, DisposableStore } from '../core';
import { CoreContext } from '../core/context';
import { DomainContext } from '../domain/context';
import { ThemeService } from './foundation/theme-service';
import { UIRegistry } from './foundation/ui-registry';
import { registerCoreViews } from './views/register-views';
import { ModalService } from './layout/modal-service';
import { SettingsModal } from './layout/settings-modal';
import { DrawerEntryController } from './layout/drawer-entry';
import { FABContainer } from './layout/fab-container';
import { FloorButtonContainer } from './layout/floor-button-container';

/** UI 表现层上下文容器 */
export interface UIContext extends IDisposable {
    readonly themeService: ThemeService;
    readonly uiRegistry: UIRegistry;
    readonly settingsModal: SettingsModal;
    readonly drawerEntry: DrawerEntryController;
    readonly fabContainer: FABContainer;
    readonly floorButtonContainer: FloorButtonContainer;
}

export interface CreateUIContextOptions {
    core: CoreContext;
    domain: DomainContext;
}

/**
 * 组装并初始化 UI 表现层
 *
 * 挂载流程：
 * 1. 初始化并订阅外观主题 (ThemeService)；
 * 2. 初始化 Tab 注册中心并注册内置 10 个设置 Tab；
 * 3. 创建主设置弹窗控制器 (SettingsModal)；
 * 4. 挂载 SillyTavern 原生抽屉设置项 (DrawerEntryController)；
 * 5. 挂载全局屏幕悬浮球 (FABContainer)；
 * 6. 挂载消息楼层生图按钮注入控制器 (FloorButtonContainer)。
 */
export function createUIContext(options: CreateUIContextOptions): UIContext {
    const { core, domain } = options;
    const disposables = new DisposableStore();

    // 1. 初始化外观主题服务
    const themeService = new ThemeService(core.store);
    disposables.add(themeService);

    // 2. 实例化 UI 注册中心并注册内置 10 个 Tab 视图
    const uiRegistry = new UIRegistry();
    disposables.add(uiRegistry);
    disposables.add(
        registerCoreViews({
            uiRegistry,
            store: core.store,
            adapters: domain.adapters,
            storage: core.storage,
            host: core.host
        })
    );

    // 3. 实例化全局主设置模态框
    const settingsModal = new SettingsModal({
        store: core.store,
        uiRegistry,
        modalService: ModalService.getInstance(),
        adapters: domain.adapters
    });
    disposables.add(settingsModal);

    // 4. 挂载宿主抽屉入口
    const drawerEntry = new DrawerEntryController({
        host: core.host,
        store: core.store,
        settingsModal
    });
    disposables.add(drawerEntry);

    // 5. 挂载全局悬浮球 (FAB)
    const fabContainer = new FABContainer({
        store: core.store,
        settingsModal,
        events: core.events
    });
    disposables.add(fabContainer);

    // 6. 挂载楼层生图按钮交互容器
    const floorButtonContainer = new FloorButtonContainer({
        host: core.host,
        events: core.events,
        store: core.store,
        taskManager: domain.tasks,
        pipeline: domain.pipeline,
        storage: core.storage
    });
    disposables.add(floorButtonContainer);

    return {
        themeService,
        uiRegistry,
        settingsModal,
        drawerEntry,
        fabContainer,
        floorButtonContainer,
        dispose: () => {
            disposables.dispose();
        }
    };
}

