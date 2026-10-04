/**
 * NovelAI 绘图服务专属设置选项卡主视图 (NovelAITabView)。
 *
 * @remarks
 * 为 NovelAI 官方云端图像生成服务提供专属设置与预设管理能力：
 * 1. 服务通信与鉴权：配置官方 Base URL 与 Bearer Token，支持服务端健康探测；
 * 2. 预设工具栏：集成 PresetToolbar 提供统一的预设切换、新增、克隆、导入导出与删除能力；
 * 3. 核心模型与提示词增强：支持 V5/V4.5/V4/V3 旗舰模型家族、负向模板预设 (Undesired Content Preset)、画质词自动追加与语法转换；
 * 4. 尺寸与采样超参：严格对齐 64 像素画幅约束、采样算法与 CFG Rescale 引导重缩放；
 * 5. 渲染增强特性：SMEA 多通正弦采样、DYN 动态增强与 Decrisper 焦黑抑制；
 * 6. 变更检测与依赖校验：集中比对草稿与持久化快照驱动 .is-dirty 黄框，引用的提示词失效时驱动 .is-invalid 红框；
 * 7. 单一事实来源：通信归属 providers.novelai，绘画参数归属 drawing/novelai，提示词通过 promptPresetId 绑定。
 */

import type { SettingsView } from '../types';
import type { DrawingPresetData, PresetItem, PromptPresetData } from '@types';
import { Card } from '../components/card';
import { FormField } from '../components/form-field';
import { Select } from '../components/select';
import { Slider } from '../components/slider';
import { Switch } from '../components/switch';
import { ConnectionCard } from '../composite/connection-card';
import { PresetToolbar } from '../composite/preset-toolbar';
import { DimensionPicker } from '../composite/dimension-picker';
import { SamplerCard } from '../composite/sampler-card';
import { PromptPresetManager, type PromptCardData } from '../composite/prompt-preset-manager';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';
import { eventBus } from '../../util/event-bus';
import { logger } from '../../util/logger';
import { Toast } from '../feedback/toast';

/** NovelAI 官方已知生图模型候选列表 */
const NOVELAI_MODEL_OPTIONS = [
    { label: 'NAI Diffusion Anime V5 (Full)', value: 'nai-diffusion-5-full' },
    { label: 'NAI Diffusion Anime V5 (Curated)', value: 'nai-diffusion-5-curated-preview' },
    { label: 'NAI Diffusion Anime V4.5 (Full)', value: 'nai-diffusion-4-5-full' },
    { label: 'NAI Diffusion Anime V4.5 (Curated)', value: 'nai-diffusion-4-5-curated-preview' },
    { label: 'NAI Diffusion Anime V4 (Full)', value: 'nai-diffusion-4-full' },
    { label: 'NAI Diffusion Anime V4 (Curated)', value: 'nai-diffusion-4-curated-preview' },
    { label: 'NAI Diffusion Anime V3', value: 'nai-diffusion-3' },
    { label: 'NAI Diffusion Furry V3', value: 'nai-diffusion-furry-3' },
];

/** 负向模板预设候选列表 (Undesired Content Preset) */
const UC_PRESET_OPTIONS = [
    { label: 'Heavy (强力防崩通用模板)', value: 'Heavy' },
    { label: 'Light (轻度负向过滤模板)', value: 'Light' },
    { label: 'Human Focus (人物主体聚焦模板)', value: 'Human Focus' },
    { label: 'None (完全不使用预设负向)', value: 'None' },
];

/** SMEA 多通渲染模式选项列表 */
const SMEA_MODE_OPTIONS = [
    { label: 'SMEA + DYN (动态高分辨率增强)', value: 'smea_dyn' },
    { label: 'SMEA (多通正弦采样增强)', value: 'smea' },
    { label: 'None (关闭 SMEA 增强)', value: 'none' },
];

/** NovelAI 官方推荐采样算法列表 */
const NOVELAI_SAMPLER_OPTIONS = [
    { label: 'k_euler', value: 'k_euler' },
    { label: 'k_euler_ancestral', value: 'k_euler_ancestral' },
    { label: 'k_dpmpp_2s_ancestral', value: 'k_dpmpp_2s_ancestral' },
    { label: 'k_dpmpp_2m', value: 'k_dpmpp_2m' },
    { label: 'k_dpmpp_sde', value: 'k_dpmpp_sde' },
    { label: 'ddim', value: 'ddim' },
];

export class NovelAITabView implements SettingsView {
    public readonly id = 'novelai';
    public readonly title = 'NovelAI';
    public readonly element: HTMLElement;

    // 复合组件成员
    private connectionCard!: ConnectionCard;
    private presetToolbar!: PresetToolbar;
    private dimensionPicker!: DimensionPicker;
    private samplerCard!: SamplerCard;
    private promptPresetManager!: PromptPresetManager;

    // 模型版本与提示词增强卡片原子控件
    private modelSelect!: Select;
    private ucPresetSelect!: Select;
    private qualityTagsSwitch!: Switch;
    private convertSyntaxSwitch!: Switch;
    private promptPresetSelect!: Select;

    // 尺寸与采样高级控件
    private cfgRescaleSlider!: Slider;
    private cfgRescaleField!: FormField;

    // 渲染增强高级特性控件
    private smeaModeSelect!: Select;
    private smeaModeField!: FormField;
    private decrisperSwitch!: Switch;
    private decrisperField!: FormField;

    // 状态管理
    private currentPresetItem: PresetItem<DrawingPresetData> | null = null;
    private initialPresetSnapshot: DrawingPresetData = {};
    private runtimeConfig: DrawingPresetData = {};
    private readonly dirtyFields = new Set<string>();
    private readonly disposables: Array<{ dispose: () => void }> = [];
    private unlistenSettings: (() => void) | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.classList.add('da-tab-pane', 'da-view-novelai');

        // 1. 初始化解析当前激活方案（单一事实 SSOT）
        const cfg = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('novelai');
        const activeDrawingId = cfg?.activeDrawingPresetId ?? '';
        this.applyActivePreset(activeDrawingId, { persist: false, silent: true });

        // 2. 组装卡片层次结构与初值回填
        this.buildView();
    }

    // 1. 方案激活与状态重置

    /**
     * 单一入口统一处理：应用并切换激活的绘图预设方案。
     *
     * @param presetId 目标方案标识符
     * @param options 配置选项 (persist: 是否持久化至 providers.novelai, silent: 是否跳过控件更新)
     */
    private applyActivePreset(presetId: string, options?: { persist?: boolean; silent?: boolean }): void {
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'novelai');
        let target = presets.find((p) => p.id === presetId);

        if (!target && presets.length > 0) {
            target = presets[0];
        }

        if (target) {
            this.currentPresetItem = target;
            this.initialPresetSnapshot = structuredClone(target.data || {});
            this.runtimeConfig = structuredClone(target.data || {});

            const currentActiveId = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('novelai')?.activeDrawingPresetId;
            if (options?.persist !== false && target.id !== currentActiveId) {
                settingsStore.setProviderConfig('novelai', {
                    activeDrawingPresetId: target.id,
                });
            }
        } else {
            // 白板状态：无激活方案，保留当前草稿，清空持久化 ID
            this.currentPresetItem = null;
            this.initialPresetSnapshot = {};
            if (options?.persist !== false) {
                settingsStore.setProviderConfig('novelai', {
                    activeDrawingPresetId: '',
                });
            }
        }

        if (!options?.silent) {
            // 刷新工具栏并回填表单
            this.presetToolbar.setPresets(
                presets.map((p) => ({ id: p.id, name: p.name })),
                this.currentPresetItem?.id || ''
            );
            this.syncControlsFromRuntime();
        }
    }

    // 2. 界面视图与卡片装配

    private buildView(): void {
        this.buildConnectionCard();
        this.buildPresetToolbar();
        this.buildModelCard();
        this.buildDimensionAndSamplingCard();
        this.buildAdvancedCard();
        this.buildPromptPresetManagementCard();

        // 初始填充工具栏与回填数据
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'novelai');
        this.presetToolbar.setPresets(
            presets.map((p) => ({ id: p.id, name: p.name })),
            this.currentPresetItem?.id || ''
        );
        this.syncControlsFromRuntime();
    }

    /**
     * 服务连接与状态探测卡片 (ConnectionCard)
     */
    private buildConnectionCard(): void {
        const cfg = settingsStore.getProviderConfig<{ serverUrl?: string; apiKey?: string }>('novelai');

        this.connectionCard = new ConnectionCard({
            initialData: {
                serverUrl: cfg?.serverUrl || 'https://image.novelai.net',
                apiKey: cfg?.apiKey || '',
            },
            showApiKey: true,
            onChange: (data) => {
                settingsStore.setProviderConfig('novelai', {
                    serverUrl: data.serverUrl,
                    apiKey: data.apiKey,
                });
            },
            onTestPing: async (_serverUrl: string, _apiKey?: string) => {
                const provider = providerRegistry.getProvider('novelai');
                if (!provider?.checkHealth) {
                    throw new Error('未注册 NovelAI 服务提供方');
                }
                return await provider.checkHealth();
            },
            onFetchAssets: async () => {
                const provider = providerRegistry.getProvider('novelai');
                if (!provider?.fetchModels) {
                    throw new Error('未注册 NovelAI 服务提供方');
                }
                const models = await provider.fetchModels();
                return {
                    count: models.length,
                    message: `已获取 ${models.length} 个官方模型`,
                };
            },
        });

        this.element.appendChild(this.connectionCard.element);
        this.disposables.push(this.connectionCard);
    }

    /**
     * 绘画参数方案管理工具栏 (PresetToolbar)
     */
    private buildPresetToolbar(): void {
        this.presetToolbar = new PresetToolbar({
            presets: [],
            activePresetId: '',
            onAction: (action, presetId) => {
                this.handlePresetAction(action, presetId);
            },
            onImportFile: (file) => {
                this.handleImportFile(file);
            },
        });

        this.element.appendChild(this.presetToolbar.element);
        this.disposables.push(this.presetToolbar);
    }

    /**
     * 模型版本与提示词增强卡片 (ModelCard)
     */
    private buildModelCard(): void {
        const card = new Card({
            title: '模型版本与提示词增强',
            subtitle: '配置 NovelAI 核心生成模型、官方负向过滤模板及语法处理开关',
            collapsible: true,
        });

        // 1. 核心生图模型
        const initialModel = this.runtimeConfig.baseModel || 'nai-diffusion-4-5-full';
        this.modelSelect = new Select({
            options: NOVELAI_MODEL_OPTIONS,
            value: initialModel,
            onChange: (val) => {
                this.runtimeConfig.baseModel = val;
                this.updateSmeaVisibilityByModel(val);
                this.evaluateDirtyState();
            },
        });
        const modelField = new FormField({
            label: '核心生图模型',
            tooltip: 'NovelAI 官方画质生成模型家族，V5 与 V4.5 具备强大的动漫人物理解能力',
            control: this.modelSelect,
        });
        card.getBodyElement().appendChild(modelField.element);
        this.disposables.push(modelField, this.modelSelect);

        // 2. 负向模板预设 (Undesired Content Preset)
        const initialUc = (this.runtimeConfig.ucPreset as string) || 'Heavy';
        this.ucPresetSelect = new Select({
            options: UC_PRESET_OPTIONS,
            value: initialUc,
            onChange: (val) => {
                this.runtimeConfig.ucPreset = val;
                this.evaluateDirtyState();
            },
        });
        const ucField = new FormField({
            label: '负向模板预设',
            tooltip: 'Undesired Content 官方内置负向过滤模板，Heavy 防崩较强，None 表示完全纯净',
            control: this.ucPresetSelect,
        });
        card.getBodyElement().appendChild(ucField.element);
        this.disposables.push(ucField, this.ucPresetSelect);

        // 3. 关联的提示词预设方案 (SSOT)
        const initialPromptId = this.runtimeConfig.promptPresetId ?? '';
        this.promptPresetSelect = new Select({
            options: this.buildPromptPresetOptions(initialPromptId),
            value: initialPromptId,
            placeholder: '选择关联提示词预设方案',
            onChange: (val) => {
                this.runtimeConfig.promptPresetId = val;
                this.evaluateDirtyState();
            },
        });
        const promptField = new FormField({
            label: '提示词预设方案',
            tooltip: '关联的提示词词库模板。出图时将自动融合正向前缀、正向后缀与负向通用过滤词',
            control: this.promptPresetSelect,
        });
        card.getBodyElement().appendChild(promptField.element);
        this.disposables.push(promptField, this.promptPresetSelect);

        // 4. 自动追加画质标签 (Quality Tags)
        this.qualityTagsSwitch = new Switch({
            value: Boolean(this.runtimeConfig.qualityTags !== false),
            label: '自动追加画质标签',
            onChange: (val) => {
                this.runtimeConfig.qualityTags = val;
                this.evaluateDirtyState();
            },
        });
        const qualityField = new FormField({
            label: '自动追加画质标签',
            tooltip: '生成时自动在提示词前追加 masterpiece, best quality 等官方推荐画质标签',
            control: this.qualityTagsSwitch,
        });
        card.getBodyElement().appendChild(qualityField.element);
        this.disposables.push(qualityField, this.qualityTagsSwitch);

        // 5. 权重语法自动转换 (Convert Syntax)
        this.convertSyntaxSwitch = new Switch({
            value: Boolean(this.runtimeConfig.convertSyntax !== false),
            label: '权重语法自动转换',
            onChange: (val) => {
                this.runtimeConfig.convertSyntax = val;
                this.evaluateDirtyState();
            },
        });
        const syntaxField = new FormField({
            label: '权重语法自动转换',
            tooltip: '自动将 SD 风格 (tag:1.2) 转换为 NovelAI 专有的 {tag} 花括号增强语法',
            control: this.convertSyntaxSwitch,
        });
        card.getBodyElement().appendChild(syntaxField.element);
        this.disposables.push(syntaxField, this.convertSyntaxSwitch);

        this.element.appendChild(card.element);
        this.disposables.push(card);
    }

    /**
     * 画幅尺寸与采样控制卡片 (DimensionPicker + SamplerCard + CFG Rescale)
     */
    private buildDimensionAndSamplingCard(): void {
        const card = new Card({
            title: '画幅尺寸与采样控制',
            subtitle: '设置生成画幅尺寸（须 64 像素对齐）与采样步数、调度等核心参数',
            collapsible: true,
        });

        // 1. 画幅尺寸选择器
        this.dimensionPicker = new DimensionPicker({
            initialData: {
                width: this.runtimeConfig.width || 832,
                height: this.runtimeConfig.height || 1216,
            },
            alignMultiple: 64,
            onChange: (dims) => {
                this.runtimeConfig.width = dims.width;
                this.runtimeConfig.height = dims.height;
                this.evaluateDirtyState();
            },
        });
        card.getBodyElement().appendChild(this.dimensionPicker.element);
        this.disposables.push(this.dimensionPicker);

        // 2. 核心采样参数复合卡片
        this.samplerCard = new SamplerCard({
            title: '核心采样参数',
            subtitle: '控制采样算法、步数、引导系数 (CFG) 与随机种子',
            showScheduler: false,
            showDenoise: false,
            initialSamplers: NOVELAI_SAMPLER_OPTIONS,
            initialData: {
                samplerName: this.runtimeConfig.samplerName || 'k_euler',
                steps: this.runtimeConfig.steps || 28,
                cfgScale: this.runtimeConfig.cfgScale || 5.0,
                seed: this.runtimeConfig.seed ?? -1,
            },
            onChange: (s) => {
                this.runtimeConfig.samplerName = s.samplerName;
                this.runtimeConfig.steps = s.steps;
                this.runtimeConfig.cfgScale = s.cfgScale;
                this.runtimeConfig.seed = s.seed;
                this.evaluateDirtyState();
            },
        });
        card.getBodyElement().appendChild(this.samplerCard.element);
        this.disposables.push(this.samplerCard);

        // 3. 引导重缩放 (CFG Rescale)
        const initialRescale = Number(this.runtimeConfig.cfgRescale ?? 0.0);
        this.cfgRescaleSlider = new Slider({
            min: 0.0,
            max: 1.0,
            step: 0.05,
            value: initialRescale,
            defaultValue: 0.0,
            precision: 2,
            onChange: (val) => {
                this.runtimeConfig.cfgRescale = val;
                this.evaluateDirtyState();
            },
        });
        this.cfgRescaleField = new FormField({
            label: '引导重缩放',
            tooltip: 'CFG Rescale 算法。有效降低高引导系数 (CFG) 引起的色彩过饱和与过曝失真',
            control: this.cfgRescaleSlider,
        });
        card.getBodyElement().appendChild(this.cfgRescaleField.element);
        this.disposables.push(this.cfgRescaleField, this.cfgRescaleSlider);

        this.element.appendChild(card.element);
        this.disposables.push(card);
    }

    /**
     * 渲染增强与高级特性卡片 (Card: 渲染增强与高级特性)
     */
    private buildAdvancedCard(): void {
        const card = new Card({
            title: '渲染增强与高级特性',
            subtitle: 'SMEA 多通正弦采样增强与 Decrisper 焦黑抑制',
            collapsible: true,
        });

        // 1. SMEA 模式 (仅在 V3 系列模型下生效)
        const initialSmea = (this.runtimeConfig.smeaMode as string) || 'smea_dyn';
        this.smeaModeSelect = new Select({
            options: SMEA_MODE_OPTIONS,
            value: initialSmea,
            onChange: (val) => {
                this.runtimeConfig.smeaMode = val;
                this.evaluateDirtyState();
            },
        });
        this.smeaModeField = new FormField({
            label: 'SMEA 渲染模式',
            tooltip: '多通正弦采样算法（仅限 V3 模型）。有效抑制高分辨率生成时的人物多肢体崩坏',
            control: this.smeaModeSelect,
        });
        card.getBodyElement().appendChild(this.smeaModeField.element);
        this.disposables.push(this.smeaModeField, this.smeaModeSelect);

        // 2. 焦黑抑制 (Decrisper)
        this.decrisperSwitch = new Switch({
            value: Boolean(this.runtimeConfig.decrisper),
            label: '启用焦黑抑制',
            onChange: (val) => {
                this.runtimeConfig.decrisper = val;
                this.evaluateDirtyState();
            },
        });
        this.decrisperField = new FormField({
            label: '焦黑抑制 (Decrisper)',
            tooltip: '平滑色彩高频边缘，减少过锐化造成的杂色斑点与焦黑伪影',
            control: this.decrisperSwitch,
        });
        card.getBodyElement().appendChild(this.decrisperField.element);
        this.disposables.push(this.decrisperField, this.decrisperSwitch);

        this.element.appendChild(card.element);
        this.disposables.push(card);

        // 依据当前模型判断 SMEA 控件状态
        this.updateSmeaVisibilityByModel(this.runtimeConfig.baseModel || '');
    }

    /**
     * 提示词预设方案管理卡片 (默认折叠收纳，NovelAI 官方服务不支持外置 LoRA 模型)
     */
    private buildPromptPresetManagementCard(): void {
        const promptPresets = settingsStore.getPresets<PromptPresetData>('prompts');
        const activePromptId = this.runtimeConfig.promptPresetId ?? promptPresets[0]?.id ?? '';

        this.promptPresetManager = new PromptPresetManager({
            presets: promptPresets.map((p) => ({
                id: p.id,
                name: p.name,
                data: {
                    positivePrefix: p.data?.positivePrefix || '',
                    positiveSuffix: p.data?.positiveSuffix || '',
                    negativePrompt: p.data?.negativePrompt || '',
                    loras: [],
                },
            })),
            activePresetId: activePromptId,
            showLora: false,
            mode: 'standard',
            onAction: (action, pId, data) => {
                this.handlePromptAssetAction(action, pId, data);
            },
        });

        // 默认折叠收纳
        this.promptPresetManager.card.setCollapsed(true);

        this.element.appendChild(this.promptPresetManager.element);
        this.disposables.push(this.promptPresetManager);
    }

    // 3. 表单变更检测与依赖校验

    /**
     * 检测表单当前输入与方案基准值的差异，同步标记变更字段并驱动工具栏状态。
     */
    private evaluateDirtyState(): void {
        const cur = this.runtimeConfig;
        const base = this.initialPresetSnapshot;

        this.dirtyFields.clear();

        // 1. 模型网络与提示词增强
        const isModelDirty = String(cur.baseModel ?? '') !== String(base.baseModel ?? '');
        this.modelSelect.setDirty(isModelDirty);
        if (isModelDirty) this.dirtyFields.add('baseModel');

        const isUcDirty = String(cur.ucPreset ?? '') !== String(base.ucPreset ?? '');
        this.ucPresetSelect.setDirty(isUcDirty);
        if (isUcDirty) this.dirtyFields.add('ucPreset');

        const curPromptId = cur.promptPresetId ?? '';
        const basePromptId = base.promptPresetId ?? '';
        const isPromptDirty = String(curPromptId) !== String(basePromptId);
        this.promptPresetSelect.setDirty(isPromptDirty);
        if (isPromptDirty) this.dirtyFields.add('promptPresetId');

        const isQualityDirty = Boolean(cur.qualityTags !== false) !== Boolean(base.qualityTags !== false);
        this.qualityTagsSwitch.setDirty(isQualityDirty);
        if (isQualityDirty) this.dirtyFields.add('qualityTags');

        const isSyntaxDirty = Boolean(cur.convertSyntax !== false) !== Boolean(base.convertSyntax !== false);
        this.convertSyntaxSwitch.setDirty(isSyntaxDirty);
        if (isSyntaxDirty) this.dirtyFields.add('convertSyntax');

        // 2. 画幅尺寸字段
        const isDimsDirty = cur.width !== base.width || cur.height !== base.height;
        this.dimensionPicker.element.classList.toggle('is-dirty', isDimsDirty);
        if (isDimsDirty) this.dirtyFields.add('dimensions');

        // 3. 采样超参数字段
        const isSamplerDirty =
            cur.samplerName !== base.samplerName ||
            cur.steps !== base.steps ||
            cur.cfgScale !== base.cfgScale ||
            cur.seed !== base.seed;
        this.samplerCard.element.classList.toggle('is-dirty', isSamplerDirty);
        if (isSamplerDirty) this.dirtyFields.add('sampler');

        const isRescaleDirty = Number(cur.cfgRescale ?? 0.0) !== Number(base.cfgRescale ?? 0.0);
        this.cfgRescaleField.setDirty(isRescaleDirty);
        if (isRescaleDirty) this.dirtyFields.add('cfgRescale');

        // 4. 高级渲染特性字段
        const isSmeaDirty = String(cur.smeaMode ?? '') !== String(base.smeaMode ?? '');
        this.smeaModeSelect.setDirty(isSmeaDirty);
        if (isSmeaDirty) this.dirtyFields.add('smeaMode');

        const isDecrisperDirty = Boolean(cur.decrisper) !== Boolean(base.decrisper);
        this.decrisperField.setDirty(isDecrisperDirty);
        if (isDecrisperDirty) this.dirtyFields.add('decrisper');

        // 5. 校验绑定有效性并驱动工具栏
        this.validateBindings();
        this.presetToolbar.setDirty(this.dirtyFields.size > 0);
    }

    /**
     * 检查引用的提示词预设是否存在；若引用失效，为对应控件添加错误标记。
     */
    private validateBindings(): void {
        const prompts = settingsStore.getPresets<PromptPresetData>('prompts');
        const promptId = this.runtimeConfig.promptPresetId;
        const isPromptInvalid = Boolean(promptId && !prompts.some((p) => p.id === promptId));
        this.setControlInvalid(this.promptPresetSelect, isPromptInvalid);
    }

    /**
     * 设置控件的 .is-invalid 校验样式。
     */
    private setControlInvalid(control: Select, isInvalid: boolean): void {
        control.element.classList.toggle('is-invalid', isInvalid);
        const sel = control.element.querySelector('select');
        if (sel) {
            sel.classList.toggle('is-invalid', isInvalid);
        }
    }

    /**
     * 将当前生效的运行时配置同步回填至各子控件，并重置表单变更状态。
     */
    private syncControlsFromRuntime(): void {
        const cfg = this.runtimeConfig;

        // 1. 模型版本与提示词增强回填
        if (this.modelSelect) {
            this.modelSelect.setValue(cfg.baseModel || 'nai-diffusion-4-5-full', { silent: true });
            this.updateSmeaVisibilityByModel(cfg.baseModel || '');
        }

        if (this.ucPresetSelect) {
            this.ucPresetSelect.setValue((cfg.ucPreset as string) || 'Heavy', { silent: true });
        }

        const boundPromptId = cfg.promptPresetId ?? '';
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(boundPromptId));
        this.promptPresetSelect.setValue(boundPromptId, { silent: true });

        if (this.qualityTagsSwitch) {
            this.qualityTagsSwitch.setValue(Boolean(cfg.qualityTags !== false), { silent: true });
        }

        if (this.convertSyntaxSwitch) {
            this.convertSyntaxSwitch.setValue(Boolean(cfg.convertSyntax !== false), { silent: true });
        }

        // 2. 画幅尺寸回填
        if (this.dimensionPicker) {
            this.dimensionPicker.setData({
                width: cfg.width || 832,
                height: cfg.height || 1216,
            });
            this.dimensionPicker.element.classList.remove('is-dirty');
        }

        // 3. 采样控制回填
        if (this.samplerCard) {
            this.samplerCard.setData({
                samplerName: cfg.samplerName || 'k_euler',
                steps: cfg.steps || 28,
                cfgScale: cfg.cfgScale || 5.0,
                seed: cfg.seed ?? -1,
            });
            this.samplerCard.element.classList.remove('is-dirty');
        }

        if (this.cfgRescaleSlider) {
            this.cfgRescaleSlider.setValue(Number(cfg.cfgRescale ?? 0.0), { silent: true });
            this.cfgRescaleField.setDirty(false);
        }

        // 4. 高级渲染特性回填
        if (this.smeaModeSelect) {
            this.smeaModeSelect.setValue((cfg.smeaMode as string) || 'smea_dyn', { silent: true });
        }

        if (this.decrisperSwitch) {
            this.decrisperSwitch.setValue(Boolean(cfg.decrisper), { silent: true });
            this.decrisperField.setDirty(false);
        }

        // 5. 清除所有控件变更标记
        this.modelSelect?.setDirty(false);
        this.ucPresetSelect?.setDirty(false);
        this.promptPresetSelect?.setDirty(false);
        this.qualityTagsSwitch?.setDirty(false);
        this.convertSyntaxSwitch?.setDirty(false);
        this.smeaModeSelect?.setDirty(false);

        this.dirtyFields.clear();
        this.presetToolbar.setDirty(false);
        this.validateBindings();
    }

    /**
     * 依据所选模型动态控制 SMEA 设置项的启用与禁用。
     *
     * @param modelId 模型标识符
     */
    private updateSmeaVisibilityByModel(modelId: string): void {
        const isV3 = modelId.includes('-3') || modelId.includes('v3');
        if (this.smeaModeSelect) {
            this.smeaModeSelect.setDisabled(!isV3);
        }
    }

    /**
     * 构建提示词预设方案下拉列表选项。
     */
    private buildPromptPresetOptions(activeId?: string): Array<{ label: string; value: string }> {
        const prompts = settingsStore.getPresets<PromptPresetData>('prompts');
        const opts: Array<{ label: string; value: string }> = [
            { label: '选择关联提示词预设方案', value: '' },
        ];

        let found = false;
        for (const p of prompts) {
            opts.push({ label: p.name, value: p.id });
            if (p.id === activeId) found = true;
        }

        if (activeId && !found) {
            opts.push({ label: `未知提示词预设 (${activeId}) [失效]`, value: activeId });
        }

        return opts;
    }

    // 4. 方案工具栏动作编排

    private handlePresetAction(action: string, presetId?: string): void {
        switch (action) {
            case 'select':
                if (presetId) this.applyActivePreset(presetId);
                break;

            case 'new': {
                // 1. 完整性校验：核心必填项除辅助选项外必须完整
                const missing: string[] = [];
                const cfg = this.runtimeConfig;
                if (!cfg.baseModel) missing.push('模型版本');
                if (!cfg.width || !cfg.height) missing.push('画幅尺寸 (宽/高)');
                if (!cfg.samplerName) missing.push('采样算法');
                if (cfg.steps === undefined || cfg.steps === null || Number.isNaN(cfg.steps)) missing.push('采样步数');
                if (cfg.cfgScale === undefined || cfg.cfgScale === null || Number.isNaN(cfg.cfgScale)) missing.push('提示词引导系数 (CFG)');

                if (missing.length > 0) {
                    Toast.show(`无法创建方案，以下必填项尚未配置：${missing.join('、')}`, { level: 'warning', duration: 3500 });
                    return;
                }

                const name = window.prompt('请输入新方案名称:', '新 NovelAI 绘图方案');
                if (!name || !name.trim()) return;

                const newId = `novelai_${Date.now()}`;
                const newPreset: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: name.trim(),
                    data: structuredClone(this.runtimeConfig),
                };

                settingsStore.savePreset('drawing', newPreset, 'novelai');
                this.applyActivePreset(newId);
                break;
            }

            case 'save':
                if (this.currentPresetItem) {
                    const toSave: PresetItem<DrawingPresetData> = {
                        ...this.currentPresetItem,
                        data: structuredClone(this.runtimeConfig),
                    };
                    settingsStore.savePreset('drawing', toSave, 'novelai');
                    this.initialPresetSnapshot = structuredClone(this.runtimeConfig);
                    this.dirtyFields.clear();
                    this.presetToolbar.setDirty(false);
                    this.syncControlsFromRuntime();
                    logger.info(`[NovelAITabView] 已保存方案: ${toSave.name}`);
                }
                break;

            case 'saveAs': {
                if (!this.currentPresetItem) return;
                const newId = `novelai_${Date.now()}`;
                const cloned: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: `${this.currentPresetItem.name} (副本)`,
                    data: structuredClone(this.runtimeConfig),
                };
                settingsStore.savePreset('drawing', cloned, 'novelai');
                this.applyActivePreset(newId);
                break;
            }

            case 'rename': {
                if (!this.currentPresetItem) return;
                const newName = window.prompt('请输入方案新名称:', this.currentPresetItem.name);
                if (newName && newName.trim() && newName.trim() !== this.currentPresetItem.name) {
                    this.currentPresetItem.name = newName.trim();
                    settingsStore.savePreset('drawing', this.currentPresetItem, 'novelai');
                    const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'novelai');
                    this.presetToolbar.setPresets(
                        presets.map((p) => ({ id: p.id, name: p.name })),
                        this.currentPresetItem.id
                    );
                }
                break;
            }

            case 'export':
                if (this.currentPresetItem) {
                    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.currentPresetItem, null, 2));
                    const downloadAnchor = document.createElement('a');
                    downloadAnchor.setAttribute('href', dataStr);
                    downloadAnchor.setAttribute('download', `${this.currentPresetItem.name || 'novelai-preset'}.json`);
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                }
                break;

            case 'reset':
                // 放弃当前修改，重置为基准快照
                this.runtimeConfig = structuredClone(this.initialPresetSnapshot);
                this.syncControlsFromRuntime();
                break;

            case 'delete':
                if (this.currentPresetItem) {
                    const deletingId = this.currentPresetItem.id;
                    settingsStore.deletePreset('drawing', deletingId, 'novelai');
                    const remaining = settingsStore.getPresets<DrawingPresetData>('drawing', 'novelai');
                    if (remaining.length > 0) {
                        this.applyActivePreset(remaining[0].id);
                    } else {
                        // 方案池删空：保留当前草稿，置空方案 ID
                        this.currentPresetItem = null;
                        this.initialPresetSnapshot = {};
                        settingsStore.setProviderConfig('novelai', {
                            activeDrawingPresetId: '',
                        });
                        this.presetToolbar.setPresets([], '');
                        this.presetToolbar.setDirty(false);
                    }
                }
                break;
        }
    }

    private handleImportFile(file: File): void {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target?.result as string);
                const importedItem: PresetItem<DrawingPresetData> = {
                    id: `novelai_${Date.now()}`,
                    name: parsed.name || file.name.replace(/\.[^/.]+$/, ''),
                    data: parsed.data || parsed,
                };
                settingsStore.savePreset('drawing', importedItem, 'novelai');
                this.applyActivePreset(importedItem.id);
            } catch (err) {
                logger.error('[NovelAITabView] 方案导入失败:', err);
                Toast.show('方案导入解析失败，请检查 JSON 格式有效性', { level: 'error' });
            }
        };
        reader.readAsText(file);
    }

    /**
     * 处理提示词预设管理器动作并向上刷新绑定下拉列表。
     */
    private handlePromptAssetAction(
        action: string,
        pId?: string,
        data?: PromptCardData
    ): void {
        const presets = settingsStore.getPresets<PromptPresetData>('prompts');
        switch (action) {
            case 'save':
                if (pId && data) {
                    const existing = presets.find((p) => p.id === pId);
                    if (existing) {
                        existing.data = {
                            ...existing.data,
                            positivePrefix: data.positivePrefix || '',
                            positiveSuffix: data.positiveSuffix || '',
                            negativePrompt: data.negativePrompt || '',
                            loras: [],
                        };
                        settingsStore.savePreset('prompts', existing);
                    }
                }
                break;

            case 'delete':
                if (pId) {
                    settingsStore.deletePreset('prompts', pId);
                    this.refreshBindingOptions();
                }
                break;

            case 'new': {
                const name = window.prompt('请输入新提示词预设名称:', '二次元通用模板');
                if (!name || !name.trim()) return;
                const newId = `pr_${Date.now()}`;
                const newPrompt: PresetItem<PromptPresetData> = {
                    id: newId,
                    name: name.trim(),
                    data: {
                        positivePrefix: data?.positivePrefix || '',
                        positiveSuffix: data?.positiveSuffix || '',
                        negativePrompt: data?.negativePrompt || '',
                        loras: [],
                    },
                };
                settingsStore.savePreset('prompts', newPrompt);
                this.refreshBindingOptions();
                break;
            }
        }
    }

    /**
     * 刷新提示词预设方案下拉列表并执行有效性自校验。
     */
    private refreshBindingOptions(): void {
        const boundPromptId = this.runtimeConfig.promptPresetId;
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(boundPromptId));
        this.validateBindings();
    }

    // 5. 生命周期管理与状态同步

    public activate(): void {
        const cfg = settingsStore.getProviderConfig<{ serverUrl?: string; apiKey?: string; activeDrawingPresetId?: string }>('novelai');
        if (cfg && this.connectionCard) {
            this.connectionCard.setData({
                serverUrl: cfg.serverUrl || 'https://image.novelai.net',
                apiKey: cfg.apiKey || '',
            });
        }
        const activeDrawingId = cfg?.activeDrawingPresetId;
        if (activeDrawingId && activeDrawingId !== this.currentPresetItem?.id) {
            this.applyActivePreset(activeDrawingId, { persist: false });
        }

        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
                if (payload?.key === 'providers' || !payload?.key) {
                    const freshCfg = settingsStore.getProviderConfig<{ serverUrl?: string; apiKey?: string }>('novelai');
                    if (freshCfg && this.connectionCard) {
                        this.connectionCard.setData({
                            serverUrl: freshCfg.serverUrl || 'https://image.novelai.net',
                            apiKey: freshCfg.apiKey || '',
                        });
                    }
                }
                if (!payload || payload.key === 'prompts') {
                    this.refreshBindingOptions();
                }
            });
        }
    }

    public deactivate(): void {
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
    }

    public dispose(): void {
        this.deactivate();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        this.element.remove();
    }
}
