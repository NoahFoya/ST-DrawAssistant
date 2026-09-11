/**
 * UI 表现层统一导出入口
 */

export * from './foundation';
export * from './feedback';
export * from './layout';
export * from './components';
export * from './views';
export * from './media';

import { IDisposable, DisposableStore, CoreEventMap } from '../types';
import { TypedEventBus } from '../utils/event-bus';
import { SettingsStore } from '../state/settings-store';
import { StorageService } from '../state/storage-service';
import { HostClient } from '../host/host-client';
import { DriverRegistry } from '../services/drivers';
import { PromptPipeline } from '../pipeline/prompt-pipeline';
import { TaskManager } from '../tasks/task-manager';

import { ThemeService } from './foundation/theme-service';
import { UIRegistry } from './foundation/ui-registry';
import { registerCoreViews } from './views/register-views';
import { ModalService } from './layout/modal-service';
import { SettingsModal } from './layout/settings-modal';
import { DrawerEntryController } from './layout/drawer-entry';
import { FABContainer } from './layout/fab-container';
import { FloorButtonManager } from './layout/floor-button-manager';

/** UI 表现层上下文容器 */
export interface UIContext extends IDisposable {
    readonly themeService: ThemeService;
    readonly uiRegistry: UIRegistry;
    readonly settingsModal: SettingsModal;
    readonly drawerEntry: DrawerEntryController;
    readonly fabContainer: FABContainer;
    readonly floorButtonManager: FloorButtonManager;
}

/** 扁平服务依赖注入选项 */
export interface CreateUIContextOptions {
    settingsStore: SettingsStore;
    eventBus: TypedEventBus<CoreEventMap>;
    hostClient: HostClient;
    storageService: StorageService;
    driverRegistry: DriverRegistry;
    promptPipeline: PromptPipeline;
    taskManager: TaskManager;
}

/**
 * 组装并挂载 UI 表现层
 * 实例化外观主题、Tab 视图注册中心、主设置弹窗、原生抽屉扩展入口、悬浮球 (FAB) 与楼层生图按钮。
 */
export function createUIContext(options: CreateUIContextOptions): UIContext {
    const disposables = new DisposableStore();

    const {
        settingsStore: store,
        eventBus: events,
        hostClient: host,
        storageService: storage,
        driverRegistry: drivers,
        promptPipeline: pipeline,
        taskManager: tasks
    } = options;

    if (!store || !events || !host || !storage || !drivers || !pipeline || !tasks) {
        throw new Error('createUIContext 缺少必要的基础服务依赖');
    }

    // 初始化外观主题服务
    const themeService = new ThemeService(store);
    disposables.add(themeService);

    // 注册 UI 选项卡视图
    const uiRegistry = new UIRegistry();
    disposables.add(uiRegistry);
    disposables.add(
        registerCoreViews({
            uiRegistry,
            store,
            drivers,
            storage,
            host,
            events
        })
    );

    // 实例化主设置模态框
    const settingsModal = new SettingsModal({
        store,
        uiRegistry,
        modalService: ModalService.getInstance(),
        drivers
    });
    disposables.add(settingsModal);

    // 挂载宿主扩展抽屉入口
    const drawerEntry = new DrawerEntryController({
        host,
        store,
        settingsModal
    });
    disposables.add(drawerEntry);

    // 挂载悬浮球容器
    const fabContainer = new FABContainer({
        store,
        settingsModal,
        events
    });
    disposables.add(fabContainer);

    // 挂载消息楼层生图控制器与任务调度中枢 (合并高内聚)
    const floorButtonManager = new FloorButtonManager({
        host,
        events,
        store,
        taskManager: tasks,
        pipeline,
        storage
    });
    disposables.add(floorButtonManager);

    return {
        themeService,
        uiRegistry,
        settingsModal,
        drawerEntry,
        fabContainer,
        floorButtonManager,
        dispose: () => {
            disposables.dispose();
        }
    };
}
