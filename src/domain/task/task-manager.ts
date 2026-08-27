/**
 * @module domain/task/task-manager
 * @description 任务调度系统与并发状态机 (支持 PENDING/RUNNING/COMPLETED/CANCELLED/DISCARDED/ERROR 与客户端丢弃模式)
 */

import { TaskState, TaskStatus, TaskContextIdentity } from './task-types';
import { GenerationPayload, IDrawDriver } from '../drivers/driver-contract';
import { ITypedEventBus } from '../../core/foundation/event-bus';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDriverRegistry } from '../../core/registry/driver-registry';
import { IStorageAdapter } from '../../core/state/storage-adapter';
import { Logger } from '../../core/diagnostics/logger';
import { IDisposable } from '../../core/foundation/disposable';

export interface TaskManagerOptions {
    events: ITypedEventBus;
    store: ObservableStore<DrawAssistantSettings>;
    drivers: IDriverRegistry;
    storage: IStorageAdapter;
}

export interface ITaskManager extends IDisposable {
    submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string>;
    cancelTask(taskId: string): Promise<void>;
    getTask(taskId: string): TaskState | undefined;
    getTasksByMessage(chatId: string, messageId: number): TaskState[];
}

export class TaskManager implements ITaskManager {
    private readonly _events: ITypedEventBus;
    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _drivers: IDriverRegistry;
    private readonly _storage: IStorageAdapter;
    private readonly _logger = new Logger('TaskManager');

    private readonly _tasks = new Map<string, TaskState>();
    private readonly _queue: string[] = [];
    private _activeCount = 0;
    private _isDisposed = false;

    constructor(options: TaskManagerOptions) {
        this._events = options.events;
        this._store = options.store;
        this._drivers = options.drivers;
        this._storage = options.storage;
    }

    public async submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string> {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const identity: TaskContextIdentity = {
            taskId,
            chatId: options.chatId,
            messageId: options.messageId,
            swipeId: options.swipeId
        };

        const state: TaskState = {
            identity,
            status: 'PENDING',
            payload: options.payload,
            createdAt: Date.now()
        };

        this._tasks.set(taskId, state);
        this._queue.push(taskId);
        this._logger.info(`任务入队: ${taskId} (楼层 #${options.messageId})`);

        this.emitState(taskId, 'PENDING');
        this.processQueue();

        return taskId;
    }

    public async cancelTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) return;

        if (task.status === 'PENDING') {
            // 排队中取消 -> 直接出队
            const idx = this._queue.indexOf(taskId);
            if (idx !== -1) this._queue.splice(idx, 1);
            this.updateTaskStatus(taskId, 'CANCELLED');
            this.emitState(taskId, 'CANCELLED');
            this._logger.info(`排队中任务已取消: ${taskId}`);
        } else if (task.status === 'RUNNING') {
            // 执行中取消 -> 客户端丢弃模式 (Client-side Discard)
            this.updateTaskStatus(taskId, 'DISCARDED');
            this.emitState(taskId, 'DISCARDED');
            this._logger.info(`执行中任务置为客户端丢弃: ${taskId}`);

            const driver = this.getActiveDriver();
            await driver?.interrupt?.();
        }
    }

    public getTask(taskId: string): TaskState | undefined {
        return this._tasks.get(taskId);
    }

    public getTasksByMessage(chatId: string, messageId: number): TaskState[] {
        return Array.from(this._tasks.values()).filter(
            (t) => t.identity.chatId === chatId && t.identity.messageId === messageId
        );
    }

    private processQueue(): void {
        if (this._isDisposed) return;
        const maxConcurrent = this._store.getState().maxConcurrent || 1;

        while (this._activeCount < maxConcurrent && this._queue.length > 0) {
            const nextTaskId = this._queue.shift()!;
            const task = this._tasks.get(nextTaskId);
            if (!task || task.status !== 'PENDING') continue;

            this._activeCount++;
            this.executeTask(nextTaskId);
        }
    }

    private async executeTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) {
            this._activeCount--;
            this.processQueue();
            return;
        }

        this.updateTaskStatus(taskId, 'RUNNING');
        this.emitState(taskId, 'RUNNING', 0);

        const driver = this.getActiveDriver();
        if (!driver) {
            this.failTask(taskId, '未找到可用的生图驱动');
            return;
        }

        try {
            const res = await driver.generate(task.payload, (progress) => {
                const currentTask = this._tasks.get(taskId);
                if (currentTask?.status === 'DISCARDED') return; // 已被丢弃直接忽略

                if (currentTask?.status === 'RUNNING') {
                    (currentTask as any).progress = progress;
                    this.emitState(taskId, 'RUNNING', progress.percent);
                }
            });

            const currentTask = this._tasks.get(taskId);
            // 若已被客户端丢弃，不落库也不触发 COMPLETED
            if (currentTask?.status === 'DISCARDED') {
                this._logger.info(`丢弃的任务 [${taskId}] 异步结果到达，已静默丢弃`);
                this._activeCount--;
                this.processQueue();
                return;
            }

            (task as any).status = 'COMPLETED';
            (task as any).resultBlobs = res.imageBlobs;

            // 持久化保存至 IndexedDB
            for (const blob of res.imageBlobs) {
                const dataUrl = await this.blobToDataURL(blob);
                await this._storage.saveImage({
                    id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    prompt: task.payload.prompt,
                    data: dataUrl,
                    metadata: {
                        taskId,
                        chatId: task.identity.chatId,
                        messageId: task.identity.messageId
                    }
                });
            }

            this.emitState(taskId, 'COMPLETED', 100);
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

    private failTask(taskId: string, errorMsg: string): void {
        const task = this._tasks.get(taskId);
        if (task) {
            (task as any).status = 'ERROR';
            (task as any).error = errorMsg;
            this.emitState(taskId, 'ERROR', undefined, errorMsg);
            this._logger.error(`任务执行失败 [${taskId}]: ${errorMsg}`);
        }
    }

    private updateTaskStatus(taskId: string, status: TaskStatus): void {
        const task = this._tasks.get(taskId);
        if (task) {
            (task as any).status = status;
        }
    }

    private emitState(taskId: string, status: TaskStatus, progress?: number, error?: string): void {
        this._events.emit('task:state_changed', {
            taskId,
            status: status as any,
            progress,
            error
        });
    }

    private getActiveDriver(): IDrawDriver | undefined {
        const settings = this._store.getState();
        const provider = settings.provider || 'comfyui';
        return this._drivers.get(provider);
    }

    private async blobToDataURL(blob: Blob): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._queue.length = 0;
        this._tasks.clear();
    }
}
