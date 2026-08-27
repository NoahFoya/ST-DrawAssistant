/**
 * @module index
 * @description ST-DrawAssistant 插件引导与生命周期装配入口 (Bootstrap)
 */

import { createKernelContext, KernelContext, VERSION, CORE_TAB_IDS } from './core';
import { hydrateSettingsFromPresets } from './core/state/store-types';
import { createPipelineHooks, PromptPipeline, ComfyUIDriver, SDWebUIDriver, OpenAIDriver, NovelAIDriver, TaskManager } from './domain';

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
    createOpenAITabView,
    createNovelAITabView,
    createThemeTabView,
    createDiagnosticsTabView,
    createGalleryTabView,
    createFABSettingsTabView,
    createAboutTabView
} from './ui';
import { CharacterManagerExtension } from './extensions/character-manager';

export * from './core';
export {
    createGeneralTabView,
    createComfyUITabView,
    createSDWebUITabView,
    createOpenAITabView,
    createNovelAITabView,
    createThemeTabView,
    createDiagnosticsTabView,
    createGalleryTabView,
    createFABSettingsTabView,
    createAboutTabView
} from './ui';

let _globalKernel: KernelContext | null = null;

/**
 * 获取当前全局核心内核上下文单例 (若插件未初始化完成则返回 null)
 *
 * @returns 核心上下文实例或 null
 */
export function getKernelContext(): KernelContext | null {
    return _globalKernel;
}

/**
 * 插件全局引导装配入口函数 (Bootstrap)
 *
 * 执行全链路系统装配流程：
 * 1. 创建核心上下文环境与响应式配置 Store；
 * 2. 初始化核心基础组件 (I18n, Logger, EventBus, Storage, PresetRegistry)；
 * 3. 注册四大核心生图引擎驱动 (ComfyUI / SD-WebUI / NovelAI / OpenAI)；
 * 4. 注册内置功能扩展 (角色预设、负向词库、提示词模板、Inpaint 局部重绘)；
 * 5. 初始化交互容器 (FloorButton, FAB 悬浮球, SettingsModal 设置弹窗)；
 * 6. 注册内置视图面板 (TabSlotDescriptor 格式)；
 *
 * @returns 初始化装配完成的 KernelContext 实例
 */
export async function bootstrap(): Promise<KernelContext> {
    // 1. 初始化核心全局上下文
    const context = createKernelContext(VERSION);
    _globalKernel = context;
    context.logger.info('ST-DrawAssistant 插件正在启动初始化装配...');

    // 2. 宿主连接与 IndexedDB 存储初始化
    await context.host.whenReady();
    context.logger.info('SillyTavern 宿主环境连接成功');

    await context.storage.init();
    context.logger.info('IndexedDB 存储层初始化就绪');

    // 同步装载出厂预设方案充实配置中心
    await hydrateSettingsFromPresets(context.store, context.presets, false);

    // 3. 注册生图后端驱动
    context.drivers.register(new ComfyUIDriver(context.store));
    context.drivers.register(new SDWebUIDriver(context.store));
    context.drivers.register(new OpenAIDriver(context.store));
    context.drivers.register(new NovelAIDriver(context.store));

    // 启动后异步静默检测后端连通性并同步模型资产
    setTimeout(async () => {
        try {
            const currentSettings = context.store.getState();
            if (currentSettings.enabled !== false) {
                const driver = context.drivers.get(currentSettings.provider);
                if (driver && (await driver.ping())) {
                    if (driver.syncAssets) {
                        const syncResult = await driver.syncAssets(context.store);
                        context.logger.info(`${driver.name} 后端模型资产自启动拉取与校验完成: ${syncResult.summary}`);
                    }
                }
            }
        } catch (err) {
            context.logger.debug('启动时静默校验生图后端资产未完成 (后端可能尚未启动)', err);
        }
    }, 1000);

    // 4. 初始化提示词处理管线与任务管理器
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

    // 6. 注册内置视图面板 (TabSlotDescriptor 格式)
    context.ui.registerTab({
        id: CORE_TAB_IDS.GENERAL,
        title: '主要',
        order: 10,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createGeneralTabView(context.store, context.extensions));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.COMFYUI,
        title: 'ComfyUI',
        order: 20,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createComfyUITabView(context.store, context.drivers));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.SDWEBUI,
        title: 'SD-WebUI',
        order: 30,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createSDWebUITabView(context.store, context.drivers));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.OPENAI,
        title: 'OpenAI/Grok',
        order: 35,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createOpenAITabView(context.store, context.drivers));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.NOVELAI,
        title: 'NovelAI',
        order: 38,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createNovelAITabView(context.store, context.drivers));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.THEME,
        title: '外观',
        order: 40,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createThemeTabView(context.store));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.GALLERY,
        title: '画廊',
        order: 50,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createGalleryTabView(context.storage, context.host));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.FAB_SETTINGS,
        title: '悬浮球',
        order: 60,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createFABSettingsTabView(context.store));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.DIAGNOSTICS,
        title: '诊断',
        order: 70,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createDiagnosticsTabView(context.store));
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.ABOUT,
        title: '关于',
        order: 80,
        isBuiltIn: true,
        render: (container) => {
            container.appendChild(createAboutTabView(context.store));
        }
    });

    // 7. 初始化外壳与容器
    const settingsModal = new SettingsModal({
        uiRegistry: context.ui,
        modalService,
        store: context.store,
        drivers: context.drivers
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

    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            const target = (e.target as HTMLElement | null)?.closest('#da-open-main-modal-btn');
            if (target) {
                e.preventDefault();
                settingsModal.open();
            }
        });
    }

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

if (typeof window !== 'undefined') {
    void bootstrap();
}
