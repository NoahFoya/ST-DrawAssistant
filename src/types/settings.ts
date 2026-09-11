/**
 * 插件设置与图像存储数据模型
 */

import { IDisposable } from './common';
import { PresetsArchiveData } from './preset';

/**
 * 图像存储策略
 * - split: 原图保存至浏览器 IndexedDB，聊天记录中只保存轻量级索引信息
 * - embedded: 原图转换为 Base64 直接内嵌在聊天记录中
 * - server: 原图上传至酒馆服务端静态目录，聊天记录中保存相对 URL
 */
export type StorageStrategy = 'split' | 'embedded' | 'server';

/**
 * 生图元数据快照
 */
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
 * 扩展全局配置模型
 */
export interface DrawAssistantSettings {
    /** 插件总开关 */
    enabled: boolean;
    /** 是否显示配置项旁边的帮助提示图标 */
    showHelp: boolean;
    /** 当前选中的生图后端 (如 comfyui, sdwebui, novelai, openai) */
    activeProvider: string;
    /** 是否将生成的图片存入 IndexedDB */
    saveToIndexedDB: boolean;
    /** 是否将生成的图片上传并保存至酒馆宿主服务端 (默认 false) */
    saveToServer?: boolean;
    /** 是否将图片以 Base64 内嵌在会话文本中 */
    embedToBase64: boolean;
    /** 是否生成 256x256 缩略图以加快画廊渲染速度 */
    enableThumbnail: boolean;
    /** 是否基于 SHA-256 去重，避免重复保存相同图像 */
    deduplicateHash?: boolean;
    /** 本地最大保存图片张数，超过时自动淘汰非收藏图片。0 表示不限制 */
    maxStoredImages: number;
    /** 生图完成后是否隐藏按钮，仅显示结果图片 */
    hideButtonOnDone: boolean;
    /** 消息中触发自动生图的占位符前缀 */
    placeholderStart: string;
    /** 消息中触发自动生图的占位符后缀 */
    placeholderEnd: string;

    /** 任务超时阈值 (毫秒) */
    taskTimeoutMs: number;
    /** 最大并发生图任务数 */
    maxConcurrentTasks: number;
    /** 收到角色消息后是否自动检测并触发生成 */
    autoGenerate: boolean;

    /** 当前激活的主题 ID */
    themePreset: string;
    /** 统一预设方案存储池 (在 extension_settings 中持久化) */
    presets: PresetsArchiveData;
    /** 各生图引擎独立配置空间 (各自维护其特有字段) */
    engineConfigs: Record<string, Record<string, any>>;

    /** 悬浮球可见性 */
    fabVisible?: boolean;
    /** 悬浮球不透明度 (0.1 ~ 1.0) */
    fabOpacity?: number;
    /** 悬浮球内置图标标识 */
    fabPresetIcon?: string;
    /** 悬浮球自定义图标 Base64 或 URL */
    fabCustomIcon?: string;
    /** 悬浮球记忆停靠位置（支持自适应侧边相对停靠模型与历史绝对像素坐标兼容） */
    fabPosition?: FabDockPosition | { top: number; left: number };
    /** 是否启用大图全屏预览弹窗 */
    imagePreviewEnabled?: boolean;

    /** 图片快捷操作与长按面板开关 */
    enableActionPanel?: boolean;

    /** 聊天消息中图片的排版显示偏好 */
    imageDisplay?: {
        align?: 'center' | 'left' | 'right';
        objectFit?: 'contain' | 'cover' | 'fill' | 'none';
        maxHeight?: number;
        maxWidthPct?: number;
        rounded?: boolean;
        collapsed?: boolean;
    };

    /** 界面交互偏好配置 */
    uiPreferences?: Record<string, unknown>;

    /** 外部扩展配置空间 */
    extensions?: Record<string, Record<string, unknown>>;

    /** 自定义扩展数据 */
    customData?: Record<string, unknown>;
}

/**
 * 外部独立扩展上下文
 */
export interface ExtensionContext {
    getSettings: <T extends Record<string, unknown> = Record<string, unknown>>() => T;
    updateSettings: (settings: Record<string, unknown>) => void;
}

/**
 * 外部可选扩展接口
 */
export interface ClientExtension extends IDisposable {
    readonly id: string;
    readonly name: string;
    init(context: ExtensionContext): Promise<void> | void;
}

/**
 * 悬浮球自适应侧边停靠模型
 */
export interface FabDockPosition {
    /** 停靠侧边：靠左或靠右 */
    dockSide: 'left' | 'right';
    /** 垂直高度相对视口比例 (0.0 ~ 1.0)，如 0.38 代表视口 38% 高度处 */
    topRatio: number;
    /** 贴边安全边距 (默认 12px) */
    edgeOffset?: number;
}
