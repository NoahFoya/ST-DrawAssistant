/**
 * 任务状态类型定义
 */
import type { GenerateOptions, GenerateResult } from '../drivers/types';
/** 任务状态枚举 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'DISCARDED' | 'ERROR';
/** 任务记录 */
export interface TaskRecord {
    /** ComfyUI prompt_id */
    id: string;
    status: TaskStatus;
    params: GenerateOptions;
    /** 关联的聊天消息索引 */
    messageIndex?: number;
    result?: GenerateResult;
    error?: Error;
    /** 任务创建时间戳 */
    createdAt: number;
}
/** TaskManager 事件映射 */
export interface TaskManagerEvents {
    progress: (taskId: string, percent: number, message?: string, previewUrl?: string) => void;
    complete: (taskId: string, result: GenerateResult) => void;
    error: (taskId: string, error: Error) => void;
    cancelled: (taskId: string) => void;
}
//# sourceMappingURL=types.d.ts.map