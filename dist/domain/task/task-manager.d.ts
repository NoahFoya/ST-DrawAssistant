/**
 * @module domain/task/task-manager
 * @description 任务调度系统与状态机管理器 (支持排队调度、并发控制、取消与客户端丢弃)
 */
import { TaskState } from './task-types';
import { GenerationPayload } from '../drivers/driver-contract';
import { ITypedEventBus } from '../../core/foundation/event-bus';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDriverRegistry } from '../../core/registry/driver-registry';
import { IStorageAdapter } from '../../core/state/storage-adapter';
import { ITaskContract, IDrawDriverContract } from '../../core/contracts';
export interface TaskManagerOptions {
    events: ITypedEventBus;
    store: ObservableStore<DrawAssistantSettings>;
    drivers: IDriverRegistry<IDrawDriverContract>;
    storage?: IStorageAdapter;
}
export interface ITaskManager extends ITaskContract {
    submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string>;
    cancelTask(taskId: string): Promise<void>;
    getTask(taskId: string): TaskState | undefined;
    getTasksByMessage(chatId: string, messageId: number): TaskState[];
    getActiveDriver(): IDrawDriverContract | undefined;
}
/** 任务调度管理器实现 */
export declare class TaskManager implements ITaskManager {
    private readonly _events;
    private readonly _store;
    private readonly _drivers;
    private readonly _logger;
    private readonly _tasks;
    private readonly _queue;
    private _activeCount;
    private _isDisposed;
    private static readonly MAX_TASK_HISTORY;
    constructor(options: TaskManagerOptions);
    submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string>;
    /** 取消指定任务 (若任务在运行中则转换为 DISCARDED 丢弃状态) */
    cancelTask(taskId: string): Promise<void>;
    /** 查询指定 ID 任务的当前快照，未找到时返回 undefined */
    getTask(taskId: string): TaskState | undefined;
    /** 返回指定楼层内所有历史任务（包括终态） */
    getTasksByMessage(chatId: string, messageId: number): TaskState[];
    /**
     * 从任务队列中取出等待中任务并在并发限制内启动执行
     * 每次任务状态变更后均应调用此方法以驱动队列消费
     */
    private processQueue;
    /**
     * 执行单个任务：调用当前活跃驱动生图并处理进度、完成与错误回调
     * 若完成时任务已被楼层丢弃，则不会触发 COMPLETED 事件也不会落库（状态机幂等性保护）
     */
    private executeTask;
    /**
     * 检查任务状态转换是否合法
     * 终态（COMPLETED / ERROR / CANCELLED / DISCARDED）不允许再次转换
     * PENDING 只能转到 RUNNING / CANCELLED / DISCARDED / ERROR
     * RUNNING 只能转到 COMPLETED / ERROR / DISCARDED / CANCELLED
     */
    private isValidTransition;
    private failTask;
    private updateTaskStatus;
    /** 广播任务状态变更事件，供 UI 层楼层按键和进度条订阅 */
    private emitState;
    /** 根据全局设置中的 provider 字段获取当前活跃的生图驱动实例 */
    getActiveDriver(): IDrawDriverContract | undefined;
    /** 淘汰最早的终态历史任务以防内存泄露 */
    private trimTaskHistory;
    /** 释放任务队列内存并清除所有任务快照，适用于插件卸载或导航退出场景 */
    dispose(): void;
}
//# sourceMappingURL=task-manager.d.ts.map