/**
 * @module state/app-store
 * @description 扩展配置与驱动运行时状态管理中心
 *
 * 设计模式：观察者模式 / 单向数据流 (Observer / Flux Data Flow Pattern)
 *
 * 核心职责：
 * - 提供轻量响应式状态容器 ReactiveStore，管理单向数据流与订阅解绑闭包
 * - 集中管理设置状态 settingsStore，统一配置读取、持久化与广播路径
 * - 集中管理驱动运行状态 driverStore，提供 ImageDriver 与 TaskManager 实例引用
 *
 * 常用操作：
 * - 读取配置：settingsStore.getState()
 * - 订阅变更：settingsStore.subscribe(state => { ... })
 * - 更新配置：patchSettings({ width: 1024 })
 * - 更新驱动：setDriverState({ driver: newDriver })
 */

import { loadSettings, updateSettings } from '../settings/manager';
import { globalEventBus, DA_EVENTS } from '../core/event-bus';
import { logger } from '../core/logger';
import type { DrawAssistantSettings, ImageProvider } from '../settings/types';
import type { ImageDriver } from '../drivers/types';
import type { TaskManager } from '../task/manager';

/**
 * 轻量响应式状态容器
 *
 * 通过订阅与广播机制实现单向数据流。
 */
class ReactiveStore<T extends object> {
    private _state: T;
    private readonly _subscribers = new Set<(state: T) => void>();

    constructor(initialState: T) {
        this._state = { ...initialState };
    }

    /**
     * 获取当前状态只读快照
     *
     * @returns 当前状态对象
     */
    getState(): Readonly<T> {
        return this._state;
    }

    /**
     * 合并更新部分状态字段并通知所有订阅者
     *
     * @param patch 包含增量修改字段的对象
     */
    setState(patch: Partial<T>): void {
        this._state = { ...this._state, ...patch };
        this._notifyAll();
    }

    /**
     * 完全替换状态并通知所有订阅者
     *
     * @param newState 替换后的新状态对象
     */
    replaceState(newState: T): void {
        this._state = { ...newState };
        this._notifyAll();
    }

    /**
     * 订阅状态变更事件
     *
     * @param fn 状态变更回调函数，接收最新的完整状态
     * @returns 解除当前订阅的闭包函数
     */
    subscribe(fn: (state: T) => void): () => void {
        this._subscribers.add(fn);
        return () => this._subscribers.delete(fn);
    }

    private _notifyAll(): void {
        for (const fn of this._subscribers) {
            try {
                fn(this._state);
            } catch (err) {
                logger.error('[ReactiveStore] 订阅者回调异常', err);
            }
        }
    }
}

// ─── Settings Store ──────────────────────────────────────────────────────────

/**
 * 扩展配置全局状态存储
 */
export const settingsStore = new ReactiveStore<DrawAssistantSettings>(loadSettings());

/**
 * 修改扩展配置并持久化写入
 *
 * 依次执行：持久化写入宿主配置 -> 更新 Store 内存快照并解耦触发响应式重载。
 *
 * @param patch 包含增量配置字段的对象
 */
export function patchSettings(patch: Partial<DrawAssistantSettings>): void {
    updateSettings(patch);
    settingsStore.replaceState(loadSettings());
    logger.debug('[AppStore] patchSettings', { keys: Object.keys(patch) });
}

/**
 * 从宿主配置对象重新同步 Store 状态
 *
 * 用于响应宿主配置被外部修改的通知事件。
 */
export function syncSettingsFromHost(): void {
    settingsStore.replaceState(loadSettings());
    globalEventBus.emit(DA_EVENTS.SETTINGS_CHANGED, {});
    logger.debug('[AppStore] syncSettingsFromHost: store 已与宿主同步');
}

// ─── Driver Store ────────────────────────────────────────────────────────────

/**
 * 驱动与任务管理器运行时状态
 */
export interface DriverState {
    /** 当前图像生成后端类型 */
    provider: ImageProvider;
    /** 当前 ImageDriver 实例 */
    driver: ImageDriver | null;
    /** 全局 TaskManager 实例 */
    taskManager: TaskManager | null;
    /** 与后端的网络连接状态 */
    isConnected: boolean;
    /** 当前运行中的任务 ID */
    activeTaskId: string | null;
}

const _initialDriverState: DriverState = {
    provider: 'comfyui',
    driver: null,
    taskManager: null,
    isConnected: false,
    activeTaskId: null,
};

/**
 * 驱动与任务管理器运行时状态存储
 */
export const driverStore = new ReactiveStore<DriverState>(_initialDriverState);

/**
 * 更新驱动与任务管理器的运行时状态
 *
 * 若包含驱动或 Provider 的变更，自动广播 DRIVER_CHANGED 事件。
 *
 * @param patch 驱动状态增量对象
 */
export function setDriverState(patch: Partial<DriverState>): void {
    const prev = driverStore.getState();
    driverStore.setState(patch);

    const changed = patch.driver !== undefined || patch.provider !== undefined;
    if (changed) {
        globalEventBus.emit(DA_EVENTS.DRIVER_CHANGED, {
            provider: patch.provider ?? prev.provider,
        });
        logger.debug('[AppStore] setDriverState: driver/provider 已更新', {
            provider: patch.provider ?? prev.provider,
        });
    }
}
