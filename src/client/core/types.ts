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
 * 生图结果的元数据信息
 * 用于历史记录展示、参数回填与信息查看
 */
export interface ImageMetadata {
    /** 图像唯一 ID */
    readonly assetId: string;
    /** 生成时所用的正向提示词 */
    readonly prompt: string;
    /** 生成时所用的负向提示词 */
    readonly negativePrompt?: string;
    /** 生图后端标识 (如 comfyui, sdwebui, novelai, cloud) */
    readonly provider: string;
    /** 随机种子 */
    readonly seed?: number;
    /** 采样步数 */
    readonly steps?: number;
    /** 提示词引导系数 (CFG Scale) */
    readonly cfgScale?: number;
    /** 采样器名称 */
    readonly samplerName?: string;
    /** 调度器名称 */
    readonly scheduler?: string;
    /** 图像宽度 */
    readonly width?: number;
    /** 图像高度 */
    readonly height?: number;
    /** 模型名称 */
    readonly modelName?: string;
    /** 扩展参数 */
    readonly extraParams?: Record<string, unknown>;
    /** 生成时间戳 (毫秒) */
    readonly createdAt: number;
}

/**
 * 本地持久化保存的图像实体
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
 * 生图任务请求数据 (GenerationRequest)
 */
export interface GenerationRequest {
    /** 任务唯一标识 */
    readonly taskId: string;

    /** 目标绘图后端标识 (如 'comfyui' | 'sdwebui' | 'novelai' | 'cloud') */
    readonly targetEngine: string;

    /** 
     * 经语义整合后的正向提示词描述 (人类可读的通用文本，尚未转换为特定后端语法)
     */
    readonly prompt: string;

    /** 可选的负向提示词描述 */
    readonly negativePrompt?: string;

    /** 关联的会话上下文信息 (可选) */
    readonly contextInfo?: {
        characterId?: string | number;
        characterName?: string;
        messageId?: number;
        chatId?: string;
    };

    /** 关联的媒体输入 (用于图生图、蒙版绘制、参考图) */
    readonly imageInputs?: {
        initImageBlob?: Blob;
        maskImageBlob?: Blob;
        referenceImageBlobs?: Blob[];
        denoiseStrength?: number;
    };

    /** 
     * 当前后端的专属参数字典
     * 由前端根据用户当前所选引擎传入，直接交给对应引擎的驱动处理
     * 上层逻辑不做解析，避免对具体引擎产生参数依赖
     */
    readonly engineOptions: Record<string, unknown>;
}

/**
 * 生图任务统一返回结果 (GenerationResult)
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

/**
 * 生图后端可用资产目录 (由后端适配器连接时动态获取与刷新)
 */
export interface ProviderAssetCatalog {
    /** 可选 Checkpoint 模型列表 */
    models: string[];
    /** 可用采样器算法列表 */
    samplers?: string[];
    /** 可用调度器算法列表 */
    schedulers?: string[];
    /** 本地已安装的 LoRA 列表 */
    loras?: string[];
    /** 可用放大算法列表 */
    upscalers?: string[];
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
    /** 是否显示悬浮球 */
    fabVisible: boolean;
    /** 悬浮球屏幕坐标 */
    fabPosition: { x: number; y: number } | null;
    /** 是否启用点击大图查看器 */
    lightboxEnabled: boolean;

    /** 各生图后端的独立配置空间 (由各后端驱动维护内部字段) */
    engineConfigs: Record<string, Record<string, unknown>>;

    /** 角色外貌与视觉规则配置 */
    characterRules: Record<string, Record<string, unknown>>;

    /** 树形宏规则配置 */
    macroRuleTree: Array<Record<string, unknown>>;
}

/** 内部事件定义 */
export interface CoreEventMap {
    'settings:changed': { settings: DrawAssistantSettings; changedKey?: string };
    'chat:changed': { chatId: string };
    'host:ready': void;
    'asset:saved': { assetId: string; record: StoredImageRecord };
    'asset:deleted': { assetId: string };
}
