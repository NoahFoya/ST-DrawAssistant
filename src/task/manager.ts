/**
 * @module task/manager
 * @description TaskManager — 生图任务状态机与队列并发调度器
 *
 * 职责：
 * - 管理生图任务的完整生命周期（PENDING → RUNNING → COMPLETED/ERROR/DISCARDED）
 * - 提供事件订阅接口，供楼层按钮与统计收集器订阅状态变更
 * - 串行并发控制（默认 maxConcurrent=1）
 *
 * 事件流：
 *   submit() → PENDING → generate() → RUNNING
 *     ↓ onProgress 回调 → emit('progress')
 *     ↓ 完成 → COMPLETED → emit('complete')
 *     ↓ 错误 → ERROR → emit('error')
 *   cancel(taskId) → DISCARDED → emit('cancelled')
 *
 * 规范参考：
 * - .agents/Skills/st-image-generation-patterns/SKILL.md §3 (并发任务队列与取消丢弃策略)
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
                logger.error(`TaskManager 事件处理器异常 (${event})`, err);
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
            if (record.status === 'DISCARDED') {
                this._emit('cancelled', record.id);
                return;
            }
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
            // 取消链路：cancelWithDriver() 设置 DISCARDED + 调用 driver.cancel()
            //   → driver.cancel() 内部 reject _pendingTasks
            //   → driver.generate() 的 await Promise reject
            //   → 进入此 catch 分支
            //   → record.status === 'DISCARDED' → emit('cancelled') ✅
            if (record.status === 'DISCARDED') {
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
     * 仅标记任务为 DISCARDED 状态（内部辅助）
     *
     * ⚠️ 此方法**不调用 driver.cancel()**，不会向 ComfyUI 后端发送取消请求。
     * 外部代码应使用 `cancelWithDriver(taskId, driver)` 完成完整取消流程。
     * 此方法保留仅供部分无法直接引用 driver 的内部场景使用。
     */
    cancel(taskId: string): void {
        const record = this._tasks.get(taskId);
        if (!record) return;

        if (record.status === 'PENDING' || record.status === 'RUNNING') {
            record.status = 'DISCARDED';
        }
    }

    /**
     * 完整取消任务（推荐使用此方法）
     *
     * - PENDING 状态：标记 DISCARDED + 调用 driver.cancel() 向后端发送 /queue delete
     * - RUNNING 状态：标记 DISCARDED + 调用 driver.cancel() 触发客户端丢弃模式
     *
     * 取消完成信号（'cancelled' 事件）由 _run() 的 catch 分支在 driver.generate()
     * reject 后自动触发，无需在此处手动 emit。
     */
    cancelWithDriver(taskId: string, driver: ImageDriver): void {
        const record = this._tasks.get(taskId);
        if (!record) return;

        if (record.status === 'PENDING' || record.status === 'RUNNING') {
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
