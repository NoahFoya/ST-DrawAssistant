/**
 * 生图任务生命周期、上下文标识与数据模型 (@types/task)
 *
 * 核心功能：
 * 1. 声明生图任务状态枚举 (TaskStatus)；
 * 2. 声明任务上下文标识 (TaskContextIdentity) 以精准关联会话、楼层与滑动序号；
 * 3. 声明任务对象 (TaskItem) 与执行器签名 (TaskExecutor)。
 *
 * 注意事项：
 * 1. 任务生命周期由调度器统筹流转，执行器通过 AbortSignal 响应外部取消；
 * 2. 关联会话上下文字段必须保证不可变性，杜绝多任务并发下的状态漂移。
 */

import type { EngineType, ImageGenerationParams, ImageGenerationResult } from './generation';

/** 生图任务状态 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * 任务上下文标识（用于关联特定会话、消息楼层与滑动序号，避免跨会话或楼层状态错乱）
 */
export interface TaskContextIdentity {
    readonly taskId: string;
    readonly chatId?: string;
    readonly messageId?: number;
    readonly swipeId?: number;
    readonly buttonIndex?: number;
}

/**
 * 统一生图任务数据模型
 */
export interface TaskItem {
    /** 任务唯一标识 (UUID) */
    readonly id: string;
    /** 归属的会话与楼层上下文标识（chatId/messageId/swipeId/buttonIndex） */
    readonly identity: TaskContextIdentity;
    /** 所选引擎标识 */
    readonly engine: EngineType;
    /** 生图输入参数对象 */
    readonly params: ImageGenerationParams;
    /** 任务当前状态 */
    status: TaskStatus;
    /** 当前执行进度 (0.0 ~ 1.0) */
    progress: number;
    /** 中间过程预览图 Object URL */
    previewUrl?: string;
    /** 执行成功后的生图结果 */
    result?: ImageGenerationResult;
    /** 失败错误原因 */
    error?: string;
    /** 任务创建时间戳 */
    readonly createdAt: number;
    /** 任务开始执行时间戳 */
    startedAt?: number;
    /** 任务结束时间戳 */
    completedAt?: number;
}

/**
 * 任务执行器函数类型
 */
export type TaskExecutor = (task: TaskItem, signal: AbortSignal) => Promise<ImageGenerationResult>;
