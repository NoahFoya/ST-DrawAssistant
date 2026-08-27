/**
 * @module core/state/store-types
 * @description DrawAssistantSettings 设置项全局强类型定义
 */

export type ImageProvider = 'comfyui' | 'sdwebui' | 'novelai';

export interface ExtensionState {
    enabled: boolean;
    config?: Record<string, unknown>;
}

export interface ImageDisplayConfig {
    align: 'left' | 'center' | 'right';
    objectFit: 'contain' | 'cover' | 'fill' | 'none';
    maxHeight: number;
    maxWidthPct: number;
    rounded: boolean;
}

export interface WorkflowInjectionConfig {
    positiveNodeId: string;
    positiveField: string;
    negativeNodeId: string;
    negativeField: string;
    widthNodeId: string;
    widthField: string;
    heightNodeId: string;
    heightField: string;
    kSamplerNodeId: string;
    saveImageNodeId: string;
}

export interface LoraItem {
    name: string;
    weight: number;
    textWeight?: number;
    triggerWeight?: number;
}

export interface PresetProfileItem<T = Record<string, unknown>> {
    id: string;
    name: string;
    data: T;
}

export interface ThemeData {
    bgPrimary: string;
    bgGradientEnd?: string;
    bgGradientAngle?: number;
    bgGradient?: string;
    bgSecondary: string;
    bgOpacity?: number;
    textPrimary: string;
    textSecondary: string;
    borderColor: string;
    accentColor: string;
    blurRadius: number;
    borderRadius: number;
}

export interface ModelProfileData {
    ckptName?: string;
    clipName?: string;
    vaeName?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    samplerName?: string;
    scheduler?: string;
    checkpointPositivePrefix?: string;
    checkpointNegativePrefix?: string;
    inpaintDenoise?: number;
    inpaintMaskBlur?: number;
    inpaintGrowMask?: number;
}

export interface PromptProfileData {
    promptPrefix?: string;
    negativePrefix?: string;
    promptSuffix?: string;
    loras?: LoraItem[];
}

export interface WorkflowProfileData {
    json?: string;
}

export interface DrawAssistantSettings {
    version?: string;
    enabled: boolean;
    showHelp: boolean;
    autoCleanupOnChatDelete?: boolean;
    logLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    provider: ImageProvider;
    requestMode: 'browser' | 'server';
    serverUrl: string;
    apiKey?: string;

    placeholderStart: string;
    placeholderEnd: string;

    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    samplerName: string;
    scheduler: string;
    promptPrefix: string;
    negativePrefix: string;
    cleanExtraSpacesAndLines?: boolean;

    inpaintDenoise?: number;
    inpaintMaskBlur?: number;
    inpaintGrowMask?: number;

    autoGenerate: boolean;
    lightboxEnabled: boolean;
    persistToChat: boolean;
    extraSaveToChat?: boolean;
    enableActionPanel?: boolean;
    imageFormat?: 'original' | 'webp' | 'jpeg';
    imageQuality?: number;
    maxConcurrent: number;
    requestTimeout: number;
    themePreset?: string;
    customThemes?: PresetProfileItem<ThemeData>[];

    imageDisplay?: ImageDisplayConfig;

    fabEnabled?: boolean;
    fabVisible?: boolean;
    fabOpacity?: number;
    fabIcon?: string;
    fabCustomIcon?: string;
    fabPosition?: { x: number; y: number } | null;

    extensions?: Record<string, ExtensionState>;

    workflowJson: string;
    inpaintWorkflowJson?: string;
    workflowInjection: WorkflowInjectionConfig;

    cachedModels?: string[];
    cachedClips?: string[];
    cachedVaes?: string[];
    cachedSamplers?: string[];
    cachedSchedulers?: string[];
    cachedLoras?: string[];

    // ComfyUI 模型与采样参数
    ckptName?: string;
    clipName?: string;
    vaeName?: string;
    checkpointPositivePrefix?: string;
    checkpointNegativePrefix?: string;
    promptSuffix?: string;
    loras?: LoraItem[];

    // ComfyUI 预设方案
    comfyModelProfiles?: PresetProfileItem<ModelProfileData>[];
    comfyModelProfileId?: string;
    comfyPromptProfiles?: PresetProfileItem<PromptProfileData>[];
    comfyPromptProfileId?: string;
    comfyTxt2ImgWorkflows?: PresetProfileItem<WorkflowProfileData>[];
    comfyTxt2ImgWorkflowId?: string;
    comfyInpaintWorkflows?: PresetProfileItem<WorkflowProfileData>[];
    comfyInpaintWorkflowId?: string;

    // SD WebUI 专用设置
    sdWebUrl?: string;
    sdModelCheckpoint?: string;
    sdSamplerName?: string;
    sdSteps?: number;
    sdCfgScale?: number;
    sdWidth?: number;
    sdHeight?: number;
    sdDenoisingStrength?: number;
    sdPromptPrefix?: string;
    sdNegativePrefix?: string;
    sdPromptSuffix?: string;
    sdClipSkip?: number;
    sdEnableHires?: boolean;
    sdHiresUpscaleBy?: number;
    sdHiresUpscaler?: string;
    sdHiresSteps?: number;
    sdHiresDenoise?: number;
    sdProfiles?: PresetProfileItem<any>[];
    sdProfileId?: string;

    // 提示词模板别名字段
    promptTemplate?: string;
    negativePromptTemplate?: string;
}
