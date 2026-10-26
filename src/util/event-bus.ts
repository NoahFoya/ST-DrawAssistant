/**
 * 事件发布订阅总线 (EventBus)。
 *
 * @remarks
 * 提供强类型事件订阅与广播：
 * 1. 强类型约束：基于 AppEventMap 约束事件名与数据格式；
 * 2. 异常隔离：独立捕获单个监听器的执行异常，避免阻断后续监听器；
 * 3. 资源清理：on 与 once 返回解除监听函数。
 */

import type { DrawingTask, TaskProgressInfo, DrawingTaskStatus, PresetItem, ThemePresetData, SlotMountTarget } from '@types';
import { logger } from './logger';

/** 任务状态流转事件数据对象（单一事实来源） */
export interface TaskStatusEventData {
    /** 任务全局唯一标识符 UUID */
    readonly taskId: string;
    /** 变更后的新状态 */
    readonly status: DrawingTaskStatus;
    /** 关联的任务对象快照 */
    readonly task?: DrawingTask;
    /** 错误描述文本，失败时存在 */
    readonly error?: string;
    /** 生成成功关联的图像资产标识符，完成时存在 */
    readonly imageId?: string;
    /** 任务取消原因描述，取消时存在 */
    readonly cancelReason?: string;
}

/** 插件默认事件类型映射 */
export type AppEventMap = {
    /** 生图任务创建入队 */
    'task:created': DrawingTask;
    /** 生图任务状态流转变更（统一承载 pending、generating、completed、failed、cancelled） */
    'task:status': TaskStatusEventData;
    /** 生图任务生成进度更新 */
    'task:progress': { taskId: string; progress: TaskProgressInfo };
    /** 图像资产就绪通知（本地 IndexedDB 持久化存储完成，驱动楼层原位呈现） */
    'image:ready': { imageId: string; target: SlotMountTarget };
    /** 插件设置项更新 */
    'settings:updated': {
        key?: string;
        keys?: string[];
        value?: unknown;
        patch?: Record<string, unknown>;
        isReset?: boolean;
    };
    /** 常驻悬浮球位置复位交互动作 */
    'ui:reset-fab-position': void;
    /** 界面主题变更通知 */
    'settings:theme-changed': PresetItem<ThemePresetData>;
    /** 界面反馈提示条显示 */
    'toast:show': { type: 'info' | 'success' | 'warn' | 'error'; message: string; duration?: number };
    /** Object URL 资源注销释放 */
    'url:revoked': { key: string };
};

/** 事件解绑函数类型 */
export type UnsubscribeFn = () => void;

/**
 * 事件发布订阅类。
 */
export class EventBus<Events extends Record<string, unknown> = AppEventMap> {
    private readonly _listeners = new Map<keyof Events, Set<(data: any) => void>>();

    /**
     * 注册指定事件的监听器
     * @param event 事件名称
     * @param listener 监听回调函数
     * @returns 解除当前监听器的注销函数
     */
    public on<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): UnsubscribeFn {
        let set = this._listeners.get(event);
        if (!set) {
            set = new Set();
            this._listeners.set(event, set);
        }
        set.add(listener);

        return () => {
            this.off(event, listener);
        };
    }

    /**
     * 注册一次性监听器，触发一次后自动解除
     * @param event 事件名称
     * @param listener 监听回调函数
     * @returns 解除当前监听器的注销函数
     */
    public once<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): UnsubscribeFn {
        const wrapper = (data: Events[K]) => {
            this.off(event, wrapper);
            listener(data);
        };
        return this.on(event, wrapper);
    }

    /**
     * 手动移除指定事件的监听器
     * @param event 事件名称
     * @param listener 待移除的监听回调函数
     */
    public off<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): void {
        const set = this._listeners.get(event);
        if (!set) {
            return;
        }
        set.delete(listener);
        if (set.size === 0) {
            this._listeners.delete(event);
        }
    }

    /**
     * 触发指定事件并向所有已注册监听器分发数据
     * @param args 事件名称及携带的数据对象（若事件数据类型为 void 则数据参数可选）
     */
    public emit<K extends keyof Events>(
        ...args: Events[K] extends void
            ? [event: K, data?: Events[K]]
            : [event: K, data: Events[K]]
    ): void {
        const [event, data] = args;
        const set = this._listeners.get(event);
        if (!set || set.size === 0) {
            return;
        }

        for (const listener of Array.from(set)) {
            try {
                listener(data as Events[K]);
            } catch (err) {
                logger.error(`事件监听器执行异常 (${String(event)}):`, err);
            }
        }
    }

    /**
     * 获取指定事件当前活跃的监听器数量
     * @param event 事件名称
     */
    public listenerCount<K extends keyof Events>(event: K): number {
        return this._listeners.get(event)?.size ?? 0;
    }

    /**
     * 清空所有事件监听器
     */
    public clear(): void {
        this._listeners.clear();
    }
}

/** 全局默认单例事件总线 */
export const eventBus = new EventBus();
