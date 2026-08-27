/**
 * @module domain/task/task-manager
 * @description 任务调度系统与并发状态机 (支持 PENDING/RUNNING/COMPLETED/CANCELLED/DISCARDED/ERROR 与客户端丢弃模式)
 */
import { TaskState } from './task-types';
import { GenerationPayload } from '../drivers/driver-contract';
import { ITypedEventBus } from '../../core/foundation/event-bus';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDriverRegistry } from '../../core/registry/driver-registry';
import { IStorageAdapter } from '../../core/state/storage-adapter';
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
export declare class TaskManager implements ITaskManager {
    private readonly _events;
    private readonly _store;
    private readonly _drivers;
    private readonly _storage;
    private readonly _logger;
    private readonly _tasks;
    private readonly _queue;
    private _activeCount;
    private _isDisposed;
    constructor(options: TaskManagerOptions);
    submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string>;
    cancelTask(taskId: string): Promise<void>;
    getTask(taskId: string): TaskState | undefined;
    getTasksByMessage(chatId: string, messageId: number): TaskState[];
    private processQueue;
    private executeTask;
    private failTask;
    private updateTaskStatus;
    private emitState;
    private getActiveDriver;
    private blobToDataURL;
    dispose(): void;
}
//# sourceMappingURL=task-manager.d.ts.map