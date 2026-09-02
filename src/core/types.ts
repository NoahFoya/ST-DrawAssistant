/**
 * @module core/types
 * @description 基础类型与全局配置模型定义
 */

/** 可释放资源的标准接口 */
export interface IDisposable {
    dispose(): void;
}

/**
 * 将清理回调函数包装为 IDisposable 对象
 * 多次调用 dispose() 时内部自动防重
 */
export function toDisposable(fn: () => void): IDisposable {
    let isDisposed = false;
    return {
        dispose: () => {
            if (!isDisposed) {
                isDisposed = true;
                try {
                    fn();
                } catch {
                    // 忽略清理异常，避免中断后续清理流程
                }
            }
        }
    };
}

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
 * 插件全局配置模型
 */
export interface DrawAssistantSettings {
    /** 插件总开关 */
    enabled: boolean;
    /** 当前选中的生图后端 (如 comfyui, sdwebui, novelai, cloud) */
    activeProvider: string;
    /** 请求方式: browser 为直连, server 为服务端代理 */
    requestMode: 'browser' | 'server';
    /** 存储方式: split 为分离存储, thumbnail 为包含缩略图, inline 为内嵌原图 */
    storageStrategy: 'split' | 'thumbnail' | 'inline';
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
