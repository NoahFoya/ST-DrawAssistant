/**
 * @module task/types
 * @description TaskManager 任务状态与事件监听器类型声明
 */


import type { GenerateOptions, GenerateResult } from '../drivers/types';

/** 任务状态枚举 */
export type TaskStatus =
    | 'PENDING'     // 已提交，等待执行
    | 'RUNNING'     // 执行中（WebSocket 推送进度）
    | 'COMPLETED'   // 成功完成
    | 'CANCELLED'   // 用户取消（PENDING 阶段，任务尚未移交驱动）
    | 'DISCARDED'   // 客户端丢弃（RUNNING 阶段，任务已在执行中）
    | 'ERROR';      // 执行错误

/** 任务记录 */
export interface TaskRecord {
    /** 任务唯一的 ID（对应生成 prompt_id 或临时标识） */
    id: string;
    /** 当前任务生命周期状态 */
    status: TaskStatus;
    /** 生图请求运行参数 */
    params: GenerateOptions;
    /** 关联的 SillyTavern 聊天消息楼层索引（从 0 开始） */
    messageIndex?: number;
    /** 生成成功时的图像结果数据（完成后图像 Base64 负载会被清空以防内存泄漏） */
    result?: GenerateResult;
    /** 执行失败时的错误信息 */
    error?: Error;
    /** 任务创建时间戳 (Date.now()) */
    createdAt: number;
}

/** TaskManager 事件映射表 */
export interface TaskManagerEvents {
    /** 任务已提交 */
    submit: (taskId: string, params: GenerateOptions, driverName: string) => void;
    /** 生成进度更新 (percent 为 -1 ~ 100) */
    progress: (taskId: string, percent: number, message?: string) => void;
    /** 任务成功完成 */
    complete: (taskId: string, result: GenerateResult) => void;
    /** 任务执行发生错误 */
    error: (taskId: string, error: Error) => void;
    /** 任务被取消或丢弃 */
    cancelled: (taskId: string) => void;
}
