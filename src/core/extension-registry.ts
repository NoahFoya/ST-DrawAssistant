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
import { getEventBus } from './context';
import { loadSettings } from '../settings/manager';
import { registerPromptProcessor, type PromptProcessor } from './prompt-pipeline';
import type { TaskManager } from '../task/manager';
import type { DrawAssistantSettings } from '../settings/types';

// ─── 接口定义 ─────────────────────────────────────────────────────────────────

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

// ─── 注册表 ───────────────────────────────────────────────────────────────────

const _registry: Map<string, ExtensionModule> = new Map();

/**
 * 注册一个进阶扩展模块
 *
 * @param module 扩展模块结构体
 */
export function registerExtension(module: ExtensionModule): void {
    if (_registry.has(module.id)) {
        logger.warn(`重复注册扩展模块，已忽略: id=${module.id}`);
        return;
    }
    _registry.set(module.id, module);
    logger.debug(`扩展模块已注册: id=${module.id}, name=${module.displayName}`);
}

/**
 * 获取所有已注册的进阶扩展模块列表
 *
 * @returns 已注册的扩展模块数组
 */
export function getRegisteredExtensions(): ExtensionModule[] {
    return Array.from(_registry.values());
}

/**
 * 校验指定 ID 的扩展模块在设置中是否处于启用状态
 *
 * @param id 扩展模块唯一标识符
 * @returns 启用返回 true，禁用返回 false
 */
export function isExtensionEnabled(id: string): boolean {
    const settings = loadSettings();
    return settings.extensions?.[id]?.enabled !== false;
}

// ─── 生命周期管理 ─────────────────────────────────────────────────────────────

/** 已初始化的扩展模块 ID 集合 */
const _initializedExtensions = new Set<string>();

/**
 * 初始化所有处于启用状态的进阶扩展模块，并注销已变更为禁用的模块
 *
 * @param taskManager 任务管理器单例实例
 */
export async function initEnabledExtensions(taskManager: TaskManager): Promise<void> {
    const settings = loadSettings();

    for (const [id, module] of _registry) {
        const enabled = isExtensionEnabled(id);

        if (!enabled) {
            if (_initializedExtensions.has(id)) {
                try {
                    module.destroy?.();
                    logger.info(`扩展 [${module.displayName}] 已禁用，完成资源销毁`);
                } catch (err) {
                    logger.error(`扩展 [${module.displayName}] 销毁时抛出异常`, err);
                }
                _initializedExtensions.delete(id);
            } else {
                logger.info(`扩展 [${module.displayName}] 已禁用，跳过初始化`);
            }
            continue;
        }

        if (_initializedExtensions.has(id)) {
            logger.debug(`扩展 [${module.displayName}] 已初始化，跳过重复加载`);
            continue;
        }

        try {
            const ctx: ExtensionContext = {
                logger,
                settings,
                taskManager,
                registerPromptProcessor,
                registerEventListener: (event, handler) => {
                    try {
                        const { eventSource } = getEventBus();
                        eventSource.on(event, handler);
                    } catch (err) {
                        logger.error(`扩展 [${id}] 注册事件监听失败: event=${event}`, err);
                    }
                },
            };

            await module.init(ctx);
            _initializedExtensions.add(id);
            logger.info(`扩展 [${module.displayName}] v${module.version} 初始化成功`);
        } catch (err) {
            logger.error(`扩展 [${module.displayName}] 初始化异常`, err);
        }
    }
}

/**
 * 集中注销所有已初始化的进阶扩展模块，释放挂载资源
 */
export function destroyAllExtensions(): void {
    for (const id of _initializedExtensions) {
        const module = _registry.get(id);
        if (module?.destroy) {
            try {
                module.destroy();
            } catch (err) {
                logger.error(`注销扩展模块 [${id}] 时发生错误`, err);
            }
        }
    }
    _initializedExtensions.clear();
}
