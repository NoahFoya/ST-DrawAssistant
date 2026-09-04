/**
 * @module domain/task/task-manager
 * @description 任务调度中心与状态机管理器
 *
 * 核心设计规则：
 * 1. 状态流转模型：PENDING (排队中) -> RUNNING (执行中) -> COMPLETED (成功) / FAILED (失败) / CANCELLED (取消)；
 * 2. 任务取消处理：执行中的任务被取消时状态置为 CANCELLED 并发出中断信号。因网络延迟返回的图片数据将被丢弃，避免写入存储或触发完成事件；
 * 3. 并发控制：受 maxConcurrentTasks 配额约束，任务终结后推进队列中的后续任务。
 */

import { IDisposable, TypedEventBus, CoreEventMap } from '../../core';
import { Logger } from '../../core/logger';
import { GenerationResult } from '../types';
import { AdapterRegistry } from '../drivers/adapter-registry';
import {
    TaskStatus,
    TaskSnapshot,
    TaskContextIdentity,
    SubmitTaskOptions
} from './task-types';

interface InternalTaskRecord {
    id: string;
    identity: TaskContextIdentity;
    status: TaskStatus;
    request: SubmitTaskOptions['request'];
    progress: number;
    previewUrl?: string;
    result?: GenerationResult;
    error?: string;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    abortController?: AbortController;
    timeoutTimer?: ReturnType<typeof setTimeout>;
}

export interface TaskManagerOptions {
    adapters: AdapterRegistry;
    events: TypedEventBus<CoreEventMap>;
    getConfig: () => {
        maxConcurrentTasks?: number;
        taskTimeoutMs?: number;
        activeProvider?: string;
    };
}

/**
 * 任务调度中心
 */
export class TaskManager implements IDisposable {
    private readonly _adapters: AdapterRegistry;
    private readonly _events: TypedEventBus<CoreEventMap>;
    private readonly _getConfig: TaskManagerOptions['getConfig'];
    private readonly _logger = new Logger('TaskManager');

    private readonly _tasks = new Map<string, InternalTaskRecord>();
    private readonly _queue: string[] = [];
    private _activeCount = 0;
    private _isProcessingQueue = false;
    private _isDisposed = false;

    private static readonly MAX_TASK_HISTORY = 100;
    private static readonly DEFAULT_TIMEOUT_MS = 180000;

    constructor(options: TaskManagerOptions) {
        this._adapters = options.adapters;
        this._events = options.events;
        this._getConfig = options.getConfig;
    }

    /**
     * 提交生图任务进入调度队列
     *
     * @param options 任务提交选项
     * @returns 任务唯一标识 (taskId)
     */
    public async submit(options: SubmitTaskOptions): Promise<string> {
        if (this._isDisposed) {
            throw new Error('TaskManager 已被销毁，无法接收新任务');
        }

        this.trimTaskHistory();

        const taskId = options.request.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const identity: TaskContextIdentity = {
            taskId,
            chatId: options.chatId ?? (options.request.contextInfo?.chatId as string | undefined),
            messageId: options.messageId ?? (options.request.contextInfo?.messageId as number | undefined),
            swipeId: options.swipeId
        };

        const task: InternalTaskRecord = {
            id: taskId,
            identity,
            status: 'PENDING',
            request: options.request,
            progress: 0,
            createdAt: Date.now()
        };

        this._tasks.set(taskId, task);
        this._queue.push(taskId);
        this._logger.info(`任务入队 [${taskId}]，目标引擎: ${options.request.targetEngine || '默认'}`);

        this._events.emit('task:queued', { taskId, request: options.request });
        this.emitState(taskId, 'PENDING');

        // 触发队列调度
        this.processQueue();

        return taskId;
    }

    /**
     * 取消指定任务
     *
     * @param taskId 任务标识
     * @param reason 取消原因
     */
    public async cancelTask(taskId: string, reason = '用户主动取消'): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) return;

        if (task.status === 'PENDING') {
            const idx = this._queue.indexOf(taskId);
            if (idx !== -1) {
                this._queue.splice(idx, 1);
            }
            task.status = 'CANCELLED';
            task.finishedAt = Date.now();
            task.error = reason;
            this._events.emit('task:cancelled', { taskId, reason });
            this.emitState(taskId, 'CANCELLED', reason);
            this._logger.info(`排队中任务已取消 [${taskId}]: ${reason}`);
        } else if (task.status === 'RUNNING') {
            task.status = 'CANCELLED';
            task.finishedAt = Date.now();
            task.error = reason;

            if (task.abortController) {
                task.abortController.abort();
            }
            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }

            this._events.emit('task:cancelled', { taskId, reason });
            this.emitState(taskId, 'CANCELLED', reason);
            this._logger.info(`执行中任务已取消 [${taskId}]: ${reason}`);

            // 通知适配器中断外部生成任务
            const targetEngine = task.request.targetEngine || this._getConfig().activeProvider || 'default';
            const adapter = this._adapters.get(targetEngine);
            if (adapter?.interrupt) {
                try {
                    await adapter.interrupt(taskId);
                } catch (err) {
                    this._logger.warn(`通知适配器中断任务异常 [${taskId}]`, err);
                }
            }
        }
    }

    /**
     * 获取指定任务的只读快照
     */
    public getTask(taskId: string): TaskSnapshot | undefined {
        const task = this._tasks.get(taskId);
        return task ? this.toSnapshot(task) : undefined;
    }

    /**
     * 获取指定楼层关联的所有任务快照
     */
    public getTasksByMessage(chatId: string, messageId: number): TaskSnapshot[] {
        const results: TaskSnapshot[] = [];
        for (const task of this._tasks.values()) {
            if (task.identity.chatId === chatId && task.identity.messageId === messageId) {
                results.push(this.toSnapshot(task));
            }
        }
        return results;
    }

    /**
     * 获取当前排队中与运行中的任务数量
     */
    public getQueueLength(): number {
        return this._queue.length;
    }

    public getActiveCount(): number {
        return this._activeCount;
    }

    /**
     * 队列消费调度
     */
    private processQueue(): void {
        if (this._isDisposed || this._isProcessingQueue) return;
        this._isProcessingQueue = true;

        try {
            const config = this._getConfig();
            const maxConcurrent = Math.max(1, config.maxConcurrentTasks || 1);

            while (this._activeCount < maxConcurrent && this._queue.length > 0) {
                const nextTaskId = this._queue.shift();
                if (!nextTaskId) break;

                const task = this._tasks.get(nextTaskId);
                if (!task || task.status !== 'PENDING') continue;

                this._activeCount++;
                void this.executeTask(task);
            }
        } finally {
            this._isProcessingQueue = false;
        }
    }

    /**
     * 执行单个任务
     */
    private async executeTask(task: InternalTaskRecord): Promise<void> {
        const taskId = task.id;

        if (task.status === 'CANCELLED') {
            this._activeCount--;
            this.processQueue();
            return;
        }

        task.status = 'RUNNING';
        task.startedAt = Date.now();
        this._events.emit('task:started', { taskId, request: task.request });
        this.emitState(taskId, 'RUNNING');
        this._logger.info(`开始执行任务 [${taskId}]`);

        const config = this._getConfig();
        const targetEngine = task.request.targetEngine || config.activeProvider || 'default';
        const adapter = this._adapters.get(targetEngine);

        if (!adapter) {
            this.failTask(task, `未找到标识为 [${targetEngine}] 的生图驱动适配器`);
            this._activeCount--;
            this.processQueue();
            return;
        }

        const controller = new AbortController();
        task.abortController = controller;

        const timeoutMs = config.taskTimeoutMs || TaskManager.DEFAULT_TIMEOUT_MS;
        task.timeoutTimer = setTimeout(() => {
            if (task.status === 'RUNNING') {
                this._logger.warn(`任务执行超时 (${timeoutMs}ms) [${taskId}]`);
                controller.abort();
                this.failTask(task, `生图任务超时 (${Math.round(timeoutMs / 1000)}秒)`);
            }
        }, timeoutMs);

        try {
            const onProgress = (progress: number, previewUrl?: string) => {
                if (task.status === 'RUNNING') {
                    task.progress = progress;
                    task.previewUrl = previewUrl;
                    this._events.emit('task:progress', { taskId, progress, previewUrl });
                }
            };

            const result = await adapter.generate(task.request, controller.signal, onProgress);

            // 任务在等待期间已被取消时直接丢弃返回的图像，避免写入存储或影响新消息
            if (this.isTaskCancelled(task)) {
                this._logger.info(`任务 [${taskId}] 已被取消，异步返回的结果已丢弃`);
                return;
            }

            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }

            task.status = 'COMPLETED';
            task.finishedAt = Date.now();
            task.result = result;
            task.progress = 100;

            this._events.emit('task:completed', { taskId, result });
            this.emitState(taskId, 'COMPLETED');
            this._logger.info(`任务执行完成 [${taskId}]，耗时: ${task.finishedAt - (task.startedAt || task.createdAt)}ms`);
        } catch (err: any) {
            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }

            // 若任务已在运行期间被取消或已因超时标记失败，不重复标记为失败
            if (!this.isTaskCancelled(task) && !this.isTaskFailed(task)) {
                const message = err?.message || '生成失败';
                this.failTask(task, message);
            }
        } finally {
            task.abortController = undefined;
            this._activeCount--;
            this.trimTaskHistory();
            this.processQueue();
        }
    }

    private failTask(task: InternalTaskRecord, error: string): void {
        task.status = 'FAILED';
        task.finishedAt = Date.now();
        task.error = error;
        this._events.emit('task:failed', { taskId: task.id, error });
        this.emitState(task.id, 'FAILED', error);
        this._logger.error(`任务执行失败 [${task.id}]: ${error}`);
    }

    private isTaskCancelled(task: InternalTaskRecord): boolean {
        return (task.status as TaskStatus) === 'CANCELLED';
    }

    private isTaskFailed(task: InternalTaskRecord): boolean {
        return (task.status as TaskStatus) === 'FAILED';
    }

    private emitState(taskId: string, status: TaskStatus, error?: string): void {
        this._events.emit('task:state_changed', { taskId, status, error });
    }

    private toSnapshot(task: InternalTaskRecord): TaskSnapshot {
        return {
            id: task.id,
            targetEngine: task.request.targetEngine,
            status: task.status,
            request: task.request,
            progress: task.progress,
            previewUrl: task.previewUrl,
            result: task.result,
            error: task.error,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            finishedAt: task.finishedAt
        };
    }

    private trimTaskHistory(): void {
        if (this._tasks.size <= TaskManager.MAX_TASK_HISTORY) return;

        const terminalTasks: string[] = [];
        for (const [id, t] of this._tasks.entries()) {
            if (t.status === 'COMPLETED' || t.status === 'FAILED' || t.status === 'CANCELLED') {
                terminalTasks.push(id);
            }
        }

        const countToRemove = this._tasks.size - TaskManager.MAX_TASK_HISTORY;
        for (let i = 0; i < countToRemove && i < terminalTasks.length; i++) {
            const id = terminalTasks[i];
            const t = this._tasks.get(id);
            if (t?.result?.images) {
                t.result = undefined;
            }
            this._tasks.delete(id);
        }
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;

        for (const taskId of this._queue) {
            const task = this._tasks.get(taskId);
            if (task) {
                task.status = 'CANCELLED';
                task.error = '调度器已关闭';
            }
        }
        this._queue.length = 0;

        for (const task of this._tasks.values()) {
            if (task.status === 'RUNNING') {
                task.abortController?.abort();
                if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
                task.status = 'CANCELLED';
            }
        }
        this._tasks.clear();
        this._logger.info('TaskManager 资源已释放');
    }
}
