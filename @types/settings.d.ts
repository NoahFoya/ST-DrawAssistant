/**
 * 插件设置项与 UI 表现层配置模型 (@types/settings)
 *
 * 核心功能：
 * 1. 声明插件全局运行设置项模型 (ExtensionSettings)；
 * 2. 声明悬浮球、灯箱、操作栏与聊天消息楼层图片的表现层配置 (ExtensionUiSettings)。
 *
 * 注意事项：
 * 1. 存储开关与 StorageStrategy 保持状态一致；
 * 2. 扩展插件的私有设置通过 extensionCustomSettings 字典进行命名空间隔离。
 */

import type { EngineType, TransportMode } from './generation';
import type { StorageStrategy } from './storage';
import type { PresetsArchiveData } from './preset';

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
    /** 图片在聊天消息楼层中的展示布局配置 */
    imageDisplay?: {
        align?: string;
        objectFit?: string;
        maxHeight?: number;
        maxWidthPct?: number;
        rounded?: boolean;
        autoBlur?: boolean;
        collapsed?: boolean;
    };
}

/**
 * 插件设置核心模型
 */
export interface ExtensionSettings {
    /** 插件总开关 */
    enabled: boolean;
    /** 是否展示配置项辅助提示 */
    showHelp: boolean;
    /** 当前选中的生图后端引擎 */
    activeEngine: EngineType;
    /** 请求传输模式 (direct: 浏览器直连, relay: 宿主中继, auto: 自动协商) */
    requestMode?: TransportMode;
    /** 是否将生成的图片存入 IndexedDB */
    saveToIndexedDB: boolean;
    /** 是否将生成的图片上传并保存至 SillyTavern 宿主服务端 */
    saveToServer: boolean;
    /** 是否将图片以 Base64 嵌入聊天记录文件中 */
    embedToBase64?: boolean;
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
    /** 是否在生图前自动执行提示词清洗与去重过滤 */
    cleanPrompt?: boolean;
    /** 消息正文中识别生图指令的前导标记 (默认 image###) */
    placeholderStart?: string;
    /** 消息正文中识别生图指令的结束闭合标记 (默认 ###) */
    placeholderEnd?: string;
    /** 已注册扩展功能的启用状态映射 */
    enabledExtensions?: Record<string, boolean>;
    /** 扩展独立配置隔离字典 (extensionId -> 配置键值对) */
    extensionCustomSettings?: Record<string, Record<string, unknown>>;
    /** 当前选中的主题配色方案 ID */
    themePreset: string;
    /** 预设集合 */
    presets: PresetsArchiveData;
    /** 各引擎专属私有配置项映射 */
    engines: Record<EngineType, Record<string, any>> & Record<string, any>;
    /** UI 界面与交互表现配置 */
    ui?: ExtensionUiSettings;
}
