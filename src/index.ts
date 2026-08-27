/**
 * @module index
 * @description ST-DrawAssistant 插件引导与生命周期装配入口 (Bootstrap)
 */

import { createKernelContext, KernelContext } from './core';
import { createPipelineHooks, PromptPipeline, ComfyUIDriver, SDWebUIDriver, TaskManager } from './domain';
import {
    ModalService,
    FeedbackService,
    ThemeService,
    SettingsModal,
    FloorButtonContainer,
    FABContainer,
    createGeneralTabView,
    createComfyUITabView,
    createSDWebUITabView,
    createThemeTabView,
    createDiagnosticsTabView,
    createGalleryTabView,
    createFABSettingsTabView,
    createAboutTabView
} from './ui';
import { CharacterManagerExtension } from './extensions/character-manager';

// 导出所有层级类型与模块以供扩展二次开发
export * from './core';
export {
    createGeneralTabView,
    createComfyUITabView,
    createSDWebUITabView,
    createThemeTabView,
    createDiagnosticsTabView,
    createGalleryTabView,
    createFABSettingsTabView,
    createAboutTabView
} from './ui';
export * from './domain';
export * from './extensions/character-manager';
export type { ThemeData } from './core';

let _globalKernel: KernelContext | null = null;

/**
 * 获取当前全局核心上下文实例
 *
 * @returns 当前全局激活的核心上下文实例，未初始化时为 null
 */
export function getKernelContext(): KernelContext | null {
    return _globalKernel;
}

import { VERSION } from './core/constants';

/**
 * 插件顶层装配与全局启动入口 (Bootstrap)
 *
 * 执行步骤：
 * 1. 实例化核心全局上下文与强类型事件总线；
 * 2. 阻塞等待 SillyTavern 宿主环境沙箱就绪；
 * 3. 阻塞等待 IndexedDB 本地存储层初始化完成；
 * 4. 注册 ComfyUI 与 SD-WebUI 生图后端驱动；
 * 5. 初始化提示词流水线与任务调度状态机；
 * 6. 注册 8 大核心自带基础设置视图与生命周期管理；
 * 7. 装配角色与服装管理器扩展插件 (CharacterManagerExtension)；
 * 8. 初始化楼层生图按钮扫描与右下角 FAB 悬浮快捷球。
 *
 * @returns 装配完成的核心上下文实例
 */
export async function bootstrap(): Promise<KernelContext> {
    // 1. 初始化核心全局上下文
    const context = createKernelContext(VERSION);
    _globalKernel = context;

    context.logger.info('ST-DrawAssistant 插件正在启动初始化装配...');

    // 2. 阻塞等待 SillyTavern 宿主就绪
    await context.host.whenReady();
    context.logger.info('SillyTavern 宿主环境沙箱连接成功');

    // 2.5 初始化 IndexedDB 持久化存储层
    await context.storage.init();
    context.logger.info('IndexedDB 存储层初始化就绪');

    // 3. 注册生图后端驱动
    context.drivers.register(new ComfyUIDriver(context.store));
    context.drivers.register(new SDWebUIDriver(context.store));

    // 4. 初始化领域生图流水线与任务调度状态机
    const hooks = createPipelineHooks();
    context.hooks = hooks;

    const pipeline = new PromptPipeline(hooks);
    const taskManager = new TaskManager({
        events: context.events,
        store: context.store,
        drivers: context.drivers,
        storage: context.storage
    });
    context.tasks = taskManager;

    // 5. 初始化交互与设计系统层服务
    const modalService = new ModalService();
    const feedbackService = new FeedbackService(modalService);
    const themeService = new ThemeService(context.store);
    context.modals = modalService;
    context.feedback = feedbackService;
    context.theme = themeService;

    // 6. 注册核心自带的默认基础视图 (符合 TabSlotDescriptor 接口规范)
    context.ui.registerTab({
        id: 'general',
        title: '常规生图',
        icon: '⚙️',
        order: 10,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createGeneralTabView(context.store));
        }
    });

    context.ui.registerTab({
        id: 'comfyui',
        title: 'ComfyUI 配置',
        icon: '🎛️',
        order: 30,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createComfyUITabView(context.store));
        }
    });

    context.ui.registerTab({
        id: 'sdwebui',
        title: 'SD-WebUI 配置',
        icon: '⚡',
        order: 35,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createSDWebUITabView(context.store));
        }
    });

    context.ui.registerTab({
        id: 'theme',
        title: '外观主题',
        icon: '🎨',
        order: 40,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createThemeTabView(context.store));
        }
    });

    context.ui.registerTab({
        id: 'gallery',
        title: '本地图库',
        icon: '🖼️',
        order: 50,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createGalleryTabView(context.storage));
        }
    });

    context.ui.registerTab({
        id: 'fab-settings',
        title: '悬浮球设置',
        icon: '📍',
        order: 55,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createFABSettingsTabView(context.store));
        }
    });

    context.ui.registerTab({
        id: 'diagnostics',
        title: '诊断与日志',
        icon: '🩺',
        order: 60,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createDiagnosticsTabView());
        }
    });

    context.ui.registerTab({
        id: 'about',
        title: '关于',
        icon: 'ℹ️',
        order: 99,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createAboutTabView());
        }
    });

    // 7. 初始化外壳与容器
    const settingsModal = new SettingsModal({
        uiRegistry: context.ui,
        modalService,
        store: context.store
    });

    new FloorButtonContainer({
        hostBridge: context.host,
        events: context.events,
        store: context.store,
        taskManager,
        pipeline,
        storage: context.storage
    });

    new FABContainer({
        store: context.store,
        settingsModal
    });

    // 8. 注册并激活独立扩展业务层
    context.extensions.register(new CharacterManagerExtension());
    await context.extensions.activateAll(context);

    // 9. 监听卸载事件
    if (typeof window !== 'undefined') {
        window.addEventListener(
            'unload',
            () => {
                context.dispose();
            },
            { once: true }
        );
    }

    context.logger.info('ST-DrawAssistant 插件初始化装配完成！');
    return context;
}

// 自动在浏览器扩展加载时启动引导
if (typeof window !== 'undefined') {
    void bootstrap();
}
