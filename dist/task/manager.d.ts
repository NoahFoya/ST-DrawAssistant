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
type EventHandler<T extends keyof TaskManagerEvents> = TaskManagerEvents[T];
export declare class TaskManager {
    private readonly _tasks;
    private readonly _listeners;
    /** 当前活跃任务 ID（用于串行控制） */
    private _activeTaskId;
    /** 等待队列（当活跃任务未完成时排队） */
    private readonly _queue;
    on<T extends keyof TaskManagerEvents>(event: T, handler: EventHandler<T>): () => void;
    off<T extends keyof TaskManagerEvents>(event: T, handler: EventHandler<T>): void;
    private _emit;
    /** 保持 _tasks 缓存容量控制在 50 条以内 */
    private _cleanOldTasks;
    /**
     * 提交一个生图任务
     *
     * @param params 生成参数
     * @param driver 图像驱动实例
     * @param messageIndex 关联的消息楼层索引
     * @returns 任务 ID（暂时使用时间戳，提交后替换为 prompt_id）
     */
    submit(params: GenerateOptions, driver: ImageDriver, messageIndex?: number): Promise<string>;
    private _run;
    /**
     * 仅标记任务为取消状态（内部辅助）
     *
     * - PENDING 状态：标记 CANCELLED（任务尚未移交驱动），即时触发 cancelled 广播
     * - RUNNING 状态：标记 DISCARDED（已交驱动尚在执行）
     */
    cancel(taskId: string): void;
    /**
     * 完整取消任务（推荐使用此方法）
     *
     * - PENDING 状态：标记 CANCELLED + 调用 driver.cancel() + 即时 emit cancelled 信号
     * - RUNNING 状态：标记 DISCARDED + 调用 driver.cancel()
     */
    cancelWithDriver(taskId: string, driver: ImageDriver): void;
    getTask(taskId: string): TaskRecord | undefined;
    getStatus(taskId: string): TaskStatus | undefined;
    isIdle(): boolean;
}
export {};
//# sourceMappingURL=manager.d.ts.map