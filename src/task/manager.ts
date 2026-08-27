/**
 * @module task/manager
 * @description 生图任务队列与状态调度管理器
 *
 * 职责：
 * - 维护任务生命周期状态（排队中、执行中、已完成、失败、已取消）
 * - 控制任务串行执行，避免同时发起多个生图请求导致显存超限 (OOM)
 * - 广播生成进度、完成与错误事件，供楼层按钮和统计模块使用
 */


import type { ImageDriver } from '../drivers/types';
import type { GenerateOptions } from '../drivers/types';
import type { TaskRecord, TaskStatus, TaskManagerEvents } from './types';
import { logger } from '../core/logger';

type EventHandler<T extends keyof TaskManagerEvents> = TaskManagerEvents[T];

export class TaskManager {
    private readonly _tasks: Map<string, TaskRecord> = new Map();
    private readonly _listeners: {
        [K in keyof TaskManagerEvents]?: Array<TaskManagerEvents[K]>;
    } = {};

    /** 当前活跃任务 ID（用于串行控制） */
    private _activeTaskId: string | null = null;

    /** 等待队列（当活跃任务未完成时排队） */
    private readonly _queue: Array<() => void> = [];

    // ─── 事件订阅 ─────────────────────────────────────────────────────────────

    // ─── 事件订阅 ─────────────────────────────────────────────────────────────

    on<T extends keyof TaskManagerEvents>(event: T, handler: EventHandler<T>): () => void {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        (this._listeners[event] as Array<EventHandler<T>>).push(handler);
        return () => this.off(event, handler);
    }

    off<T extends keyof TaskManagerEvents>(event: T, handler: EventHandler<T>): void {
        const handlers = this._listeners[event] as Array<EventHandler<T>> | undefined;
        if (!handlers) return;
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
    }

    private _emit<T extends keyof TaskManagerEvents>(event: T, ...args: Parameters<TaskManagerEvents[T]>): void {
        const handlers = this._listeners[event];
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (handler as (...a: any[]) => void)(...args);
            } catch (err) {
                logger.error(`TaskManager 事件处理器异常 (${event})`, err);
            }
        }
    }

    /** 保持 _tasks 缓存容量控制在 50 条以内 */
    private _cleanOldTasks(): void {
        if (this._tasks.size <= 50) return;
        const now = Date.now();
        for (const [id, record] of this._tasks.entries()) {
            if (record.status !== 'PENDING' && record.status !== 'RUNNING' && now - record.createdAt > 5000) {
                this._tasks.delete(id);
                if (this._tasks.size <= 50) break;
            }
        }
    }

    // ─── 任务提交 ─────────────────────────────────────────────────────────────

    /**
     * 提交一个生图任务
     *
     * @param params 生成参数
     * @param driver 图像驱动实例
     * @param messageIndex 关联的消息楼层索引
     * @returns 任务 ID（暂时使用时间戳，提交后替换为 prompt_id）
     */
    async submit(
        params: GenerateOptions,
        driver: ImageDriver,
        messageIndex?: number
    ): Promise<string> {
        const tempId = `task_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const record: TaskRecord = {
            id: tempId,
            status: 'PENDING',
            params,
            messageIndex,
            createdAt: Date.now(),
        };

        this._tasks.set(tempId, record);
        this._emit('submit', tempId, params, driver.name);

        // 串行控制：若有活跃任务，等待其完成
        if (this._activeTaskId) {
            await new Promise<void>(resolve => this._queue.push(resolve));
        }

        this._activeTaskId = tempId;

        // 异步执行（不等待完成）
        void this._run(record, driver);

        return tempId;
    }

    private async _run(record: TaskRecord, driver: ImageDriver): Promise<void> {
        try {
            if (record.status === 'DISCARDED' || record.status === 'CANCELLED') {
                logger.debug(`任务 ${record.id} 在进入执行前已被取消，跳过生成`);
                return;
            }
            record.status = 'RUNNING';

            const result = await driver.generate(record.params, (progress) => {
                let percent = progress.percentage;
                if ((percent === undefined || percent < 0) && progress.totalSteps > 0) {
                    percent = Math.round((progress.currentStep / progress.totalSteps) * 100);
                }
                const statusMsg = progress.statusMessage || (progress.totalSteps > 0
                    ? `采样中 (${progress.currentStep}/${progress.totalSteps})... ${Math.max(0, percent)}%`
                    : '生图渲染中...');
                this._emit('progress', record.id, percent !== undefined && percent >= 0 ? percent : -1, statusMsg);
            });

            record.status = 'COMPLETED';
            record.result = result;
            this._emit('complete', record.id, result);
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));

            // 取消/丢弃状态判定 (cancelWithDriver 或 cancel 触发)
            if (record.status === 'DISCARDED' || record.status === 'CANCELLED') {
                this._emit('cancelled', record.id);
            } else {
                record.status = 'ERROR';
                record.error = error;
                this._emit('error', record.id, error);
            }
        } finally {
            this._activeTaskId = null;
            // 释放大体积 Base64 图像负载并定时清理任务记录，防范内存泄漏
            if (record.result) {
                record.result = { ...record.result, imageData: '' };
            }
            this._cleanOldTasks();
            setTimeout(() => {
                this._tasks.delete(record.id);
            }, 30000);

            // 唤醒队列中下一个等待任务
            const next = this._queue.shift();
            if (next) next();
        }
    }

    // ─── 任务取消 ─────────────────────────────────────────────────────────────

    /**
     * 仅标记任务为取消状态（内部辅助）
     *
     * - PENDING 状态：标记 CANCELLED（任务尚未移交驱动），即时触发 cancelled 广播
     * - RUNNING 状态：标记 DISCARDED（已交驱动尚在执行）
     */
    cancel(taskId: string): void {
        const record = this._tasks.get(taskId);
        if (!record) return;

        if (record.status === 'PENDING') {
            record.status = 'CANCELLED';
            this._emit('cancelled', taskId);
        } else if (record.status === 'RUNNING') {
            record.status = 'DISCARDED';
        }
    }

    /**
     * 完整取消任务（推荐使用此方法）
     *
     * - PENDING 状态：标记 CANCELLED + 调用 driver.cancel() + 即时 emit cancelled 信号
     * - RUNNING 状态：标记 DISCARDED + 调用 driver.cancel()
     */
    cancelWithDriver(taskId: string, driver: ImageDriver): void {
        const record = this._tasks.get(taskId);
        if (!record) return;

        if (record.status === 'PENDING') {
            record.status = 'CANCELLED';
            driver.cancel();
            this._emit('cancelled', taskId);
        } else if (record.status === 'RUNNING') {
            record.status = 'DISCARDED';
            driver.cancel();
        }
    }

    // ─── 查询 ─────────────────────────────────────────────────────────────────

    getTask(taskId: string): TaskRecord | undefined {
        return this._tasks.get(taskId);
    }

    getStatus(taskId: string): TaskStatus | undefined {
        return this._tasks.get(taskId)?.status;
    }

    isIdle(): boolean {
        return this._activeTaskId === null;
    }
}
