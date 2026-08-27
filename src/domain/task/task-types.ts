/**
 * @module domain/task/task-types
 * @description 会话级任务标识 (TaskContextIdentity) 与状态流转数据结构定义
 */

export type { TaskStatus, TaskContextIdentity, TaskState, GenerationPayload } from '../../core/contracts';
import type { TaskStatus, TaskContextIdentity, GenerationPayload } from '../../core/contracts';



/** 任务内部可变状态 (供 TaskManager 内部流转) */
export interface MutableTaskState {
    identity: TaskContextIdentity;
    status: TaskStatus;
    payload?: GenerationPayload;
    progress?: {
        percent: number;
        nodeName?: string;
        previewBlob?: Blob;
    };
    error?: string;
    resultBlobs?: Blob[];
    createdAt: number;
}
