/**
 * 生图任务状态机与并发队列调度管理器
 * 职责：管理任务生命周期流转、并发数限制调度、超时强断保护与跨会话切换隔离。
 */

import type {
    TaskStatus,
    TaskItem,
    TaskContextIdentity,
    ImageGenerationParams,
    ImageGenerationResult,
    EngineType
} from '@types';
import { TypedEventBus, IDisposable } from '../util/event-bus';
import { DEFAULT_TASK_TIMEOUT_MS } from '../constants';

/** 插件任务生命周期事件映射 */
export interface TaskEventMap {
    'task:queued': { taskId: string; task: TaskItem };
    'task:started': { taskId: string; task: TaskItem };
    'task:progress': { taskId: string; progress: number; previewUrl?: string };
    'task:completed': { taskId: string; result: ImageGenerationResult };
    'task:cancelled': { taskId: string; reason?: string };
    'task:failed': { taskId: string; error: string };
    'task:state_changed': { taskId: string; status: TaskStatus; error?: string };
}

/** 内部任务运行时记录模型 */
interface InternalTaskItem extends TaskItem {
    abortController?: AbortController;
    timeoutTimer?: ReturnType<typeof setTimeout>;
}

/** 任务执行函数接口 (与具体网络协议解耦) */
export type TaskExecutor = (task: TaskItem, signal: AbortSignal) => Promise<ImageGenerationResult>;

/** 任务队列调度器构造参数 */
export interface TaskQueueManagerOptions {
    events?: TypedEventBus<TaskEventMap>;
    executor?: TaskExecutor;
    maxConcurrent?: number;
    taskTimeoutMs?: number;
    maxHistory?: number;
}

export class TaskQueueManager implements IDisposable {
    private readonly _events: TypedEventBus<TaskEventMap>;
    private _executor: TaskExecutor;
    private readonly _tasks = new Map<string, InternalTaskItem>();
    private readonly _queue: string[] = [];
    private _activeCount = 0;
    private _maxConcurrent: number;
    private _taskTimeoutMs: number;
    private _maxHistory: number;
    private _isDisposed = false;

    constructor(options: TaskQueueManagerOptions = {}) {
        this._events = options.events ?? new TypedEventBus<TaskEventMap>();
        this._executor = options.executor ?? (async () => {
            throw new Error('TaskQueueManager 尚未配置有效的任务执行器');
        });
        this._maxConcurrent = Math.max(1, options.maxConcurrent ?? 1);
        this._taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
        this._maxHistory = options.maxHistory ?? 100;
    }

    /** 动态设置或更新任务执行器 */
    public setExecutor(executor: TaskExecutor): void {
        this._executor = executor;
    }

    /** 获取事件总线实例 */
    public get events(): TypedEventBus<TaskEventMap> {
        return this._events;
    }

    /** 动态更新最大并发限制 */
    public setMaxConcurrent(max: number): void {
        this._maxConcurrent = Math.max(1, max);
        this._processQueue();
    }

    /** 动态更新任务超时时间 (毫秒) */
    public setTaskTimeoutMs(timeoutMs: number): void {
        this._taskTimeoutMs = Math.max(1000, timeoutMs);
    }

    /**
     * 提交生图任务到调度队列
     * @param params 统一生图请求参数
     * @param context 上下文绑定信息 (锁定 chatId，可选绑定 messageId/swipeId/buttonIndex)
     * @param engine 目标生图引擎标识
     */
    public submit(
        params: ImageGenerationParams,
        context: { chatId: string; messageId?: number; swipeId?: number; buttonIndex?: number },
        engine: EngineType | string
    ): string {
        if (this._isDisposed) {
            throw new Error('TaskQueueManager 已注销，无法接收新任务');
        }

        this._trimHistory();

        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const identity: TaskContextIdentity = {
            taskId,
            chatId: context.chatId,
            messageId: context.messageId,
            swipeId: context.swipeId,
            buttonIndex: context.buttonIndex
        };

        const task: InternalTaskItem = {
            id: taskId,
            identity,
            engine,
            params,
            status: 'PENDING',
            progress: 0,
            createdAt: Date.now()
        };

        this._tasks.set(taskId, task);
        this._queue.push(taskId);

        this._events.emit('task:queued', { taskId, task });
        this._events.emit('task:state_changed', { taskId, status: 'PENDING' });

        this._processQueue();
        return taskId;
    }

    /**
     * 队列调度循环：根据最大并发数自动提取排队任务执行
     */
    private _processQueue(): void {
        if (this._isDisposed) return;

        while (this._activeCount < this._maxConcurrent && this._queue.length > 0) {
            const nextTaskId = this._queue.shift();
            if (!nextTaskId) break;

            const task = this._tasks.get(nextTaskId);
            if (!task || task.status !== 'PENDING') {
                continue;
            }

            this._activeCount++;
            this._runTask(task);
        }
    }

    /**
     * 执行单个任务，配置独立 AbortController 与超时强断定时器
     */
    private async _runTask(task: InternalTaskItem): Promise<void> {
        const abortController = new AbortController();
        task.abortController = abortController;
        task.status = 'RUNNING';
        task.startedAt = Date.now();

        // 启动超时强断保护，防范后端未响应或网络悬挂导致队列永久阻塞
        if (this._taskTimeoutMs > 0) {
            task.timeoutTimer = setTimeout(() => {
                if (task.status === 'RUNNING') {
                    abortController.abort();
                    this._finalizeTask(task, 'FAILED', undefined, `任务执行超时 (${Math.round(this._taskTimeoutMs / 1000)}s)`);
                }
            }, this._taskTimeoutMs);
        }

        this._events.emit('task:started', { taskId: task.id, task });
        this._events.emit('task:state_changed', { taskId: task.id, status: 'RUNNING' });

        try {
            const result = await this._executor(task, abortController.signal);

            // 若任务在等待期间已被外部取消或超时，则忽略迟到的结果
            if (task.status !== 'RUNNING') {
                return;
            }

            this._finalizeTask(task, 'COMPLETED', result);
        } catch (err: any) {
            if (task.status !== 'RUNNING') {
                return;
            }

            if (abortController.signal.aborted) {
                this._finalizeTask(task, 'CANCELLED', undefined, '任务已被取消');
            } else {
                const errorMsg = err?.message || String(err) || '未知生图执行异常';
                this._finalizeTask(task, 'FAILED', undefined, errorMsg);
            }
        }
    }

    /**
     * 终结任务生命周期，清理定时器并调度下一任务
     */
    private _finalizeTask(
        task: InternalTaskItem,
        status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
        result?: ImageGenerationResult,
        error?: string
    ): void {
        if (task.timeoutTimer) {
            clearTimeout(task.timeoutTimer);
            task.timeoutTimer = undefined;
        }

        task.status = status;
        task.completedAt = Date.now();
        task.result = result;
        task.error = error;
        task.abortController = undefined;

        this._activeCount = Math.max(0, this._activeCount - 1);

        if (status === 'COMPLETED' && result) {
            this._events.emit('task:completed', { taskId: task.id, result });
        } else if (status === 'CANCELLED') {
            this._events.emit('task:cancelled', { taskId: task.id, reason: error });
        } else if (status === 'FAILED') {
            this._events.emit('task:failed', { taskId: task.id, error: error || '未知错误' });
        }

        this._events.emit('task:state_changed', { taskId: task.id, status, error });

        // 调度队列中的后续等待任务
        this._processQueue();
    }

    /**
     * 上报任务中间生成进度与预览图片
     */
    public reportProgress(taskId: string, progress: number, previewUrl?: string): void {
        const task = this._tasks.get(taskId);
        if (!task || task.status !== 'RUNNING') return;

        task.progress = Math.max(0, Math.min(1, progress));
        if (previewUrl) {
            task.previewUrl = previewUrl;
        }

        this._events.emit('task:progress', { taskId, progress: task.progress, previewUrl });
    }

    /**
     * 取消单个指定任务
     */
    public async cancelTask(taskId: string, reason = '用户主动取消'): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) return;

        if (task.status === 'PENDING') {
            const index = this._queue.indexOf(taskId);
            if (index >= 0) {
                this._queue.splice(index, 1);
            }
            task.status = 'CANCELLED';
            task.completedAt = Date.now();
            task.error = reason;
            this._events.emit('task:cancelled', { taskId, reason });
            this._events.emit('task:state_changed', { taskId, status: 'CANCELLED', error: reason });
            return;
        }

        if (task.status === 'RUNNING') {
            if (task.abortController) {
                task.abortController.abort();
            }
            this._finalizeTask(task, 'CANCELLED', undefined, reason);
        }
    }

    /**
     * 会话切换时中止非当前会话的任务，避免异步结果写回已失效的角色会话
     */
    public async cancelTasksExceptChatId(activeChatId: string, reason = '会话已切换，旧任务自动取消'): Promise<void> {
        const tasksToCancel: string[] = [];

        for (const [id, task] of this._tasks.entries()) {
            if (
                task.identity.chatId &&
                task.identity.chatId !== activeChatId &&
                (task.status === 'PENDING' || task.status === 'RUNNING')
            ) {
                tasksToCancel.push(id);
            }
        }

        for (const id of tasksToCancel) {
            await this.cancelTask(id, reason);
        }
    }

    /**
     * 获取单个任务详情
     */
    public getTask(taskId: string): TaskItem | undefined {
        return this._tasks.get(taskId);
    }

    /**
     * 获取所有活跃任务（PENDING 或 RUNNING 状态）
     */
    public getActiveTasks(): TaskItem[] {
        const active: TaskItem[] = [];
        for (const task of this._tasks.values()) {
            if (task.status === 'PENDING' || task.status === 'RUNNING') {
                active.push(task);
            }
        }
        return active;
    }

    /**
     * 获取当前排队等待执行的任务数量
     */
    public getQueueLength(): number {
        return this._queue.length;
    }

    /**
     * 淘汰最早终结的非活跃历史任务，防范长会话内存增长
     */
    private _trimHistory(): void {
        if (this._tasks.size <= this._maxHistory) return;

        const finishedTasks: InternalTaskItem[] = [];
        for (const task of this._tasks.values()) {
            if (task.status !== 'PENDING' && task.status !== 'RUNNING') {
                finishedTasks.push(task);
            }
        }

        // 按创建时间升序排序，优先移除最早完成的任务
        finishedTasks.sort((a, b) => a.createdAt - b.createdAt);

        const removeCount = this._tasks.size - this._maxHistory;
        for (let i = 0; i < removeCount && i < finishedTasks.length; i++) {
            this._tasks.delete(finishedTasks[i].id);
        }
    }

    /**
     * 销毁调度管理器，中止全部在途任务并清空队列
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;

        for (const task of this._tasks.values()) {
            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }
            if (task.status === 'RUNNING' && task.abortController) {
                task.abortController.abort();
            }
            if (task.status === 'PENDING' || task.status === 'RUNNING') {
                task.status = 'CANCELLED';
                task.completedAt = Date.now();
                task.error = '调度器已销毁';
            }
        }

        this._queue.length = 0;
        this._activeCount = 0;
        this._events.dispose();
    }
}
