/**
 * 图像存储策略、持久化记录与元数据模型 (@types/storage)
 *
 * 核心功能：
 * 1. 声明三种图像持久化存储策略 (StorageStrategy)；
 * 2. 声明浏览器本地 IndexedDB 图片记录与图像生成元数据结构 (StoredImageRecord, ImageMetadata)；
 * 3. 声明宿主聊天消息楼层绑定的图片条目结构 (ChatImageEntry, ChatImagesRoot)。
 *
 * 注意事项：
 * 1. 核心数据模型统一使用 id 作为主键，废除跨模块的 assetId 与 uuid 割裂命名；
 * 2. 时间戳字段统一采用 createdAt，媒体类型遵循 Web 标准 mimeType；
 * 3. 历史聊天记录数据在读取时通过数据规整函数规范为标准模型。
 */

import type { EngineGenerationTaskParams } from './engine-data';

/**
 * 图像存储策略
 * - split: 原图保存至浏览器本地 IndexedDB，聊天记录中仅保存轻量级索引元数据（默认推荐）
 * - embedded: 原图转换为 Base64 内嵌在聊天记录中（离线导出或特定场景）
 * - server: 原图上传至 SillyTavern 宿主服务端静态目录 (/api/images/upload)，聊天记录保存相对 URL
 */
export type StorageStrategy = 'split' | 'embedded' | 'server';

/** 关联的会话与聊天消息楼层上下文信息 */
export interface ChatContextInfo {
    readonly characterId?: string | number;
    readonly characterName?: string;
    readonly userName?: string;
    readonly messageId?: number;
    readonly chatId?: string;
    readonly swipeId?: number;
    readonly buttonIndex?: number;
}

/** 图像生成任务元数据快照 */
export interface ImageMetadata {
    /** 图片唯一标识符 (主键 id) */
    readonly id: string;
    /** 生图引擎类型标识 (如 comfyui, sdwebui, novelai, openai) */
    readonly engine: string;
    /** 生成完成的时间戳 (毫秒) */
    readonly createdAt: number;
    /** 提示词正文 */
    readonly prompt: string;
    /** 负向提示词 */
    readonly negativePrompt?: string;
    /** 图像分辨率与尺寸规格 */
    readonly dimensions?: {
        readonly width: number;
        readonly height: number;
        readonly aspectRatio?: string;
    };
    /** 关联的会话上下文信息 */
    readonly contextInfo?: ChatContextInfo;
    /** 生成耗时 (毫秒) */
    readonly durationMs?: number;
    /** 引擎特定生成参数快照（保存任务强类型请求参数或字典快照） */
    readonly engineParams?: EngineGenerationTaskParams | Record<string, unknown>;
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
    /** 图片唯一标识 (统一为主键 id) */
    readonly id: string;
    /** 媒体 MIME 类型，如 'image/png' (统一 Web 标准命名) */
    readonly mimeType: string;
    /** 文件扩展名，如 'png' */
    readonly extension: string;
    /** 生图引擎类型标识 */
    readonly engine: string;
    /** 提示词正文 */
    readonly prompt: string;
    /** 负向提示词 */
    readonly negativePrompt?: string;
    /** 创建时间戳 (毫秒) */
    readonly createdAt: number;
    /** 存储策略 */
    readonly storageStrategy: StorageStrategy;
    /** 嵌入 Base64 图片数据 (embedded 策略使用) */
    readonly base64?: string;
    /** 服务端静态图片 URL (server 策略使用) */
    readonly url?: string;
    /** 扩展元数据 */
    readonly metadata?: Record<string, unknown>;
}

/** 聊天消息楼层图片映射表，按 [swipeId][buttonIndex] 索引组织 */
export type ChatImagesRoot = Record<string | number, Record<string | number, ChatImageEntry>>;

