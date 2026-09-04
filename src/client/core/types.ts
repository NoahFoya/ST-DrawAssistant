/**
 * @module core/types
 * @description 基础类型与全局配置模型定义
 */

export { IDisposable, toDisposable } from '../../common';

/** 日志输出级别 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

/**
 * 跨后端通用的标准图像元数据实体
 * 公共字段统一定义，后端专属参数保存在开放的 engineParams 中
 */
export interface ImageMetadata {
    /** 图像资产唯一标识 */
    readonly assetId: string;
    /** 生图后端标识 (如 'comfyui', 'sdwebui', 'novelai', 'cloud') */
    readonly engine: string;
    /** 生成完成的时间戳 (毫秒) */
    readonly createdAt: number;
    /** 提示词描述 (通用标准文本) */
    readonly prompt: string;
    /** 可选的负向提示词描述 */
    readonly negativePrompt?: string;
    /** 图像基础尺寸规格 (可选) */
    readonly dimensions?: {
        readonly width: number;
        readonly height: number;
        readonly aspectRatio?: string;
    };
    /** 关联的会话上下文快照 (可选) */
    readonly contextInfo?: {
        readonly characterId?: string | number;
        readonly characterName?: string;
        readonly messageId?: number;
        readonly chatId?: string;
    };
    /** 生成耗时 (毫秒，可选) */
    readonly durationMs?: number;

    /**
     * 各生图后端特有的参数快照
     * 核心层不预设具体后端的专有字段结构
     */
    readonly engineParams?: Record<string, unknown>;

    /**
     * 后端原始响应快照，供调试或导出原生信息使用
     */
    readonly rawResponse?: unknown;
}

/**
 * 本地存储的图片记录
 */
export interface StoredImageRecord {
    /** 图像唯一 ID */
    readonly id: string;
    /** 图像提示词摘要 */
    readonly prompt: string;
    /** 高清原图二进制数据 */
    readonly originalBlob: Blob;
    /** 缩略图二进制数据 (用于列表快速渲染) */
    readonly thumbnailBlob?: Blob;
    /** 生图参数元数据 */
    readonly metadata: ImageMetadata;
    /** 收藏标记 */
    isFavorite?: boolean;
    /** 最近访问时间戳 */
    lastAccessedAt?: number;
}

/**
 * 插件全局配置模型
 */
export interface DrawAssistantSettings {
    /** 插件总开关 */
    enabled: boolean;
    /** 当前选中的生图后端 (如 comfyui, sdwebui, novelai, cloud) */
    activeProvider: string;
    /** 请求方式: browser 为直连, server 为服务端代理 */
    requestMode: 'browser' | 'server';
    /** 存储方式: split 为分离存储, thumbnail 为包含缩略图 */
    storageStrategy: 'split' | 'thumbnail';
    /** 任务超时时间 (毫秒) */
    taskTimeoutMs: number;
    /** 最大并发任务数 */
    maxConcurrentTasks: number;
    /** 收到角色消息后是否自动生图 */
    autoGenerate: boolean;

    /** 当前主题名称 */
    themePreset: string;
    /** 自定义主题列表 */
    customThemes: Array<{
        id: string;
        name: string;
        tokens: Record<string, string>;
    }>;
    /** 各生图后端的独立配置空间 (由各后端驱动维护内部字段) */
    engineConfigs: Record<string, Record<string, unknown>>;

    /** UI 表现层偏好配置 (开放命名空间) */
    uiPreferences?: Record<string, unknown>;

    /** 插件自定义扩展数据 (开放命名空间) */
    customData?: Record<string, unknown>;
}

/** 任务生命周期状态枚举 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

/**
 * 生图任务请求数据结构
 * 承载用户意图与后端专有参数，由流水线组织后交付调度中心
 */
export interface GenerationRequest {
    /** 任务唯一标识 */
    readonly taskId: string;

    /** 目标绘图后端标识 (如 'comfyui' | 'sdwebui' | 'novelai' | 'cloud') */
    readonly targetEngine: string;

    /** 经语义整合后的正向提示词描述 (通用标准文本) */
    readonly prompt: string;

    /** 可选的负向提示词描述 */
    readonly negativePrompt?: string;

    /** 关联的会话上下文快照 (可选) */
    readonly contextInfo?: {
        readonly characterId?: string | number;
        readonly characterName?: string;
        readonly messageId?: number;
        readonly chatId?: string;
    };

    /** 关联的图像输入 (用于图生图、重绘蒙版与参考图) */
    readonly imageInputs?: {
        readonly initImageBlob?: Blob;
        readonly maskImageBlob?: Blob;
        readonly referenceImageBlobs?: Blob[];
        readonly denoiseStrength?: number;
    };

    /**
     * 当前后端的专属参数字典
     * 由前端根据用户当前所选引擎传入，直接交给对应引擎的驱动处理，上层逻辑不解析内部结构
     */
    readonly engineOptions: Record<string, unknown>;
}

/**
 * 生图任务统一返回结果
 */
export interface GenerationResult {
    readonly taskId: string;
    readonly engine: string;
    readonly images: Array<{
        blob: Blob;
        format: string;
        seed?: number;
        metadata?: Record<string, unknown>;
    }>;
    readonly durationMs: number;
}

/** 内部事件定义与任务生命周期通知 */
export interface CoreEventMap {
    'settings:changed': { settings: DrawAssistantSettings; changedKey?: string };
    'chat:changed': { chatId: string };
    'host:ready': void;
    'asset:saved': { assetId: string; record: StoredImageRecord };
    'asset:deleted': { assetId: string };
    // 任务生命周期事件
    'task:queued': { taskId: string; request: GenerationRequest };
    'task:started': { taskId: string; request: GenerationRequest };
    'task:progress': { taskId: string; progress: number; previewUrl?: string };
    'task:completed': { taskId: string; result: GenerationResult };
    'task:cancelled': { taskId: string; reason?: string };
    'task:failed': { taskId: string; error: string };
    'task:state_changed': { taskId: string; status: TaskStatus; error?: string };
}
