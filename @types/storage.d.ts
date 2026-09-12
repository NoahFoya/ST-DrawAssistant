/**
 * 图像存储策略、持久化记录与元数据模型
 */

/**
 * 图像存储策略
 * - split: 原图保存至浏览器本地 IndexedDB，聊天记录中仅保存轻量级索引元数据（默认推荐）
 * - embedded: 原图转换为 Base64 内嵌在聊天记录中（离线导出或特定场景）
 * - server: 原图上传至酒馆服务端静态目录 (/api/images/upload)，聊天记录保存相对 URL
 */
export type StorageStrategy = 'split' | 'embedded' | 'server';

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
