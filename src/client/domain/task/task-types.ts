/**
 * @module domain/task/task-types
 * @description 生图任务数据类型与事件定义
 */

import {
    TaskStatus,
    GenerationRequest,
    GenerationResult,
    CoreEventMap
} from '../../core/types';

export { TaskStatus, GenerationRequest, GenerationResult, CoreEventMap };

/** 任务上下文标识信息 */
export interface TaskContextIdentity {
    readonly taskId: string;
    readonly chatId?: string;
    readonly messageId?: number;
    readonly swipeId?: number;
}

/** 外部可查询的任务只读快照 */
export interface TaskSnapshot {
    readonly id: string;
    readonly targetEngine: string;
    readonly status: TaskStatus;
    readonly request: GenerationRequest;
    readonly progress: number;
    readonly previewUrl?: string;
    readonly result?: GenerationResult;
    readonly error?: string;
    readonly createdAt: number;
    readonly startedAt?: number;
    readonly finishedAt?: number;
}

/** 提交生图任务的选项参数 */
export interface SubmitTaskOptions {
    /** 提示词流水线生成的生图请求对象 */
    request: GenerationRequest;
    /** 任务关联的会话标识 (可选) */
    chatId?: string;
    /** 任务关联的消息楼层标识 (可选) */
    messageId?: number;
    /** 消息 Swipe 分支序号 (可选) */
    swipeId?: number;
}

/** 任务事件定义 (统一指向 CoreEventMap) */
export type TaskEventMap = CoreEventMap;
