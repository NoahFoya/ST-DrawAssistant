/**
 * 生图任务上下文与运行状态类型定义。
 *
 * @remarks
 * 任务模型采用扁平结构，以容器挂载坐标管理生成生命周期。
 * 任务取消与超时由 AbortSignal 统一管理。
 */

import type { ImageGenerationMetadata } from './st/chat';
import type { ProviderType } from './provider';

/** 绘图容器挂载目标定位坐标 */
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

/** 生图任务数据模型 */
export interface DrawingTask {
    /** 任务全局唯一标识符 UUID */
    readonly taskId: string;
    /** 容器挂载目标定位坐标 */
    readonly target: SlotMountTarget;
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本 */
    readonly negativePrompt?: string;
    /** 选用的生图提供者标识符 */
    readonly providerType: ProviderType;
    /** 任务入队时的生成参数快照 */
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
