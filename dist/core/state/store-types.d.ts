/**
 * @module core/state/store-types
 * @description 全局配置状态类型定义与预设加载逻辑 (DrawAssistantSettings)
 *
 * 设计意图：
 * - 集中定义插件全局配置的 TypeScript 接口与各子方案数据结构；
 * - 提供基础默认配置对象，确保首次启动时的安全初始化；
 * - 支持从 config/presets/ 静态目录动态加载预设方案并同步至配置中心；
 * - 修改 config/presets/ 目录下的预设 JSON 文件后，刷新页面即可直接生效。
 */
import type { IPresetRegistry } from '../registry/preset-registry';
import { ObservableStore } from './store';
import type { ThemeData } from '../contracts';
export type { ThemeData } from '../contracts';
/** 支持的图像生成后端类型枚举 (开放联合类型，允许扩展第三方新模型驱动) */
export type ImageProvider = 'comfyui' | 'sdwebui' | (string & {});
/** 方案项通用包装结构 */
export interface PresetProfileItem<T = any> {
    id: string;
    name: string;
    data: T;
}
/** ComfyUI 模型参数方案数据结构 */
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
/** ComfyUI 提示词方案数据结构 */
export interface PromptProfileData {
    promptPrefix?: string;
    negativePrefix?: string;
    promptSuffix?: string;
    loras?: LoraItem[];
}
/** 工作流方案数据结构 */
export interface WorkflowProfileData {
    json: string;
}
/** LoRA 触发词与权重项 */
export interface LoraItem {
    name: string;
    weight: number;
    clipWeight?: number;
    textWeight?: number;
    triggerWeight?: number;
    triggerWords?: string;
}
/** 图像展示样式配置 */
export interface ImageDisplayConfig {
    align: 'left' | 'center' | 'right';
    objectFit: 'contain' | 'cover' | 'fill' | 'none';
    maxHeight: number;
    maxWidthPct: number;
    rounded: boolean;
}
/** 扩展功能状态 */
export interface ExtensionState {
    enabled: boolean;
    config?: Record<string, any>;
}
/** 工作流节点注入映射配置 */
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
/**
 * 插件全局设置数据结构完整接口定义
 */
export interface DrawAssistantSettings {
    version: string;
    enabled: boolean;
    showHelp: boolean;
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
    maxStoredImages?: number;
    maxConcurrent: number;
    requestTimeout: number;
    themePreset?: string;
    customThemes?: PresetProfileItem<ThemeData>[];
    imageDisplay?: ImageDisplayConfig;
    fabEnabled?: boolean;
    fabVisible?: boolean;
    fabOpacity?: number;
    fabIcon?: string;
    fabPresetIcon?: string;
    fabCustomIcon?: string;
    fabPosition?: {
        x?: number;
        y?: number;
        top?: number;
        left?: number;
    } | null;
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
    cachedUpscalers?: string[];
    ckptName?: string;
    clipName?: string;
    vaeName?: string;
    checkpointPositivePrefix?: string;
    checkpointNegativePrefix?: string;
    promptSuffix?: string;
    loras?: LoraItem[];
    comfyModelProfiles?: PresetProfileItem<ModelProfileData>[];
    comfyModelProfileId?: string;
    comfyPromptProfiles?: PresetProfileItem<PromptProfileData>[];
    comfyPromptProfileId?: string;
    comfyTxt2ImgWorkflows?: PresetProfileItem<WorkflowProfileData>[];
    comfyTxt2ImgWorkflowId?: string;
    comfyInpaintWorkflows?: PresetProfileItem<WorkflowProfileData>[];
    comfyInpaintWorkflowId?: string;
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
    naiUrl?: string;
    naiApiKey?: string;
    naiModel?: string;
    naiSampler?: string;
    naiSteps?: number;
    naiScale?: number;
    naiWidth?: number;
    naiHeight?: number;
    naiNegativePrefix?: string;
    naiPromptPrefix?: string;
    naiPromptSuffix?: string;
    naiSmea?: boolean;
    naiSmeaDyn?: boolean;
    naiDecrisper?: boolean;
    naiUncondScale?: number;
    openaiBaseUrl?: string;
    openaiApiKey?: string;
    openaiModel?: string;
    openaiSize?: string;
    openaiQuality?: string;
    openaiStyle?: string;
    openaiPromptPrefix?: string;
    openaiNegativePrefix?: string;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    promptTemplate?: string;
    negativePromptTemplate?: string;
    autoCleanupOnChatDelete?: boolean;
}
/**
 * 创建基准出厂默认设置对象 (同步防呆兜底，保障离线冷启动绝对可用)
 */
export declare function createDefaultSettings(): DrawAssistantSettings;
/**
 * 从预设注册表中读取预设列表，并将默认项参数注入全局配置
 *
 * @param store 全局状态 Store 实例
 * @param registryOrOverwrite 预设注册中心实例或是否强制覆盖标识
 * @param overwriteExisting 是否覆盖现有配置（全量出厂重置时为 true）
 */
export declare function hydrateSettingsFromPresets(store: ObservableStore<DrawAssistantSettings>, registryOrOverwrite?: IPresetRegistry | boolean, overwriteExisting?: boolean): Promise<void>;
//# sourceMappingURL=store-types.d.ts.map