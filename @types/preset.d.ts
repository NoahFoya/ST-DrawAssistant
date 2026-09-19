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

export interface DrawingPresetData {
    /** 主模型 / 基底模型文件名 */
    baseModel?: string;
    /** 级联额外模型文件名列表 */
    extraModels?: string[];
    /** 分立式 UNet 模型文件名 */
    unetName?: string;
    /** 分立式 CLIP 模型文件名 */
    clipName?: string;
    /** 分立式 VAE 模型文件名 */
    vaeName?: string;
    /** SD-WebUI 专用 VAE 文件名 (兼容 SD-WebUI 私有字段) */
    vae?: string;
    /** CLIP 跳过层数 */
    clipSkip?: number;
    /** 采样算法名称 */
    samplerName?: string;
    /** 调度器名称 */
    scheduler?: string;
    /** 采样步数 */
    steps?: number;
    /** 提示词引导系数 CFG Scale */
    cfgScale?: number;
    /** 随机种子 (未指定时由引擎自动随机生成) */
    seed?: number;
    /** 重绘幅度 / 去噪强度 (文生图默认 1.0) */
    denoise?: number;
    /** 图像生成宽度 (像素) */
    width?: number;
    /** 图像生成高度 (像素) */
    height?: number;
    /** 单批次生成数量 */
    batchSize?: number;
    /** 关联的提示词预设方案标识符 */
    promptProfileId?: string;
    /** 关联的文生图工作流方案标识符 */
    txt2imgWorkflowId?: string;
    /** 关联的图生图工作流方案标识符 */
    img2imgWorkflowId?: string;
    /** 关联的局部重绘工作流方案标识符 */
    inpaintWorkflowId?: string;
    /** 是否开启高清修复 (SD-WebUI) */
    enableHires?: boolean;
    /** 高清修复放大算法 (SD-WebUI) */
    hiresUpscaler?: string;
    /** 高清修复倍率 (SD-WebUI) */
    hiresScale?: number;
    /** 高清修复步数 (SD-WebUI) */
    hiresSteps?: number;
    /** 高清修复重绘幅度 (SD-WebUI) */
    hiresDenoise?: number;
    /** 引擎扩展参数通用键值 */
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
