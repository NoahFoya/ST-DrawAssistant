/**
 * @module domain/task/task-manager
 * @description 任务调度系统与状态机管理器 (支持排队调度、并发控制、取消与客户端丢弃)
 */

import {
    TaskState,
    TaskStatus,
    TaskContextIdentity,
    GenerationPayload,
    ITypedEventBus,
    ObservableStore,
    DrawAssistantSettings,
    IDriverRegistry,
    IStorageAdapter,
    Logger,
    StatisticsCollector,
    ITaskManager as ITaskManagerContract,
    IDrawDriver
} from '../../core';

/** 任务内部可变状态 (仅供 TaskManager 内部流转) */
interface MutableTaskState {
    identity: TaskContextIdentity;
    status: TaskStatus;
    payload?: GenerationPayload;
    error?: string;
    resultBlobs?: Blob[];
    createdAt: number;
}

export interface TaskManagerOptions {
    events: ITypedEventBus;
    store: ObservableStore<DrawAssistantSettings>;
    drivers: IDriverRegistry<IDrawDriver>;
    storage?: IStorageAdapter;
}

export interface ITaskManager extends ITaskManagerContract {
    submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string>;
    cancelTask(taskId: string): Promise<void>;
    getTask(taskId: string): TaskState | undefined;
    getTasksByMessage(chatId: string, messageId: number): TaskState[];
    getActiveDriver(): IDrawDriver | undefined;
}

/**
 * 任务调度管理器实现
 *
 * 核心设计规则：
 * 1. 状态流转模型：PENDING (排队中) -> RUNNING (执行中) -> COMPLETED (成功) / ERROR (失败) / CANCELLED (取消) / DISCARDED (丢弃)；
 * 2. 客户端丢弃模式 (Client-side Discard)：当执行中的任务被用户取消时，状态置为 DISCARDED 并向后端发出中断请求，
 *    即使后端驱动因网络延迟仍返回了图片数据，调度器也会静默丢弃，绝不会写入图库或触发完成事件（状态机幂等性保证）；
 * 3. 并发配额自平衡：在 finally 块中递减活跃计数并自动触发 processQueue() 消费下一个排队任务。
 */
export class TaskManager implements ITaskManager {
    private readonly _events: ITypedEventBus;
    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _drivers: IDriverRegistry<IDrawDriver>;
    private readonly _logger = new Logger('TaskManager');


    private readonly _tasks = new Map<string, MutableTaskState>();
    private readonly _queue: string[] = [];
    private _activeCount = 0;
    private _isProcessingQueue = false;
    private _isDisposed = false;
    private static readonly MAX_TASK_HISTORY = 150;

    constructor(options: TaskManagerOptions) {
        this._events = options.events;
        this._store = options.store;
        this._drivers = options.drivers;
    }

    public async submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string> {
        this.trimTaskHistory();

        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const identity: TaskContextIdentity = {
            taskId,
            chatId: options.chatId,
            messageId: options.messageId,
            swipeId: options.swipeId
        };

        const state: MutableTaskState = {
            identity,
            status: 'PENDING',
            payload: options.payload,
            createdAt: Date.now()
        };

        this._tasks.set(taskId, state);
        this._queue.push(taskId);
        this._logger.info(`任务入队: ${taskId} (楼层 #${options.messageId})`);

        const settings = this._store.getState();
        const modelName = (options.payload.params.model as string)
            || (settings.provider === 'sdwebui' ? settings.sdModelCheckpoint : settings.ckptName)
            || 'default';

        StatisticsCollector.getInstance().recordTaskSubmit(taskId, {
            model: modelName,
            sampler: options.payload.params.samplerName || settings.samplerName || 'default',
            engine: settings.provider || 'comfyui'
        });

        this.emitState(taskId, 'PENDING');
        this.processQueue();

        return taskId;
    }

    /** 取消指定任务 (若任务在运行中则转换为 DISCARDED 丢弃状态) */
    public async cancelTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) return;

        if (task.status === 'PENDING') {
            const idx = this._queue.indexOf(taskId);
            if (idx !== -1) this._queue.splice(idx, 1);
            this.updateTaskStatus(taskId, 'CANCELLED');
            this.emitState(taskId, 'CANCELLED');
            StatisticsCollector.getInstance().recordTaskFailure(taskId, true);
            this._logger.info(`排队中任务已取消: ${taskId}`);
        } else if (task.status === 'RUNNING') {
            // 执行中任务置为客户端丢弃模式 (Client-side Discard)
            this.updateTaskStatus(taskId, 'DISCARDED');
            this.emitState(taskId, 'DISCARDED');
            StatisticsCollector.getInstance().recordTaskFailure(taskId, true);
            this._logger.info(`执行中任务置为客户端丢弃: ${taskId}`);

            const driver = this.getActiveDriver();
            await driver?.interrupt?.();
        }
    }

    /** 查询指定 ID 任务的当前快照，未找到时返回 undefined */
    public getTask(taskId: string): TaskState | undefined {
        return this._tasks.get(taskId);
    }

    /** 返回指定楼层内所有历史任务（包括终态） */
    public getTasksByMessage(chatId: string, messageId: number): TaskState[] {
        return Array.from(this._tasks.values()).filter(
            (t) => t.identity.chatId === chatId && t.identity.messageId === messageId
        );
    }

    /**
     * 从任务队列中取出等待中任务并在并发限制内启动执行
     * 每次任务状态变更后均应调用此方法以驱动队列消费
     */
    private processQueue(): void {
        if (this._isDisposed || this._isProcessingQueue) return;
        this._isProcessingQueue = true;

        try {
            const maxConcurrent = this._store.getState().maxConcurrent || 1;

            while (this._activeCount < maxConcurrent && this._queue.length > 0) {
                const nextTaskId = this._queue.shift()!;
                const task = this._tasks.get(nextTaskId);
                if (!task || task.status !== 'PENDING') continue;

                this._activeCount++;
                this.executeTask(nextTaskId);
            }
        } finally {
            this._isProcessingQueue = false;
        }
    }

    /**
     * 执行单个任务：调用当前活跃驱动生图并处理进度、完成与错误回调
     * 若完成时任务已被楼层丢弃，则不会触发 COMPLETED 事件也不会落库（状态机幂等性保护）
     */
    private async executeTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) {
            this._activeCount--;
            this.processQueue();
            return;
        }

        if (!task.payload) {
            this.failTask(taskId, '未包含有效的生图请求参数');
            return;
        }

        this.updateTaskStatus(taskId, 'RUNNING');
        this.emitState(taskId, 'RUNNING');

        const driver = this.getActiveDriver();
        if (!driver) {
            this.failTask(taskId, '未找到可用的生图驱动');
            return;
        }

        try {
            const res = await driver.generate(task.payload);

            const currentTask = this._tasks.get(taskId);
            // 若任务在等待期间已被取消或丢弃，则忽略本次结果，不触发后续写入与事件
            if (currentTask?.status === 'DISCARDED') {
                this._logger.info(`丢弃的任务 [${taskId}] 异步结果到达，已静默丢弃`);
                return;
            }

            task.status = 'COMPLETED';
            task.resultBlobs = res.imageBlobs;

            this.emitState(taskId, 'COMPLETED');
            StatisticsCollector.getInstance().recordTaskSuccess(taskId);
            this._logger.info(`任务执行成功: ${taskId}`);
        } catch (err: any) {
            const currentTask = this._tasks.get(taskId);
            if (currentTask?.status !== 'DISCARDED') {
                this.failTask(taskId, err.message || '生图执行失败');
            }
        } finally {
            this._activeCount--;
            this.processQueue();
        }
    }

    /**
     * 检查任务状态转换是否合法
     * 终态（COMPLETED / ERROR / CANCELLED / DISCARDED）不允许再次转换
     * PENDING 只能转到 RUNNING / CANCELLED / DISCARDED / ERROR
     * RUNNING 只能转到 COMPLETED / ERROR / DISCARDED / CANCELLED
     */
    private isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
        if (from === to) return true;
        const terminalStates: Set<TaskStatus> = new Set(['COMPLETED', 'ERROR', 'CANCELLED', 'DISCARDED']);
        if (terminalStates.has(from)) {
            return false;
        }
        if (from === 'PENDING') {
            return to === 'RUNNING' || to === 'CANCELLED' || to === 'DISCARDED' || to === 'ERROR';
        }
        if (from === 'RUNNING') {
            return to === 'COMPLETED' || to === 'ERROR' || to === 'DISCARDED' || to === 'CANCELLED';
        }
        return true;
    }

    private failTask(taskId: string, errorMsg: string): void {
        const task = this._tasks.get(taskId);
        if (task && this.isValidTransition(task.status, 'ERROR')) {
            task.status = 'ERROR';
            task.error = errorMsg;
            this.emitState(taskId, 'ERROR', errorMsg);
            StatisticsCollector.getInstance().recordTaskFailure(taskId, false);
            this._logger.error(`任务执行失败 [${taskId}]: ${errorMsg}`);
        }
    }

    private updateTaskStatus(taskId: string, status: TaskStatus): void {
        const task = this._tasks.get(taskId);
        if (task && this.isValidTransition(task.status, status)) {
            task.status = status;
        }
    }

    /** 广播任务状态变更事件，供 UI 层楼层按键订阅 */
    private emitState(taskId: string, status: TaskStatus, error?: string): void {
        this._events.emit('task:state_changed', {
            taskId,
            status,
            error
        });
    }

    /** 根据全局设置中的 provider 字段获取当前活跃的生图驱动实例 */
    public getActiveDriver(): IDrawDriver | undefined {
        const settings = this._store.getState();
        const provider = settings.provider || 'comfyui';
        return this._drivers.get(provider);
    }


    /** 淘汰最早的终态历史任务以防内存泄露 */
    private trimTaskHistory(): void {
        if (this._tasks.size <= TaskManager.MAX_TASK_HISTORY) return;
        const tasksToRemove: string[] = [];
        for (const [id, t] of this._tasks.entries()) {
            if (t.status === 'COMPLETED' || t.status === 'ERROR' || t.status === 'CANCELLED' || t.status === 'DISCARDED') {
                tasksToRemove.push(id);
                if (this._tasks.size - tasksToRemove.length <= TaskManager.MAX_TASK_HISTORY) {
                    break;
                }
            }
        }
        for (const id of tasksToRemove) {
            const task = this._tasks.get(id);
            if (task) {
                delete task.resultBlobs;
                delete task.payload;
            }
            this._tasks.delete(id);
        }
    }

    /** 释放任务队列内存并清除所有任务快照，适用于插件卸载或导航退出场景 */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._queue.length = 0;
        this._tasks.clear();
    }
}
