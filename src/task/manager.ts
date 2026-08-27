/**
 * TaskManager — 生图任务状态机
 *
 * 职责：
 * - 管理生图任务的完整生命周期（PENDING → RUNNING → COMPLETED/ERROR/DISCARDED）
 * - 提供事件订阅接口，供楼层按钮订阅状态变更
 * - 串行并发控制（默认 maxConcurrent=1）
 *
 * 事件流：
 *   submit() → PENDING → generate() → RUNNING
 *     ↓ onProgress 回调 → emit('progress')
 *     ↓ 完成 → COMPLETED → emit('complete')
 *     ↓ 错误 → ERROR → emit('error')
 *   cancel(taskId) → DISCARDED → emit('cancelled')
 */

import type { ImageDriver } from '../drivers/types';
import type { GenerateOptions } from '../drivers/types';
import type { TaskRecord, TaskStatus, TaskManagerEvents } from './types';

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

    on<T extends keyof TaskManagerEvents>(event: T, handler: EventHandler<T>): void {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        (this._listeners[event] as Array<EventHandler<T>>).push(handler);
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
                console.error(`[TaskManager] 事件处理器异常 (${event}):`, err);
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
            record.status = 'RUNNING';

            const result = await driver.generate(record.params, (progress) => {
                const percent = progress.percentage >= 0 ? progress.percentage : -1;
                this._emit('progress', record.id, percent, progress.statusMessage, progress.previewImage);
            });

            record.status = 'COMPLETED';
            record.result = result;
            this._emit('complete', record.id, result);
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));

            // 判断是否为取消/丢弃（DriverError CANCELLED）
            if (record.status === 'DISCARDED') {
                this._emit('cancelled', record.id);
            } else {
                record.status = 'ERROR';
                record.error = error;
                this._emit('error', record.id, error);
            }
        } finally {
            this._activeTaskId = null;
            // 唤醒队列中下一个等待任务
            const next = this._queue.shift();
            if (next) next();
        }
    }

    // ─── 任务取消 ─────────────────────────────────────────────────────────────

    /**
     * 取消任务
     * - PENDING 状态：尝试从后端队列删除（通过驱动的 cancel()）
     * - RUNNING 状态：客户端丢弃模式（立即标记 DISCARDED）
     */
    cancel(taskId: string): void {
        const record = this._tasks.get(taskId);
        if (!record) return;

        if (record.status === 'PENDING' || record.status === 'RUNNING') {
            record.status = 'DISCARDED';
            // 驱动的 cancel() 会发送 /queue delete 请求（PENDING 有效），并丢弃 WebSocket 结果
            // 由于我们没有直接引用 driver，取消需通过全局注册的驱动
            // ⚠️ 实际取消操作在 TaskManager.cancelWithDriver() 中执行
        }
    }

    /**
     * 带驱动引用的取消（完整实现）
     */
    cancelWithDriver(taskId: string, driver: ImageDriver): void {
        const record = this._tasks.get(taskId);
        if (!record) return;

        if (record.status === 'PENDING' || record.status === 'RUNNING') {
            record.status = 'DISCARDED';
            driver.cancel();
            this._emit('cancelled', taskId);
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
