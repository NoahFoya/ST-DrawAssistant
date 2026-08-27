/**
 * @module index
 * @description ST-DrawAssistant 插件系统引导与生命周期管理入口 (Bootstrap)
 */

import {
    createKernelContext,
    KernelContext,
    VERSION,
    CORE_TAB_IDS,
    hydrateSettingsFromPresets
} from './core';
import { createPipelineHooks, PromptPipeline, ComfyUIDriver, SDWebUIDriver, OpenAIDriver, NovelAIDriver, TaskManager } from './domain';

import {
    ModalService,
    ThemeService,
    SettingsModal,
    FloorButtonContainer,
    FABContainer,
    GeneralTabView,
    OpenAITabView,
    NovelAITabView,
    GalleryTabView,
    FABSettingsTabView,
    DiagnosticsTabView,
    AboutTabView,
    ThemeTabView,
    SDWebUITabView,
    ComfyUITabView
} from './ui';
import { CharacterManagerExtension } from './extensions/character-manager';

export * from './core';

let _activeKernelInstance: KernelContext | null = null;

/**
 * 获取当前插件核心上下文实例（仅供调试或测试断言使用）
 */
export function getActiveKernel(): KernelContext | null {
    return _activeKernelInstance;
}

/**
 * 插件全局引导入口函数 (Bootstrap)
 *
 * 执行系统初始化与服务注册流程：
 * 1. 创建核心上下文环境与响应式配置 Store；
 * 2. 初始化基础设施服务 (I18n, Logger, EventBus, Storage, PresetRegistry)；
 * 3. 注册内置生图驱动 (ComfyUI / SD-WebUI / NovelAI / OpenAI)；
 * 4. 注册内置扩展模块 (角色与服装预设管理)；
 * 5. 初始化交互控制器 (FloorButton, FAB 悬浮球, SettingsModal 设置弹窗)；
 * 6. 注册内置设置面板视图 (TabSlotDescriptor 格式)；
 *
 * @returns 初始化完成的 KernelContext 实例
 */
export async function bootstrap(): Promise<KernelContext> {
    // 0. 若存在先前初始化的上下文实例，先执行清理
    if (_activeKernelInstance) {
        try {
            _activeKernelInstance.dispose();
        } catch {}
        _activeKernelInstance = null;
    }

    // 1. 初始化核心全局上下文
    const context = createKernelContext(VERSION);
    _activeKernelInstance = context;
    context.addDisposable({
        dispose: () => {
            if (_activeKernelInstance === context) {
                _activeKernelInstance = null;
            }
        }
    });

    context.logger.info('ST-DrawAssistant 插件正在启动初始化...');

    // 2. 宿主连接与 IndexedDB 存储初始化
    await context.host.whenReady();
    context.logger.info('SillyTavern 宿主环境连接成功');

    await context.storage.init();
    context.logger.info('IndexedDB 存储层初始化就绪');

    // 加载预设配置
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
    const taskManager = context.addDisposable(
        new TaskManager({
            events: context.events,
            store: context.store,
            drivers: context.drivers,
            storage: context.storage
        })
    );
    context.tasks = taskManager;

    // 5. 注册内置扩展模块并激活
    context.extensions.register(new CharacterManagerExtension());
    await context.extensions.activateAll(context);

    // 6. 初始化交互与设计系统层服务
    const modalService = context.addDisposable(new ModalService());
    const themeService = context.addDisposable(new ThemeService(context.store));
    context.theme = themeService;

    // 7. 注册内置视图面板 (TabSlotDescriptor 格式)
    context.ui.registerTab({
        id: CORE_TAB_IDS.GENERAL,
        title: '通用设置',
        order: 10,
        isBuiltIn: true,
        render: (container) => {
            const view = new GeneralTabView(context.store, context.extensions);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.COMFYUI,
        title: 'ComfyUI',
        order: 20,
        isBuiltIn: true,
        render: (container) => {
            const view = new ComfyUITabView(context.store, context.drivers);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.SDWEBUI,
        title: 'SD-WebUI',
        order: 30,
        isBuiltIn: true,
        render: (container) => {
            const view = new SDWebUITabView(context.store, context.drivers);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.OPENAI,
        title: 'OpenAI/Grok',
        order: 35,
        isBuiltIn: true,
        render: (container) => {
            const view = new OpenAITabView(context.store, context.drivers);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.NOVELAI,
        title: 'NovelAI',
        order: 38,
        isBuiltIn: true,
        render: (container) => {
            const view = new NovelAITabView(context.store, context.drivers);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.THEME,
        title: '外观主题',
        order: 40,
        isBuiltIn: true,
        render: (container) => {
            const view = new ThemeTabView(context.store);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.GALLERY,
        title: '历史图库',
        order: 50,
        isBuiltIn: true,
        render: (container) => {
            const view = new GalleryTabView(context.storage, context.host);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.FAB_SETTINGS,
        title: '悬浮球',
        order: 60,
        isBuiltIn: true,
        render: (container) => {
            const view = new FABSettingsTabView(context.store);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.DIAGNOSTICS,
        title: '日志与统计',
        order: 70,
        isBuiltIn: true,
        render: (container) => {
            const view = new DiagnosticsTabView(context.store);
            container.appendChild(view.element);
            return view;
        }
    });

    context.ui.registerTab({
        id: CORE_TAB_IDS.ABOUT,
        title: '关于',
        order: 80,
        isBuiltIn: true,
        render: (container) => {
            const view = new AboutTabView(context.store);
            container.appendChild(view.element);
            return view;
        }
    });

    // 8. 初始化外壳与容器
    const settingsModal = context.addDisposable(
        new SettingsModal({
            uiRegistry: context.ui,
            modalService,
            store: context.store,
            drivers: context.drivers
        })
    );

    context.addDisposable(
        new FloorButtonContainer({
            hostBridge: context.host,
            events: context.events,
            store: context.store,
            taskManager,
            pipeline,
            storage: context.storage
        })
    );

    context.addDisposable(
        new FABContainer({
            store: context.store,
            settingsModal,
            events: context.events
        })
    );

    // 9. 挂载 SillyTavern 原生扩展设置抽屉入口
    if (typeof document !== 'undefined') {
        const mountDrawer = async () => {
            const drawerContainer = context.host.getExtensionDrawerContainer();
            if (!drawerContainer || document.getElementById('da-drawer-entry-root')) return;

            const html = await context.host.renderTemplate('settings');
            if (!html) return;

            const wrapper = document.createElement('div');
            wrapper.id = 'da-drawer-entry-root';
            wrapper.innerHTML = html;
            drawerContainer.appendChild(wrapper);

            const fabCheckbox = wrapper.querySelector<HTMLInputElement>('#da-drawer-toggle-fab');
            if (fabCheckbox) {
                fabCheckbox.checked = context.store.get('fabVisible') !== false;
                fabCheckbox.addEventListener('change', () => {
                    context.store.set('fabVisible', fabCheckbox.checked);
                });
            }

            const openSettingsBtn = wrapper.querySelector<HTMLButtonElement>('#da-drawer-open-settings');
            if (openSettingsBtn) {
                openSettingsBtn.addEventListener('click', () => {
                    settingsModal.open();
                });
            }
        };

        void mountDrawer();

        const onDocClick = (e: MouseEvent) => {
            const target = (e.target as HTMLElement | null)?.closest('#da-open-main-modal-btn');
            if (target) {
                e.preventDefault();
                settingsModal.open();
            }
        };

        const unsubFab = context.store.subscribeKey('fabVisible', (val) => {
            const fabCheckbox = document.getElementById('da-drawer-toggle-fab') as HTMLInputElement | null;
            if (fabCheckbox && fabCheckbox.checked !== (val !== false)) {
                fabCheckbox.checked = val !== false;
            }
        });

        document.addEventListener('click', onDocClick);

        context.addDisposable({
            dispose: () => {
                document.removeEventListener('click', onDocClick);
                unsubFab.dispose();
                document.getElementById('da-drawer-entry-root')?.remove();
            }
        });
    }

    // 10. 监听页面隐藏与生命周期清理
    if (typeof window !== 'undefined') {
        window.addEventListener(
            'pagehide',
            () => {
                context.dispose();
            },
            { once: true }
        );
    }

    context.logger.info('ST-DrawAssistant 插件初始化完成');
    return context;
}

if (typeof window !== 'undefined') {
    void bootstrap();
}
