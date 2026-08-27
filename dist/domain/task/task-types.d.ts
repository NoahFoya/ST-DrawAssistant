/**
 * @module domain/task/task-types
 * @description 会话级任务标识 (TaskContextIdentity) 与状态流转数据结构定义
 */
import { GenerationPayload } from '../drivers/driver-contract';
export interface TaskContextIdentity {
    readonly taskId: string;
    readonly chatId: string;
    readonly messageId: number;
    readonly swipeId?: number;
}
/** 任务状态机：支持排队、执行、完成、取消、客户端丢弃与错误状态 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'DISCARDED' | 'ERROR';
export interface TaskState {
    readonly identity: TaskContextIdentity;
    readonly status: TaskStatus;
    readonly payload: GenerationPayload;
    readonly progress?: {
        percent: number;
        nodeName?: string;
        previewBlob?: Blob;
    };
    readonly error?: string;
    readonly resultBlobs?: Blob[];
    readonly createdAt: number;
}
//# sourceMappingURL=task-types.d.ts.map