/**
 * UI 表现层通用接口、原子控件规范与跨子层数据模型
 * 集中管理 components/、composite/、layout/、media/、views/ 的共享类型与组件接口
 */

import type { HealthCheckResult } from './adapter';
import type { StoredImageRecord } from './storage';

// 1. 基础原子控件与图标类型

/** 纯净内联矢量 SVG 图标标识名枚举 */
export type IconName =
    | 'eye'
    | 'eye-off'
    | 'clear'
    | 'check'
    | 'alert'
    | 'spinner'
    | 'refresh'
    | 'help'
    | 'trash'
    | 'copy'
    | 'edit'
    | 'chevron-up'
    | 'chevron-down'
    | 'close'
    | 'external'
    | 'plus'
    | 'swap'
    | 'dice'
    | 'star'
    | 'download'
    | 'settings'
    | 'palette'
    | 'zap'
    | 'sparkles'
    | 'image';

/** 基础控件通用操作句柄 */
export interface IControlHandle<T> {
    /** 根 DOM 元素 */
    readonly element: HTMLElement;
    /** 获取当前组件的值 */
    getValue(): T;
    /** 设置组件的值 */
    setValue(val: T extends object ? Partial<T> : T): void;
    /** 设置控件启用/禁用状态 */
    setDisabled(disabled: boolean): void;
    /** 设置控件未保存修改状态 (呈现琥珀色微光 .is-dirty) */
    setDirty?(isDirty: boolean): void;
    /** 设置控件校验错误状态 (呈现红框告警 .is-invalid 与错误提示) */
    setError?(hasError: boolean, message?: string): void;
    /** 释放组件绑定的事件监听器与资源 */
    dispose?(): void;
}

/** 基础控件通用构造配置 */
export interface BaseControlOptions {
    id?: string;
    name?: string;
    className?: string;
    ariaLabel?: string;
    disabled?: boolean;
}

/** 下拉选择框条目模型 */
export interface SelectOptionItem {
    label: string;
    value: string;
    disabled?: boolean;
    group?: string;
}

/** 按钮语义化视觉变体 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/** 按钮尺寸规范 */
export type ButtonSize = 'normal' | 'sm';

/** 反馈提示语义化类型 */
export type FeedbackVariant = 'success' | 'warn' | 'error' | 'info' | 'muted';

// 2. 复合卡片与业务数据模型

/** 连接卡片当前状态 */
export type ConnectionCardStatus = 'idle' | 'checking' | 'online' | 'offline';

/** 连通性测试执行函数 */
export type HealthCheckFn = (signal?: AbortSignal) => Promise<HealthCheckResult>;

/** 预设工具栏操作类型 */
export type PresetActionType = 'select' | 'new' | 'save' | 'saveAs' | 'rename' | 'import' | 'export' | 'reset' | 'delete';

/** 单个 LoRA 项展示与编辑模型 */
export interface LoraItemModel {
    id: string;
    name: string;
    enabled: boolean;
    modelWeight: number;
    clipWeight: number;
    triggerWeight?: number;
    /** 模型是否已失效（未在当前生图服务中发现） */
    isInvalid?: boolean;
}

/** ComfyUI 工作流变量占位符定义 */
export interface ComfyWorkflowVariableDefinition {
    variable: string;
    label: string;
    matchKeys: readonly string[];
    tip: string;
}

/** 工作流变量替换映射详情 */
export interface VariableReplacementInfo {
    variable: string;
    nodeId: string;
    classType: string;
    field: string;
    prevValue: unknown;
}

/** 未匹配的工作流变量信息 */
export interface UnmatchedVariableInfo {
    variable: string;
    label: string;
    tip: string;
}

/** 工作流变量深度扫描与替换分析结果 */
export interface WorkflowAnalysisResult {
    success: boolean;
    error?: string;
    formattedJson: string;
    replaced: VariableReplacementInfo[];
    unmatched: UnmatchedVariableInfo[];
}

/** 工作流预设方案数据模型 */
export interface WorkflowPresetData extends Record<string, any> {
    json: string;
}

/** 统计卡片条目数据模型 */
export interface StatItemModel {
    label: string;
    value: string | number;
    unit?: string;
    variant?: 'success' | 'warn' | 'error' | 'info';
    hint?: string;
}

/** 本地存储配额监控数据模型 */
export interface StorageQuotaInfo {
    usedBytes: number;
    totalBytes: number;
    imageCount: number;
}

/** 画幅尺寸与分辨率数据模型 */
export interface DimensionValue {
    width: number;
    height: number;
    aspectRatio?: string;
}

/** 常用采样生成超参数模型 */
export interface SamplerParamsModel {
    sampler: string;
    scheduler: string;
    steps: number;
    cfgScale: number;
    seed: number;
}

/** 终端日志级别 */
export type TerminalLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 终端日志条目模型 */
export interface TerminalLogEntry {
    level: TerminalLogLevel;
    message: string;
    namespace?: string;
    timestamp?: number;
}

/** 画廊媒体单张卡片模型 */
export interface MediaCardItemModel {
    id: string;
    url: string;
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    isFavorite?: boolean;
    createdAt?: number;
}

/** OpenAI 兼容后端服务提供商类型 */
export type OpenAIProviderType =
    | 'openai-official'
    | 'siliconflow'
    | 'xai-grok'
    | 'openrouter'
    | 'together'
    | 'custom';

/** OpenAI 兼容后端连接与凭据配置模型 */
export interface OpenAIProviderConfig {
    provider: OpenAIProviderType;
    serverUrl: string;
    apiKey: string;
    customHeaders?: string;
}

// 3. 弹窗骨架与交互状态模型

/** 状态指示圆点显示状态 */
export type StatusDotState = 'ok' | 'checking' | 'error' | 'warn' | 'idle';

/** 模态主弹窗标签页配置项 */
export interface TabDefinition {
    id: string;
    label: string;
    iconSvg: string;
    group: 'engine' | 'system';
    render: () => HTMLElement | Promise<HTMLElement>;
    onActivate?: () => void;
    onDeactivate?: () => void;
    dispose?: () => void;
}

/** 模态弹窗外壳构造配置 */
export interface ModalShellOptions {
    title?: string;
    version?: string;
    initialTabId?: string;
    settingsStore?: any;
    onClose?: () => void;
    onTabChange?: (tabId: string) => void;
    tabs?: TabDefinition[];
}

// 4. 图像局部重绘输出结果类型

/** 局部涂抹重绘输出结果 */
export interface InpaintResult {
    baseBlob: Blob;
    maskBlob: Blob;
    maskBase64: string;
}

// 5. UI 模块对外操作接口与服务定义

/** UI 子系统装配服务输入 */
export interface UIServices {
    settingsStore: any;
    storage?: any;
    orchestrator?: any;
    taskQueue?: any;
    containerEl?: HTMLElement;
    version?: string;
}

/** UI 子系统顶层操作句柄 */
export interface UIHandle {
    readonly modalShell: any;
    readonly fabContainer: any;
    readonly floorManager: any;
    readonly lightbox: any;
    readonly imageInfo: any;
    readonly inpaintModal: any;
    readonly workflowModal: any;
    readonly actionPanel?: any;
    openModal(tabId?: string): void;
    closeModal(): void;
    openWorkflowBlueprint(workflowId: string, json: string, onSave?: (newJson: string) => void): void;
    openLightbox(items: MediaCardItemModel[], startIndex?: number): void;
    openImageInfo(record: StoredImageRecord): void;
    openInpaint(blob: Blob): void;
    openActionPanel?(data: any): void;
    dispose(): void;
}
