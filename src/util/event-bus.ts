/**
 * 事件发布订阅管理器。
 *
 * @remarks
 * 为任务状态通知、配置变更与界面反馈提供解耦的事件传递能力。
 * 单个监听器内部异常不会中断其他监听器的执行。
 */

import type { DrawingTask, TaskProgressInfo, DrawingTaskStatus } from '@types';
import { logger } from './logger';

/** 插件默认事件类型映射 */
export type AppEventMap = {
    /** 生图任务创建入队 */
    'task:created': DrawingTask;
    /** 生图任务生成进度更新 */
    'task:progress': { taskId: string; progress: TaskProgressInfo };
    /** 生图任务状态流转变更 */
    'task:status': { taskId: string; status: DrawingTaskStatus; error?: string; imageId?: string };
    /** 插件设置项更新 */
    'settings:updated': { key?: string; value?: unknown };
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
     * @param event 事件名称
     * @param data 事件携带的数据对象
     */
    public emit<K extends keyof Events>(event: K, data: Events[K]): void {
        const set = this._listeners.get(event);
        if (!set || set.size === 0) {
            return;
        }

        for (const listener of Array.from(set)) {
            try {
                listener(data);
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
