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
     * 仅标记任务为 DISCARDED 状态（内部辅助）
     *
     * ⚠️ 此方法**不调用 driver.cancel()**，不会向 ComfyUI 后端发送取消请求。
     * 外部代码应使用 `cancelWithDriver(taskId, driver)` 完成完整取消流程。
     * 此方法保留仅供部分无法直接引用 driver 的内部场景使用。
     */
    cancel(taskId: string): void;
    /**
     * 完整取消任务（推荐使用此方法）
     *
     * - PENDING 状态：标记 DISCARDED + 调用 driver.cancel() 向后端发送 /queue delete
     * - RUNNING 状态：标记 DISCARDED + 调用 driver.cancel() 触发客户端丢弃模式
     *
     * 取消完成信号（'cancelled' 事件）由 _run() 的 catch 分支在 driver.generate()
     * reject 后自动触发，无需在此处手动 emit。
     */
    cancelWithDriver(taskId: string, driver: ImageDriver): void;
    getTask(taskId: string): TaskRecord | undefined;
    getStatus(taskId: string): TaskStatus | undefined;
    isIdle(): boolean;
}
export {};
//# sourceMappingURL=manager.d.ts.map