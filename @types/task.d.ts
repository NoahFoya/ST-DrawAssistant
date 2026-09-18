/**
 * 生图任务上下文与运行状态类型定义。
 *
 * @remarks
 * 任务模型采用扁平结构，以插槽挂载坐标为锚点管理生成生命周期。
 * 取消与超时由原生 `AbortSignal` 协调，不引入冗余状态机抽象。
 */

import type { ImageGenerationMetadata } from './st/chat';
import type { ProviderType } from './provider';

/** 绘图插槽挂载目标定位坐标 */
export interface SlotMountTarget {
    /** 宿主会话标识符 */
    readonly chatId: string;
    /** 宿主消息序号，当前会话中的消息索引 */
    readonly messageId: number;
    /** 候选分支序号，缺省为 0 */
    readonly swipeId: number;
    /** 当前消息内的指令序号，从 0 开始递增 */
    readonly instructionIndex: number;
}

/** 生图任务运行状态 */
export type DrawingTaskStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled';

/** 任务生成进度信息 */
export interface TaskProgressInfo {
    /** 进度百分比，范围为 0 到 100 */
    readonly percent: number;
    /** 当前采样步数 */
    readonly step?: number;
    /** 总采样步数 */
    readonly totalSteps?: number;
    /** 当前阶段描述文本 */
    readonly statusText?: string;
}

/** 任务进度回调函数类型 */
export type TaskProgressCallback = (progress: TaskProgressInfo) => void;

/** 生图任务数据模型 */
export interface DrawingTask {
    /** 任务全局唯一标识符 UUID */
    readonly taskId: string;
    /** 插槽挂载目标定位坐标 */
    readonly target: SlotMountTarget;
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本 */
    readonly negativePrompt?: string;
    /** 选用的生图提供者标识符 */
    readonly providerType: ProviderType;
    /** 任务入队时冻结的生成参数快照，防止配置变动串扰 */
    readonly parametersSnapshot?: Record<string, unknown>;
    /** 任务创建时间戳，单位毫秒 */
    readonly createdAt: number;
    /** 任务当前运行状态 */
    status: DrawingTaskStatus;
    /** 错误信息，任务失败时存在 */
    error?: string;
    /** 生成成功关联的图像标识符 UUID */
    imageId?: string;
    /** 生成完成的技术参数快照 */
    generationMetadata?: ImageGenerationMetadata;
    /** 任务取消控制器 */
    abortController?: AbortController;
}
