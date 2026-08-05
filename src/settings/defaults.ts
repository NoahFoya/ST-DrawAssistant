/**
 * @module settings/defaults
 * @description 设置默认值与预设模板注册表
 *
 * 职责：
 * - 定义全量扩展设置项的默认值
 * - 提供默认内置的 Wai 工作流 JSON 模版与通用预设方案
 *
 * 规范参考：
 * - .agents/Skills/sillytavern-extension-host/SKILL.md §7 (扩展设置默认结构)
 *
 * 核心原则：
 * 1. 消除任何死编码文件名引入，使用 require.context 按文件夹路径通配扫描
 * 2. 默认主题与预设由扫描得到的第一个配置文件动态决定
 */

import type {
    DrawAssistantSettings,
    WorkflowInjectionConfig,
    PresetProfileItem,
    ModelProfileData,
    PromptProfileData,
    WorkflowProfileData,
    GlobalProfileData,
    CustomThemeScheme
} from './types';

import { logger } from '../core/logger';

import waiTxt2ImgWorkflow from '../presets/workflows/wai-txt2img.json';
import waiInpaintWorkflow from '../presets/workflows/wai-inpaint.json';

/**
 * 辅助函数：通配符扫描目标文件夹路径下的所有符合规则的 JSON 配置文件
 * 核心解耦原则：插件不硬编码任何具体文件名，只按文件夹路径动态装载
 */
function loadPresetsFromDirectory<T>(context: WebpackContext): T[] {
    try {
        return context.keys().map(key => context<T>(key));
    } catch (err) {
        logger.error('动态扫描预设文件夹失败', err);
        return [];
    }
}

// 动态装载各个 presets 目标文件夹路径（100% 动态，零文件名硬编码）
const themeContext = require.context('../presets/themes', false, /\.json$/);
const modelContext = require.context('../presets/models', false, /\.json$/);
const promptContext = require.context('../presets/prompts', false, /\.json$/);
const globalContext = require.context('../presets/global', false, /\.json$/);

export const DEFAULT_THEME_PROFILES: CustomThemeScheme[] = loadPresetsFromDirectory<CustomThemeScheme>(themeContext);

export const DEFAULT_GLOBAL_PROFILES: PresetProfileItem<GlobalProfileData>[] = loadPresetsFromDirectory<PresetProfileItem<GlobalProfileData>>(globalContext);

export const DEFAULT_MODEL_PROFILES: PresetProfileItem<ModelProfileData>[] = loadPresetsFromDirectory<PresetProfileItem<ModelProfileData>>(modelContext);

export const DEFAULT_PROMPT_PROFILES: PresetProfileItem<PromptProfileData>[] = loadPresetsFromDirectory<PresetProfileItem<PromptProfileData>>(promptContext);

export const DEFAULT_WAI_WORKFLOW_JSON = JSON.stringify(waiTxt2ImgWorkflow, null, 2);

export const DEFAULT_WORKFLOW_PROFILES: PresetProfileItem<WorkflowProfileData>[] = [
    {
        id: 'wai_txt2img_default',
        name: 'Wai 官方标准文生图工作流',
        data: {
            json: JSON.stringify(waiTxt2ImgWorkflow, null, 2),
        },
    },
    {
        id: 'wai_inpaint_default',
        name: 'Wai 官方标准局部重绘工作流',
        data: {
            json: JSON.stringify(waiInpaintWorkflow, null, 2),
        },
    },
];

const DEFAULT_WORKFLOW_INJECTION = {
    positiveNodeId: '113',
    positiveField: 'positive',
    negativeNodeId: '12',
    negativeField: 'text',
    widthNodeId: '119',
    widthField: 'value',
    heightNodeId: '118',
    heightField: 'value',
    kSamplerNodeId: '63',
    saveImageNodeId: '99',
} satisfies WorkflowInjectionConfig;

export const DEFAULT_SETTINGS: DrawAssistantSettings = {
    // 全局开关与模式配置
    enabled: true,
    showHelp: true,
    logLevel: 'WARN',

    // 后端配置
    provider: 'comfyui',
    requestMode: 'browser',
    serverUrl: 'http://127.0.0.1:8188',
    apiKey: '',

    // Workflow 工作流配置与节点注入映射
    workflowJson: DEFAULT_WAI_WORKFLOW_JSON,
    inpaintWorkflowJson: JSON.stringify(waiInpaintWorkflow, null, 2),
    workflowInjection: { ...DEFAULT_WORKFLOW_INJECTION },

    // 占位符配置
    placeholderStart: 'image###',
    placeholderEnd: '###',

    // 基础图像生成参数默认值
    ckptName: 'waiIllustriousSDXL_v170.safetensors',
    clipName: '',
    vaeName: '',
    width: 1024,
    height: 1344,
    steps: 18,
    cfgScale: 6,
    samplerName: 'euler_ancestral',
    scheduler: 'normal',

    // 提示词配置
    promptPrefix: '',
    negativePrefix: 'score_1, score_2, score_3, bad anatomy, bad proportions, deformed anatomy, deformed face, deformed eyes, text, multiple fingers, watermark, artist name',

    // 行为配置
    autoGenerate: false,
    lightboxEnabled: true,
    persistToChat: true,
    extraSaveToChat: false,
    imageFormat: 'original',
    imageQuality: 0.85,
    maxConcurrent: 1,
    requestTimeout: 120000,

    // 主题完全解耦：默认主题为动态扫描得到的第一个主题方案 ID
    themePreset: DEFAULT_THEME_PROFILES[0]?.id || '',
    customThemes: [...DEFAULT_THEME_PROFILES],

    // 悬浮窗默认值
    fabVisible: true,
    fabOpacity: 0.9,
    fabIcon: 'palette',
    fabPosition: null,

    // ComfyUI 预设默认值与内置初始化方案
    globalProfileId: DEFAULT_GLOBAL_PROFILES[0]?.id || 'wai_global_default',
    globalProfiles: [...DEFAULT_GLOBAL_PROFILES],
    comfyModelProfileId: DEFAULT_MODEL_PROFILES[0]?.id || 'wai_sdxl_default',
    comfyPromptProfileId: DEFAULT_PROMPT_PROFILES[0]?.id || 'wai_illustrious_prompt',
    comfyTxt2ImgWorkflowId: 'wai_txt2img_default',
    comfyInpaintWorkflowId: 'wai_inpaint_default',
    checkpointPositivePrefix: '',
    checkpointNegativePrefix: '',
    promptSuffix: '',
    comfyModelProfiles: [...DEFAULT_MODEL_PROFILES],
    comfyPromptProfiles: [...DEFAULT_PROMPT_PROFILES],
    comfyWorkflows: [...DEFAULT_WORKFLOW_PROFILES],
};
