/**
 * 生图任务生命周期、上下文标识与数据模型
 */

import type { EngineType, ImageGenerationParams, ImageGenerationResult } from './generation';

/** 生图任务状态 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * 任务上下文标识（用于关联特定会话、消息楼层与滑动分页，避免跨会话或楼层错乱）
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
    /** 归属上下文标识（chatId/messageId/swipeId/buttonIndex） */
    readonly identity: TaskContextIdentity;
    /** 所选引擎标识 */
    readonly engine: EngineType | string;
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
 * 任务底层执行函数类型
 */
export type TaskExecutor = (task: TaskItem, signal: AbortSignal) => Promise<ImageGenerationResult>;
