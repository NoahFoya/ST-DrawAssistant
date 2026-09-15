/**
 * 引擎生图请求参数构建器
 *
 * 功能：
 * 1. 统一处理从当前活跃绘图预设到各引擎原生强类型请求数据的转换；
 * 2. 为四大引擎 (ComfyUI, SD-WebUI, NovelAI, OpenAI) 分别构建专属原生请求对象；
 * 3. 保证各引擎请求数据强类型约束与参数完整性。
 *
 * Tips：
 * 1. 协议边界：严格按照各后端引擎的协议字段构建，未配置字段自动回退至缺省超参数；
 * 2. 尺寸整除：对于 NovelAI 等特殊后端，尺寸需在构建阶段由外部或缺省值保证 64 像素对齐。
 */

import type {
    EngineType,
    EngineGenerationTaskParams,
    SdWebUIRequestData,
    ComfyUITaskData,
    NovelAIRequestData,
    OpenAIRequestData,
    TransportMode,
    PresetItem
} from '@types';
import type { SettingsStore } from '@store/settings';
import { BUILTIN_WORKFLOWS } from '@store/preset';

export interface BuildEngineParamsOptions {
    engine: EngineType;
    prompt: string;
    negativePrompt?: string;
    settingsStore: SettingsStore;
    transport?: TransportMode;
}

/**
 * SD-WebUI 默认绘图超参数
 */
export const DEFAULT_SD_PARAMS = {
    samplerName: 'Euler a',
    scheduler: 'Automatic',
    steps: 20,
    cfgScale: 7.0,
    width: 512,
    height: 768,
    clipSkip: 2
};

/**
 * ComfyUI 默认绘图超参数
 */
export const DEFAULT_COMFY_PARAMS = {
    samplerName: 'euler_ancestral',
    scheduler: 'normal',
    steps: 20,
    cfgScale: 6.0,
    width: 832,
    height: 1216
};

/**
 * NovelAI 默认绘图超参数
 */
export const DEFAULT_NOVELAI_PARAMS = {
    model: 'nai-diffusion-4-5-full',
    sampler: 'k_euler',
    steps: 28,
    scale: 5.0,
    width: 832,
    height: 1216,
    ucPreset: 0,
    qualityToggle: true
};

/**
 * OpenAI 默认绘图参数
 */
export const DEFAULT_OPENAI_PARAMS = {
    model: 'dall-e-3',
    size: '1024x1024',
    quality: 'standard' as const,
    style: 'vivid' as const
};

/**
 * 从设置中心读取指定引擎当前激活的绘图方案配置对象
 */
function resolveActiveDrawingData(settingsStore: SettingsStore, engine: EngineType): Record<string, any> {
    const enginesConfig = settingsStore.get('engines') || {};
    const curEngineConfig = enginesConfig[engine] || {};
    const activeProfileId = curEngineConfig.activeDrawingProfileId;

    const presets = settingsStore.get('presets');
    const enginePresets: PresetItem[] = (presets?.drawing?.[engine] || []) as PresetItem[];

    let activeProfile = enginePresets.find(p => p.id === activeProfileId);
    if (!activeProfile && enginePresets.length > 0) {
        activeProfile = enginePresets[0];
    }

    return (activeProfile?.data as Record<string, any>) || {};
}

/**
 * 构建 SD-WebUI 原生请求参数
 */
export function buildSdWebUIParams(
    prompt: string,
    negativePrompt: string | undefined,
    settingsStore: SettingsStore,
    transport?: TransportMode
): SdWebUIRequestData {
    const data = resolveActiveDrawingData(settingsStore, 'sdwebui');

    const width = Number(data.width) || DEFAULT_SD_PARAMS.width;
    const height = Number(data.height) || DEFAULT_SD_PARAMS.height;
    const steps = Number(data.steps) || DEFAULT_SD_PARAMS.steps;
    const cfgScale = Number(data.cfgScale) || DEFAULT_SD_PARAMS.cfgScale;
    const samplerName = String(data.samplerName || data.sampler || DEFAULT_SD_PARAMS.samplerName);
    const scheduler = data.scheduler ? String(data.scheduler) : undefined;
    const seed = typeof data.seed === 'number' && data.seed >= 0 ? data.seed : -1;

    const overrideSettings: Record<string, unknown> = {};
    if (data.model) {
        overrideSettings.sd_model_checkpoint = data.model;
    }
    if (data.vae) {
        overrideSettings.sd_vae = data.vae;
    }
    if (typeof data.clipSkip === 'number' && data.clipSkip > 0) {
        overrideSettings.CLIP_stop_at_last_layers = data.clipSkip;
    }

    return {
        engine: 'sdwebui',
        prompt,
        negative_prompt: negativePrompt || '',
        width,
        height,
        seed,
        steps,
        cfg_scale: cfgScale,
        sampler_name: samplerName,
        scheduler,
        override_settings: Object.keys(overrideSettings).length > 0 ? overrideSettings : undefined,
        override_settings_restore_afterwards: true,
        transport
    };
}

/**
 * 构建 ComfyUI 原生任务参数
 */
export function buildComfyUITaskParams(
    prompt: string,
    negativePrompt: string | undefined,
    settingsStore: SettingsStore,
    transport?: TransportMode
): ComfyUITaskData {
    const data = resolveActiveDrawingData(settingsStore, 'comfyui');

    const width = Number(data.width) || DEFAULT_COMFY_PARAMS.width;
    const height = Number(data.height) || DEFAULT_COMFY_PARAMS.height;
    const steps = Number(data.steps) || DEFAULT_COMFY_PARAMS.steps;
    const cfg = Number(data.cfgScale) || DEFAULT_COMFY_PARAMS.cfgScale;
    const samplerName = String(data.samplerName || data.sampler || DEFAULT_COMFY_PARAMS.samplerName);
    const scheduler = String(data.scheduler || DEFAULT_COMFY_PARAMS.scheduler);
    const seed = typeof data.seed === 'number' && data.seed > 0 ? data.seed : -1;

    // 解析关联工作流
    const presets = settingsStore.get('presets');
    const customWorkflows: PresetItem<{ json: string }>[] = (presets?.workflows || []) as PresetItem<{ json: string }>[];
    const allWorkflows = [...BUILTIN_WORKFLOWS, ...customWorkflows];

    const targetWfId = data.txt2imgWorkflowId || settingsStore.get('engines')?.comfyui?.activeWorkflowProfileId || 'comfyui_checkpoint_standard';
    const targetItem = allWorkflows.find(w => w.id === targetWfId) || BUILTIN_WORKFLOWS[0];

    let workflowGraph: Record<string, any> = {};
    try {
        if (targetItem?.data?.json) {
            workflowGraph = JSON.parse(targetItem.data.json);
        }
    } catch {
        workflowGraph = {};
    }

    return {
        engine: 'comfyui',
        prompt,
        negativePrompt,
        workflow: workflowGraph,
        variables: {
            seed,
            width,
            height,
            steps,
            cfg,
            sampler_name: samplerName,
            scheduler,
            model_name: data.model ? String(data.model) : undefined
        },
        transport
    };
}

/**
 * 构建 NovelAI 原生请求参数
 */
export function buildNovelAIParams(
    prompt: string,
    negativePrompt: string | undefined,
    settingsStore: SettingsStore,
    transport?: TransportMode
): NovelAIRequestData {
    const data = resolveActiveDrawingData(settingsStore, 'novelai');

    const rawWidth = Number(data.width) || DEFAULT_NOVELAI_PARAMS.width;
    const rawHeight = Number(data.height) || DEFAULT_NOVELAI_PARAMS.height;

    // 严格确保尺寸为 64 的整数倍
    const width = Math.max(64, Math.round(rawWidth / 64) * 64);
    const height = Math.max(64, Math.round(rawHeight / 64) * 64);

    const steps = Number(data.steps) || DEFAULT_NOVELAI_PARAMS.steps;
    const scale = Number(data.scale || data.cfgScale) || DEFAULT_NOVELAI_PARAMS.scale;
    const sampler = String(data.sampler || DEFAULT_NOVELAI_PARAMS.sampler);
    const model = String(data.model || DEFAULT_NOVELAI_PARAMS.model);
    const seed = typeof data.seed === 'number' && data.seed > 0 ? data.seed : Math.floor(Math.random() * 1000000000);
    const uc = negativePrompt || '';

    return {
        engine: 'novelai',
        prompt,
        negativePrompt,
        input: prompt,
        model,
        action: 'generate',
        parameters: {
            width,
            height,
            scale,
            sampler,
            steps,
            seed,
            n_samples: 1,
            ucPreset: typeof data.ucPreset === 'number' ? data.ucPreset : 0,
            qualityToggle: data.qualityToggle !== false,
            uc,
            negative_prompt: uc,
            cfg_rescale: typeof data.cfgRescale === 'number' ? data.cfgRescale : undefined
        },
        transport
    };
}

/**
 * 构建 OpenAI 兼容原生请求参数
 * 彻底剔除 steps, cfgScale, sampler 等无关冗余字段
 */
export function buildOpenAIParams(
    prompt: string,
    _negativePrompt: string | undefined,
    settingsStore: SettingsStore,
    transport?: TransportMode
): OpenAIRequestData {
    const data = resolveActiveDrawingData(settingsStore, 'openai');

    const model = String(data.model || DEFAULT_OPENAI_PARAMS.model);
    const rawWidth = Number(data.width) || 1024;
    const rawHeight = Number(data.height) || 1024;
    const size = `${rawWidth}x${rawHeight}`;

    const quality = (data.quality === 'hd' ? 'hd' : 'standard') as 'standard' | 'hd';
    const style = (data.style === 'natural' ? 'natural' : 'vivid') as 'vivid' | 'natural';

    let customBody: Record<string, unknown> | undefined;
    if (data.customBodyJson && typeof data.customBodyJson === 'string') {
        try {
            const parsed = JSON.parse(data.customBodyJson);
            if (typeof parsed === 'object' && parsed !== null) {
                customBody = parsed;
            }
        } catch {
            // 解析失败不附加自定义请求体
        }
    }

    return {
        engine: 'openai',
        prompt,
        model,
        size,
        response_format: 'b64_json',
        n: 1,
        quality,
        style,
        ...(customBody || {}),
        transport
    };
}

/**
 * 统一工厂函数：依据目标引擎构建强类型原生参数
 */
export function buildEngineParams(options: BuildEngineParamsOptions): EngineGenerationTaskParams {
    const { engine, prompt, negativePrompt, settingsStore, transport } = options;

    switch (engine) {
        case 'sdwebui':
            return buildSdWebUIParams(prompt, negativePrompt, settingsStore, transport);
        case 'comfyui':
            return buildComfyUITaskParams(prompt, negativePrompt, settingsStore, transport);
        case 'novelai':
            return buildNovelAIParams(prompt, negativePrompt, settingsStore, transport);
        case 'openai':
            return buildOpenAIParams(prompt, negativePrompt, settingsStore, transport);
        default:
            throw new Error(`不支持的生图引擎类型: ${engine}`);
    }
}
