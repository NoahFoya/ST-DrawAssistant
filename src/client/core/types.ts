/**
 * @module core/types
 * @description 基础类型与全局配置模型定义
 */

import { IDisposable, toDisposable, DisposableStore } from '../../common';
export { IDisposable, toDisposable, DisposableStore };

/** 日志输出级别 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

/**
 * 生图元数据接口
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
    /** 图像二进制哈希 (用于避免重复存入相同图片) */
    hash?: string;
    /** 收藏标记 */
    isFavorite?: boolean;
    /** 最近访问时间戳 */
    lastAccessedAt?: number;
}

/** 存储方案: split (存入本地数据库), embedded (Base64存入聊天记录), server (保存到服务端) */
export type StorageStrategy = 'split' | 'embedded' | 'server';

/**
 * 聊天记录中存储的图片数据结构 (保存在 msg.extra.da_images[swipeId][buttonIndex])
 * 按酒馆消息的多轮滑动 (Swipe) 与按钮槽位组织
 */
export interface ChatImageEntry {
    /** 图像唯一标识 (UUID 或 assetId) */
    readonly uuid: string;
    /** 图像 MIME 类型 (如 'image/png', 'image/webp') */
    readonly mime: string;
    /** 图像文件编码格式 (如 'png', 'webp', 'jpeg') */
    readonly format: string;
    /** 生图引擎名称 (如 'comfyui', 'sdwebui', 'novelai', 'cloud') */
    readonly engine: string;
    /** 生图提示词正文 */
    readonly prompt: string;
    /** 可选的负向提示词 */
    readonly negativePrompt?: string;
    /** 生成完成的时间戳 (毫秒) */
    readonly timestamp: number;
    /** 存储策略 */
    readonly storageStrategy: StorageStrategy;
    /** embedded 策略下的原图 Base64 字符串 (包含 data:image/... 前缀) */
    readonly base64?: string;
    /** server 策略下的静态文件访问 URL */
    readonly url?: string;
    /** 补充的生图元数据 */
    readonly metadata?: Record<string, unknown>;
}

/** 聊天消息中的图片字典 (结构为 [swipeId][buttonIndex]) */
export type ChatImagesRoot = Record<string | number, Record<string | number, ChatImageEntry>>;

/**
 * 插件配置接口
 */
export interface DrawAssistantSettings {
    /** 插件总开关 */
    enabled: boolean;
    /** 当前选中的生图后端 (如 comfyui, sdwebui, novelai, cloud) */
    activeProvider: string;
    /** 请求方式: browser 为直连, server 为服务端代理 */
    requestMode: 'browser' | 'server';
    /** 存储方式: split 为分离存储, embedded 为原图直接内嵌聊天记录, server 为服务端存储 */
    storageStrategy: StorageStrategy;
    /** 性能可选项: 是否自动生成 256x256 轻量缩略图优化画廊性能 (默认 true) */
    enableThumbnail: boolean;
    /** 存储可选项: 是否启用 SHA-256 哈希去重 (默认 true) */
    deduplicateHash: boolean;
    /** 存储容量上限: 最多保存图片张数，超出时清理最久未使用的未收藏项，0 表示不限制 (默认 500) */
    maxStoredImages: number;
    /** 自动清理周期: 图片保留天数，0 表示永久 (默认 0) */
    imageRetentionDays: number;
    /** UI 显示偏好: 生图完成后是否隐藏生成按钮仅保留图片 (默认 false) */
    hideButtonOnDone: boolean;
    /** 触发占位符前缀 (默认 'image###') */
    placeholderStart: string;
    /** 触发占位符后缀 (默认 '###') */
    placeholderEnd: string;
    /** 提示词预处理: 是否清理多余换行与空格 (默认 true) */
    cleanExtraSpacesAndLines: boolean;

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
    engineConfigs: Record<string, Record<string, any>>;

    /** 悬浮球 (FAB) 显隐 (默认 true) */
    fabVisible?: boolean;
    /** 悬浮球透明度 (默认 0.95) */
    fabOpacity?: number;
    /** 悬浮球预设图标标识 (如 'palette', 'sparkles', 'wand', 'image', 'brush') */
    fabPresetIcon?: string;
    /** 悬浮球自定义图标 Base64 或 URL */
    fabCustomIcon?: string;
    /** 悬浮球屏幕记忆坐标 */
    fabPosition?: { top: number; left: number };
    /** 是否启用灯箱大图预览 (默认 true) */
    lightboxEnabled?: boolean;

    /** UI 表现层偏好配置 (开放命名空间) */
    uiPreferences?: Record<string, unknown>;

    /**
     * 独立扩展层配置空间 (供外部独立扩展按模块名称存放专属配置)
     */
    extensions?: Record<string, Record<string, unknown>>;

    /** 插件自定义扩展数据 (开放命名空间) */
    customData?: Record<string, unknown>;
}

/** 任务生命周期状态枚举 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

/**
 * 生图任务请求数据结构
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
        readonly userName?: string;
        readonly messageId?: number;
        readonly chatId?: string;
        readonly swipeId?: number;
        readonly buttonIndex?: number;
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

/**
 * 独立可选扩展上下文契约
 * 供未来外部独立扩展（如角色管理扩展）与核心层交互，避免产生硬编码与依赖倒置
 */
export interface ExtensionContext {
    /** 扩展专属配置读取 */
    getSettings: <T extends Record<string, unknown> = Record<string, unknown>>() => T;
    /** 扩展专属配置保存更新 */
    updateSettings: (settings: Record<string, unknown>) => void;
}

/**
 * 独立可选扩展标准接口
 * 扩展层遵循此生命周期契约，完全独立于插件本体
 */
export interface ClientExtension extends IDisposable {
    /** 扩展唯一标识符 (对应 settings.extensions[id]) */
    readonly id: string;
    /** 扩展名称 */
    readonly name: string;
    /** 扩展初始化入口 */
    init(context: ExtensionContext): Promise<void> | void;
}
