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

import {
    VERSION,
    DEFAULT_COMFYUI_URL,
    DEFAULT_SDWEBUI_URL,
    DEFAULT_PLACEHOLDER_START,
    DEFAULT_PLACEHOLDER_END,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_CONCURRENT,
    DEFAULT_THEME_DATA,
    IMAGE_DISPLAY_DEFAULTS,
    PROVIDERS,
    REQUEST_MODES
} from '../constants';
import {
    fetchThemes,
    fetchComfyUIModels,
    fetchComfyUIPrompts,
    fetchComfyUITxt2ImgWorkflows,
    fetchComfyUIInpaintWorkflows,
    fetchSDWebUIModels
} from '../config/config-loader';
import { PRESET_REGISTRY } from '../presets/preset-definitions';
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
    fabPosition?: { x?: number; y?: number; top?: number; left?: number } | null;

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

    // NovelAI 引擎专属设置
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

    // OpenAI / Grok / Banana 图像专属设置
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
export function createDefaultSettings(): DrawAssistantSettings {
    const fallbackThemeList: PresetProfileItem<ThemeData>[] = [
        {
            id: 'luminous-obsidian',
            name: '流光黑曜',
            data: { ...DEFAULT_THEME_DATA }
        }
    ];

    return {
        version: VERSION,
        enabled: true,
        showHelp: true,
        provider: PROVIDERS.COMFYUI,
        requestMode: REQUEST_MODES.BROWSER,
        serverUrl: DEFAULT_COMFYUI_URL,
        apiKey: '',
        placeholderStart: DEFAULT_PLACEHOLDER_START,
        placeholderEnd: DEFAULT_PLACEHOLDER_END,
        width: 832,
        height: 1216,
        steps: 28,
        cfgScale: 6,
        samplerName: 'euler_ancestral',
        scheduler: 'normal',
        promptPrefix: 'masterpiece, best quality',
        negativePrefix: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
        promptSuffix: '',
        cleanExtraSpacesAndLines: true,
        inpaintDenoise: 0.75,
        inpaintMaskBlur: 8,
        inpaintGrowMask: 6,
        autoGenerate: false,
        lightboxEnabled: true,
        persistToChat: true,
        extraSaveToChat: false,
        enableActionPanel: true,
        imageFormat: 'webp',
        imageQuality: 0.85,
        maxStoredImages: 500,
        maxConcurrent: DEFAULT_MAX_CONCURRENT,
        requestTimeout: DEFAULT_TIMEOUT_MS,
        themePreset: 'luminous-obsidian',
        customThemes: fallbackThemeList,
        fabEnabled: true,
        fabVisible: true,
        fabOpacity: 0.9,
        fabIcon: '🎨',
        fabPresetIcon: '',
        fabCustomIcon: '',
        fabPosition: null,
        extensions: {},
        comfyModelProfiles: [],
        comfyModelProfileId: '',
        comfyPromptProfiles: [],
        comfyPromptProfileId: '',
        comfyTxt2ImgWorkflows: [],
        comfyTxt2ImgWorkflowId: '',
        comfyInpaintWorkflows: [],
        comfyInpaintWorkflowId: '',
        workflowJson: '',
        inpaintWorkflowJson: '',
        loras: [],
        cachedModels: [],
        cachedClips: [],
        cachedVaes: [],
        cachedSamplers: [],
        cachedSchedulers: [],
        cachedLoras: [],
        cachedUpscalers: [],
        ckptName: '',
        clipName: '',
        vaeName: '',
        checkpointPositivePrefix: '',
        checkpointNegativePrefix: '',
        imageDisplay: {
            align: IMAGE_DISPLAY_DEFAULTS.ALIGN,
            objectFit: IMAGE_DISPLAY_DEFAULTS.OBJECT_FIT,
            maxHeight: IMAGE_DISPLAY_DEFAULTS.MAX_HEIGHT,
            maxWidthPct: IMAGE_DISPLAY_DEFAULTS.MAX_WIDTH_PCT,
            rounded: IMAGE_DISPLAY_DEFAULTS.ROUNDED
        },
        autoCleanupOnChatDelete: false,
        workflowInjection: {
            positiveNodeId: '6',
            positiveField: 'text',
            negativeNodeId: '7',
            negativeField: 'text',
            widthNodeId: '5',
            widthField: 'width',
            heightNodeId: '5',
            heightField: 'height',
            kSamplerNodeId: '3',
            saveImageNodeId: '9'
        },

        // SD-WebUI 引擎专属默认参数
        sdWebUrl: DEFAULT_SDWEBUI_URL,
        sdModelCheckpoint: '',
        sdSamplerName: 'DPM++ 2M Karras',
        sdSteps: 20,
        sdCfgScale: 7.0,
        sdWidth: 512,
        sdHeight: 768,
        sdDenoisingStrength: 0.75,
        sdPromptPrefix: '',
        sdNegativePrefix: '',
        sdPromptSuffix: '',
        sdClipSkip: 2,
        sdEnableHires: true,
        sdHiresUpscaleBy: 1.5,
        sdHiresUpscaler: 'R-ESRGAN 4x+ Anime6B',
        sdHiresSteps: 15,
        sdHiresDenoise: 0.45,
        sdProfiles: [],
        sdProfileId: '',

        // NovelAI 引擎专属默认参数
        naiUrl: 'https://image.novelai.net',
        naiApiKey: '',
        naiModel: 'nai-diffusion-4-full',
        naiSampler: 'k_euler_ancestral',
        naiSteps: 28,
        naiScale: 6.0,
        naiWidth: 832,
        naiHeight: 1216,
        naiNegativePrefix: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
        naiPromptPrefix: 'masterpiece, best quality',
        naiPromptSuffix: '',
        naiSmea: true,
        naiSmeaDyn: false,
        naiDecrisper: false,
        naiUncondScale: 1.0,

        // OpenAI / Grok / Banana 图像专属默认参数
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: '',
        openaiModel: 'dall-e-3',
        openaiSize: '1024x1024',
        openaiQuality: 'standard',
        openaiStyle: 'vivid',
        openaiPromptPrefix: '',
        openaiNegativePrefix: '',

        // 提示词模板别名字段
        logLevel: 'info',
        promptTemplate: '',
        negativePromptTemplate: ''
    };
}

/**
 * 从预设注册表中读取预设列表，并将默认项参数注入全局配置
 *
 * @param store 全局状态 Store 实例
 * @param registryOrOverwrite 预设注册中心实例或是否强制覆盖标识
 * @param overwriteExisting 是否覆盖现有配置（全量出厂重置时为 true）
 */
export async function hydrateSettingsFromPresets(
    store: ObservableStore<DrawAssistantSettings>,
    registryOrOverwrite?: IPresetRegistry | boolean,
    overwriteExisting: boolean = false
): Promise<void> {
    const registry = typeof registryOrOverwrite === 'object' && registryOrOverwrite !== null ? registryOrOverwrite : undefined;
    const overwrite = typeof registryOrOverwrite === 'boolean' ? registryOrOverwrite : overwriteExisting;

    try {
        const [
            themes,
            comfyModels,
            comfyPrompts,
            comfyTxt2imgWorkflows,
            comfyInpaintWorkflows,
            sdModels
        ] = await Promise.all([
            fetchThemes(registry),
            fetchComfyUIModels(registry),
            fetchComfyUIPrompts(registry),
            fetchComfyUITxt2ImgWorkflows(registry),
            fetchComfyUIInpaintWorkflows(registry),
            fetchSDWebUIModels(registry)
        ]);

        const current = store.getState();
        const patch: Partial<DrawAssistantSettings> = {};

        // 1. 外观主题
        if (themes.length > 0 && (overwrite || !current.customThemes || current.customThemes.length <= 1)) {
            patch.customThemes = themes;
            if (!current.themePreset || overwrite) patch.themePreset = themes[0].id;
        }

        // 2. ComfyUI 模型参数方案
        if (comfyModels.length > 0 && (overwrite || !current.comfyModelProfiles || current.comfyModelProfiles.length === 0)) {
            patch.comfyModelProfiles = comfyModels;
            patch.comfyModelProfileId = comfyModels[0].id;
            if (comfyModels[0].data) {
                Object.assign(patch, PRESET_REGISTRY.model.applyToSettings(comfyModels[0].data));
            }
        }

        // 3. ComfyUI 提示词方案
        if (comfyPrompts.length > 0 && (overwrite || !current.comfyPromptProfiles || current.comfyPromptProfiles.length === 0)) {
            patch.comfyPromptProfiles = comfyPrompts;
            patch.comfyPromptProfileId = comfyPrompts[0].id;
            if (comfyPrompts[0].data) {
                Object.assign(patch, PRESET_REGISTRY.prompt.applyToSettings(comfyPrompts[0].data));
            }
        }

        // 4. ComfyUI 文生图工作流
        if (comfyTxt2imgWorkflows.length > 0 && (overwrite || !current.comfyTxt2ImgWorkflows || current.comfyTxt2ImgWorkflows.length === 0 || !current.workflowJson)) {
            patch.comfyTxt2ImgWorkflows = comfyTxt2imgWorkflows;
            patch.comfyTxt2ImgWorkflowId = comfyTxt2imgWorkflows[0].id;
            if (comfyTxt2imgWorkflows[0].data) {
                Object.assign(patch, PRESET_REGISTRY.txt2imgWorkflow.applyToSettings(comfyTxt2imgWorkflows[0].data));
            }
        }

        // 5. ComfyUI 重绘工作流
        if (comfyInpaintWorkflows.length > 0 && (overwrite || !current.comfyInpaintWorkflows || current.comfyInpaintWorkflows.length === 0 || !current.inpaintWorkflowJson)) {
            patch.comfyInpaintWorkflows = comfyInpaintWorkflows;
            patch.comfyInpaintWorkflowId = comfyInpaintWorkflows[0].id;
            if (comfyInpaintWorkflows[0].data) {
                Object.assign(patch, PRESET_REGISTRY.inpaintWorkflow.applyToSettings(comfyInpaintWorkflows[0].data));
            }
        }

        // 6. SD-WebUI 方案
        if (sdModels.length > 0 && (overwrite || !current.sdProfiles || current.sdProfiles.length === 0)) {
            patch.sdProfiles = sdModels;
            patch.sdProfileId = sdModels[0].id;
            if (sdModels[0].data) {
                Object.assign(patch, PRESET_REGISTRY.sdProfile.applyToSettings(sdModels[0].data));
            }
        }

        if (Object.keys(patch).length > 0) {
            store.update(patch);
        }
    } catch {
        // 预设加载失败时保持当前已有配置不变
    }
}
