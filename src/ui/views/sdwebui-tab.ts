/**
 * SD-WebUI / Forge 引擎专属配置面板 (SDWebUITab)
 *
 * 功能：
 * 1. 管理 SD-WebUI / Forge 服务连接配置、可用性探测与服务端资产同步；
 * 2. 提供绘图方案预设切换、采样超参数配置、画面尺寸选择与高清修复 (Hires.fix)；
 * 3. 集成提示词预设管理器，支持正反向模板组装与 LoRA 列表维护；
 * 4. 追踪表单脏状态变更，支持配置一键复原与保存状态提示。
 *
 * Tips：
 * 1. 资产同步依赖服务端 CORS 跨域配置，连接受阻时提供友好排查指引；
 * 2. 高清修复开启时联动重绘幅度与放大倍数，避免显存不足导致生成失败。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard, FormFieldHandle } from '../components/form-field';
import { createSelect } from '../components/select';
import { createSlider, SliderHandle } from '../components/slider';
import { createToggle, ToggleHandle } from '../components/toggle';
import { createConnectionCard, ConnectionCardHandle } from '../composite/connection-card';
import { createDimensionPicker, DimensionPickerHandle } from '../composite/dimension-picker';
import { createSamplerCard, SamplerCardHandle } from '../composite/sampler-card';
import { createPromptPresetManager, PromptPresetManagerHandle, PromptPresetData } from '../composite/prompt-preset-manager';
import { createPresetToolbar, PresetToolbarHandle } from '../composite/preset-toolbar';
import { createDirtyTracker, IDirtyTracker } from '../components/dirty-tracker';
import { getIconSvg } from '../components/icons';
import { PresetManager, BUILTIN_PROMPTS } from '../../store/preset';
import { getAdapter } from '../../function/adapter/registry';
import type { SettingsStore } from '../../store/settings';
import type { PresetItem } from '@types';

export interface SDWebUITabOptions {
    presetManager?: PresetManager;
}

export interface SDWebUITabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

interface SDWebUIDrawingParams extends Record<string, any> {
    model: string;
    vae: string;
    clipSkip: number;
    width: number;
    height: number;
    sampler: string;
    scheduler: string;
    steps: number;
    cfgScale: number;
    seed: number;
    restoreFaces: boolean;
    denoisingStrength: number;
    hiresEnabled: boolean;
    hiresUpscaler: string;
    hiresUpscaleBy: number;
    hiresSteps: number;
    hiresDenoising: number;
    promptProfileId: string;
}

const DEFAULT_SD_DRAWING: SDWebUIDrawingParams = {
    model: 'animeRealistic_v20.safetensors',
    vae: 'automatic',
    clipSkip: 2,
    width: 512,
    height: 768,
    sampler: 'DPM++ 2M Karras',
    scheduler: 'Karras',
    steps: 28,
    cfgScale: 7.0,
    seed: -1,
    restoreFaces: false,
    denoisingStrength: 0.7,
    hiresEnabled: true,
    hiresUpscaler: 'R-ESRGAN 4x+ Anime6B',
    hiresUpscaleBy: 1.5,
    hiresSteps: 15,
    hiresDenoising: 0.45,
    promptProfileId: 'prompt_anime_general'
};

export function renderSDWebUITab(
    settingsStore: SettingsStore,
    options: SDWebUITabOptions = {}
): SDWebUITabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    const presetManager = options.presetManager || new PresetManager(settingsStore);
    const engines = settingsStore.get('engines') || {};
    const sdConfig = engines.sdwebui || {
        serverUrl: 'http://127.0.0.1:7860',
        activeDrawingProfileId: 'default_sd15',
        activePromptProfileId: 'prompt_anime_general'
    };

    // 1. ConnectionCard (服务连接与资产拉取更新)
    const connectionCard: ConnectionCardHandle = createConnectionCard({
        engineName: 'SD-WebUI / Forge',
        baseUrl: sdConfig.serverUrl || 'http://127.0.0.1:7860',
        editableUrl: true,
        onChangeBaseUrl: (newUrl) => {
            const currentEngines = settingsStore.get('engines') || {};
            const curSd = currentEngines.sdwebui || {};
            settingsStore.update({
                engines: {
                    ...currentEngines,
                    sdwebui: { ...curSd, serverUrl: newUrl }
                }
            });
        },
        onCheckHealth: async (signal?: AbortSignal) => {
            const adapter = getAdapter('sdwebui');
            adapter.setBaseUrl?.(connectionCard.getBaseUrl());
            if (adapter.fetchAssets) {
                return await adapter.fetchAssets(signal);
            }
            return await adapter.checkHealth(signal);
        },
        onAssetUpdate: (assets) => {
            if (Array.isArray(assets.models) && assets.models.length > 0) {
                baseModelSelect.setOptions(assets.models.map((m: string) => ({ label: m, value: m })));
            }
            if (Array.isArray(assets.vaes) && assets.vaes.length > 0) {
                vaeSelect.setOptions([
                    { label: '自动探测', value: 'automatic' },
                    ...assets.vaes.map((v: string) => ({ label: v, value: v }))
                ]);
            }
            if (Array.isArray(assets.upscalers) && assets.upscalers.length > 0) {
                hiresUpscalerSelect.setOptions(assets.upscalers.map((u: string) => ({ label: u, value: u })));
            }
            if (Array.isArray(assets.samplers) && assets.samplers.length > 0) {
                samplerCard.setSamplers(assets.samplers as string[]);
            }
            if (Array.isArray(assets.loras) && assets.loras.length > 0) {
                promptPresetManager.setAvailableLoras(assets.loras as string[]);
            }
        }
    });
    regDisposer(connectionCard);
    root.appendChild(connectionCard.element);

    // 2. 绘图参数预设 (Drawing Preset Card)
    const drawingCard = createCard({
        title: '绘图参数预设',
        iconSvg: getIconSvg('palette'),
        collapsible: true
    });
    regDisposer(drawingCard);

    let drawingPresets = presetManager.list<SDWebUIDrawingParams>('drawing', 'sdwebui');
    if (drawingPresets.length === 0) {
        drawingPresets = [
            {
                id: 'default_sd15',
                name: '默认 SD 1.5 绘图方案',
                isBuiltin: true,
                data: { ...DEFAULT_SD_DRAWING }
            }
        ];
    }

    let activeDrawingId = sdConfig.activeDrawingProfileId || drawingPresets[0].id;
    let currentDrawingParams: SDWebUIDrawingParams = {
        ...DEFAULT_SD_DRAWING,
        ...(drawingPresets.find((p) => p.id === activeDrawingId)?.data || {})
    };

    // 表单脏状态追踪器
    const drawingDirtyTracker: IDirtyTracker<SDWebUIDrawingParams> = createDirtyTracker(
        currentDrawingParams,
        (isDirty) => {
            drawingToolbar.setDirty(isDirty);
        }
    );
    regDisposer(drawingDirtyTracker);

    const drawingToolbar: PresetToolbarHandle = createPresetToolbar({
        presets: drawingPresets.map((p) => ({ id: p.id, name: p.name, isBuiltin: p.isBuiltin })),
        activePresetId: activeDrawingId,
        onAction: (action, presetId) => {
            if (action === 'select') {
                activeDrawingId = presetId;
                const found = drawingPresets.find((p) => p.id === presetId);
                if (found && found.data) {
                    currentDrawingParams = { ...found.data };
                    syncDrawingControls(currentDrawingParams);
                    drawingDirtyTracker.setBaseline(currentDrawingParams);
                }
            } else if (action === 'save') {
                drawingDirtyTracker.setBaseline(currentDrawingParams);
            } else if (action === 'reset') {
                currentDrawingParams = { ...(drawingDirtyTracker.getBaseline() as SDWebUIDrawingParams) };
                syncDrawingControls(currentDrawingParams);
                drawingDirtyTracker.setBaseline(currentDrawingParams);
            }
        }
    });
    regDisposer(drawingToolbar);
    drawingCard.append(drawingToolbar.element);

    // Section 1: 模型设置
    const modelSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '生图模型与特征跳过'
    });
    modelSectionTitle.style.padding = '8px 12px 4px 12px';
    modelSectionTitle.style.fontSize = '12px';
    modelSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    modelSectionTitle.style.fontWeight = '600';
    drawingCard.append(modelSectionTitle);

    const baseModelSelect = createSelect({
        value: currentDrawingParams.model,
        options: [
            { label: 'animeRealistic_v20.safetensors', value: 'animeRealistic_v20.safetensors' },
            { label: 'v1-5-pruned-emaonly.safetensors', value: 'v1-5-pruned-emaonly.safetensors' },
            { label: 'counterfeitV30_v30.safetensors', value: 'counterfeitV30_v30.safetensors' }
        ],
        onChange: (val) => {
            currentDrawingParams.model = val;
            drawingDirtyTracker.notifyFieldChange('model', val);
        }
    });
    regDisposer(baseModelSelect);
    const baseModelField: FormFieldHandle = createFormField({
        label: '生图主模型',
        helpText: 'SD-WebUI 服务端加载的 Checkpoint 大模型文件',
        control: baseModelSelect
    });
    regDisposer(baseModelField);
    drawingCard.append(baseModelField.element);

    const vaeSelect = createSelect({
        value: currentDrawingParams.vae,
        options: [
            { label: '自动探测', value: 'automatic' },
            { label: 'vae-ft-mse-840000.safetensors', value: 'vae-ft-mse-840000.safetensors' },
            { label: 'kl-f8-anime2.vae.safetensors', value: 'kl-f8-anime2.vae.safetensors' }
        ],
        onChange: (val) => {
            currentDrawingParams.vae = val;
            drawingDirtyTracker.notifyFieldChange('vae', val);
        }
    });
    regDisposer(vaeSelect);
    const vaeField: FormFieldHandle = createFormField({
        label: 'VAE 模型',
        helpText: '图像颜色解码增强模型，选 automatic 将使用模型自带或系统默认配置',
        control: vaeSelect
    });
    regDisposer(vaeField);
    drawingCard.append(vaeField.element);

    const clipSkipSlider: SliderHandle = createSlider({
        value: currentDrawingParams.clipSkip,
        min: 1,
        max: 12,
        step: 1,
        unit: '层',
        onChange: (val) => {
            currentDrawingParams.clipSkip = val;
            drawingDirtyTracker.notifyFieldChange('clipSkip', val);
        }
    });
    regDisposer(clipSkipSlider);
    const clipSkipField: FormFieldHandle = createFormField({
        label: 'CLIP 跳过层数',
        helpText: '二次元动漫模型通常推荐 2 层，真实摄影模型通常推荐 1 层',
        control: clipSkipSlider
    });
    regDisposer(clipSkipField);
    drawingCard.append(clipSkipField.element);

    // Section 2: 采样与画幅设置 (DimensionPicker + SamplerCard)
    const samplingSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '画幅尺寸与采样超参数'
    });
    samplingSectionTitle.style.padding = '8px 12px 4px 12px';
    samplingSectionTitle.style.fontSize = '12px';
    samplingSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    samplingSectionTitle.style.fontWeight = '600';
    drawingCard.append(samplingSectionTitle);

    const dimensionPicker: DimensionPickerHandle = createDimensionPicker({
        value: { width: currentDrawingParams.width, height: currentDrawingParams.height },
        onChange: (val) => {
            currentDrawingParams.width = val.width;
            currentDrawingParams.height = val.height;
            drawingDirtyTracker.notifyFieldChange('width', val.width);
            drawingDirtyTracker.notifyFieldChange('height', val.height);
        }
    });
    regDisposer(dimensionPicker);
    drawingCard.append(dimensionPicker.element);

    const samplerCard: SamplerCardHandle = createSamplerCard({
        value: {
            sampler: currentDrawingParams.sampler,
            scheduler: currentDrawingParams.scheduler,
            steps: currentDrawingParams.steps,
            cfgScale: currentDrawingParams.cfgScale,
            seed: currentDrawingParams.seed
        },
        onChange: (val) => {
            currentDrawingParams.sampler = val.sampler;
            currentDrawingParams.scheduler = val.scheduler;
            currentDrawingParams.steps = val.steps;
            currentDrawingParams.cfgScale = val.cfgScale;
            currentDrawingParams.seed = val.seed ?? -1;
            drawingDirtyTracker.notifyFieldChange('sampler', val.sampler);
            drawingDirtyTracker.notifyFieldChange('scheduler', val.scheduler);
            drawingDirtyTracker.notifyFieldChange('steps', val.steps);
            drawingDirtyTracker.notifyFieldChange('cfgScale', val.cfgScale);
            drawingDirtyTracker.notifyFieldChange('seed', currentDrawingParams.seed);
        }
    });
    regDisposer(samplerCard);
    drawingCard.append(samplerCard.element);

    const restoreFacesToggle: ToggleHandle = createToggle({
        value: currentDrawingParams.restoreFaces,
        onChange: (val) => {
            currentDrawingParams.restoreFaces = val;
            drawingDirtyTracker.notifyFieldChange('restoreFaces', val);
        }
    });
    regDisposer(restoreFacesToggle);
    const restoreFacesField: FormFieldHandle = createFormField({
        label: '面部修复',
        helpText: '使用 CodeFormer / GFPGAN 对生成图像中的人物面部细节进行修复',
        control: restoreFacesToggle
    });
    regDisposer(restoreFacesField);
    drawingCard.append(restoreFacesField.element);

    const denoiseSlider: SliderHandle = createSlider({
        value: currentDrawingParams.denoisingStrength,
        min: 0,
        max: 1,
        step: 0.05,
        onChange: (val) => {
            currentDrawingParams.denoisingStrength = val;
            drawingDirtyTracker.notifyFieldChange('denoisingStrength', val);
        }
    });
    regDisposer(denoiseSlider);
    const denoiseField: FormFieldHandle = createFormField({
        label: '重绘幅度',
        helpText: '图生图与重绘时的去噪变化强度，值越大画面变化越显著',
        control: denoiseSlider
    });
    regDisposer(denoiseField);
    drawingCard.append(denoiseField.element);

    // Section 3: 高清修复
    const hiresSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '高清修复'
    });
    hiresSectionTitle.style.padding = '8px 12px 4px 12px';
    hiresSectionTitle.style.fontSize = '12px';
    hiresSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    hiresSectionTitle.style.fontWeight = '600';
    drawingCard.append(hiresSectionTitle);

    const hiresToggle: ToggleHandle = createToggle({
        value: currentDrawingParams.hiresEnabled,
        onChange: (val) => {
            currentDrawingParams.hiresEnabled = val;
            drawingDirtyTracker.notifyFieldChange('hiresEnabled', val);
        }
    });
    regDisposer(hiresToggle);
    const hiresToggleField: FormFieldHandle = createFormField({
        label: '启用高清修复',
        helpText: '在基础低分辨率出图后自动执行二次超分重绘，显著减少肢体错误并提升细节',
        control: hiresToggle
    });
    regDisposer(hiresToggleField);
    drawingCard.append(hiresToggleField.element);

    const hiresUpscalerSelect = createSelect({
        value: currentDrawingParams.hiresUpscaler,
        options: [
            { label: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
            { label: 'Latent (nearest-exact)', value: 'Latent (nearest-exact)' },
            { label: '4x-UltraSharp', value: '4x-UltraSharp' }
        ],
        onChange: (val) => {
            currentDrawingParams.hiresUpscaler = val;
            drawingDirtyTracker.notifyFieldChange('hiresUpscaler', val);
        }
    });
    regDisposer(hiresUpscalerSelect);
    const hiresUpscalerField: FormFieldHandle = createFormField({
        label: '放大算法',
        helpText: '超分辨率重绘采用的潜空间或像素级插值放大算法',
        control: hiresUpscalerSelect
    });
    regDisposer(hiresUpscalerField);
    drawingCard.append(hiresUpscalerField.element);

    const hiresScaleSlider: SliderHandle = createSlider({
        value: currentDrawingParams.hiresUpscaleBy,
        min: 1,
        max: 4,
        step: 0.05,
        unit: 'x',
        onChange: (val) => {
            currentDrawingParams.hiresUpscaleBy = val;
            drawingDirtyTracker.notifyFieldChange('hiresUpscaleBy', val);
        }
    });
    regDisposer(hiresScaleSlider);
    const hiresScaleField: FormFieldHandle = createFormField({
        label: '放大倍率',
        helpText: '基于初始分辨率的等比放大倍率，推荐 1.5x ~ 2.0x',
        control: hiresScaleSlider
    });
    regDisposer(hiresScaleField);
    drawingCard.append(hiresScaleField.element);

    const hiresStepsSlider: SliderHandle = createSlider({
        value: currentDrawingParams.hiresSteps,
        min: 0,
        max: 100,
        step: 1,
        unit: '步',
        onChange: (val) => {
            currentDrawingParams.hiresSteps = val;
            drawingDirtyTracker.notifyFieldChange('hiresSteps', val);
        }
    });
    regDisposer(hiresStepsSlider);
    const hiresStepsField: FormFieldHandle = createFormField({
        label: '高分重绘步数',
        helpText: '第二次超分辨率采样的迭代步数，填 0 则沿用基础步数',
        control: hiresStepsSlider
    });
    regDisposer(hiresStepsField);
    drawingCard.append(hiresStepsField.element);

    const hiresDenoiseSlider: SliderHandle = createSlider({
        value: currentDrawingParams.hiresDenoising,
        min: 0,
        max: 1,
        step: 0.05,
        onChange: (val) => {
            currentDrawingParams.hiresDenoising = val;
            drawingDirtyTracker.notifyFieldChange('hiresDenoising', val);
        }
    });
    regDisposer(hiresDenoiseSlider);
    const hiresDenoiseField: FormFieldHandle = createFormField({
        label: '高分重绘幅度',
        helpText: '超分阶段的去噪强度，推荐 0.35 ~ 0.55，太高会导致画面完全偏离',
        control: hiresDenoiseSlider
    });
    regDisposer(hiresDenoiseField);
    drawingCard.append(hiresDenoiseField.element);

    // Section 4: 关联提示词方案
    const promptPresets: PresetItem[] = presetManager.list('prompts') || BUILTIN_PROMPTS;
    const promptProfileSelect = createSelect({
        value: currentDrawingParams.promptProfileId,
        options: promptPresets.map((p: PresetItem) => ({ label: p.name, value: p.id })),
        onChange: (val) => {
            currentDrawingParams.promptProfileId = val;
            drawingDirtyTracker.notifyFieldChange('promptProfileId', val);
        }
    });
    regDisposer(promptProfileSelect);
    const promptProfileField: FormFieldHandle = createFormField({
        label: '关联提示词方案',
        helpText: '当前绘图方案默认绑定的提示词预设配置，生图时优先注入其正反词与 LoRA',
        control: promptProfileSelect
    });
    regDisposer(promptProfileField);
    drawingCard.append(promptProfileField.element);

    root.appendChild(drawingCard.element);

    const syncDrawingControls = (params: SDWebUIDrawingParams) => {
        baseModelSelect.setValue(params.model);
        vaeSelect.setValue(params.vae);
        clipSkipSlider.setValue(params.clipSkip);
        dimensionPicker.setValue({ width: params.width, height: params.height });
        samplerCard.setValue({
            sampler: params.sampler,
            scheduler: params.scheduler,
            steps: params.steps,
            cfgScale: params.cfgScale,
            seed: params.seed
        });
        restoreFacesToggle.setValue(params.restoreFaces);
        denoiseSlider.setValue(params.denoisingStrength);
        hiresToggle.setValue(params.hiresEnabled);
        hiresUpscalerSelect.setValue(params.hiresUpscaler);
        hiresScaleSlider.setValue(params.hiresUpscaleBy);
        hiresStepsSlider.setValue(params.hiresSteps);
        hiresDenoiseSlider.setValue(params.hiresDenoising);
        promptProfileSelect.setValue(params.promptProfileId);
    };

    // 3. PromptPresetManager (提示词预设方案与双权重 LoRA)
    const syncPromptPresets = () => {
        const updated = presetManager.list('prompts') || BUILTIN_PROMPTS;
        promptProfileSelect.setOptions(updated.map((p: PresetItem) => ({ label: p.name, value: p.id })));
    };

    const promptPresetManager: PromptPresetManagerHandle = createPromptPresetManager({
        presets: promptPresets as PresetItem<PromptPresetData>[],
        activePresetId: currentDrawingParams.promptProfileId || promptPresets[0]?.id || 'default',
        showLora: true,
        backendMode: 'sdwebui',
        onAction: (action, presetId, data) => {
            if (action === 'save' && data) {
                presetManager.save('prompts', {
                    id: presetId,
                    name: presetId,
                    data
                });
                syncPromptPresets();
            }
        },
        onChange: () => {
            syncPromptPresets();
        }
    });
    regDisposer(promptPresetManager);
    root.appendChild(promptPresetManager.element);

    return {
        element: root,
        dispose(): void {
            for (const d of disposers) {
                d();
            }
        }
    };
}
