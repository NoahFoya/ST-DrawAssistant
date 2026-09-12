/**
 * @module src/ui/views/novelai-tab
 * @description NovelAI 驱动专属配置面板 (NovelAITab)
 *
 * 遵循规范 (UI_LAYOUT_PREVIEW.md 第六节第 5 条)：
 * 1. Card 1: ConnectionCard (端点, API Token 密码框带眼睛显隐, 连通探测与订阅资产状态)；
 * 2. Card 2: 绘图参数预设 (PresetToolbar, 模型选择, 画幅Select+Opus免点指示, 采样超参数, 画质控制 UC Preset / 画质标签 / SMEA / Decrisper / Variety, 关联提示词)；
 * 3. Card 3: PromptPresetManager (正反向提示词, showLora: false 自动隐藏 LoRA)；
 * 4. 状态同步：全量居中、Select 画幅、等宽数字框、表单脏状态追踪与基准重置。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard, FormFieldHandle } from '../components/form-field';
import { createSelect } from '../components/select';
import { createNumberInput, NumberInputHandle } from '../components/input';
import { createToggle, ToggleHandle } from '../components/toggle';
import { createConnectionCard, ConnectionCardHandle } from '../composite/connection-card';
import { createDimensionPicker, DimensionPickerHandle } from '../composite/dimension-picker';
import { createPromptPresetManager, PromptPresetManagerHandle, PromptPresetData } from '../composite/prompt-preset-manager';
import { createPresetToolbar, PresetToolbarHandle } from '../composite/preset-toolbar';
import { createDirtyTracker, IDirtyTracker } from '../components/dirty-tracker';
import { getIconSvg } from '../components/icons';
import { PresetManager, BUILTIN_PROMPTS } from '../../store/preset';
import { getAdapter } from '../../function/adapter/registry';
import type { SettingsStore } from '../../store/settings';
import type { PresetItem } from '@types';

export interface NovelAITabOptions {
    presetManager?: PresetManager;
}

export interface NovelAITabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

interface NovelAIDrawingParams extends Record<string, any> {
    model: string;
    width: number;
    height: number;
    sampler: string;
    scheduler: string;
    steps: number;
    cfgScale: number;
    cfgRescale: number;
    seed: number;
    ucPreset: string;
    qualityTags: boolean;
    convertSyntax: boolean;
    smeaMode: string;
    decrisper: boolean;
    variety: boolean;
    promptProfileId: string;
}

const DEFAULT_NOVELAI_DRAWING: NovelAIDrawingParams = {
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    steps: 28,
    cfgScale: 5.0,
    cfgRescale: 0.0,
    seed: -1,
    ucPreset: 'heavy',
    qualityTags: true,
    convertSyntax: true,
    smeaMode: 'none',
    decrisper: false,
    variety: false,
    promptProfileId: 'prompt_anime_general'
};

export function renderNovelAITab(
    settingsStore: SettingsStore,
    options: NovelAITabOptions = {}
): NovelAITabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    const presetManager = options.presetManager || new PresetManager(settingsStore);
    const engines = settingsStore.get('engines') || {};
    const novelConfig = engines.novelai || {
        serverUrl: 'https://image.novelai.net',
        apiKey: '',
        activeDrawingProfileId: 'default_novelai',
        activePromptProfileId: 'prompt_anime_general'
    };

    // 1. ConnectionCard (服务连接与订阅资产探测)
    const connectionCard: ConnectionCardHandle = createConnectionCard({
        engineName: 'NovelAI',
        baseUrl: novelConfig.serverUrl || 'https://image.novelai.net',
        editableUrl: true,
        onChangeBaseUrl: (newUrl) => {
            const currentEngines = settingsStore.get('engines') || {};
            const curNai = currentEngines.novelai || {};
            settingsStore.update({
                engines: {
                    ...currentEngines,
                    novelai: { ...curNai, serverUrl: newUrl }
                }
            });
        },
        tokenField: {
            value: novelConfig.apiKey || '',
            label: 'API Token',
            helpText: 'NovelAI 官网登录凭据 (pst-...)，点击右侧眼睛显隐查看',
            placeholder: 'pst-********************************',
            onChange: (newToken) => {
                const currentEngines = settingsStore.get('engines') || {};
                const curNai = currentEngines.novelai || {};
                settingsStore.update({
                    engines: {
                        ...currentEngines,
                        novelai: { ...curNai, apiKey: newToken }
                    }
                });
            }
        },
        onCheckHealth: async (signal?: AbortSignal) => {
            const currentToken = (settingsStore.get('engines')?.novelai?.apiKey || '').trim();
            if (!currentToken) {
                return {
                    ok: false,
                    message: '请先填入有效 API Token 凭据'
                };
            }
            const adapter = getAdapter('novelai');
            adapter.setBaseUrl?.(connectionCard.getBaseUrl());
            if (adapter.fetchAssets) {
                return await adapter.fetchAssets(signal, { apiKey: currentToken });
            }
            return await adapter.checkHealth(signal);
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

    let drawingPresets = presetManager.list<NovelAIDrawingParams>('drawing', 'novelai');
    if (drawingPresets.length === 0) {
        drawingPresets = [
            {
                id: 'default_novelai',
                name: '默认 NAI V4.5 方案',
                isBuiltin: true,
                data: { ...DEFAULT_NOVELAI_DRAWING }
            }
        ];
    }

    let activeDrawingId = novelConfig.activeDrawingProfileId || drawingPresets[0].id;
    let currentDrawingParams: NovelAIDrawingParams = {
        ...DEFAULT_NOVELAI_DRAWING,
        ...(drawingPresets.find((p) => p.id === activeDrawingId)?.data || {})
    };

    // 表单脏状态追踪器
    const drawingDirtyTracker: IDirtyTracker<NovelAIDrawingParams> = createDirtyTracker(
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
                currentDrawingParams = { ...(drawingDirtyTracker.getBaseline() as NovelAIDrawingParams) };
                syncDrawingControls(currentDrawingParams);
                drawingDirtyTracker.setBaseline(currentDrawingParams);
            }
        }
    });
    regDisposer(drawingToolbar);
    drawingCard.append(drawingToolbar.element);

    // Section 1: 模型选择
    const modelSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '模型设置'
    });
    modelSectionTitle.style.padding = '8px 12px 4px 12px';
    modelSectionTitle.style.fontSize = '12px';
    modelSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    modelSectionTitle.style.fontWeight = '600';
    drawingCard.append(modelSectionTitle);

    const modelSelect = createSelect({
        value: currentDrawingParams.model,
        options: [
            { label: 'NAI Diffusion V4.5 Full (推荐)', value: 'nai-diffusion-4-5-full' },
            { label: 'NAI Diffusion V4.5 Curated', value: 'nai-diffusion-4-5-curated' },
            { label: 'NAI Diffusion Anime V3', value: 'nai-diffusion-3' },
            { label: 'NAI Diffusion Furry V3', value: 'nai-diffusion-furry-3' }
        ],
        onChange: (val) => {
            currentDrawingParams.model = val;
            drawingDirtyTracker.notifyFieldChange('model', val);
        }
    });
    regDisposer(modelSelect);
    const modelField: FormFieldHandle = createFormField({
        label: '生图主模型 (Model)',
        helpText: '选择使用 NovelAI 官方部署的扩散模型版本',
        control: modelSelect
    });
    regDisposer(modelField);
    drawingCard.append(modelField.element);

    // Section 2: 画幅与采样设置
    const samplingSectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '画幅与采样超参数'
    });
    samplingSectionTitle.style.padding = '8px 12px 4px 12px';
    samplingSectionTitle.style.fontSize = '12px';
    samplingSectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    samplingSectionTitle.style.fontWeight = '600';
    drawingCard.append(samplingSectionTitle);

    const dimensionPicker: DimensionPickerHandle = createDimensionPicker({
        presets: [
            { id: 'normal_portrait', label: '832 × 1216 (标准竖图 · Opus免点)', width: 832, height: 1216 },
            { id: 'normal_landscape', label: '1216 × 832 (标准横图 · Opus免点)', width: 1216, height: 832 },
            { id: 'normal_square', label: '1024 × 1024 (正方形 · Opus免点)', width: 1024, height: 1024 },
            { id: 'large_portrait', label: '1024 × 1536 (高清大图 · 需点数)', width: 1024, height: 1536 },
            { id: 'wallpaper', label: '1920 × 1088 (超宽壁纸 · 需点数)', width: 1920, height: 1088 },
            { id: 'custom', label: '自定义画幅尺寸', width: 832, height: 1216 }
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

    const samplerSelect = createSelect({
        value: currentDrawingParams.sampler,
        options: [
            { label: 'k_euler_ancestral (推荐 · 细节生动)', value: 'k_euler_ancestral' },
            { label: 'k_euler', value: 'k_euler' },
            { label: 'k_dpmpp_2m', value: 'k_dpmpp_2m' },
            { label: 'k_dpmpp_sde', value: 'k_dpmpp_sde' },
            { label: 'ddim_v3', value: 'ddim_v3' }
        ],
        onChange: (val) => {
            currentDrawingParams.sampler = val;
            drawingDirtyTracker.notifyFieldChange('sampler', val);
        }
    });
    regDisposer(samplerSelect);
    const samplerField: FormFieldHandle = createFormField({
        label: '采样方法 (Sampler)',
        helpText: '降噪迭代算法，Euler Ancestral 适合人物动漫',
        control: samplerSelect
    });
    regDisposer(samplerField);
    drawingCard.append(samplerField.element);

    const schedulerSelect = createSelect({
        value: currentDrawingParams.scheduler,
        options: [
            { label: 'karras (经典平滑 · 官方推荐)', value: 'karras' },
            { label: 'native (原生步进)', value: 'native' },
            { label: 'exponential (指数衰减)', value: 'exponential' }
        ],
        onChange: (val) => {
            currentDrawingParams.scheduler = val;
            drawingDirtyTracker.notifyFieldChange('scheduler', val);
        }
    });
    regDisposer(schedulerSelect);
    const schedulerField: FormFieldHandle = createFormField({
        label: '调度类型 (Schedule)',
        helpText: '决定各步降噪幅度分布的平滑曲线',
        control: schedulerSelect
    });
    regDisposer(schedulerField);
    drawingCard.append(schedulerField.element);

    const stepsInput: NumberInputHandle = createNumberInput({
        value: currentDrawingParams.steps,
        min: 1,
        max: 50,
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
        helpText: '生成迭代步数，Opus 免费额度最高支持 28 步',
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
        helpText: '控制图像与提示词贴合度，NovelAI 推荐 4.0 ~ 6.0',
        control: cfgInput
    });
    regDisposer(cfgField);
    drawingCard.append(cfgField.element);

    const cfgRescaleInput: NumberInputHandle = createNumberInput({
        value: currentDrawingParams.cfgRescale,
        min: 0,
        max: 1,
        step: 0.05,
        onChange: (val) => {
            currentDrawingParams.cfgRescale = val;
            drawingDirtyTracker.notifyFieldChange('cfgRescale', val);
        }
    });
    regDisposer(cfgRescaleInput);
    const cfgRescaleField: FormFieldHandle = createFormField({
        label: '色彩过饱和抑制 (CFG Rescale)',
        helpText: '降低高 CFG 下画面过度对比度与烧焦失真，推荐 0.0 ~ 0.4',
        control: cfgRescaleInput
    });
    regDisposer(cfgRescaleField);
    drawingCard.append(cfgRescaleField.element);

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
        helpText: '生成随机数起点，填 -1 表示每次随机出图',
        control: seedInput
    });
    regDisposer(seedField);
    drawingCard.append(seedField.element);

    // Section 3: 画质与生成控制
    const qualitySectionTitle = createElement('div', {
        className: 'da-form-section-title',
        textContent: '画质与生成控制'
    });
    qualitySectionTitle.style.padding = '8px 12px 4px 12px';
    qualitySectionTitle.style.fontSize = '12px';
    qualitySectionTitle.style.color = 'var(--da-accent, #8b5cf6)';
    qualitySectionTitle.style.fontWeight = '600';
    drawingCard.append(qualitySectionTitle);

    const ucPresetSelect = createSelect({
        value: currentDrawingParams.ucPreset,
        options: [
            { label: '重度过滤 (Heavy · 官方推荐)', value: 'heavy' },
            { label: '轻度过滤 (Light)', value: 'light' },
            { label: '人类重度 (Human Focus)', value: 'human' },
            { label: '完全不过滤 (None)', value: 'none' }
        ],
        onChange: (val) => {
            currentDrawingParams.ucPreset = val;
            drawingDirtyTracker.notifyFieldChange('ucPreset', val);
        }
    });
    regDisposer(ucPresetSelect);
    const ucPresetField: FormFieldHandle = createFormField({
        label: '负向词预设 (UC Preset)',
        helpText: 'NovelAI 官方提供的基础负向词模板档位',
        control: ucPresetSelect
    });
    regDisposer(ucPresetField);
    drawingCard.append(ucPresetField.element);

    const qualityTagsToggle: ToggleHandle = createToggle({
        value: currentDrawingParams.qualityTags,
        onChange: (val) => {
            currentDrawingParams.qualityTags = val;
            drawingDirtyTracker.notifyFieldChange('qualityTags', val);
        }
    });
    regDisposer(qualityTagsToggle);
    const qualityTagsField: FormFieldHandle = createFormField({
        label: '添加官方画质标签',
        helpText: '自动附加 best quality, amazing quality 等官方调优标签',
        control: qualityTagsToggle
    });
    regDisposer(qualityTagsField);
    drawingCard.append(qualityTagsField.element);

    const syntaxToggle: ToggleHandle = createToggle({
        value: currentDrawingParams.convertSyntax,
        onChange: (val) => {
            currentDrawingParams.convertSyntax = val;
            drawingDirtyTracker.notifyFieldChange('convertSyntax', val);
        }
    });
    regDisposer(syntaxToggle);
    const syntaxField: FormFieldHandle = createFormField({
        label: '语法智能转换',
        helpText: '自动将 WebUI 权重语法 (tag:1.2) 转换为 NovelAI 花括号语法 {tag}',
        control: syntaxToggle
    });
    regDisposer(syntaxField);
    drawingCard.append(syntaxField.element);

    const smeaSelect = createSelect({
        value: currentDrawingParams.smeaMode,
        options: [
            { label: '关闭 (None)', value: 'none' },
            { label: 'SMEA (细节平滑)', value: 'smea' },
            { label: 'SMEA + DYN (动态高频采样 · 仅V3)', value: 'smea_dyn' }
        ],
        onChange: (val) => {
            currentDrawingParams.smeaMode = val;
            drawingDirtyTracker.notifyFieldChange('smeaMode', val);
        }
    });
    regDisposer(smeaSelect);
    const smeaField: FormFieldHandle = createFormField({
        label: 'SMEA 细节增强模式',
        helpText: '专用于 V3 模型的细节采样稳定机制，避免大分辨率下的肢体变形',
        control: smeaSelect
    });
    regDisposer(smeaField);
    drawingCard.append(smeaField.element);

    const decrisperToggle: ToggleHandle = createToggle({
        value: currentDrawingParams.decrisper,
        onChange: (val) => {
            currentDrawingParams.decrisper = val;
            drawingDirtyTracker.notifyFieldChange('decrisper', val);
        }
    });
    regDisposer(decrisperToggle);
    const decrisperField: FormFieldHandle = createFormField({
        label: '去焦平滑 (Decrisper)',
        helpText: '消除高饱和度和伪影颗粒感',
        control: decrisperToggle
    });
    regDisposer(decrisperField);
    drawingCard.append(decrisperField.element);

    const varietyToggle: ToggleHandle = createToggle({
        value: currentDrawingParams.variety,
        onChange: (val) => {
            currentDrawingParams.variety = val;
            drawingDirtyTracker.notifyFieldChange('variety', val);
        }
    });
    regDisposer(varietyToggle);
    const varietyField: FormFieldHandle = createFormField({
        label: '构图多样化 (Variety)',
        helpText: '提升相同 Seed 和提示词下的构图随机丰富性',
        control: varietyToggle
    });
    regDisposer(varietyField);
    drawingCard.append(varietyField.element);

    // Section 4: 关联提示词预设
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
        helpText: '当前绘图方案关联生效的正反向词预设配置',
        control: promptProfileSelect
    });
    regDisposer(promptProfileField);
    drawingCard.append(promptProfileField.element);

    root.appendChild(drawingCard.element);

    const syncDrawingControls = (params: NovelAIDrawingParams) => {
        modelSelect.setValue(params.model);
        dimensionPicker.setValue({ width: params.width, height: params.height });
        samplerSelect.setValue(params.sampler);
        schedulerSelect.setValue(params.scheduler);
        stepsInput.setValue(params.steps);
        cfgInput.setValue(params.cfgScale);
        cfgRescaleInput.setValue(params.cfgRescale);
        seedInput.setValue(params.seed);
        ucPresetSelect.setValue(params.ucPreset);
        qualityTagsToggle.setValue(params.qualityTags);
        syntaxToggle.setValue(params.convertSyntax);
        smeaSelect.setValue(params.smeaMode);
        decrisperToggle.setValue(params.decrisper);
        varietyToggle.setValue(params.variety);
        promptProfileSelect.setValue(params.promptProfileId);
    };

    // 3. PromptPresetManager (正反提示词, 隐藏 LoRA)
    const syncPromptPresets = () => {
        const updated = presetManager.list('prompts') || BUILTIN_PROMPTS;
        promptProfileSelect.setOptions(updated.map((p: PresetItem) => ({ label: p.name, value: p.id })));
    };

    const promptPresetManager: PromptPresetManagerHandle = createPromptPresetManager({
        presets: promptPresets as PresetItem<PromptPresetData>[],
        activePresetId: currentDrawingParams.promptProfileId || promptPresets[0]?.id || 'default',
        showLora: false, // NovelAI 官方直连模式下隐藏 LoRA 模块
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
