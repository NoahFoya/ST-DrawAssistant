/**
 * 插件设置项与 UI 表现层配置模型
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
    /** 全局请求传输模式 (direct: 浏览器直连, relay: 宿主中继, auto: 自动协商) */
    requestMode?: TransportMode;
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
