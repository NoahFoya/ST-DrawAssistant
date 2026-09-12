/**
 * 插件设置项、预设模板、任务状态与持久化存储数据模型
 */

import type { EngineType, ImageGenerationParams, ImageGenerationResult } from './generation';

/** 生图任务生命周期状态机枚举 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * 图像存储策略
 * - split: 原图保存至浏览器本地 IndexedDB，聊天记录中仅保存轻量级索引元数据（默认推荐）
 * - embedded: 原图转换为 Base64 内嵌在聊天记录中（离线导出或特定场景）
 * - server: 原图上传至酒馆服务端静态目录 (/api/images/upload)，聊天记录保存相对 URL
 */
export type StorageStrategy = 'split' | 'embedded' | 'server';

/** 预设条目通用模型 */
export interface PresetItem<T = any> {
    id: string;
    name: string;
    isBuiltin?: boolean;
    data?: T;
    description?: string;
    engine?: string;
    category?: string;
}

/** 预设归档包数据结构 */
export interface PresetsArchiveData {
    themes?: PresetItem[];
    prompts?: PresetItem[];
    workflows?: PresetItem<{ json: string }>[];
    drawing?: Record<string, PresetItem[]>;
}

/** 生图元数据快照 */
export interface ImageMetadata {
    /** 图像资产唯一标识 */
    readonly assetId: string;
    /** 生图后端标识 (如 comfyui, sdwebui, novelai, openai) */
    readonly engine: string;
    /** 生成完成的时间戳 (毫秒) */
    readonly createdAt: number;
    /** 提示词正文 */
    readonly prompt: string;
    /** 负向提示词 */
    readonly negativePrompt?: string;
    /** 尺寸规格 */
    readonly dimensions?: {
        readonly width: number;
        readonly height: number;
        readonly aspectRatio?: string;
    };
    /** 关联的会话上下文信息 */
    readonly contextInfo?: {
        readonly characterId?: string | number;
        readonly characterName?: string;
        readonly userName?: string;
        readonly messageId?: number;
        readonly chatId?: string;
        readonly swipeId?: number;
        readonly buttonIndex?: number;
    };
    /** 生成耗时 (毫秒) */
    readonly durationMs?: number;
    /** 引擎特定生成参数快照 */
    readonly engineParams?: Record<string, unknown>;
    /** 原始响应数据 (供调试与信息面板查看) */
    readonly rawResponse?: unknown;
}

/**
 * 本地 IndexedDB 中持久化的图片记录
 */
export interface StoredImageRecord {
    readonly id: string;
    readonly prompt: string;
    readonly originalBlob: Blob;
    readonly thumbnailBlob?: Blob;
    readonly metadata: ImageMetadata;
    hash?: string;
    isFavorite?: boolean;
    lastAccessedAt?: number;
}

/**
 * 聊天消息中保存的图片条目 (位于 message.extra.da_images[swipeId][buttonIndex])
 */
export interface ChatImageEntry {
    readonly uuid: string;
    readonly mime: string;
    readonly format: string;
    readonly engine: string;
    readonly prompt: string;
    readonly negativePrompt?: string;
    readonly timestamp: number;
    readonly storageStrategy: StorageStrategy;
    readonly base64?: string;
    readonly url?: string;
    readonly metadata?: Record<string, unknown>;
}

/** 消息中的图片映射表，按 [swipeId][buttonIndex] 索引 */
export type ChatImagesRoot = Record<string | number, Record<string | number, ChatImageEntry>>;

/**
 * 任务上下文标识（用于锁定楼层分支与槽位，防跨角色串写）
 */
export interface TaskContextIdentity {
    readonly taskId: string;
    readonly chatId?: string;
    readonly messageId?: number;
    readonly swipeId?: number;
    readonly buttonIndex?: number;
}

/**
 * 统一生图任务实体模型
 */
export interface TaskItem {
    /** 任务唯一标识 (UUID) */
    readonly id: string;
    /** 归属上下文标识（chatId/messageId/swipeId/buttonIndex） */
    readonly identity: TaskContextIdentity;
    /** 所选引擎标识 */
    readonly engine: EngineType | string;
    /** 生图输入参数对象 */
    readonly params: ImageGenerationParams;
    /** 任务当前状态 */
    status: TaskStatus;
    /** 当前执行进度 (0.0 ~ 1.0) */
    progress: number;
    /** 中间过程预览图 Object URL */
    previewUrl?: string;
    /** 执行成功后的生图结果 */
    result?: ImageGenerationResult;
    /** 失败错误原因 */
    error?: string;
    /** 任务创建时间戳 */
    readonly createdAt: number;
    /** 任务开始执行时间戳 */
    startedAt?: number;
    /** 任务结束时间戳 */
    completedAt?: number;
}

/**
 * 插件 UI 表现层配置模型
 */
export interface ExtensionUiSettings {
    /** 悬浮触发按钮配置 */
    trigger?: {
        visible: boolean;
        opacity: number;
        icon: string;
        autoSnap: boolean;
        position?: {
            x: number;
            y: number;
        };
    };
    /** 画廊灯箱配置 */
    lightbox?: {
        enabled: boolean;
    };
    /** 操作面板配置 */
    actionPanel?: {
        enabled: boolean;
        hideButtonOnDone?: boolean;
    };
    /** 图片在楼层的展示布局配置 */
    imageDisplay?: {
        align?: string;
        objectFit?: string;
        maxHeight?: number;
        maxWidthPct?: number;
        rounded?: boolean;
        collapsed?: boolean;
    };
}

/**
 * 插件全局设置核心模型
 */
export interface ExtensionSettings {
    /** 插件总开关 */
    enabled: boolean;
    /** 是否展示配置项辅助提示 */
    showHelp: boolean;
    /** 当前选中的生图后端引擎 */
    activeEngine: EngineType;
    /** 是否将生成的图片存入 IndexedDB */
    saveToIndexedDB: boolean;
    /** 是否将生成的图片上传并保存至酒馆宿主服务端 */
    saveToServer: boolean;
    /** 是否生成并持久化缩略图 */
    enableThumbnail: boolean;
    /** 是否启用内容哈希图片去重 */
    deduplicateHash: boolean;
    /** 本地 IndexedDB 允许存储的最大图片数量 */
    maxStoredImages: number;
    /** 单个任务执行超时时间 (毫秒) */
    taskTimeoutMs: number;
    /** 最大并发生图任务数 */
    maxConcurrentTasks: number;
    /** 是否在接收到 AI 回复后自动触发生成 */
    autoGenerate: boolean;
    /** 当前选中的主题配色方案 ID */
    themePreset: string;
    /** 预设集合 */
    presets: PresetsArchiveData;
    /** 各引擎专属私有配置项映射 */
    engines: Record<EngineType, Record<string, any>> & Record<string, any>;
    /** 界面展现配置 */
    ui?: ExtensionUiSettings;
}


