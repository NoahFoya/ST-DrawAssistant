/**
 * @module core/context
 * @description 核心全局上下文 (KernelContext) 与初始化装配
 */
import { IDisposable } from './foundation/disposable';
import { ITypedEventBus, CoreEventMap } from './foundation/event-bus';
import { IHostBridge } from './foundation/host-bridge';
import { ILogger } from './diagnostics/logger';
import { ObservableStore } from './state/store';
import { DrawAssistantSettings } from './state/store-types';
import { IStorageAdapter } from './state/storage-adapter';
import { IExtensionRegistry } from './registry/extension-registry';
import { IUIRegistry } from './registry/ui-registry';
import { IPresetRegistry } from './registry/preset-registry';
import { IDriverRegistry } from './registry/driver-registry';
import type { IThemeContract, ITaskContract, IPipelineHooksContract, IModalContract, IFeedbackContract } from './contracts';
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
export declare function createKernelContext(version?: string): KernelContext;
//# sourceMappingURL=context.d.ts.map