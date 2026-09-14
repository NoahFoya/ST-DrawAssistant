/**
 * @module src/ui/views/comfyui-tab
 * @description ComfyUI 引擎专属配置面板 (ComfyUITab)
 *
 * 核心功能：
 * 1. 管理 ComfyUI 服务连接配置、HTTP 接口探测与 WebSocket 信道状态展示；
 * 2. 提供绘图方案预设切换、模型与采样器超参数配置、画面尺寸选择与工作流方案绑定；
 * 3. 集成工作流预设管理器，支持 API 节点图预览、导入导出与变量填报诊断；
 * 4. 集成提示词预设管理器，支持 WeiLin 语法模板与 LoRA 权重项配置；
 * 5. 追踪表单脏状态变更，提供一键复原与持久化同步。
 *
 * 注意事项：
 * 1. ComfyUI 依赖完整的 API 节点图格式，需防止前端占位变量注入时破坏 JSON 结构；
 * 2. 实时进度展示需要与后端 WebSocket 保持连接稳定，网络断开时应具备重连容错能力。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard, FormFieldHandle } from '../components/form-field';
import { createSelect } from '../components/select';
import { createConnectionCard, ConnectionCardHandle } from '../composite/connection-card';
import { createDimensionPicker, DimensionPickerHandle } from '../composite/dimension-picker';
import { createSamplerCard, SamplerCardHandle } from '../composite/sampler-card';
import { createPromptPresetManager, PromptPresetManagerHandle, PromptPresetData } from '../composite/prompt-preset-manager';
import { createWorkflowPresetManager, WorkflowPresetManagerHandle } from '../composite/workflow-card';
import { createPresetToolbar, PresetToolbarHandle } from '../composite/preset-toolbar';
import { createDirtyTracker, IDirtyTracker } from '../components/dirty-tracker';
import { getIconSvg } from '../components/icons';
import { PresetManager, BUILTIN_WORKFLOWS, BUILTIN_PROMPTS } from '../../store/preset';
import { getAdapter } from '../../function/adapter/registry';
import type { SettingsStore } from '../../store/settings';
import type { PresetItem } from '@types';

export interface ComfyUITabOptions {
    presetManager?: PresetManager;
    onOpenWorkflowBlueprint?: (workflowId: string, json: string, onSave?: (newJson: string) => void) => void;
}

export interface ComfyUITabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

interface ComfyUIDrawingParams extends Record<string, any> {
    baseModel: string;
    clipModel: string;
    vaeModel: string;
    width: number;
    height: number;
    sampler: string;
    scheduler: string;
    steps: number;
    cfgScale: number;
    promptProfileId: string;
    txt2imgWorkflowId: string;
    img2imgWorkflowId: string;
    inpaintWorkflowId: string;
}

const DEFAULT_COMFY_DRAWING: ComfyUIDrawingParams = {
    baseModel: 'v1-5-pruned-emaonly.safetensors',
    clipModel: '(默认内置)',
    vaeModel: 'vae-ft-mse-840000.safetensors',
    width: 832,
    height: 1216,
    sampler: 'dpmpp_2m',
    scheduler: 'karras',
    steps: 25,
    cfgScale: 7.0,
    promptProfileId: 'prompt_anime_general',
    txt2imgWorkflowId: 'comfyui_checkpoint_standard',
    img2imgWorkflowId: 'comfyui_checkpoint_weilin',
    inpaintWorkflowId: 'comfyui_split_standard'
};

export function renderComfyUITab(
    settingsStore: SettingsStore,
    options: ComfyUITabOptions = {}
): ComfyUITabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    const presetManager = options.presetManager || new PresetManager(settingsStore);
    const engines = settingsStore.get('engines') || {};
    const comfyConfig = engines.comfyui || {
        serverUrl: 'http://127.0.0.1:8188',
        activeDrawingProfileId: 'comfyui_drawing_wai_default',
        activePromptProfileId: 'prompt_anime_general',
        activeWorkflowProfileId: 'comfyui_checkpoint_standard'
    };

    // 1. ConnectionCard (服务连接与资产拉取更新)
    const connectionCard: ConnectionCardHandle = createConnectionCard({
        engineName: 'ComfyUI',
        baseUrl: comfyConfig.serverUrl || 'http://127.0.0.1:8188',
        editableUrl: true,
        onChangeBaseUrl: (newUrl) => {
            const currentEngines = settingsStore.get('engines') || {};
            const curComfy = currentEngines.comfyui || {};
            settingsStore.update({
                engines: {
                    ...currentEngines,
                    comfyui: { ...curComfy, serverUrl: newUrl }
                }
            });
        },
        onCheckHealth: async (signal?: AbortSignal) => {
            const adapter = getAdapter('comfyui');
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
                    { label: '(默认内置)', value: '(默认内置)' },
                    ...assets.vaes.map((v: string) => ({ label: v, value: v }))
                ]);
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

    let drawingPresets = presetManager.list<ComfyUIDrawingParams>('drawing', 'comfyui');
    if (drawingPresets.length === 0) {
        drawingPresets = [
            {
                id: 'comfyui_drawing_wai_default',
                name: '默认 SDXL 绘图预设',
                isBuiltin: true,
                data: { ...DEFAULT_COMFY_DRAWING }
            }
        ];
    }

    let activeDrawingId = comfyConfig.activeDrawingProfileId || drawingPresets[0].id;
    let currentDrawingParams: ComfyUIDrawingParams = {
        ...DEFAULT_COMFY_DRAWING,
        ...(drawingPresets.find((p) => p.id === activeDrawingId)?.data || {})
    };

    // 表单脏状态追踪器
    const drawingDirtyTracker: IDirtyTracker<ComfyUIDrawingParams> = createDirtyTracker(
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
                currentDrawingParams = { ...(drawingDirtyTracker.getBaseline() as ComfyUIDrawingParams) };
                syncDrawingControls(currentDrawingParams);
                drawingDirtyTracker.setBaseline(currentDrawingParams);
            }
        }
    });
    regDisposer(drawingToolbar);
    drawingCard.append(drawingToolbar.element);

    // Section 1: 生图底模与核心组件
    const modelSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '生图底模与核心组件'
    });
    modelSectionTitle.style.padding = '8px 12px 4px 12px';
    modelSectionTitle.style.fontSize = '12px';
    modelSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    modelSectionTitle.style.fontWeight = '600';
    drawingCard.append(modelSectionTitle);

    const baseModelSelect = createSelect({
        value: currentDrawingParams.baseModel,
        options: [
            { label: 'v1-5-pruned-emaonly.safetensors', value: 'v1-5-pruned-emaonly.safetensors' },
            { label: 'sd_xl_base_1.0.safetensors', value: 'sd_xl_base_1.0.safetensors' },
            { label: 'animagineXL_v30.safetensors', value: 'animagineXL_v30.safetensors' }
        ],
        onChange: (val) => {
            currentDrawingParams.baseModel = val;
            drawingDirtyTracker.notifyFieldChange('baseModel', val);
        }
    });
    regDisposer(baseModelSelect);
    const baseModelField: FormFieldHandle = createFormField({
        label: '生图主模型 (Base Model)',
        helpText: 'ComfyUI 后端 CheckpointLoaderSimple 加载的大模型权重文件',
        control: baseModelSelect
    });
    regDisposer(baseModelField);
    drawingCard.append(baseModelField.element);

    const clipSelect = createSelect({
        value: currentDrawingParams.clipModel,
        options: [
            { label: '(默认内置)', value: '(默认内置)' },
            { label: 'clip-vit-large-patch14.safetensors', value: 'clip-vit-large-patch14.safetensors' },
            { label: 't5xxl_fp16.safetensors', value: 't5xxl_fp16.safetensors' }
        ],
        onChange: (val) => {
            currentDrawingParams.clipModel = val;
            drawingDirtyTracker.notifyFieldChange('clipModel', val);
        }
    });
    regDisposer(clipSelect);
    const clipField: FormFieldHandle = createFormField({
        label: 'CLIP 文本编码器 (CLIP)',
        helpText: '分立架构或特定模型下的文本特征提取器，常规大模型选默认内置即可',
        control: clipSelect
    });
    regDisposer(clipField);
    drawingCard.append(clipField.element);

    const vaeSelect = createSelect({
        value: currentDrawingParams.vaeModel,
        options: [
            { label: '(默认内置)', value: '(默认内置)' },
            { label: 'vae-ft-mse-840000.safetensors', value: 'vae-ft-mse-840000.safetensors' },
            { label: 'sdxl_vae.safetensors', value: 'sdxl_vae.safetensors' }
        ],
        onChange: (val) => {
            currentDrawingParams.vaeModel = val;
            drawingDirtyTracker.notifyFieldChange('vaeModel', val);
        }
    });
    regDisposer(vaeSelect);
    const vaeField: FormFieldHandle = createFormField({
        label: 'VAE 模型 (VAE)',
        helpText: '负责潜空间与像素图像解码的变分自编码器，改善画面饱和度与灰阶',
        control: vaeSelect
    });
    regDisposer(vaeField);
    drawingCard.append(vaeField.element);

    // Section 2: 采样与画幅设置 (DimensionPicker + SamplerCard)
    const samplingSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '画幅分辨率与采样超参数'
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
            cfgScale: currentDrawingParams.cfgScale
        },
        onChange: (val) => {
            currentDrawingParams.sampler = val.sampler;
            currentDrawingParams.scheduler = val.scheduler;
            currentDrawingParams.steps = val.steps;
            currentDrawingParams.cfgScale = val.cfgScale;
            drawingDirtyTracker.notifyFieldChange('sampler', val.sampler);
            drawingDirtyTracker.notifyFieldChange('scheduler', val.scheduler);
            drawingDirtyTracker.notifyFieldChange('steps', val.steps);
            drawingDirtyTracker.notifyFieldChange('cfgScale', val.cfgScale);
        }
    });
    regDisposer(samplerCard);
    drawingCard.append(samplerCard.element);

    // Section 3: 关联提示词方案与工作流绑定
    const bindingSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '关联提示词与生图工作流绑定'
    });
    bindingSectionTitle.style.padding = '8px 12px 4px 12px';
    bindingSectionTitle.style.fontSize = '12px';
    bindingSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    bindingSectionTitle.style.fontWeight = '600';
    drawingCard.append(bindingSectionTitle);

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

    let onTxt2imgWorkflowSelect: ((val: string) => void) | null = null;
    const workflowPresets: PresetItem<{ json: string }>[] = presetManager.list('workflows') || BUILTIN_WORKFLOWS;
    const wfOptions = workflowPresets.map((w: PresetItem<{ json: string }>) => ({ label: w.name, value: w.id }));

    const txt2imgWfSelect = createSelect({
        value: currentDrawingParams.txt2imgWorkflowId,
        options: wfOptions,
        onChange: (val) => {
            currentDrawingParams.txt2imgWorkflowId = val;
            drawingDirtyTracker.notifyFieldChange('txt2imgWorkflowId', val);
            onTxt2imgWorkflowSelect?.(val);
        }
    });
    regDisposer(txt2imgWfSelect);
    const txt2imgField: FormFieldHandle = createFormField({
        label: '文生图工作流 (txt2img)',
        helpText: '根据文本提示词直接生成图像时派发执行的 ComfyUI 工作流蓝图',
        control: txt2imgWfSelect
    });
    regDisposer(txt2imgField);
    drawingCard.append(txt2imgField.element);

    const img2imgWfSelect = createSelect({
        value: currentDrawingParams.img2imgWorkflowId,
        options: wfOptions,
        onChange: (val) => {
            currentDrawingParams.img2imgWorkflowId = val;
            drawingDirtyTracker.notifyFieldChange('img2imgWorkflowId', val);
        }
    });
    regDisposer(img2imgWfSelect);
    const img2imgField: FormFieldHandle = createFormField({
        label: '图生图工作流 (img2img)',
        helpText: '在既有图像或垫图上依据提示词进行重绘或风格迁移的工作流蓝图',
        control: img2imgWfSelect
    });
    regDisposer(img2imgField);
    drawingCard.append(img2imgField.element);

    const inpaintWfSelect = createSelect({
        value: currentDrawingParams.inpaintWorkflowId,
        options: wfOptions,
        onChange: (val) => {
            currentDrawingParams.inpaintWorkflowId = val;
            drawingDirtyTracker.notifyFieldChange('inpaintWorkflowId', val);
        }
    });
    regDisposer(inpaintWfSelect);
    const inpaintField: FormFieldHandle = createFormField({
        label: '局部重绘工作流 (inpaint)',
        helpText: '搭配重绘蒙版画布进行局部位姿、服饰修复时派发的工作流蓝图',
        control: inpaintWfSelect
    });
    regDisposer(inpaintField);
    drawingCard.append(inpaintField.element);

    root.appendChild(drawingCard.element);

    const syncDrawingControls = (params: ComfyUIDrawingParams) => {
        baseModelSelect.setValue(params.baseModel);
        clipSelect.setValue(params.clipModel);
        vaeSelect.setValue(params.vaeModel);
        dimensionPicker.setValue({ width: params.width, height: params.height });
        samplerCard.setValue({
            sampler: params.sampler,
            scheduler: params.scheduler,
            steps: params.steps,
            cfgScale: params.cfgScale,
            seed: currentDrawingParams.seed ?? -1
        });
        promptProfileSelect.setValue(params.promptProfileId);
        txt2imgWfSelect.setValue(params.txt2imgWorkflowId);
        img2imgWfSelect.setValue(params.img2imgWorkflowId);
        inpaintWfSelect.setValue(params.inpaintWorkflowId);
    };

    // 3. PromptPresetManager (提示词预设方案与 LoRA)
    const syncPromptPresets = () => {
        const updated = presetManager.list('prompts') || BUILTIN_PROMPTS;
        promptProfileSelect.setOptions(updated.map((p: PresetItem) => ({ label: p.name, value: p.id })));
    };

    const promptPresetManager: PromptPresetManagerHandle = createPromptPresetManager({
        presets: promptPresets as PresetItem<PromptPresetData>[],
        activePresetId: currentDrawingParams.promptProfileId || promptPresets[0]?.id || 'default',
        showLora: true,
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

    // 4. WorkflowPresetManager (工作流预设方案管理与代码编辑)
    const syncWorkflowPresets = () => {
        const updated = presetManager.list('workflows') || BUILTIN_WORKFLOWS;
        const optionsList = updated.map((w: PresetItem) => ({ label: w.name, value: w.id }));
        txt2imgWfSelect.setOptions(optionsList);
        img2imgWfSelect.setOptions(optionsList);
        inpaintWfSelect.setOptions(optionsList);
    };

    let currentWf = workflowPresets.find((w: PresetItem<{ json: string }>) => w.id === currentDrawingParams.txt2imgWorkflowId) || workflowPresets[0];
    let wfJsonStr = typeof currentWf?.data === 'string' ? currentWf.data : (currentWf?.data?.json || '{}');

    const workflowPresetManager: WorkflowPresetManagerHandle = createWorkflowPresetManager({
        presets: workflowPresets as PresetItem<{ json: string }>[],
        activePresetId: currentDrawingParams.txt2imgWorkflowId || workflowPresets[0]?.id || 'default',
        value: { json: typeof wfJsonStr === 'string' ? wfJsonStr : JSON.stringify(wfJsonStr, null, 2) },
        onAction: (action, presetId, data) => {
            if (action === 'select') {
                const found = workflowPresets.find((w: PresetItem<{ json: string }>) => w.id === presetId);
                if (found) {
                    currentDrawingParams.txt2imgWorkflowId = presetId;
                    txt2imgWfSelect.setValue(presetId);
                    drawingDirtyTracker.notifyFieldChange('txt2imgWorkflowId', presetId);
                }
            } else if (action === 'save' && data) {
                const target = workflowPresets.find((w: PresetItem<{ json: string }>) => w.id === presetId);
                if (target) {
                    presetManager.save('workflows', {
                        ...target,
                        data: { json: data.json }
                    });
                    syncWorkflowPresets();
                }
            }
        },
        onChange: (data) => {
            wfJsonStr = data.json;
        },
        onOpenBlueprint: (currentJson) => {
            options.onOpenWorkflowBlueprint?.(
                currentDrawingParams.txt2imgWorkflowId || currentWf?.id || 'default',
                currentJson,
                (newJson: string) => {
                    wfJsonStr = newJson;
                    workflowPresetManager.setValue({ json: newJson });
                    const target = workflowPresets.find((w: PresetItem<{ json: string }>) => w.id === currentDrawingParams.txt2imgWorkflowId);
                    if (target) {
                        presetManager.save('workflows', {
                            ...target,
                            data: { json: newJson }
                        });
                        syncWorkflowPresets();
                    }
                }
            );
        }
    });
    regDisposer(workflowPresetManager);
    root.appendChild(workflowPresetManager.element);

    onTxt2imgWorkflowSelect = (val: string) => {
        const found = workflowPresets.find((w: PresetItem<{ json: string }>) => w.id === val);
        if (found) {
            currentWf = found;
            wfJsonStr = typeof found.data === 'string' ? found.data : (found.data?.json || '{}');
            const jsonContent = typeof wfJsonStr === 'string' ? wfJsonStr : JSON.stringify(wfJsonStr, null, 2);
            workflowPresetManager.setValue({ json: jsonContent });
        }
    };

    return {
        element: root,
        dispose(): void {
            for (const d of disposers) {
                d();
            }
        }
    };
}
