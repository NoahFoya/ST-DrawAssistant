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
 * 遵循文档型数据模型，公共基准强类型化，后端专属参数收敛在开放的 engineParams 中
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
     * 引擎专属参数快照 (开放命名空间，命名空间自治)
     * 领域层与核心层保持中立，不预设任何具体后端的私有字段
     */
    readonly engineParams?: Record<string, unknown>;

    /**
     * 外部后端原始响应快照 (可选保底，便于导出原生数据块与底层审计)
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

/** 内部事件定义 */
export interface CoreEventMap {
    'settings:changed': { settings: DrawAssistantSettings; changedKey?: string };
    'chat:changed': { chatId: string };
    'host:ready': void;
    'asset:saved': { assetId: string; record: StoredImageRecord };
    'asset:deleted': { assetId: string };
}
