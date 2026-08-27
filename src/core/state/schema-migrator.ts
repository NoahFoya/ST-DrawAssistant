/**
 * @module core/state/schema-migrator
 * @description 配置项版本自动校验与数据模型迁移工具 (SchemaMigrator)
 */

import { DrawAssistantSettings } from './store-types';
import {
    VERSION,
    DEFAULT_COMFYUI_URL,
    DEFAULT_PLACEHOLDER_START,
    DEFAULT_PLACEHOLDER_END
} from '../constants';

/**
 * 校验并平滑迁移历史设置对象至最新数据模型
 *
 * @param rawSettings 宿主或 LocalStorage 读取出的原始设置对象
 * @returns 迁移补齐后的标准 DrawAssistantSettings 对象
 */
export function migrateSettings(rawSettings: any): DrawAssistantSettings {
    const raw = (rawSettings && typeof rawSettings === 'object') ? rawSettings : {};

    // 基础配置默认值
    const migrated: DrawAssistantSettings = {
        version: VERSION,
        enabled: raw.enabled ?? true,
        showHelp: raw.showHelp ?? true,
        autoCleanupOnChatDelete: raw.autoCleanupOnChatDelete ?? false,
        logLevel: raw.logLevel || 'INFO',
        provider: raw.provider || 'comfyui',
        requestMode: raw.requestMode || 'browser',
        serverUrl: raw.serverUrl || DEFAULT_COMFYUI_URL,
        apiKey: raw.apiKey || '',

        // 占位符
        placeholderStart: raw.placeholderStart || DEFAULT_PLACEHOLDER_START,
        placeholderEnd: raw.placeholderEnd || DEFAULT_PLACEHOLDER_END,

        // 默认生图参数
        width: typeof raw.width === 'number' ? raw.width : 512,
        height: typeof raw.height === 'number' ? raw.height : 768,
        steps: typeof raw.steps === 'number' ? raw.steps : 20,
        cfgScale: typeof raw.cfgScale === 'number' ? raw.cfgScale : 7.0,
        samplerName: raw.samplerName || 'Euler a',
        scheduler: raw.scheduler || 'normal',
        promptPrefix: raw.promptPrefix ?? 'masterpiece, best quality, ultra-detailed',
        negativePrefix: raw.negativePrefix ?? 'bad anatomy, bad hands, missing fingers, low quality, worst quality',
        cleanExtraSpacesAndLines: raw.cleanExtraSpacesAndLines ?? true,

        // 局部重绘
        inpaintDenoise: typeof raw.inpaintDenoise === 'number' ? raw.inpaintDenoise : 0.75,
        inpaintMaskBlur: typeof raw.inpaintMaskBlur === 'number' ? raw.inpaintMaskBlur : 8,
        inpaintGrowMask: typeof raw.inpaintGrowMask === 'number' ? raw.inpaintGrowMask : 6,

        // 行为控制
        autoGenerate: raw.autoGenerate ?? false,
        lightboxEnabled: raw.lightboxEnabled ?? true,
        persistToChat: raw.persistToChat ?? true,
        extraSaveToChat: raw.extraSaveToChat ?? false,
        enableActionPanel: raw.enableActionPanel ?? true,
        imageFormat: raw.imageFormat || 'original',
        imageQuality: typeof raw.imageQuality === 'number' ? raw.imageQuality : 0.9,
        maxConcurrent: typeof raw.maxConcurrent === 'number' ? raw.maxConcurrent : 1,
        requestTimeout: typeof raw.requestTimeout === 'number' ? raw.requestTimeout : 180000,

        // 图像显示
        imageDisplay: raw.imageDisplay || {
            align: 'center',
            objectFit: 'contain',
            maxHeight: 0,
            maxWidthPct: 100,
            rounded: true
        },

        // 悬浮球 (FAB)
        fabVisible: raw.fabVisible ?? true,
        fabOpacity: typeof raw.fabOpacity === 'number' ? raw.fabOpacity : 0.9,
        fabIcon: raw.fabIcon || '🎨',
        fabCustomIcon: raw.fabCustomIcon || '',
        fabPosition: raw.fabPosition || null,

        // 扩展与预设
        extensions: raw.extensions || {},
        customThemes: Array.isArray(raw.customThemes) ? raw.customThemes : [],
        themePreset: raw.themePreset || '',

        // ComfyUI Workflow 与预设
        workflowJson: raw.workflowJson || '',
        inpaintWorkflowJson: raw.inpaintWorkflowJson || '',
        workflowInjection: raw.workflowInjection || {
            positiveNodeId: '113',
            positiveField: 'text',
            negativeNodeId: '12',
            negativeField: 'text',
            widthNodeId: '119',
            widthField: 'value',
            heightNodeId: '118',
            heightField: 'value',
            kSamplerNodeId: '63',
            saveImageNodeId: '99'
        },

        // ComfyUI 缓存列表
        cachedModels: Array.isArray(raw.cachedModels) ? raw.cachedModels : [],
        cachedClips: Array.isArray(raw.cachedClips) ? raw.cachedClips : [],
        cachedVaes: Array.isArray(raw.cachedVaes) ? raw.cachedVaes : [],
        cachedSamplers: Array.isArray(raw.cachedSamplers) ? raw.cachedSamplers : [],
        cachedSchedulers: Array.isArray(raw.cachedSchedulers) ? raw.cachedSchedulers : [],
        cachedLoras: Array.isArray(raw.cachedLoras) ? raw.cachedLoras : [],

        // 方案与模型预设
        comfyModelProfileId: raw.comfyModelProfileId || '',
        comfyPromptProfileId: raw.comfyPromptProfileId || '',
        comfyTxt2ImgWorkflowId: raw.comfyTxt2ImgWorkflowId || '',
        comfyInpaintWorkflowId: raw.comfyInpaintWorkflowId || '',
        ckptName: raw.ckptName || '',
        clipName: raw.clipName || '',
        vaeName: raw.vaeName || '',
        checkpointPositivePrefix: raw.checkpointPositivePrefix || '',
        checkpointNegativePrefix: raw.checkpointNegativePrefix || '',
        promptSuffix: raw.promptSuffix || '',
        loras: Array.isArray(raw.loras) ? raw.loras : [],

        comfyModelProfiles: Array.isArray(raw.comfyModelProfiles) ? raw.comfyModelProfiles : [],
        comfyPromptProfiles: Array.isArray(raw.comfyPromptProfiles) ? raw.comfyPromptProfiles : [],
        comfyTxt2ImgWorkflows: Array.isArray(raw.comfyTxt2ImgWorkflows) ? raw.comfyTxt2ImgWorkflows : [],
        comfyInpaintWorkflows: Array.isArray(raw.comfyInpaintWorkflows) ? raw.comfyInpaintWorkflows : []
    };

    return migrated;
}
