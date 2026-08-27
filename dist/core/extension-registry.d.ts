/**
 * @module core/extension-registry
 * @description 进阶扩展注册器 — 管理扩展模块的生命周期与能力注入
 *
 * 职责：
 * - 定义扩展模块标准接口 ExtensionModule
 * - 定义核心层向扩展暴露的能力集合 ExtensionContext
 * - 提供扩展的注册、启用校验与初始化调度
 */
import { logger } from './logger';
import { type PromptProcessor } from './prompt-pipeline';
import type { TaskManager } from '../task/manager';
import type { DrawAssistantSettings } from '../settings/types';
/**
 * 核心层向进阶扩展暴露的能力集合
 * 扩展只能通过此接口访问核心能力，不得直接导入核心内部模块
 */
export interface ExtensionContext {
    readonly logger: typeof logger;
    /** 扩展初始化时的设置快照（只读参考，如需实时值请调用 loadSettings） */
    readonly settings: DrawAssistantSettings;
    readonly taskManager: TaskManager;
    registerPromptProcessor(processor: PromptProcessor): void;
    registerEventListener(event: string, handler: (...args: unknown[]) => void): void;
}
/** 进阶扩展模块标准接口契约 */
export interface ExtensionModule {
    /** 扩展全局唯一标识符，如 'character-manager' */
    readonly id: string;
    /** 用户可读扩展名称 */
    readonly displayName: string;
    /** 扩展功能简介 */
    readonly description: string;
    /** 扩展版本号 */
    readonly version: string;
    /** 生命周期：扩展初始化 */
    init(ctx: ExtensionContext): Promise<void> | void;
    /** 生命周期：扩展销毁（可选） */
    destroy?(): void;
}
/**
 * 注册一个进阶扩展模块
 *
 * @param module 扩展模块结构体
 */
export declare function registerExtension(module: ExtensionModule): void;
/**
 * 获取所有已注册的进阶扩展模块列表
 *
 * @returns 已注册的扩展模块数组
 */
export declare function getRegisteredExtensions(): ExtensionModule[];
/**
 * 校验指定 ID 的扩展模块在设置中是否处于启用状态
 *
 * @param id 扩展模块唯一标识符
 * @returns 启用返回 true，禁用返回 false
 */
export declare function isExtensionEnabled(id: string): boolean;
/**
 * 初始化所有处于启用状态的进阶扩展模块，并注销已变更为禁用的模块
 *
 * @param taskManager 任务管理器单例实例
 */
export declare function initEnabledExtensions(taskManager: TaskManager): Promise<void>;
/**
 * 集中注销所有已初始化的进阶扩展模块，释放挂载资源
 */
export declare function destroyAllExtensions(): void;
//# sourceMappingURL=extension-registry.d.ts.map