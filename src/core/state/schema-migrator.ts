/**
 * @module core/state/schema-migrator
 * @description 配置项版本自动校验与数据模型迁移工具 (SchemaMigrator)
 */

import { DrawAssistantSettings, createDefaultSettings } from './store-types';
import { VERSION, TASK_TIMEOUT_LIMITS } from '../constants';

/**
 * 校验并平滑迁移历史设置对象至最新数据模型
 * 保证与 createDefaultSettings() 保持完全一致的单一事实源默认值
 *
 * @param rawSettings 宿主或 LocalStorage 读取出的原始设置对象
 * @returns 迁移补齐后的标准 DrawAssistantSettings 对象
 */
export function migrateSettings(rawSettings: unknown): DrawAssistantSettings {
    const defaults = createDefaultSettings();
    if (!rawSettings || typeof rawSettings !== 'object' || Object.keys(rawSettings).length === 0) {
        return defaults;
    }

    const raw = rawSettings as Record<string, any>;

    // 辅助安全取值函数
    const num = (val: any, fallback: number): number => (typeof val === 'number' && !isNaN(val) ? val : fallback);
    const str = (val: any, fallback: string): string => (typeof val === 'string' ? val : fallback);
    const bool = (val: any, fallback: boolean): boolean => (typeof val === 'boolean' ? val : fallback);
    const arr = <T>(val: any, fallback: T[]): T[] => (Array.isArray(val) ? val : fallback);

    const migrated: DrawAssistantSettings = {
        ...defaults,
        version: VERSION,
        enabled: bool(raw.enabled, defaults.enabled),
        showHelp: bool(raw.showHelp, defaults.showHelp),
        provider: str(raw.provider, defaults.provider),
        requestMode: raw.requestMode === 'server' ? 'server' : 'browser',
        serverUrl: str(raw.serverUrl, defaults.serverUrl),
        apiKey: str(raw.apiKey, defaults.apiKey || ''),

        // 提示词占位符格式设置
        placeholderStart: str(raw.placeholderStart, defaults.placeholderStart),
        placeholderEnd: str(raw.placeholderEnd, defaults.placeholderEnd),

        // 默认生图参数
        width: num(raw.width, defaults.width),
        height: num(raw.height, defaults.height),
        steps: num(raw.steps, defaults.steps),
        cfgScale: num(raw.cfgScale, defaults.cfgScale),
        samplerName: str(raw.samplerName, defaults.samplerName),
        scheduler: str(raw.scheduler, defaults.scheduler),
        promptPrefix: str(raw.promptPrefix, defaults.promptPrefix),
        negativePrefix: str(raw.negativePrefix, defaults.negativePrefix),
        promptSuffix: str(raw.promptSuffix, defaults.promptSuffix || ''),
        cleanExtraSpacesAndLines: bool(raw.cleanExtraSpacesAndLines, defaults.cleanExtraSpacesAndLines ?? true),

        // 局部重绘
        inpaintDenoise: num(raw.inpaintDenoise, defaults.inpaintDenoise ?? 0.75),
        inpaintMaskBlur: num(raw.inpaintMaskBlur, defaults.inpaintMaskBlur ?? 8),
        inpaintGrowMask: num(raw.inpaintGrowMask, defaults.inpaintGrowMask ?? 6),

        // 行为控制
        autoGenerate: bool(raw.autoGenerate, defaults.autoGenerate),
        lightboxEnabled: bool(raw.lightboxEnabled, defaults.lightboxEnabled),
        enableActionPanel: bool(raw.enableActionPanel, defaults.enableActionPanel ?? true),
        hideButtonOnDone: bool(raw.hideButtonOnDone, defaults.hideButtonOnDone ?? false),
        autoCleanupOnChatDelete: bool(raw.autoCleanupOnChatDelete, defaults.autoCleanupOnChatDelete ?? false),
        imageFormat: (['original', 'webp', 'jpeg'].includes(raw.imageFormat) ? raw.imageFormat : defaults.imageFormat) as any,
        imageQuality: num(raw.imageQuality, defaults.imageQuality ?? 0.85),
        maxStoredImages: num(raw.maxStoredImages, defaults.maxStoredImages ?? 500),
        maxConcurrent: num(raw.maxConcurrent, defaults.maxConcurrent),
        taskTimeout: (() => {
            const val = num(raw.taskTimeout ?? raw.requestTimeout, defaults.taskTimeout);
            return val >= TASK_TIMEOUT_LIMITS.MIN_SEC * 1000 && val <= TASK_TIMEOUT_LIMITS.MAX_SEC * 1000
                ? val
                : defaults.taskTimeout;
        })(),

        // 外观与主题
        themePreset: str(raw.themePreset, defaults.themePreset || ''),
        customThemes: arr(raw.customThemes, defaults.customThemes || []),

        // 图像展示
        imageDisplay: raw.imageDisplay && typeof raw.imageDisplay === 'object'
            ? {
                  align: ['left', 'center', 'right'].includes(raw.imageDisplay.align) ? raw.imageDisplay.align : defaults.imageDisplay?.align ?? 'center',
                  objectFit: ['contain', 'cover', 'fill', 'none'].includes(raw.imageDisplay.objectFit) ? raw.imageDisplay.objectFit : defaults.imageDisplay?.objectFit ?? 'contain',
                  maxHeight: num(raw.imageDisplay.maxHeight, defaults.imageDisplay?.maxHeight ?? 600),
                  maxWidthPct: num(raw.imageDisplay.maxWidthPct, defaults.imageDisplay?.maxWidthPct ?? 100),
                  rounded: bool(raw.imageDisplay.rounded, defaults.imageDisplay?.rounded ?? true),
                  collapsed: bool(raw.imageDisplay.collapsed, defaults.imageDisplay?.collapsed ?? false)
              }
            : defaults.imageDisplay,

        // 悬浮球 (FAB)
        fabVisible: bool(raw.fabVisible, bool(raw.fabEnabled, defaults.fabVisible ?? true)),
        fabOpacity: num(raw.fabOpacity, defaults.fabOpacity ?? 0.9),
        fabPresetIcon: str(raw.fabPresetIcon, defaults.fabPresetIcon || ''),
        fabCustomIcon: str(raw.fabCustomIcon, defaults.fabCustomIcon || ''),
        fabPosition: raw.fabPosition && typeof raw.fabPosition === 'object' ? raw.fabPosition : defaults.fabPosition,

        // 扩展与预设状态
        extensions: raw.extensions && typeof raw.extensions === 'object' ? raw.extensions : defaults.extensions || {},

        // ComfyUI Workflow
        workflowJson: str(raw.workflowJson, defaults.workflowJson),
        inpaintWorkflowJson: str(raw.inpaintWorkflowJson, defaults.inpaintWorkflowJson || ''),

        // ComfyUI 缓存列表
        cachedModels: arr(raw.cachedModels, defaults.cachedModels || []),
        cachedClips: arr(raw.cachedClips, defaults.cachedClips || []),
        cachedVaes: arr(raw.cachedVaes, defaults.cachedVaes || []),
        cachedSamplers: arr(raw.cachedSamplers, defaults.cachedSamplers || []),
        cachedSchedulers: arr(raw.cachedSchedulers, defaults.cachedSchedulers || []),
        cachedLoras: arr(raw.cachedLoras, defaults.cachedLoras || []),
        cachedUpscalers: arr(raw.cachedUpscalers, defaults.cachedUpscalers || []),

        // ComfyUI 模型参数方案
        ckptName: str(raw.ckptName, defaults.ckptName || ''),
        clipName: str(raw.clipName, defaults.clipName || ''),
        vaeName: str(raw.vaeName, defaults.vaeName || ''),
        checkpointPositivePrefix: str(raw.checkpointPositivePrefix, defaults.checkpointPositivePrefix || ''),
        checkpointNegativePrefix: str(raw.checkpointNegativePrefix, defaults.checkpointNegativePrefix || ''),
        loras: arr(raw.loras, defaults.loras || []),

        comfyModelProfiles: arr(raw.comfyModelProfiles, defaults.comfyModelProfiles || []),
        comfyModelProfileId: str(raw.comfyModelProfileId, defaults.comfyModelProfileId || ''),
        comfyPromptProfiles: arr(raw.comfyPromptProfiles, defaults.comfyPromptProfiles || []),
        comfyPromptProfileId: str(raw.comfyPromptProfileId, defaults.comfyPromptProfileId || ''),
        comfyTxt2ImgWorkflows: arr(raw.comfyTxt2ImgWorkflows, defaults.comfyTxt2ImgWorkflows || []),
        comfyTxt2ImgWorkflowId: str(raw.comfyTxt2ImgWorkflowId, defaults.comfyTxt2ImgWorkflowId || ''),
        comfyInpaintWorkflows: arr(raw.comfyInpaintWorkflows, defaults.comfyInpaintWorkflows || []),
        comfyInpaintWorkflowId: str(raw.comfyInpaintWorkflowId, defaults.comfyInpaintWorkflowId || ''),

        // SD-WebUI 引擎专属参数
        sdWebUrl: str(raw.sdWebUrl, defaults.sdWebUrl || ''),
        sdModelCheckpoint: str(raw.sdModelCheckpoint, defaults.sdModelCheckpoint || ''),
        sdSamplerName: str(raw.sdSamplerName, defaults.sdSamplerName || 'DPM++ 2M Karras'),
        sdSteps: num(raw.sdSteps, defaults.sdSteps ?? 20),
        sdCfgScale: num(raw.sdCfgScale, defaults.sdCfgScale ?? 7.0),
        sdWidth: num(raw.sdWidth, defaults.sdWidth ?? 512),
        sdHeight: num(raw.sdHeight, defaults.sdHeight ?? 768),
        sdDenoisingStrength: num(raw.sdDenoisingStrength, defaults.sdDenoisingStrength ?? 0.75),
        sdPromptPrefix: str(raw.sdPromptPrefix, defaults.sdPromptPrefix || ''),
        sdNegativePrefix: str(raw.sdNegativePrefix, defaults.sdNegativePrefix || ''),
        sdPromptSuffix: str(raw.sdPromptSuffix, defaults.sdPromptSuffix || ''),
        sdClipSkip: num(raw.sdClipSkip, defaults.sdClipSkip ?? 2),
        sdEnableHires: bool(raw.sdEnableHires, defaults.sdEnableHires ?? true),
        sdHiresUpscaleBy: num(raw.sdHiresUpscaleBy, defaults.sdHiresUpscaleBy ?? 1.5),
        sdHiresUpscaler: str(raw.sdHiresUpscaler, defaults.sdHiresUpscaler || 'R-ESRGAN 4x+ Anime6B'),
        sdHiresSteps: num(raw.sdHiresSteps, defaults.sdHiresSteps ?? 15),
        sdHiresDenoise: num(raw.sdHiresDenoise, defaults.sdHiresDenoise ?? 0.45),
        sdProfiles: arr(raw.sdProfiles, defaults.sdProfiles || []),
        sdProfileId: str(raw.sdProfileId, defaults.sdProfileId || ''),

        // NovelAI 引擎专属参数
        naiUrl: str(raw.naiUrl, defaults.naiUrl || 'https://image.novelai.net'),
        naiApiKey: str(raw.naiApiKey, defaults.naiApiKey || ''),
        naiModel: str(raw.naiModel, defaults.naiModel || 'nai-diffusion-4-full'),
        naiSampler: str(raw.naiSampler, defaults.naiSampler || 'k_euler_ancestral'),
        naiSteps: num(raw.naiSteps, defaults.naiSteps ?? 28),
        naiScale: num(raw.naiScale, defaults.naiScale ?? 6.0),
        naiWidth: num(raw.naiWidth, defaults.naiWidth ?? 832),
        naiHeight: num(raw.naiHeight, defaults.naiHeight ?? 1216),
        naiNegativePrefix: str(raw.naiNegativePrefix, defaults.naiNegativePrefix || ''),
        naiPromptPrefix: str(raw.naiPromptPrefix, defaults.naiPromptPrefix || ''),
        naiPromptSuffix: str(raw.naiPromptSuffix, defaults.naiPromptSuffix || ''),
        naiSmea: bool(raw.naiSmea, defaults.naiSmea ?? true),
        naiSmeaDyn: bool(raw.naiSmeaDyn, defaults.naiSmeaDyn ?? false),
        naiDecrisper: bool(raw.naiDecrisper, defaults.naiDecrisper ?? false),
        naiUncondScale: num(raw.naiUncondScale, defaults.naiUncondScale ?? 1.0),

        // OpenAI / Grok / Banana 图像专属参数
        openaiBaseUrl: str(raw.openaiBaseUrl, defaults.openaiBaseUrl || 'https://api.openai.com/v1'),
        openaiApiKey: str(raw.openaiApiKey, defaults.openaiApiKey || ''),
        openaiModel: str(raw.openaiModel, defaults.openaiModel || 'dall-e-3'),
        openaiSize: str(raw.openaiSize, defaults.openaiSize || '1024x1024'),
        openaiQuality: str(raw.openaiQuality, defaults.openaiQuality || 'standard'),
        openaiStyle: str(raw.openaiStyle, defaults.openaiStyle || 'vivid'),
        openaiPromptPrefix: str(raw.openaiPromptPrefix, defaults.openaiPromptPrefix || '')
    };

    return migrated;
}
