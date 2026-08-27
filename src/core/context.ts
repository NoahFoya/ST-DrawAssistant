/**
 * @module core/context
 * @description 核心全局上下文 (KernelContext) 与初始化装配
 */

import { VERSION } from './constants';
import { IDisposable, DisposableStore } from './foundation/disposable';
import { ITypedEventBus, TypedEventBus, CoreEventMap } from './foundation/event-bus';
import { IHostBridge, SillyTavernHostBridge } from './foundation/host-bridge';
import { ILogger, Logger } from './diagnostics/logger';
import { ObservableStore } from './state/store';
import { DrawAssistantSettings } from './state/store-types';
import { migrateSettings } from './state/schema-migrator';
import { IStorageAdapter, IndexedDBStorageAdapter } from './state/storage-adapter';
import { IExtensionRegistry, ExtensionRegistry } from './registry/extension-registry';
import { IUIRegistry, UIRegistry } from './registry/ui-registry';
import { IPresetRegistry, PresetRegistry } from './registry/preset-registry';
import { loadAllPresetsToRegistry } from './config/config-loader';
import { IDriverRegistry, DriverRegistry } from './registry/driver-registry';
import type {
    IThemeContract,
    ITaskContract,
    IPipelineHooksContract,
    IModalContract,
    IFeedbackContract
} from './contracts';

/**
 * 核心全局上下文接口 (整合各子系统与基础服务)
 */
export interface KernelContext extends IDisposable {
    /** 插件当前版本号 */
    readonly version: string;
    /** 宿主环境通信与事件适配器 */
    readonly host: IHostBridge;
    /** 强类型跨模块事件总线 */
    readonly events: ITypedEventBus<CoreEventMap>;
    /** 响应式全局配置与状态中心 */
    readonly store: ObservableStore<DrawAssistantSettings>;
    /** 图像 IndexedDB 持久化存储适配器 */
    readonly storage: IStorageAdapter;
    /** 扩展插件注册中心 */
    readonly extensions: IExtensionRegistry;
    /** UI 插槽与贡献点注册中心 */
    readonly ui: IUIRegistry;
    /** 预设方案注册中心 */
    readonly presets: IPresetRegistry;
    /** 生图后端驱动注册中心 */
    readonly drivers: IDriverRegistry;
    /** 诊断日志器 */
    readonly logger: ILogger;

    // 领域与 UI 层子系统 (通过下沉接口解耦注入)
    /** 外观主题服务 */
    theme?: IThemeContract;
    /** 提示词流水线拦截钩子 */
    hooks?: IPipelineHooksContract;
    /** 生图任务调度状态机 */
    tasks?: ITaskContract;
    /** 模态框调度服务 */
    modals?: IModalContract;
    /** 用户反馈交互服务 */
    feedback?: IFeedbackContract;
}

/**
 * 创建并初始化核心上下文实例
 *
 * @param version 插件版本号，默认取当前系统版本
 * @returns 核心全局上下文实例
 */
export function createKernelContext(version = VERSION): KernelContext {
    const disposables = new DisposableStore();
    const logger = new Logger('Kernel');

    const host = disposables.add(new SillyTavernHostBridge());
    const events = disposables.add(new TypedEventBus<CoreEventMap>());

    // 初始化全局配置与响应式 Store
    const rawSettings = host.getExtensionSettings<Record<string, unknown>>('st-drawassistant');
    const initialSettings = migrateSettings(rawSettings);

    const store = disposables.add(
        new ObservableStore<DrawAssistantSettings>(initialSettings, {
            onSave: (state) => {
                host.saveExtensionSettings('st-drawassistant', state as unknown as Record<string, unknown>);
                host.saveExtensionSettingsDebounced();
            }
        })
    );

    // 监听设置变化向事件总线广播
    store.subscribe((state, keyPath, oldState) => {
        events.emit('settings:changed', {
            path: keyPath || '',
            value: keyPath ? (state as any)[keyPath] : state,
            oldValue: keyPath ? (oldState ? (oldState as any)[keyPath] : undefined) : oldState
        });
    });

    const storage = disposables.add(new IndexedDBStorageAdapter());
    const extensions = disposables.add(new ExtensionRegistry());
    const ui = disposables.add(new UIRegistry());
    const presets = disposables.add(new PresetRegistry());
    loadAllPresetsToRegistry(presets);
    const drivers = disposables.add(new DriverRegistry());

    let isDisposed = false;

    return {
        version,
        host,
        events,
        store,
        storage,
        extensions,
        ui,
        presets,
        drivers,
        logger,
        dispose: () => {
            if (isDisposed) return;
            isDisposed = true;
            disposables.dispose();
            logger.info('核心上下文资源已完成全部清理');
        }
    };
}
