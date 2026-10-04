/**
 * SD-WebUI / Forge 绘图服务专属设置视图 (SDWebUITabView)。
 *
 * @remarks
 * 实现 SettingsView 视图接口，负责装配并管理 SD-WebUI 与 Forge 兼容服务的相关配置：
 * 1. 服务通信配置独立维护 (ConnectionCard)，不随绘图方案切换改变；
 * 2. 绘画参数方案由统一的标准 PresetToolbar (受控下拉框 + 8 项操作图标) 驱动，存储于 drawing/sdwebui；
 * 3. 核心参数包含模型网络 (主模型、外置 VAE、CLIP 跳过层)、画幅尺寸、采样控制及高清修复 (Hires. fix)；
 * 4. 状态反馈：支持修改未保存黄色描边高亮 (.is-dirty) 与失效预设红色描边高亮 (.is-invalid)；
 * 5. 底部提供折叠式的提示词与通用 LoRA 模板库 (PromptPresetManager)。
 */

import type { SettingsView, Disposable } from '../types';
import type { DrawingPresetData, PresetItem, PromptPresetData } from '@types';
import { Card } from '../components/card';
import { FormField } from '../components/form-field';
import { Select, type SelectOption } from '../components/select';
import { Switch } from '../components/switch';
import { Slider } from '../components/slider';
import {
    ConnectionCard,
    DimensionPicker,
    SamplerCard,
    PresetToolbar,
    PromptPresetManager,
    type PromptCardData,
    type PresetActionType,
} from '../composite';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';
import { SdWebUIProvider } from '../../provider/sdwebui/sdwebui-provider';
import { eventBus } from '../../util/event-bus';
import { Toast } from '../feedback/toast';

export class SDWebUITabView implements SettingsView {
    public readonly id = 'sdwebui';
    public readonly title = 'SD-WebUI / Forge';
    public readonly element: HTMLElement;

    private readonly disposables: Disposable[] = [];

    // 子卡片与复合控件实例
    private connectionCard!: ConnectionCard;
    private presetToolbar!: PresetToolbar;
    private dimensionPicker!: DimensionPicker;
    private samplerCard!: SamplerCard;
    private promptPresetManager!: PromptPresetManager;

    // 模型与网络架构控件
    private baseModelSelect!: Select;
    private vaeSelect!: Select;
    private clipSkipSlider!: Slider;
    private clipSkipField!: FormField;
    private promptPresetSelect!: Select;

    // 高清修复 (Hires. fix) 控件
    private hiresCard!: Card;
    private enableHiresSwitch!: Switch;
    private hiresBodyContainer!: HTMLElement;
    private hiresUpscalerSelect!: Select;
    private hiresScaleSlider!: Slider;
    private hiresStepsSlider!: Slider;
    private hiresDenoiseSlider!: Slider;
    private hiresUpscalerField!: FormField;
    private hiresScaleField!: FormField;
    private hiresStepsField!: FormField;
    private hiresDenoiseField!: FormField;

    // 方案数据快照与表单变更追踪
    private currentPresetItem: PresetItem<DrawingPresetData> | null = null;
    private initialPresetSnapshot: DrawingPresetData = {};
    private runtimeConfig: DrawingPresetData = {};
    private readonly dirtyFields = new Set<string>();

    private unlistenSettings: (() => void) | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane da-view-sdwebui';

        // 1. 初始化解析当前激活方案（单一事实 SSOT）
        const cfg = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('sdwebui');
        const activeDrawingId = cfg?.activeDrawingPresetId || '';
        this.applyActivePreset(activeDrawingId, { persist: false, silent: true });

        // 2. 组装卡片层次结构（控件初值直接绑定 runtimeConfig 真实存储数据或草稿）
        this.buildConnectionCard();
        this.buildPresetToolbar();
        this.buildModelCard();
        this.buildSamplingCard();
        this.buildHiresCard();
        this.buildPromptPresetManagementCard();

        // 3. 首次更新预设工具栏与校验状态
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'sdwebui');
        this.presetToolbar.setPresets(
            presets.map((p) => ({ id: p.id, name: p.name })),
            this.currentPresetItem?.id || ''
        );
        this.validateBindings();
    }

    // 1. 方案激活与状态重置

    /**
     * 激活并应用指定的绘图预设方案。
     *
     * @remarks
     * 统一处理方案切换、新建、导入、另存为及删除重置时的状态初始化逻辑：
     * 1. 从存储中心查询并确立单一事实来源；
     * 2. 若无方案（白板状态），保留当前输入作为临时未保存草稿，置空方案 ID；
     * 3. 刷新工具栏方案列表并同步受控按钮状态。
     *
     * @param presetId 目标方案唯一标识符；为空时自动选定方案池首项
     * @param options 可选参数：persist 控制是否将变更写回 store，silent 控制是否在构造阶段跳过控件同步
     */
    private applyActivePreset(presetId: string, options?: { persist?: boolean; silent?: boolean }): void {
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'sdwebui');
        let target = presets.find((p) => p.id === presetId);

        if (!target && presets.length > 0) {
            target = presets[0];
        }

        if (target) {
            this.currentPresetItem = target;
            this.initialPresetSnapshot = structuredClone(target.data || {});
            this.runtimeConfig = structuredClone(target.data || {});

            const currentActiveId = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('sdwebui')?.activeDrawingPresetId;
            if (options?.persist !== false && target.id !== currentActiveId) {
                settingsStore.setProviderConfig('sdwebui', {
                    activeDrawingPresetId: target.id,
                });
            }
        } else {
            // 白板状态：无激活方案，保留当前草稿，清空持久化 ID
            this.currentPresetItem = null;
            this.initialPresetSnapshot = {};
            if (options?.persist !== false) {
                settingsStore.setProviderConfig('sdwebui', {
                    activeDrawingPresetId: '',
                });
            }
        }

        if (this.presetToolbar) {
            this.presetToolbar.setPresets(
                presets.map((p) => ({ id: p.id, name: p.name })),
                this.currentPresetItem?.id || ''
            );
        }

        if (!options?.silent) {
            this.syncControlsFromRuntime();
        }
    }

    // 2. 界面视图与卡片装配

    /**
     * 服务连接与状态探测卡片（配置 Base URL 与鉴权凭据）
     */
    private buildConnectionCard(): void {
        const cfg = settingsStore.getProviderConfig<{ serverUrl?: string; apiKey?: string }>('sdwebui');

        this.connectionCard = new ConnectionCard({
            title: '服务连接与状态探测',
            subtitle: '配置 SD-WebUI / Forge 服务访问地址与接口连通探测',
            urlPlaceholder: 'http://127.0.0.1:7860',
            initialData: {
                serverUrl: cfg?.serverUrl || 'http://127.0.0.1:7860',
                apiKey: cfg?.apiKey || '',
            },
            showApiKey: false,
            onChange: (data) => {
                settingsStore.setProviderConfig('sdwebui', {
                    serverUrl: data.serverUrl,
                });
            },
            onTestPing: async (_serverUrl: string) => {
                const provider = providerRegistry.getProvider('sdwebui');
                if (!provider?.checkHealth) {
                    throw new Error('未注册 SD-WebUI 服务提供方');
                }
                return await provider.checkHealth();
            },
            onFetchAssets: async () => {
                const count = await this.refreshServerAssets();
                return { count, message: `已成功同步 ${count} 项服务端模型与采样资产` };
            },
        });

        this.element.appendChild(this.connectionCard.element);
        this.disposables.push(this.connectionCard);
    }

    /**
     * 绘图预设方案主控工具栏（下拉选择与 8 项快捷动作）
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
     * 模型与网络架构卡片 (包含主模型、外置 VAE、CLIP 跳过层与关联提示词方案)
     */
    private buildModelCard(): void {
        const card = new Card({
            title: '模型与网络架构',
            subtitle: '配置基础扩散模型、外置 VAE、文本跳过层及关联提示词预设',
            collapsible: true,
        });

        // 1. 主模型 (Checkpoint)
        const initialModel = this.runtimeConfig.baseModel || '';
        const initialModelOpts = initialModel
            ? [{ label: initialModel, value: initialModel }]
            : [{ label: '(未选择主模型)', value: '' }];

        this.baseModelSelect = new Select({
            options: initialModelOpts,
            value: initialModel,
            placeholder: '选择主模型文件',
            onChange: (val) => {
                this.runtimeConfig.baseModel = val;
                this.evaluateDirtyState();
            },
        });
        const baseModelField = new FormField({
            label: '主模型',
            tooltip: '基础扩散模型文件（Checkpoint 或 UNet），决定画面的主体风格与生成能力',
            control: this.baseModelSelect,
        });
        card.getBodyElement().appendChild(baseModelField.element);
        this.disposables.push(baseModelField, this.baseModelSelect);

        // 2. 外置 VAE 编解码器
        const initialVae = (this.runtimeConfig.vaeName as string) || 'automatic';
        const initialVaeOpts = [
            { label: '自动选择默认 VAE (automatic)', value: 'automatic' },
            { label: '不使用外置 VAE (None)', value: 'None' },
        ];
        if (initialVae && initialVae !== 'automatic' && initialVae !== 'None') {
            initialVaeOpts.push({ label: initialVae, value: initialVae });
        }

        this.vaeSelect = new Select({
            options: initialVaeOpts,
            value: initialVae,
            onChange: (val) => {
                this.runtimeConfig.vaeName = val;
                this.evaluateDirtyState();
            },
        });
        const vaeField = new FormField({
            label: '外置 VAE',
            tooltip: '变分自编码器。负责潜空间与像素画面的色彩及纹理重建；留空或选 automatic 时采用主模型内置 VAE',
            control: this.vaeSelect,
        });
        card.getBodyElement().appendChild(vaeField.element);
        this.disposables.push(vaeField, this.vaeSelect);

        // 3. CLIP 跳过层 (Clip Skip)
        const initialClipSkip = Number(this.runtimeConfig.clipSkip ?? 2);
        this.clipSkipSlider = new Slider({
            min: 1,
            max: 12,
            step: 1,
            value: initialClipSkip,
            defaultValue: 2,
            unit: ' 层',
            onChange: (val) => {
                this.runtimeConfig.clipSkip = val;
                this.evaluateDirtyState();
            },
        });
        this.clipSkipField = new FormField({
            label: 'CLIP 跳过层',
            tooltip: '文本编码器倒数第几层特征输出。二次元模型通常推荐设为 2，真实系模型常设为 1',
            control: this.clipSkipSlider,
        });
        card.getBodyElement().appendChild(this.clipSkipField.element);
        this.disposables.push(this.clipSkipField, this.clipSkipSlider);

        // 4. 关联提示词预设方案绑定
        const initialPromptId = this.runtimeConfig.promptPresetId || '';
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
            tooltip: '关联的提示词模板。出图时将自动拼接质量词、通用负向词并加载对应 LoRA',
            control: this.promptPresetSelect,
        });
        card.getBodyElement().appendChild(promptField.element);
        this.disposables.push(promptField, this.promptPresetSelect);

        this.element.appendChild(card.element);
        this.disposables.push(card);
    }

    /**
     * 画幅尺寸与采样控制卡片
     */
    private buildSamplingCard(): void {
        const card = new Card({
            title: '画幅尺寸与采样控制',
            subtitle: '设置生成画幅尺寸与采样步数、调度器等核心参数',
            collapsible: true,
        });

        // 1. 尺寸选择器
        this.dimensionPicker = new DimensionPicker({
            initialData: {
                width: this.runtimeConfig.width || 832,
                height: this.runtimeConfig.height || 1216,
            },
            onChange: (dims) => {
                this.runtimeConfig.width = dims.width;
                this.runtimeConfig.height = dims.height;
                this.evaluateDirtyState();
            },
        });
        card.getBodyElement().appendChild(this.dimensionPicker.element);
        this.disposables.push(this.dimensionPicker);

        // 分割线
        const divider = document.createElement('div');
        divider.className = 'da-settings-divider';
        card.getBodyElement().appendChild(divider);

        // 2. 采样参数卡片
        this.samplerCard = new SamplerCard({
            initialData: {
                samplerName: this.runtimeConfig.samplerName || 'DPM++ 2M Karras',
                steps: this.runtimeConfig.steps || 28,
                cfgScale: this.runtimeConfig.cfgScale || 7.0,
                seed: this.runtimeConfig.seed ?? -1,
                denoise: this.runtimeConfig.denoise ?? 0.7,
            },
            showScheduler: false,
            showDenoise: true,
            initialSamplers: [
                { label: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
                { label: 'DPM++ SDE Karras', value: 'DPM++ SDE Karras' },
                { label: 'DPM++ 2S a Karras', value: 'DPM++ 2S a Karras' },
                { label: 'Euler a', value: 'Euler a' },
                { label: 'Euler', value: 'Euler' },
                { label: 'DDIM', value: 'DDIM' },
                { label: 'UniPC', value: 'UniPC' },
            ],
            onChange: (s) => {
                this.runtimeConfig.samplerName = s.samplerName;
                this.runtimeConfig.steps = s.steps;
                this.runtimeConfig.cfgScale = s.cfgScale;
                this.runtimeConfig.seed = s.seed;
                this.runtimeConfig.denoise = s.denoise;
                this.evaluateDirtyState();
            },
        });
        card.getBodyElement().appendChild(this.samplerCard.element);
        this.disposables.push(this.samplerCard);

        this.element.appendChild(card.element);
        this.disposables.push(card);
    }

    /**
     * 高清修复 (Hires. fix) 卡片
     */
    private buildHiresCard(): void {
        this.hiresCard = new Card({
            title: '高清修复 (Hires. fix)',
            subtitle: '在潜空间或像素空间先低分辨率生成，再放大并执行二次去噪以丰富细节',
            collapsible: true,
            defaultCollapsed: !this.runtimeConfig.enableHires,
        });

        // 1. 启用开关
        this.enableHiresSwitch = new Switch({
            value: Boolean(this.runtimeConfig.enableHires),
            label: '启用高清修复',
            onChange: (checked) => {
                this.runtimeConfig.enableHires = checked;
                this.updateHiresControlsState(checked);
                this.evaluateDirtyState();
            },
        });
        const switchField = new FormField({
            label: '启用高清修复',
            tooltip: '开启后将先生成基准分辨率图像，随后按倍率放大并进行二次重绘采样',
            control: this.enableHiresSwitch,
        });
        this.hiresCard.getBodyElement().appendChild(switchField.element);
        this.disposables.push(switchField, this.enableHiresSwitch);

        // 2. 二级参数容器
        this.hiresBodyContainer = document.createElement('div');
        this.hiresBodyContainer.className = 'da-hires-container';
        this.hiresBodyContainer.style.display = this.runtimeConfig.enableHires ? 'block' : 'none';

        // 2.1 放大算法 (Upscaler)
        const initialUpscaler = this.runtimeConfig.hiresUpscaler || 'R-ESRGAN 4x+ Anime6B';
        this.hiresUpscalerSelect = new Select({
            options: [
                { label: 'R-ESRGAN 4x+ Anime6B (二次元推荐)', value: 'R-ESRGAN 4x+ Anime6B' },
                { label: 'R-ESRGAN 4x+ (写实摄影推荐)', value: 'R-ESRGAN 4x+' },
                { label: 'Latent (潜空间近邻插值)', value: 'Latent' },
                { label: 'Latent (antialiased)', value: 'Latent (antialiased)' },
                { label: 'Latent (bicubic)', value: 'Latent (bicubic)' },
                { label: '4x-UltraSharp', value: '4x-UltraSharp' },
                { label: 'ESRGAN_4x', value: 'ESRGAN_4x' },
            ],
            value: initialUpscaler,
            onChange: (val) => {
                this.runtimeConfig.hiresUpscaler = val;
                this.evaluateDirtyState();
            },
        });
        this.hiresUpscalerField = new FormField({
            label: '放大算法',
            tooltip: '用于拉伸分辨率的算法模型，Latent 算法重构感强，ESRGAN 系列纹理保持较好',
            control: this.hiresUpscalerSelect,
        });
        this.hiresBodyContainer.appendChild(this.hiresUpscalerField.element);
        this.disposables.push(this.hiresUpscalerField, this.hiresUpscalerSelect);

        // 2.2 放大倍率 (Scale)
        const initialScale = Number(this.runtimeConfig.hiresScale ?? 1.5);
        this.hiresScaleSlider = new Slider({
            min: 1.0,
            max: 4.0,
            step: 0.05,
            value: initialScale,
            defaultValue: 1.5,
            precision: 2,
            unit: 'x',
            onChange: (val) => {
                this.runtimeConfig.hiresScale = val;
                this.evaluateDirtyState();
            },
        });
        this.hiresScaleField = new FormField({
            label: '放大倍率',
            tooltip: '最终图像分辨率相对于基准画幅尺寸的倍数（例如 1.5x 或 2.0x）',
            control: this.hiresScaleSlider,
        });
        this.hiresBodyContainer.appendChild(this.hiresScaleField.element);
        this.disposables.push(this.hiresScaleField, this.hiresScaleSlider);

        // 2.3 高清重绘步数 (Hires steps)
        const initialSteps = Number(this.runtimeConfig.hiresSteps ?? 15);
        this.hiresStepsSlider = new Slider({
            min: 0,
            max: 50,
            step: 1,
            value: initialSteps,
            defaultValue: 15,
            unit: ' 步',
            onChange: (val) => {
                this.runtimeConfig.hiresSteps = val;
                this.evaluateDirtyState();
            },
        });
        this.hiresStepsField = new FormField({
            label: '高清步数',
            tooltip: '放大后的二次去噪采样步数，设为 0 表示沿用基础采样步数',
            control: this.hiresStepsSlider,
        });
        this.hiresBodyContainer.appendChild(this.hiresStepsField.element);
        this.disposables.push(this.hiresStepsField, this.hiresStepsSlider);

        // 2.4 高清重绘幅度 (Hires denoise)
        const initialDenoise = Number(this.runtimeConfig.hiresDenoise ?? 0.45);
        this.hiresDenoiseSlider = new Slider({
            min: 0.0,
            max: 1.0,
            step: 0.01,
            value: initialDenoise,
            defaultValue: 0.45,
            precision: 2,
            onChange: (val) => {
                this.runtimeConfig.hiresDenoise = val;
                this.evaluateDirtyState();
            },
        });
        this.hiresDenoiseField = new FormField({
            label: '高清重绘幅度',
            tooltip: '放大后的去噪重绘强度。过高可能改变构图与脸型，推荐 0.35 ~ 0.55',
            control: this.hiresDenoiseSlider,
        });
        this.hiresBodyContainer.appendChild(this.hiresDenoiseField.element);
        this.disposables.push(this.hiresDenoiseField, this.hiresDenoiseSlider);

        this.hiresCard.getBodyElement().appendChild(this.hiresBodyContainer);
        this.updateHiresControlsState(Boolean(this.runtimeConfig.enableHires));

        this.element.appendChild(this.hiresCard.element);
        this.disposables.push(this.hiresCard);
    }

    /**
     * 更新高清修复级联参数控件的启用/禁用状态与容器显隐。
     *
     * @param enabled 是否启用高清修复
     */
    private updateHiresControlsState(enabled: boolean): void {
        this.hiresBodyContainer.style.display = enabled ? 'block' : 'none';
        this.hiresUpscalerSelect.setDisabled(!enabled);
        this.hiresScaleSlider.setDisabled(!enabled);
        this.hiresStepsSlider.setDisabled(!enabled);
        this.hiresDenoiseSlider.setDisabled(!enabled);
    }

    /**
     * 提示词与通用 LoRA 管理卡片 (默认折叠收纳)
     */
    private buildPromptPresetManagementCard(): void {
        const promptPresets = settingsStore.getPresets<PromptPresetData>('prompts');
        const activePromptId = this.runtimeConfig.promptPresetId || promptPresets[0]?.id || '';

        this.promptPresetManager = new PromptPresetManager({
            presets: promptPresets.map((p) => ({
                id: p.id,
                name: p.name,
                data: {
                    positivePrefix: p.data?.positivePrefix || '',
                    positiveSuffix: p.data?.positiveSuffix || '',
                    negativePrompt: p.data?.negativePrompt || '',
                    loras: (p.data?.loras || []).map((l, idx) => ({
                        id: `lora_${p.id}_${idx}`,
                        enabled: true,
                        modelName: l.name || '',
                        modelWeight: l.weight ?? 0.8,
                        clipWeight: l.weight ?? 0.8,
                    })),
                },
            })),
            activePresetId: activePromptId,
            showLora: true,
            mode: 'standard',
            onAction: (action, pId, data) => {
                this.handlePromptAssetAction(action, pId, data);
            },
        });

        // 默认折叠收纳，保证主界面高效紧凑
        this.promptPresetManager.card.setCollapsed(true);

        this.element.appendChild(this.promptPresetManager.element);
        this.disposables.push(this.promptPresetManager);
    }

    // 3. 表单变更检测与依赖校验

    /**
     * 检测表单当前输入与方案基准值的差异，同步标记变更字段并更新工具栏状态。
     */
    private evaluateDirtyState(): void {
        const cur = this.runtimeConfig;
        const base = this.initialPresetSnapshot;

        this.dirtyFields.clear();

        // 1. 模型网络字段
        const isBaseModelDirty = String(cur.baseModel ?? '') !== String(base.baseModel ?? '');
        this.baseModelSelect.setDirty(isBaseModelDirty);
        if (isBaseModelDirty) this.dirtyFields.add('baseModel');

        const isVaeDirty = String(cur.vaeName ?? '') !== String(base.vaeName ?? '');
        this.vaeSelect.setDirty(isVaeDirty);
        if (isVaeDirty) this.dirtyFields.add('vaeName');

        const isClipSkipDirty = Number(cur.clipSkip ?? 2) !== Number(base.clipSkip ?? 2);
        this.clipSkipField.setDirty(isClipSkipDirty);
        if (isClipSkipDirty) this.dirtyFields.add('clipSkip');

        const isPromptDirty = String(cur.promptPresetId ?? '') !== String(base.promptPresetId ?? '');
        this.promptPresetSelect.setDirty(isPromptDirty);
        if (isPromptDirty) this.dirtyFields.add('promptPresetId');

        // 2. 画幅尺寸字段
        const isDimsDirty = cur.width !== base.width || cur.height !== base.height;
        this.dimensionPicker.element.classList.toggle('is-dirty', isDimsDirty);
        if (isDimsDirty) this.dirtyFields.add('dimensions');

        // 3. 采样超参数字段
        const isSamplerDirty =
            cur.samplerName !== base.samplerName ||
            cur.steps !== base.steps ||
            cur.cfgScale !== base.cfgScale ||
            cur.seed !== base.seed ||
            cur.denoise !== base.denoise;
        this.samplerCard.element.classList.toggle('is-dirty', isSamplerDirty);
        if (isSamplerDirty) this.dirtyFields.add('sampler');

        // 4. 高清修复字段
        const isHiresDirty =
            Boolean(cur.enableHires) !== Boolean(base.enableHires) ||
            String(cur.hiresUpscaler ?? '') !== String(base.hiresUpscaler ?? '') ||
            Number(cur.hiresScale ?? 1.5) !== Number(base.hiresScale ?? 1.5) ||
            Number(cur.hiresSteps ?? 15) !== Number(base.hiresSteps ?? 15) ||
            Number(cur.hiresDenoise ?? 0.45) !== Number(base.hiresDenoise ?? 0.45);
        this.hiresCard.element.classList.toggle('is-dirty', isHiresDirty);
        if (isHiresDirty) this.dirtyFields.add('hires');

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

        // 1. 模型网络回填
        if (this.baseModelSelect) {
            const m = cfg.baseModel || '';
            const opts = m ? [{ label: m, value: m }] : [{ label: '(未选择主模型)', value: '' }];
            this.baseModelSelect.setOptions(opts);
            this.baseModelSelect.setValue(m, { silent: true });
        }

        if (this.vaeSelect) {
            const v = (cfg.vaeName as string) || 'automatic';
            const vaeOpts = [
                { label: '自动选择默认 VAE (automatic)', value: 'automatic' },
                { label: '不使用外置 VAE (None)', value: 'None' },
            ];
            if (v && v !== 'automatic' && v !== 'None' && !vaeOpts.some((opt) => opt.value === v)) {
                vaeOpts.push({ label: v, value: v });
            }
            this.vaeSelect.setOptions(vaeOpts);
            this.vaeSelect.setValue(v, { silent: true });
        }

        if (this.clipSkipSlider) {
            this.clipSkipSlider.setValue(Number(cfg.clipSkip ?? 2), { silent: true });
        }

        const boundPromptId = cfg.promptPresetId || '';
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(boundPromptId));
        this.promptPresetSelect.setValue(boundPromptId, { silent: true });

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
                samplerName: cfg.samplerName || 'DPM++ 2M Karras',
                steps: cfg.steps || 28,
                cfgScale: cfg.cfgScale || 7.0,
                seed: cfg.seed ?? -1,
                denoise: cfg.denoise ?? 0.7,
            });
            this.samplerCard.element.classList.remove('is-dirty');
        }

        // 4. 高清修复回填
        const isHires = Boolean(cfg.enableHires);
        this.enableHiresSwitch.setValue(isHires, { silent: true });
        this.updateHiresControlsState(isHires);
        this.hiresUpscalerSelect.setValue(cfg.hiresUpscaler || 'R-ESRGAN 4x+ Anime6B', { silent: true });
        this.hiresScaleSlider.setValue(Number(cfg.hiresScale ?? 1.5), { silent: true });
        this.hiresStepsSlider.setValue(Number(cfg.hiresSteps ?? 15), { silent: true });
        this.hiresDenoiseSlider.setValue(Number(cfg.hiresDenoise ?? 0.45), { silent: true });
        this.hiresCard.element.classList.remove('is-dirty');

        // 5. 清除所有控件变更标记
        this.baseModelSelect?.setDirty(false);
        this.vaeSelect?.setDirty(false);
        this.clipSkipField?.setDirty(false);
        this.promptPresetSelect.setDirty(false);
        this.hiresUpscalerField?.setDirty(false);
        this.hiresScaleField?.setDirty(false);
        this.hiresStepsField?.setDirty(false);
        this.hiresDenoiseField?.setDirty(false);

        this.dirtyFields.clear();
        this.validateBindings();
        this.presetToolbar.setDirty(false);
    }

    // 4. 预设工具栏动作分发

    private handlePresetAction(action: PresetActionType, presetId: string): void {
        switch (action) {
            case 'select': {
                this.applyActivePreset(presetId);
                break;
            }
            case 'new': {
                // 1. 完整性校验：核心必填项除 VAE/主模型使用远端默认外必须完整
                const missing: string[] = [];
                const cfg = this.runtimeConfig;
                if (!cfg.width || !cfg.height) missing.push('画幅尺寸 (宽/高)');
                if (!cfg.samplerName) missing.push('采样算法');
                if (cfg.steps === undefined || cfg.steps === null || Number.isNaN(cfg.steps)) missing.push('采样步数');
                if (cfg.cfgScale === undefined || cfg.cfgScale === null || Number.isNaN(cfg.cfgScale)) missing.push('提示词引导系数 (CFG)');

                if (missing.length > 0) {
                    Toast.show(`无法创建方案，以下必填项尚未配置：${missing.join('、')}`, { level: 'warning', duration: 3500 });
                    return;
                }

                const newName = window.prompt('请输入新绘图方案名称:', '新建方案');
                if (!newName || !newName.trim()) return;

                const newId = 'sdwebui_preset_' + Date.now();
                const newPreset: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: newName.trim(),
                    data: structuredClone(this.runtimeConfig),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('drawing', newPreset, 'sdwebui');
                this.applyActivePreset(newId);
                break;
            }
            case 'save': {
                if (this.currentPresetItem) {
                    const toSave: PresetItem<DrawingPresetData> = {
                        ...this.currentPresetItem,
                        data: structuredClone(this.runtimeConfig),
                        updatedAt: Date.now(),
                    };
                    settingsStore.savePreset('drawing', toSave, 'sdwebui');
                    this.initialPresetSnapshot = structuredClone(this.runtimeConfig);
                    this.dirtyFields.clear();
                    this.presetToolbar.setDirty(false);
                    this.syncControlsFromRuntime();
                }
                break;
            }
            case 'saveAs': {
                if (!this.currentPresetItem) return;
                const sourceName = this.currentPresetItem.name || '绘图方案';
                const newId = 'sdwebui_preset_' + Date.now();
                const cloned: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: `${sourceName} (副本)`,
                    data: structuredClone(this.runtimeConfig),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('drawing', cloned, 'sdwebui');
                this.applyActivePreset(newId);
                break;
            }
            case 'rename': {
                if (!this.currentPresetItem) return;
                const newName = window.prompt('请输入预设方案新名称:', this.currentPresetItem.name);
                if (newName && newName.trim() && newName.trim() !== this.currentPresetItem.name) {
                    this.currentPresetItem.name = newName.trim();
                    settingsStore.savePreset('drawing', this.currentPresetItem, 'sdwebui');
                    const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'sdwebui');
                    this.presetToolbar.setPresets(
                        presets.map((p) => ({ id: p.id, name: p.name })),
                        this.currentPresetItem.id
                    );
                }
                break;
            }
            case 'export': {
                if (!this.currentPresetItem) return;
                const blob = new Blob([JSON.stringify(this.currentPresetItem, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `sdwebui_preset_${this.currentPresetItem.name.replace(/\s+/g, '_')}.json`;
                a.click();
                URL.revokeObjectURL(url);
                break;
            }
            case 'reset': {
                // 放弃未保存修改，恢复为当前激活方案的基准快照
                this.runtimeConfig = structuredClone(this.initialPresetSnapshot);
                this.syncControlsFromRuntime();
                break;
            }
            case 'delete': {
                if (!this.currentPresetItem) return;
                const deletingId = this.currentPresetItem.id;
                settingsStore.deletePreset('drawing', deletingId, 'sdwebui');
                const remaining = settingsStore.getPresets<DrawingPresetData>('drawing', 'sdwebui');
                if (remaining.length > 0) {
                    this.applyActivePreset(remaining[0].id);
                } else {
                    // 方案池删空：保留当前控件参数作为临时未保存草稿，置空方案 ID 并通知工具栏
                    this.currentPresetItem = null;
                    this.initialPresetSnapshot = {};
                    settingsStore.setProviderConfig('sdwebui', {
                        activeDrawingPresetId: '',
                    });
                    this.presetToolbar.setPresets([], '');
                    this.presetToolbar.setDirty(false);
                }
                break;
            }
        }
    }

    /**
     * 导入外部预设 JSON 文件。
     */
    private handleImportFile(file: File): void {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string);
                if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                    throw new Error('预设文件格式错误：未包含有效的 data 配置项');
                }
                const newId = 'sdwebui_preset_' + Date.now();
                const importedItem: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: (parsed.name || '导入的 SD-WebUI 方案') + ' (导入)',
                    data: parsed.data,
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('drawing', importedItem, 'sdwebui');
                this.applyActivePreset(newId);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                Toast.show('导入方案解析失败: ' + message, { level: 'error' });
            }
        };
        reader.onerror = () => {
            Toast.show('读取预设文件失败', { level: 'error' });
        };
        reader.readAsText(file);
    }

    // 5. 提示词预设方案变动联动

    private handlePromptAssetAction(action: PresetActionType, pId: string, data?: PromptCardData): void {
        if (action === 'save' && data) {
            const pr = settingsStore.getPreset<PromptPresetData>('prompts', pId);
            if (pr) {
                pr.data = {
                    ...pr.data,
                    positivePrefix: data.positivePrefix,
                    positiveSuffix: data.positiveSuffix,
                    negativePrompt: data.negativePrompt,
                    loras: (data.loras || [])
                        .filter((l) => l.enabled && l.modelName)
                        .map((l) => ({
                            name: l.modelName,
                            weight: l.modelWeight,
                        })),
                };
                settingsStore.savePreset('prompts', pr);
            }
        }
        this.refreshBindingOptions();
    }

    /**
     * 刷新关联提示词预设方案的下拉选项列表，并触发有效性自校验。
     */
    private refreshBindingOptions(): void {
        const boundPromptId = this.runtimeConfig.promptPresetId;
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(boundPromptId));
        this.validateBindings();
    }

    // 6. 服务端资产同步与选项构建

    private async refreshServerAssets(): Promise<number> {
        const provider = providerRegistry.getProvider('sdwebui');
        let totalCount = 0;

        if (provider instanceof SdWebUIProvider) {
            // 1. 同步 Checkpoint 主模型列表
            const models = await provider.fetchModels();
            if (Array.isArray(models) && models.length > 0) {
                totalCount += models.length;
                const currentVal = this.runtimeConfig.baseModel || models[0];
                const opts: SelectOption[] = models.map((m: string) => ({ label: m, value: m }));
                if (currentVal && !models.includes(currentVal)) {
                    opts.unshift({ label: `${currentVal} (未在服务端检测到)`, value: currentVal });
                }
                this.baseModelSelect.setOptions(opts);
                this.baseModelSelect.setValue(currentVal, { silent: true });
                this.runtimeConfig.baseModel = currentVal;
            }

            // 2. 同步 VAE 模型列表
            const vaes = await provider.fetchVaes();
            if (Array.isArray(vaes) && vaes.length > 0) {
                totalCount += vaes.length;
                const currentVae = this.runtimeConfig.vaeName || 'automatic';
                const vaeOpts: SelectOption[] = [
                    { label: '自动选择默认 VAE (automatic)', value: 'automatic' },
                    ...vaes.map((v: string) => ({ label: v, value: v })),
                ];
                if (currentVae && currentVae !== 'automatic' && !vaes.includes(currentVae)) {
                    vaeOpts.splice(1, 0, { label: `${currentVae} (未在服务端检测到)`, value: currentVae });
                }
                this.vaeSelect.setOptions(vaeOpts);
                this.vaeSelect.setValue(currentVae, { silent: true });
            }

            // 3. 同步采样器列表
            const samplers = await provider.fetchSamplers();
            if (Array.isArray(samplers) && samplers.length > 0) {
                totalCount += samplers.length;
                this.samplerCard.setSamplers(samplers.map((s: string) => ({ label: s, value: s })));
            }
        }

        return totalCount;
    }

    private buildPromptPresetOptions(currentBoundId?: string): SelectOption[] {
        const prompts = settingsStore.getPresets<PromptPresetData>('prompts');
        const opts: SelectOption[] = prompts.map((p) => ({
            label: p.name,
            value: p.id,
        }));
        if (currentBoundId && !prompts.some((p) => p.id === currentBoundId)) {
            opts.unshift({
                label: `[已失效] 未知提示词方案 (${currentBoundId})`,
                value: currentBoundId,
            });
        }
        return opts;
    }

    // 7. 视图生命周期控制

    public activate(): void {
        const cfg = settingsStore.getProviderConfig<{ serverUrl?: string; activeDrawingPresetId?: string }>('sdwebui');
        const activeDrawingId = cfg?.activeDrawingPresetId || '';

        // 同步服务连接配置
        this.connectionCard.setData({
            serverUrl: cfg?.serverUrl || 'http://127.0.0.1:7860',
        });

        // 统一应用当前激活方案
        this.applyActivePreset(activeDrawingId);

        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
                const freshCfg = settingsStore.getProviderConfig<{ serverUrl?: string; activeDrawingPresetId?: string }>('sdwebui');
                this.connectionCard.setData({
                    serverUrl: freshCfg?.serverUrl || 'http://127.0.0.1:7860',
                });

                const freshActiveId = freshCfg?.activeDrawingPresetId;
                if (freshActiveId && freshActiveId !== this.currentPresetItem?.id) {
                    this.applyActivePreset(freshActiveId, { persist: false });
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
        for (const item of this.disposables) {
            item.dispose();
        }
        this.disposables.length = 0;
        this.element.innerHTML = '';
        this.element.remove();
    }
}
