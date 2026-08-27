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
    DEFAULT_TASK_TIMEOUT_MS,
    DEFAULT_MAX_CONCURRENT,
    DEFAULT_IMAGE_RETENTION_DAYS,
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
import { PRESET_SCHEMA_BINDINGS } from '../registry/preset-definitions';
import type { IPresetRegistry } from '../registry/preset-registry';
import { ObservableStore } from './store';

import type { ThemeData } from '../contracts';
export type { ThemeData } from '../contracts';

/** 支持的图像生成后端类型枚举 (与 PROVIDERS 常量表单一事实来源对齐，同时支持扩展第三方驱动) */
export type ImageProvider = (typeof PROVIDERS)[keyof typeof PROVIDERS] | (string & {});

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

/** SD-WebUI 参数方案数据结构 */
export interface SDProfileData {
    sdModelCheckpoint?: string;
    sdSamplerName?: string;
    sdSteps?: number;
    sdCfgScale?: number;
    sdWidth?: number;
    sdHeight?: number;
    sdClipSkip?: number;
    sdDenoisingStrength?: number;
    sdEnableHires?: boolean;
    sdHiresUpscaler?: string;
    sdHiresUpscaleBy?: number;
    sdHiresSteps?: number;
    sdHiresDenoise?: number;
    sdPromptPrefix?: string;
    sdNegativePrefix?: string;
    sdPromptSuffix?: string;
    loras?: LoraItem[];
}

/** LoRA 触发词与权重项 */
export interface LoraItem {
    name: string;
    weight?: number;
    clipWeight?: number;
    textWeight?: number;
    triggerWeight?: number;
    triggerWords?: string;
    enabled?: boolean;
}

/** 图像展示样式配置 */
export interface ImageDisplayConfig {
    align: 'left' | 'center' | 'right';
    objectFit: 'contain' | 'cover' | 'fill' | 'none';
    maxHeight: number;
    maxWidthPct: number;
    rounded: boolean;
    collapsed?: boolean;
}

/** 扩展功能状态 */
export interface ExtensionState {
    enabled: boolean;
    config?: Record<string, any>;
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
    /** ComfyUI 后端服务地址 (默认 http://127.0.0.1:8188) */
    serverUrl: string;
    /** ComfyUI API Key (若服务配置了反代鉴权) */
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
    enableActionPanel?: boolean;
    hideButtonOnDone?: boolean;
    autoCleanupOnChatDelete?: boolean;
    imageRetentionDays?: number;
    imageFormat?: 'original' | 'webp' | 'jpeg';
    imageQuality?: number;
    maxStoredImages?: number;
    maxConcurrent: number;
    taskTimeout: number;
    themePreset?: string;
    customThemes?: PresetProfileItem<ThemeData>[];

    imageDisplay?: ImageDisplayConfig;

    fabVisible?: boolean;
    fabOpacity?: number;
    fabPresetIcon?: string;
    fabCustomIcon?: string;
    fabPosition?: { x?: number; y?: number; top?: number; left?: number } | null;

    extensions?: Record<string, ExtensionState>;

    workflowJson: string;
    inpaintWorkflowJson?: string;

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
    sdProfiles?: PresetProfileItem<SDProfileData>[];
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
}

/**
 * 创建基准出厂默认设置对象 (同步默认值初始化，保障离线冷启动可用)
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
        enableActionPanel: true,
        hideButtonOnDone: false,
        imageFormat: 'original',
        imageQuality: 0.85,
        maxStoredImages: 500,
        maxConcurrent: DEFAULT_MAX_CONCURRENT,
        taskTimeout: DEFAULT_TASK_TIMEOUT_MS,
        themePreset: 'luminous-obsidian',
        customThemes: fallbackThemeList,
        fabVisible: true,
        fabOpacity: 0.9,
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
            rounded: IMAGE_DISPLAY_DEFAULTS.ROUNDED,
            collapsed: IMAGE_DISPLAY_DEFAULTS.COLLAPSED
        },
        autoCleanupOnChatDelete: false,
        imageRetentionDays: DEFAULT_IMAGE_RETENTION_DAYS,

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

        // OpenAI / Grok 图像专属默认参数
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: '',
        openaiModel: 'dall-e-3',
        openaiSize: '1024x1024',
        openaiQuality: 'standard',
        openaiStyle: 'vivid'
    };
}

/**
 * 异步加载静态预设并初始化插件配置
 *
 * @param store 目标响应式配置 Store 实例
 * @param registryOrOverwrite 预设注册中心实例（可选）或是否覆盖现有配置的布尔标志
 * @param overwriteExisting 是否覆盖现有配置（全量重置为默认值时为 true）
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

        // 1. 外观主题 (若无预设文件则以 DEFAULT_THEME_DATA 作为默认回退)
        const safeThemes: PresetProfileItem<ThemeData>[] = themes.length > 0
            ? themes
            : [{ id: 'luminous-obsidian', name: '流光黑曜', data: { ...DEFAULT_THEME_DATA } }];

        if (overwrite || !current.customThemes || current.customThemes.length === 0) {
            patch.customThemes = safeThemes;
            if (!current.themePreset || overwrite || !safeThemes.some(t => t.id === current.themePreset)) {
                patch.themePreset = safeThemes[0].id;
            }
        }

        // 2. ComfyUI 模型参数方案 (零假设：允许为空数组)
        if (overwrite || !current.comfyModelProfiles) {
            patch.comfyModelProfiles = comfyModels;
            patch.comfyModelProfileId = comfyModels[0]?.id || '';
            if (comfyModels[0]?.data) {
                Object.assign(patch, PRESET_SCHEMA_BINDINGS.model.applyToSettings(comfyModels[0].data));
            }
        }

        // 3. ComfyUI 提示词方案 (零假设：允许为空数组)
        if (overwrite || !current.comfyPromptProfiles) {
            patch.comfyPromptProfiles = comfyPrompts;
            patch.comfyPromptProfileId = comfyPrompts[0]?.id || '';
            if (comfyPrompts[0]?.data) {
                Object.assign(patch, PRESET_SCHEMA_BINDINGS.prompt.applyToSettings(comfyPrompts[0].data));
            }
        }

        // 4. ComfyUI 文生图工作流 (零假设：允许为空数组)
        if (overwrite || !current.comfyTxt2ImgWorkflows) {
            patch.comfyTxt2ImgWorkflows = comfyTxt2imgWorkflows;
            patch.comfyTxt2ImgWorkflowId = comfyTxt2imgWorkflows[0]?.id || '';
            if (comfyTxt2imgWorkflows[0]?.data) {
                Object.assign(patch, PRESET_SCHEMA_BINDINGS.txt2imgWorkflow.applyToSettings(comfyTxt2imgWorkflows[0].data));
            }
        }

        // 5. ComfyUI 重绘工作流 (零假设：允许为空数组)
        if (overwrite || !current.comfyInpaintWorkflows) {
            patch.comfyInpaintWorkflows = comfyInpaintWorkflows;
            patch.comfyInpaintWorkflowId = comfyInpaintWorkflows[0]?.id || '';
            if (comfyInpaintWorkflows[0]?.data) {
                Object.assign(patch, PRESET_SCHEMA_BINDINGS.inpaintWorkflow.applyToSettings(comfyInpaintWorkflows[0].data));
            }
        }

        // 6. SD-WebUI 方案 (零假设：允许为空数组)
        if (overwrite || !current.sdProfiles) {
            patch.sdProfiles = sdModels;
            patch.sdProfileId = sdModels[0]?.id || '';
            if (sdModels[0]?.data) {
                Object.assign(patch, PRESET_SCHEMA_BINDINGS.sdProfile.applyToSettings(sdModels[0].data));
            }
        }

        if (Object.keys(patch).length > 0) {
            store.update(patch);
        }
    } catch {
        // 预设加载失败时保持当前已有配置不变
    }
}
