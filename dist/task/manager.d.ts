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
export declare class TaskManager {
    private readonly _tasks;
    private readonly _listeners;
    /** 当前活跃任务 ID（用于串行控制） */
    private _activeTaskId;
    /** 等待队列（当活跃任务未完成时排队） */
    private readonly _queue;
    on<T extends keyof TaskManagerEvents>(event: T, handler: EventHandler<T>): void;
    off<T extends keyof TaskManagerEvents>(event: T, handler: EventHandler<T>): void;
    private _emit;
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
     * 取消任务
     * - PENDING 状态：尝试从后端队列删除（通过驱动的 cancel()）
     * - RUNNING 状态：客户端丢弃模式（立即标记 DISCARDED）
     */
    cancel(taskId: string): void;
    /**
     * 带驱动引用的取消（完整实现）
     */
    cancelWithDriver(taskId: string, driver: ImageDriver): void;
    getTask(taskId: string): TaskRecord | undefined;
    getStatus(taskId: string): TaskStatus | undefined;
    isIdle(): boolean;
}
export {};
//# sourceMappingURL=manager.d.ts.map