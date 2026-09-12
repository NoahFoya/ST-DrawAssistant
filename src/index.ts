/**
 * ST-DrawAssistant 插件主入口
 * 负责核心服务初始化、读取与同步宿主配置、UI 挂载以及清理逻辑。
 */

import {
    IDisposable,
    CoreEventMap,
    DrawAssistantSettings,
    DrawAssistantPlugin
} from './types';
import { EXTENSION_NAME, EXTENSION_VERSION } from './constants';
import { Logger } from './utils/logger';
import { TypedEventBus } from './utils/event-bus';
import { HostClient } from './host/host-client';
import { SettingsStore, sanitizeSettings } from './state/settings-store';
import { PresetStore } from './state/preset-store';
import { StorageService } from './state/storage-service';
import { DriverRegistry, createDefaultDriverRegistry } from './services/drivers';
import { PromptPipeline } from './pipeline/prompt-pipeline';
import { TaskManager } from './tasks/task-manager';
import { ResultIntegrator } from './tasks/result-integrator';
import { createUIContext, UIContext } from './ui';
import { FeedbackService } from './ui/feedback/feedback';

export * from './types';
export * from './constants';
export * from './utils';
export * from './host';
export * from './services/network';
export * from './services/drivers';
export * from './state';
export * from './pipeline';
export * from './tasks';
export * from './ui';

export interface DrawAssistantApp extends IDisposable {
    readonly events: TypedEventBus<CoreEventMap>;
    readonly store: SettingsStore;
    readonly storage: StorageService;
    readonly host: HostClient;
    readonly drivers: DriverRegistry;
    readonly pipeline: PromptPipeline;
    readonly tasks: TaskManager;
    readonly integrator: ResultIntegrator;
    readonly ui: UIContext;
    readonly plugins: readonly DrawAssistantPlugin[];
    registerPlugin(plugin: DrawAssistantPlugin): Promise<void>;
}

let _activeApp: DrawAssistantApp | null = null;

/** 获取当前激活应用实例 */
export function getActiveApp(): DrawAssistantApp | null {
    return _activeApp;
}

export function getActiveUIContext(): UIContext | null {
    return _activeApp ? _activeApp.ui : null;
}

export interface BootstrapOptions {
    skipAutoCheck?: boolean;
}

/**
 * 插件初始化引导入口
 * 实例化各层服务，等待宿主环境就绪并同步设置，随后挂载 UI。
 */
export async function bootstrap(options?: BootstrapOptions): Promise<DrawAssistantApp> {
    if (_activeApp) {
        console.warn(`[${EXTENSION_NAME}] 插件已处于初始化状态，跳过重复自启动。`);
        return _activeApp;
    }

    const logger = new Logger('App');
    console.info(`[${EXTENSION_NAME}] v${EXTENSION_VERSION} 插件正在启动初始化...`);

    const events = new TypedEventBus<CoreEventMap>();
    const host = new HostClient();

    const store = new SettingsStore(undefined, {
        onSave: (state: DrawAssistantSettings) => {
            try {
                const safeSettings = sanitizeSettings(state);
                host.saveExtensionSettings(safeSettings as unknown as Record<string, unknown>);
            } catch (err: any) {
                logger.error('配置持久化写入宿主失败', err);
                events.emit('settings:save_failed', { error: err?.message || String(err) });
            }
        }
    });
    PresetStore.bindStore(store);

    const storage = new StorageService();
    const drivers = createDefaultDriverRegistry({ store });

    // 自动通过驱动的自描述接口注册出厂默认配置，消除硬编码耦合
    for (const driver of drivers.getAll()) {
        if (typeof driver.getDefaultConfig === 'function') {
            store.registerEngineDefaults(driver.id, driver.getDefaultConfig());
        }
    }

    const pipeline = new PromptPipeline();

    const tasks = new TaskManager({
        drivers,
        events,
        getConfig: () => ({
            maxConcurrentTasks: store.get('maxConcurrentTasks'),
            taskTimeoutMs: store.get('taskTimeoutMs'),
            activeProvider: store.get('activeProvider')
        })
    });

    const integrator = new ResultIntegrator({
        events,
        storage,
        host,
        tasks,
        getSettings: () => store.getState()
    });

    await store.ready;

    // 同步宿主已存配置与本地存储初始化
    try {
        await host.whenReady();
        const savedSettings = host.getExtensionSettings();
        if (savedSettings) {
            await store.loadSettings(savedSettings);
        }

        // 监听宿主配置外部更新（如多窗口修改、用户 Profile 切换或配置导入）并平滑同步
        let lastSettingsSnapshot = JSON.stringify(store.getState());
        host.onSettingsUpdated(() => {
            const externalSettings = host.getExtensionSettings();
            if (externalSettings) {
                const currentSnapshot = JSON.stringify(externalSettings);
                if (currentSnapshot !== lastSettingsSnapshot) {
                    lastSettingsSnapshot = currentSnapshot;
                    void store.loadSettings(externalSettings);
                    logger.info('已同步宿主外部配置变更');
                }
            }
        });

        await storage.init();
        events.emit('host:ready', undefined);
        logger.info('ST-DrawAssistant 基础服务已就绪');
    } catch (err) {
        logger.error('插件启动初始化检测异常', err);
    }

    // 挂载 UI 表现层
    const ui = createUIContext({
        settingsStore: store,
        eventBus: events,
        hostClient: host,
        storageService: storage,
        driverRegistry: drivers,
        promptPipeline: pipeline,
        taskManager: tasks
    });
    logger.info('ST-DrawAssistant UI 表现层已挂载就绪');

    events.on('settings:save_failed', ({ error }) => {
        FeedbackService.toastError(error);
    });

    const registeredPlugins: DrawAssistantPlugin[] = [];

    const registerPlugin = async (plugin: DrawAssistantPlugin): Promise<void> => {
        if (registeredPlugins.some((p) => p.name === plugin.name)) {
            logger.warn(`插件 [${plugin.name}] 已注册，跳过重复注册`);
            return;
        }
        registeredPlugins.push(plugin);
        try {
            await plugin.init({
                host,
                events,
                store,
                drivers,
                pipeline
            });
            logger.info(`扩展插件 [${plugin.name}] 初始化成功`);
        } catch (err) {
            logger.error(`扩展插件 [${plugin.name}] 初始化异常:`, err);
        }
    };

    const app: DrawAssistantApp = {
        events,
        store,
        storage,
        host,
        drivers,
        pipeline,
        tasks,
        integrator,
        ui,
        get plugins() {
            return registeredPlugins;
        },
        registerPlugin,
        dispose: () => {
            dispose();
        }
    };

    _activeApp = app;

    if (!options?.skipAutoCheck) {
        void autoCheckCurrentEngineConnection(app);
    }

    if (typeof window !== 'undefined') {
        window.addEventListener(
            'pagehide',
            () => {
                dispose();
            },
            { once: true }
        );
    }

    return app;
}

/**
 * 启动时自动连通性健康探测
 */
export async function autoCheckCurrentEngineConnection(app?: DrawAssistantApp): Promise<void> {
    const targetApp = app || _activeApp;
    if (!targetApp) return;

    const { store, drivers } = targetApp;
    const logger = new Logger('App');
    const activeProvider = store.get('activeProvider') || 'comfyui';
    const driver = drivers.get(activeProvider);
    if (!driver) return;

    try {
        const res = await driver.checkHealth();
        if (res.ok) {
            logger.info(`[${driver.name}] 自启动连通性探测正常 (${res.latencyMs}ms)`);
            if (typeof driver.syncAssets === 'function') {
                try {
                    await driver.syncAssets();
                } catch (syncErr) {
                    logger.warn(`[${driver.name}] 启动资产同步异常:`, syncErr);
                }
            }
            FeedbackService.toastSuccess(`[${driver.name}] 连接正常，已自动就绪`);
        } else {
            FeedbackService.toastError(`[${driver.name}] 自动连接失败: ${res.message || '服务未启动'}`);
        }
    } catch (err: any) {
        FeedbackService.toastError(`[${driver.name}] 自动连接异常: ${err?.message || err}`);
    }
}

/**
 * 逆序释放全局资源
 */
export function dispose(): void {
    if (!_activeApp) return;

    try {
        _activeApp.plugins.slice().reverse().forEach((p) => {
            try {
                p.dispose?.();
            } catch (err) {
                console.error(`[${EXTENSION_NAME}] 释放扩展插件 [${p.name}] 异常:`, err);
            }
        });
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 释放扩展插件列表异常:`, err);
    }

    try {
        _activeApp.ui.dispose();
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 释放 UI 异常:`, err);
    }

    try {
        _activeApp.integrator.dispose();
        _activeApp.tasks.dispose();
        _activeApp.pipeline.dispose();
        _activeApp.drivers.dispose();
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 释放服务驱动异常:`, err);
    }

    try {
        _activeApp.storage.dispose();
        _activeApp.store.dispose();
        _activeApp.events.clear();
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 释放存储与状态异常:`, err);
    }

    _activeApp = null;
    console.info(`[${EXTENSION_NAME}] 插件全部资源已释放。`);
}

if (typeof window !== 'undefined') {
    void bootstrap();
}
