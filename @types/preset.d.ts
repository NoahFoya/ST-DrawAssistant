/**
 * ST-DrawAssistant 预设方案类型定义。
 *
 * @remarks
 * 声明预设方案数据模型及各类别预设数据类型，
 * 涵盖绘图参数、提示词模板、工作流及主题预设。
 */

import type { ProviderType } from './provider';

/** 预设所属的分类类型 */
export type PresetCategory = 'drawing' | 'prompts' | 'workflows' | 'themes';

/** 单个预设条目的统一标准化包装模型 */
export interface PresetItem<T = Record<string, unknown>> {
    /** 预设全局唯一标识符 */
    readonly id: string;
    /** 预设显示名称 (用户可自由修改) */
    name: string;
    /** 预设具体业务参数负载 */
    data: T;
    /** 备注或说明信息 (可选) */
    description?: string;
    /** 最近修改时间戳 (可选) */
    updatedAt?: number;
}

/** 绘图参数方案负载类型 */
export interface DrawingPresetData {
    model?: string;
    vae?: string;
    clipSkip?: number;
    samplerName?: string;
    scheduler?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    promptProfileId?: string;
    txt2imgWorkflowId?: string;
    img2imgWorkflowId?: string;
    inpaintWorkflowId?: string;
    enableHires?: boolean;
    hiresUpscaler?: string;
    hiresScale?: number;
    hiresSteps?: number;
    hiresDenoise?: number;
    [key: string]: unknown;
}

/** 提示词方案负载类型 */
export interface PromptPresetData {
    prefix?: string;
    suffix?: string;
    defaultNegative?: string;
    loras?: Array<{ name: string; weight: number; trigger?: string }>;
    [key: string]: unknown;
}

/** 工作流方案负载类型 (如 ComfyUI API 节点图) */
export interface WorkflowPresetData {
    workflow: Record<string, unknown>;
    inputMappings?: Record<string, unknown>;
    [key: string]: unknown;
}

/** 界面主题方案负载类型 */
export interface ThemePresetData {
    accentColor?: string;
    accentCyan?: string;
    bgPrimary?: string;
    bgSecondary?: string;
    bgSidebar?: string;
    bgCard?: string;
    bgCardHover?: string;
    bgInput?: string;
    bgInputHover?: string;
    bgGradientEnd?: string;
    bgGradientAngle?: number;
    bgOpacity?: number;
    textPrimary?: string;
    textSecondary?: string;
    borderColor?: string;
    borderHighlight?: string;
    borderRadius?: number;
    radiusModal?: number;
    radiusCard?: number;
    radiusInput?: number;
    blurRadius?: number;
    blurModal?: number;
    blurPanel?: number;
    [key: string]: unknown;
}

/** 预设方案池整体持久化结构 */
export interface PresetSettings {
    /** 绘图方案字典，按绘图服务提供方划分独立命名空间 */
    drawing: Record<ProviderType | string, PresetItem<DrawingPresetData>[]>;
    /** 提示词方案列表 */
    prompts: PresetItem<PromptPresetData>[];
    /** 工作流模板列表 */
    workflows: PresetItem<WorkflowPresetData>[];
    /** 界面主题列表 */
    themes: PresetItem<ThemePresetData>[];
}
