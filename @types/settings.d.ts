/**
 * 插件设置项与任务状态类型定义
 */

import type { EngineType, ImageGenerationParams, ImageGenerationResult } from './generation';

/** 生图任务生命周期状态机枚举 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** 单个生图任务实体模型 */
export interface TaskItem {
    /** 任务唯一标识 (UUID) */
    id: string;
    /** 归属会话标识（用于会话切换时隔离与自动中止） */
    chatId: string;
    /** 关联的聊天消息楼层序号 */
    messageIndex?: number;
    /** 所选引擎标识 */
    engine: EngineType;
    /** 生图输入参数对象 */
    params: ImageGenerationParams;
    /** 任务当前状态 */
    status: TaskStatus;
    /** 当前执行进度 (0.0 ~ 1.0) */
    progress: number;
    /** 执行成功后的生图结果 */
    result?: ImageGenerationResult;
    /** 失败错误原因 */
    error?: string;
    /** 任务创建时间戳 */
    createdAt: number;
    /** 任务开始执行时间戳 */
    startedAt?: number;
    /** 任务结束时间戳 */
    completedAt?: number;
}

/** 插件全局配置对象结构 */
export interface ExtensionSettings {
    /** 当前选中的活动生图引擎 */
    activeEngine: EngineType;
    /** 插件总开关 */
    enabled: boolean;
    /** 最大并发生图任务数 (1 ~ 3) */
    maxConcurrency: number;
    /** 请求超时时间（秒） */
    timeoutSeconds: number;
    /** 悬浮触发按钮停靠配置（横向与纵向百分比） */
    triggerPosition?: {
        x: number;
        y: number;
    };
    /** 各后端专属私有配置映射 */
    engines: {
        sdwebui: Record<string, unknown>;
        comfyui: Record<string, unknown>;
        novelai: Record<string, unknown>;
        openai: Record<string, unknown>;
    };
}
