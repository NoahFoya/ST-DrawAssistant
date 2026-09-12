/**
 * @module src/ui/views/openai-tab
 * @description OpenAI 兼容驱动专属配置面板 (OpenAITab)
 *
 * 遵循规范 (UI_LAYOUT_PREVIEW.md 第六节第 4 条)：
 * 1. Card 1: OpenAIServiceCard (多供应商选择, Base URL, API Key 显隐密码框, 自定义 Headers JSON, 同步远端模型与测试连接)；
 * 2. Card 2: 绘图参数预设 (PresetToolbar, 模型选择与自定义 ID, DimensionPicker 画幅, 质量与风格, 扩散模型进阶负向词/步数/CFG/Seed, 自定义额外 Body JSON 透传)；
 * 3. 状态同步：全量居中、Select 画幅、等宽数字框、表单脏状态追踪与基准重置。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard, FormFieldHandle } from '../components/form-field';
import { createSelect, SelectHandle } from '../components/select';
import { createTextInput, createNumberInput, createTextarea, TextInputHandle, NumberInputHandle, TextareaHandle } from '../components/input';
import { createOpenAIServiceCard, OpenAIServiceCardHandle, OpenAIProviderConfig } from '../composite/openai-service-card';
import { createDimensionPicker, DimensionPickerHandle } from '../composite/dimension-picker';
import { createPresetToolbar, PresetToolbarHandle } from '../composite/preset-toolbar';
import { createDirtyTracker, IDirtyTracker } from '../components/dirty-tracker';
import { getIconSvg } from '../components/icons';
import { PresetManager } from '../../store/preset';
import { getAdapter } from '../../function/adapter/registry';
import type { SettingsStore } from '../../store/settings';

export interface OpenAITabOptions {
    presetManager?: PresetManager;
}

export interface OpenAITabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

interface OpenAIDrawingParams extends Record<string, any> {
    model: string;
    customModelId: string;
    width: number;
    height: number;
    quality: string;
    style: string;
    negativePrompt: string;
    steps: number;
    cfgScale: number;
    seed: number;
    customBodyJson: string;
}

const DEFAULT_OPENAI_DRAWING: OpenAIDrawingParams = {
    model: 'dall-e-3',
    customModelId: '',
    width: 1024,
    height: 1024,
    quality: 'standard',
    style: 'vivid',
    negativePrompt: '',
    steps: 30,
    cfgScale: 7.0,
    seed: -1,
    customBodyJson: '{\n  "response_format": "b64_json"\n}'
};

export function renderOpenAITab(
    settingsStore: SettingsStore,
    options: OpenAITabOptions = {}
): OpenAITabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    const presetManager = options.presetManager || new PresetManager(settingsStore);
    const engines = settingsStore.get('engines') || {};
    const openaiConfig = engines.openai || {
        activeProvider: 'openai-official',
        serverUrl: 'https://api.openai.com/v1',
        apiKey: '',
        activeDrawingProfileId: 'default_openai'
    };

    // 1. OpenAIServiceCard (服务连接与多供应商管理)
    const serviceCard: OpenAIServiceCardHandle = createOpenAIServiceCard({
        value: {
            provider: (openaiConfig.activeProvider as any) || 'openai-official',
            serverUrl: openaiConfig.serverUrl || 'https://api.openai.com/v1',
            apiKey: openaiConfig.apiKey || '',
            customHeaders: ''
        },
        onChange: (cfg: OpenAIProviderConfig) => {
            const currentEngines = settingsStore.get('engines') || {};
            const curOpenai = currentEngines.openai || {};
            settingsStore.update({
                engines: {
                    ...currentEngines,
                    openai: {
                        ...curOpenai,
                        activeProvider: cfg.provider,
                        serverUrl: cfg.serverUrl,
                        apiKey: cfg.apiKey
                    }
                }
            });
        },
        onCheckHealth: async (cfg, signal) => {
            const adapter = getAdapter('openai');
            adapter.setBaseUrl?.(cfg.serverUrl);
            if (adapter.fetchAssets) {
                const res = await adapter.fetchAssets(signal, {
                    apiKey: cfg.apiKey,
                    customHeaders: cfg.customHeaders
                });
                if (res.ok && Array.isArray(res.availableModels) && res.availableModels.length > 0) {
                    modelSelect.setOptions(res.availableModels.map((id: string) => ({ label: id, value: id })));
                }
                return res;
            }
            return await adapter.checkHealth(signal);
        },
        onSyncModels: async (cfg, signal) => {
            const adapter = getAdapter('openai');
            adapter.setBaseUrl?.(cfg.serverUrl);
            if (adapter.fetchAssets) {
                const res = await adapter.fetchAssets(signal, {
                    apiKey: cfg.apiKey,
                    customHeaders: cfg.customHeaders
                });
                if (res.ok && Array.isArray(res.availableModels)) {
                    if (res.availableModels.length > 0) {
                        modelSelect.setOptions(res.availableModels.map((id) => ({ label: id, value: id })));
                    }
                    return res.availableModels;
                }
                throw new Error(res.message || '模型列表同步失败');
            }
            return [];
        }
    });
    regDisposer(serviceCard);
    root.appendChild(serviceCard.element);

    // 2. 绘图参数预设 (Drawing Preset Card)
    const drawingCard = createCard({
        title: '绘图参数预设',
        iconSvg: getIconSvg('palette'),
        collapsible: true
    });
    regDisposer(drawingCard);

    let drawingPresets = presetManager.list<OpenAIDrawingParams>('drawing', 'openai');
    if (drawingPresets.length === 0) {
        drawingPresets = [
            {
                id: 'default_openai',
                name: 'DALL·E 3 默认方案',
                isBuiltin: true,
                data: { ...DEFAULT_OPENAI_DRAWING }
            }
        ];
    }

    let activeDrawingId = openaiConfig.activeDrawingProfileId || drawingPresets[0].id;
    let currentDrawingParams: OpenAIDrawingParams = {
        ...DEFAULT_OPENAI_DRAWING,
        ...(drawingPresets.find((p) => p.id === activeDrawingId)?.data || {})
    };

    // 表单脏状态追踪器
    const drawingDirtyTracker: IDirtyTracker<OpenAIDrawingParams> = createDirtyTracker(
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
                currentDrawingParams = { ...(drawingDirtyTracker.getBaseline() as OpenAIDrawingParams) };
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
        textContent: '模型设置'
    });
    modelSectionTitle.style.padding = '8px 12px 4px 12px';
    modelSectionTitle.style.fontSize = '12px';
    modelSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    modelSectionTitle.style.fontWeight = '600';
    drawingCard.append(modelSectionTitle);

    const modelSelect: SelectHandle = createSelect({
        value: currentDrawingParams.model,
        options: [
            { label: 'dall-e-3 (OpenAI 官方旗舰)', value: 'dall-e-3' },
            { label: 'dall-e-2 (经典轻量)', value: 'dall-e-2' },
            { label: 'black-forest-labs/FLUX.1-schnell', value: 'black-forest-labs/FLUX.1-schnell' },
            { label: 'black-forest-labs/FLUX.1-dev', value: 'black-forest-labs/FLUX.1-dev' },
            { label: 'stabilityai/stable-diffusion-3-medium', value: 'stabilityai/stable-diffusion-3-medium' }
        ],
        onChange: (val) => {
            currentDrawingParams.model = val;
            drawingDirtyTracker.notifyFieldChange('model', val);
        }
    });
    regDisposer(modelSelect);
    const modelField: FormFieldHandle = createFormField({
        label: '生图模型 (Model)',
        helpText: '目标供应商部署的生图模型标识',
        control: modelSelect
    });
    regDisposer(modelField);
    drawingCard.append(modelField.element);

    const customModelInput: TextInputHandle = createTextInput({
        value: currentDrawingParams.customModelId,
        placeholder: '若不在下拉列表，可直接输入自定义模型 ID...',
        variant: 'normal',
        onChange: (val) => {
            currentDrawingParams.customModelId = val;
            drawingDirtyTracker.notifyFieldChange('customModelId', val);
        }
    });
    regDisposer(customModelInput);
    const customModelField: FormFieldHandle = createFormField({
        label: '自定义模型 ID',
        helpText: '覆盖选中的下拉模型，优先派发此自定义模型标识',
        control: customModelInput
    });
    regDisposer(customModelField);
    drawingCard.append(customModelField.element);

    // Section 2: 画幅与分辨率
    const dimensionSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '画幅与分辨率规格'
    });
    dimensionSectionTitle.style.padding = '8px 12px 4px 12px';
    dimensionSectionTitle.style.fontSize = '12px';
    dimensionSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    dimensionSectionTitle.style.fontWeight = '600';
    drawingCard.append(dimensionSectionTitle);

    const dimensionPicker: DimensionPickerHandle = createDimensionPicker({
        presets: [
            { id: '1:1', label: '1024 × 1024 (1:1 正方形 · 标准)', width: 1024, height: 1024 },
            { id: '9:16', label: '1024 × 1792 (9:16 手机竖屏)', width: 1024, height: 1792 },
            { id: '16:9', label: '1792 × 1024 (16:9 电脑横屏)', width: 1792, height: 1024 },
            { id: 'custom', label: '自定义画幅尺寸', width: 1024, height: 1024 }
        ],
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

    // Section 3: 提供商特定特性 (质量与风格)
    const providerPropsTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: 'DALL·E 官方渲染特性'
    });
    providerPropsTitle.style.padding = '8px 12px 4px 12px';
    providerPropsTitle.style.fontSize = '12px';
    providerPropsTitle.style.color = 'var(--da-accent, #8b5cf6)';
    providerPropsTitle.style.fontWeight = '600';
    drawingCard.append(providerPropsTitle);

    const qualitySelect = createSelect({
        value: currentDrawingParams.quality,
        options: [
            { label: 'standard (标准画质 · 经济)', value: 'standard' },
            { label: 'hd (高清画质 · 丰富细节)', value: 'hd' }
        ],
        onChange: (val) => {
            currentDrawingParams.quality = val;
            drawingDirtyTracker.notifyFieldChange('quality', val);
        }
    });
    regDisposer(qualitySelect);
    const qualityField: FormFieldHandle = createFormField({
        label: '画面质量 (Quality)',
        helpText: 'DALL·E 3 的画质模式，hd 模式呈现更精细的纹理细节',
        control: qualitySelect
    });
    regDisposer(qualityField);
    drawingCard.append(qualityField.element);

    const styleSelect = createSelect({
        value: currentDrawingParams.style,
        options: [
            { label: 'vivid (鲜艳戏剧化 · 视觉冲击)', value: 'vivid' },
            { label: 'natural (自然写实风格)', value: 'natural' }
        ],
        onChange: (val) => {
            currentDrawingParams.style = val;
            drawingDirtyTracker.notifyFieldChange('style', val);
        }
    });
    regDisposer(styleSelect);
    const styleField: FormFieldHandle = createFormField({
        label: '画面风格 (Style)',
        helpText: 'vivid 会强化光影与超现实色彩，natural 偏向真实胶片摄影感',
        control: styleSelect
    });
    regDisposer(styleField);
    drawingCard.append(styleField.element);

    // Section 4: 扩散模型进阶控制 (针对 Flux / SD 开源模型提供商)
    const diffSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '进阶扩散参数 (针对开源多模态供应商)'
    });
    diffSectionTitle.style.padding = '8px 12px 4px 12px';
    diffSectionTitle.style.fontSize = '12px';
    diffSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    diffSectionTitle.style.fontWeight = '600';
    drawingCard.append(diffSectionTitle);

    const negPromptInput: TextareaHandle = createTextarea({
        value: currentDrawingParams.negativePrompt,
        placeholder: 'blurry, low quality, watermark, deformed, ugly...',
        rows: 2,
        onChange: (val) => {
            currentDrawingParams.negativePrompt = val;
            drawingDirtyTracker.notifyFieldChange('negativePrompt', val);
        }
    });
    regDisposer(negPromptInput);
    const negPromptField: FormFieldHandle = createFormField({
        label: '负向提示词 (Negative Prompt)',
        helpText: '部分支持负向词的开源大模型供应商（如硅基流动 SDXL）可用',
        control: negPromptInput
    });
    regDisposer(negPromptField);
    drawingCard.append(negPromptField.element);

    const stepsInput: NumberInputHandle = createNumberInput({
        value: currentDrawingParams.steps,
        min: 1,
        max: 100,
        step: 1,
        unit: '步',
        onChange: (val) => {
            currentDrawingParams.steps = val;
            drawingDirtyTracker.notifyFieldChange('steps', val);
        }
    });
    regDisposer(stepsInput);
    const stepsField: FormFieldHandle = createFormField({
        label: '采样步数 (Steps)',
        helpText: '扩散步数，DALL·E 官方模型会自动忽略此参数',
        control: stepsInput
    });
    regDisposer(stepsField);
    drawingCard.append(stepsField.element);

    const cfgInput: NumberInputHandle = createNumberInput({
        value: currentDrawingParams.cfgScale,
        min: 1,
        max: 20,
        step: 0.5,
        onChange: (val) => {
            currentDrawingParams.cfgScale = val;
            drawingDirtyTracker.notifyFieldChange('cfgScale', val);
        }
    });
    regDisposer(cfgInput);
    const cfgField: FormFieldHandle = createFormField({
        label: '提示词引导系数 (CFG Scale)',
        helpText: '提示词贴合权重',
        control: cfgInput
    });
    regDisposer(cfgField);
    drawingCard.append(cfgField.element);

    const seedInput: NumberInputHandle = createNumberInput({
        value: currentDrawingParams.seed,
        min: -1,
        max: 4294967295,
        step: 1,
        onChange: (val) => {
            currentDrawingParams.seed = val;
            drawingDirtyTracker.notifyFieldChange('seed', val);
        }
    });
    regDisposer(seedInput);
    const seedField: FormFieldHandle = createFormField({
        label: '随机种子 (Seed)',
        helpText: '填 -1 表示随机出图',
        control: seedInput
    });
    regDisposer(seedField);
    drawingCard.append(seedField.element);

    // Section 5: 高级透传参数
    const advancedSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '高级自定义 Body 透传'
    });
    advancedSectionTitle.style.padding = '8px 12px 4px 12px';
    advancedSectionTitle.style.fontSize = '12px';
    advancedSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    advancedSectionTitle.style.fontWeight = '600';
    drawingCard.append(advancedSectionTitle);

    const bodyJsonInput: TextareaHandle = createTextarea({
        value: currentDrawingParams.customBodyJson,
        placeholder: '{\n  "response_format": "b64_json"\n}',
        rows: 3,
        onChange: (val) => {
            currentDrawingParams.customBodyJson = val;
            drawingDirtyTracker.notifyFieldChange('customBodyJson', val);
        }
    });
    regDisposer(bodyJsonInput);
    const bodyJsonField: FormFieldHandle = createFormField({
        label: '自定义额外 Body (JSON)',
        helpText: '直接注入 POST /images/generations 载荷的私有扩展参数',
        control: bodyJsonInput
    });
    regDisposer(bodyJsonField);
    drawingCard.append(bodyJsonField.element);

    root.appendChild(drawingCard.element);

    const syncDrawingControls = (params: OpenAIDrawingParams) => {
        modelSelect.setValue(params.model);
        customModelInput.setValue(params.customModelId);
        dimensionPicker.setValue({ width: params.width, height: params.height });
        qualitySelect.setValue(params.quality);
        styleSelect.setValue(params.style);
        negPromptInput.setValue(params.negativePrompt);
        stepsInput.setValue(params.steps);
        cfgInput.setValue(params.cfgScale);
        seedInput.setValue(params.seed);
        bodyJsonInput.setValue(params.customBodyJson);
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
