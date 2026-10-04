/**
 * ComfyUI 绘图服务专属设置视图 (ComfyUITabView)。
 *
 * @remarks
 * 实现 SettingsView 视图接口并遵循功能分类存储架构规范：
 * 1. 服务通信配置独立维护 (ConnectionCard)，不随绘画方案切换改变；
 * 2. 绘画参数方案由统一的标准 PresetToolbar (受控下拉框 + 8 项操作图标) 驱动；
 * 3. 核心参数包含外部预设绑定索引 (文生图工作流、图生图工作流、提示词方案)、模型网络与画幅采样；
 * 4. 状态反馈：支持修改未保存黄色描边高亮 (.is-dirty) 与失效预设红色描边高亮 (.is-invalid)；
 * 5. 底部提供折叠式的 ComfyUI 工作流模板库 (WorkflowCard) 与提示词模板库 (PromptPresetManager)。
 */

import type { SettingsView, Disposable } from '../types';
import type { DrawingPresetData, PresetItem, WorkflowPresetData, PromptPresetData } from '@types';
import { Card } from '../components/card';
import { FormField } from '../components/form-field';
import { Select, type SelectOption } from '../components/select';
import {
    ConnectionCard,
    DimensionPicker,
    SamplerCard,
    PresetToolbar,
    WorkflowCard,
    PromptPresetManager,
    type PromptCardData,
    type PresetActionType,
} from '../composite';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';
import { eventBus } from '../../util/event-bus';
import { Toast } from '../feedback/toast';

export class ComfyUITabView implements SettingsView {
    public readonly id = 'comfyui';
    public readonly title = 'ComfyUI';
    public readonly element: HTMLElement;

    private readonly disposables: Disposable[] = [];

    // 子卡片与复合控件实例
    private connectionCard!: ConnectionCard;
    private presetToolbar!: PresetToolbar;
    private dimensionPicker!: DimensionPicker;
    private samplerCard!: SamplerCard;
    private workflowCard!: WorkflowCard;
    private promptPresetManager!: PromptPresetManager;

    // 模型与工作流选择控件
    private txt2imgWorkflowSelect!: Select;
    private img2imgWorkflowSelect!: Select;
    private promptPresetSelect!: Select;
    private baseModelSelect!: Select;
    private clipNameSelect!: Select;
    private vaeNameSelect!: Select;

    // 方案数据快照与表单变更追踪
    private currentPresetItem: PresetItem<DrawingPresetData> | null = null;
    private initialPresetSnapshot: DrawingPresetData = {};
    private runtimeConfig: DrawingPresetData = {};
    private readonly dirtyFields = new Set<string>();

    private unlistenSettings: (() => void) | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane da-view-comfyui';

        // 1. 初始化解析当前激活方案（单一事实 SSOT）
        const cfg = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('comfyui');
        const activeDrawingId = cfg?.activeDrawingPresetId || '';
        this.applyActivePreset(activeDrawingId, { persist: false, silent: true });

        // 2. 组装卡片层次结构（控件初值直接绑定 runtimeConfig 真实存储数据或空态）
        this.buildConnectionCard();
        this.buildPresetToolbar();
        this.buildModelAndWorkflowCard();
        this.buildSamplingCard();
        this.buildWorkflowManagementCard();
        this.buildPromptPresetManagementCard();

        // 3. 首次更新预设工具栏与校验状态
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'comfyui');
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
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'comfyui');
        let target = presets.find((p) => p.id === presetId);

        if (!target && presets.length > 0) {
            target = presets[0];
        }

        if (target) {
            this.currentPresetItem = target;
            this.initialPresetSnapshot = structuredClone(target.data || {});
            this.runtimeConfig = structuredClone(target.data || {});

            const currentActiveId = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('comfyui')?.activeDrawingPresetId;
            if (options?.persist !== false && target.id !== currentActiveId) {
                settingsStore.setProviderConfig('comfyui', {
                    activeDrawingPresetId: target.id,
                });
            }
        } else {
            // 白板状态：无激活方案，保留当前草稿，清空持久化 ID
            this.currentPresetItem = null;
            this.initialPresetSnapshot = {};
            if (options?.persist !== false) {
                settingsStore.setProviderConfig('comfyui', {
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
        const cfg = settingsStore.getProviderConfig<{ serverUrl?: string; apiKey?: string }>('comfyui');

        this.connectionCard = new ConnectionCard({
            initialData: {
                serverUrl: cfg?.serverUrl || 'http://127.0.0.1:8188',
                apiKey: cfg?.apiKey || '',
            },
            showApiKey: true,
            onChange: (data) => {
                settingsStore.setProviderConfig('comfyui', {
                    serverUrl: data.serverUrl,
                    apiKey: data.apiKey,
                });
            },
            onTestPing: async (_serverUrl: string, _apiKey?: string) => {
                const provider = providerRegistry.getProvider('comfyui');
                if (!provider?.checkHealth) {
                    throw new Error('未注册 ComfyUI 服务提供方');
                }
                return await provider.checkHealth();
            },
            onFetchAssets: async () => {
                const count = await this.refreshServerAssets();
                return { count, message: `已成功加载 ${count} 个模型资产` };
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
     * 流程与模型架构卡片 (包含工作流/提示词方案绑定下拉与模型网络)
     */
    private buildModelAndWorkflowCard(): void {
        const card = new Card({
            title: '模型与流程架构',
            subtitle: '配置主模型、编码器及关联的工作流与提示词预设',
            collapsible: true,
        });

        // 1. 文生图工作流绑定
        this.txt2imgWorkflowSelect = new Select({
            options: this.buildWorkflowOptions(this.runtimeConfig.txt2imgWorkflowId),
            value: this.runtimeConfig.txt2imgWorkflowId || '',
            placeholder: '选择文生图工作流模板',
            onChange: (val) => {
                this.runtimeConfig.txt2imgWorkflowId = val;
                this.evaluateDirtyState();
            },
        });
        const txt2imgField = new FormField({
            label: '文生图工作流',
            tooltip: '文生图 API 工作流模板。生成时将自动注入提示词、采样参数与尺寸并提交执行',
            control: this.txt2imgWorkflowSelect,
        });
        card.getBodyElement().appendChild(txt2imgField.element);
        this.disposables.push(txt2imgField, this.txt2imgWorkflowSelect);

        // 2. 图生图工作流绑定
        this.img2imgWorkflowSelect = new Select({
            options: this.buildWorkflowOptions(this.runtimeConfig.img2imgWorkflowId),
            value: this.runtimeConfig.img2imgWorkflowId || '',
            placeholder: '选择图生图工作流模板 (可选)',
            onChange: (val) => {
                this.runtimeConfig.img2imgWorkflowId = val;
                this.evaluateDirtyState();
            },
        });
        const img2imgField = new FormField({
            label: '图生图工作流',
            tooltip: '图生图/重绘工作流模板。生成时将自动注入参考底图、重绘幅度与采样参数',
            control: this.img2imgWorkflowSelect,
        });
        card.getBodyElement().appendChild(img2imgField.element);
        this.disposables.push(img2imgField, this.img2imgWorkflowSelect);

        // 3. 提示词预设方案绑定
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

        // 分割线
        const divider = document.createElement('div');
        divider.className = 'da-settings-divider';
        card.getBodyElement().appendChild(divider);

        // 4. 主模型 (Checkpoint / UNet)
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

        // 5. CLIP 编码器
        const initialClip = (this.runtimeConfig.clipName as string) || '';
        const initialClipOpts = [{ label: '(默认使用内置编码器)', value: '' }];
        if (initialClip) {
            initialClipOpts.push({ label: initialClip, value: initialClip });
        }

        this.clipNameSelect = new Select({
            options: initialClipOpts,
            value: initialClip,
            onChange: (val) => {
                this.runtimeConfig.clipName = val;
                this.evaluateDirtyState();
            },
        });
        const clipField = new FormField({
            label: 'CLIP 编码器',
            tooltip: 'CLIP 文本编码器。用于解析提示词语义，部分大模型（如 SD3、FLUX）需单独指定',
            control: this.clipNameSelect,
        });
        card.getBodyElement().appendChild(clipField.element);
        this.disposables.push(clipField, this.clipNameSelect);

        // 6. VAE 编解码器
        const initialVae = (this.runtimeConfig.vaeName as string) || '';
        const initialVaeOpts = [{ label: '(默认使用主模型内置 VAE)', value: '' }];
        if (initialVae) {
            initialVaeOpts.push({ label: initialVae, value: initialVae });
        }

        this.vaeNameSelect = new Select({
            options: initialVaeOpts,
            value: initialVae,
            onChange: (val) => {
                this.runtimeConfig.vaeName = val;
                this.evaluateDirtyState();
            },
        });
        const vaeField = new FormField({
            label: 'VAE 编解码器',
            tooltip: 'VAE 编解码模型。负责潜空间特征与像素图像之间的相互转换与画质还原',
            control: this.vaeNameSelect,
        });
        card.getBodyElement().appendChild(vaeField.element);
        this.disposables.push(vaeField, this.vaeNameSelect);

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
                width: this.runtimeConfig.width || 1024,
                height: this.runtimeConfig.height || 1024,
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
                samplerName: this.runtimeConfig.samplerName || 'euler',
                scheduler: this.runtimeConfig.scheduler || 'simple',
                steps: this.runtimeConfig.steps || 28,
                cfgScale: this.runtimeConfig.cfgScale || 3.5,
                seed: this.runtimeConfig.seed ?? -1,
                denoise: this.runtimeConfig.denoise ?? 1.0,
            },
            showScheduler: true,
            showDenoise: true,
            initialSamplers: [
                { label: 'euler', value: 'euler' },
                { label: 'euler_ancestral', value: 'euler_ancestral' },
                { label: 'dpmpp_2m', value: 'dpmpp_2m' },
                { label: 'dpmpp_2m_sde', value: 'dpmpp_2m_sde' },
                { label: 'dpmpp_2s_ancestral', value: 'dpmpp_2s_ancestral' },
                { label: 'dpmpp_3m_sde', value: 'dpmpp_3m_sde' },
                { label: 'ddim', value: 'ddim' },
                { label: 'uni_pc', value: 'uni_pc' },
            ],
            initialSchedulers: [
                { label: 'simple', value: 'simple' },
                { label: 'normal', value: 'normal' },
                { label: 'karras', value: 'karras' },
                { label: 'exponential', value: 'exponential' },
                { label: 'sgm_uniform', value: 'sgm_uniform' },
                { label: 'beta', value: 'beta' },
            ],
            onChange: (s) => {
                this.runtimeConfig.samplerName = s.samplerName;
                this.runtimeConfig.scheduler = s.scheduler;
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
     * ComfyUI 工作流模板库管理卡片 (默认折叠，独立自维护)
     */
    private buildWorkflowManagementCard(): void {
        const workflows = settingsStore.getPresets<WorkflowPresetData>('workflows');
        const activeWfId = this.runtimeConfig.txt2imgWorkflowId || workflows[0]?.id || '';

        this.workflowCard = new WorkflowCard({
            presets: workflows.map((w) => ({
                id: w.id,
                name: w.name,
                data: { json: typeof w.data?.workflow === 'object' ? JSON.stringify(w.data.workflow, null, 2) : '{}' },
            })),
            activePresetId: activeWfId,
            onAction: (action, wfId, data) => {
                this.handleWorkflowAssetAction(action, wfId, data);
            },
        });

        // 默认折叠收纳，保证主界面高效紧凑
        this.workflowCard.card.setCollapsed(true);

        this.element.appendChild(this.workflowCard.element);
        this.disposables.push(this.workflowCard);
    }

    /**
     * 提示词与通用 LoRA 管理卡片 (默认折叠，独立自维护)
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

        // 默认折叠收纳
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

        // 1. 外部预设引用字段
        const isTxt2imgDirty = String(cur.txt2imgWorkflowId ?? '') !== String(base.txt2imgWorkflowId ?? '');
        this.txt2imgWorkflowSelect.setDirty(isTxt2imgDirty);
        if (isTxt2imgDirty) this.dirtyFields.add('txt2imgWorkflowId');

        const isImg2imgDirty = String(cur.img2imgWorkflowId ?? '') !== String(base.img2imgWorkflowId ?? '');
        this.img2imgWorkflowSelect.setDirty(isImg2imgDirty);
        if (isImg2imgDirty) this.dirtyFields.add('img2imgWorkflowId');

        const isPromptDirty = String(cur.promptPresetId ?? '') !== String(base.promptPresetId ?? '');
        this.promptPresetSelect.setDirty(isPromptDirty);
        if (isPromptDirty) this.dirtyFields.add('promptPresetId');

        // 2. 模型网络字段
        const isBaseModelDirty = String(cur.baseModel ?? '') !== String(base.baseModel ?? '');
        this.baseModelSelect.setDirty(isBaseModelDirty);
        if (isBaseModelDirty) this.dirtyFields.add('baseModel');

        const isClipDirty = String(cur.clipName ?? '') !== String(base.clipName ?? '');
        this.clipNameSelect.setDirty(isClipDirty);
        if (isClipDirty) this.dirtyFields.add('clipName');

        const isVaeDirty = String(cur.vaeName ?? '') !== String(base.vaeName ?? '');
        this.vaeNameSelect.setDirty(isVaeDirty);
        if (isVaeDirty) this.dirtyFields.add('vaeName');

        // 3. 画幅尺寸字段
        const isDimsDirty = cur.width !== base.width || cur.height !== base.height;
        this.dimensionPicker.element.classList.toggle('is-dirty', isDimsDirty);
        if (isDimsDirty) this.dirtyFields.add('dimensions');

        // 4. 采样超参数字段
        const isSamplerDirty = cur.samplerName !== base.samplerName ||
            cur.scheduler !== base.scheduler ||
            cur.steps !== base.steps ||
            cur.cfgScale !== base.cfgScale ||
            cur.seed !== base.seed ||
            cur.denoise !== base.denoise;
        this.samplerCard.element.classList.toggle('is-dirty', isSamplerDirty);
        if (isSamplerDirty) this.dirtyFields.add('sampler');

        // 5. 校验绑定有效性并驱动工具栏
        this.validateBindings();
        this.presetToolbar.setDirty(this.dirtyFields.size > 0);
    }

    /**
     * 检查引用的工作流与提示词预设是否存在；若引用失效，为对应控件添加错误标记。
     */
    private validateBindings(): void {
        const workflows = settingsStore.getPresets<WorkflowPresetData>('workflows');
        const prompts = settingsStore.getPresets<PromptPresetData>('prompts');

        const txt2imgId = this.runtimeConfig.txt2imgWorkflowId;
        const isTxt2imgInvalid = Boolean(txt2imgId && !workflows.some((w) => w.id === txt2imgId));
        this.setControlInvalid(this.txt2imgWorkflowSelect, isTxt2imgInvalid);

        const img2imgId = this.runtimeConfig.img2imgWorkflowId;
        const isImg2imgInvalid = Boolean(img2imgId && !workflows.some((w) => w.id === img2imgId));
        this.setControlInvalid(this.img2imgWorkflowSelect, isImg2imgInvalid);

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

        // 重建下拉选项
        this.txt2imgWorkflowSelect.setOptions(this.buildWorkflowOptions(cfg.txt2imgWorkflowId));
        this.txt2imgWorkflowSelect.setValue(cfg.txt2imgWorkflowId || '', { silent: true });

        this.img2imgWorkflowSelect.setOptions(this.buildWorkflowOptions(cfg.img2imgWorkflowId));
        this.img2imgWorkflowSelect.setValue(cfg.img2imgWorkflowId || '', { silent: true });

        const boundPromptId = cfg.promptPresetId || '';
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(boundPromptId));
        this.promptPresetSelect.setValue(boundPromptId, { silent: true });

        if (this.baseModelSelect) {
            const m = cfg.baseModel || '';
            const opts = m ? [{ label: m, value: m }] : [{ label: '(未选择主模型)', value: '' }];
            this.baseModelSelect.setOptions(opts);
            this.baseModelSelect.setValue(m, { silent: true });
        }

        if (this.clipNameSelect) {
            this.clipNameSelect.setValue((cfg.clipName as string) || '', { silent: true });
        }

        if (this.vaeNameSelect) {
            this.vaeNameSelect.setValue((cfg.vaeName as string) || '', { silent: true });
        }

        if (this.dimensionPicker) {
            this.dimensionPicker.setData({
                width: cfg.width || 1024,
                height: cfg.height || 1024,
            });
            this.dimensionPicker.element.classList.remove('is-dirty');
        }

        if (this.samplerCard) {
            this.samplerCard.setData({
                samplerName: cfg.samplerName || 'euler',
                scheduler: cfg.scheduler || 'simple',
                steps: cfg.steps || 28,
                cfgScale: cfg.cfgScale || 3.5,
                seed: cfg.seed ?? -1,
                denoise: cfg.denoise ?? 1.0,
            });
            this.samplerCard.element.classList.remove('is-dirty');
        }

        // 清除所有脏样式
        this.txt2imgWorkflowSelect.setDirty(false);
        this.img2imgWorkflowSelect.setDirty(false);
        this.promptPresetSelect.setDirty(false);
        this.baseModelSelect?.setDirty(false);
        this.clipNameSelect?.setDirty(false);
        this.vaeNameSelect?.setDirty(false);

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
                // 1. 完整性校验：核心必填项除 VAE 等可选外必须完整，保证无遗漏
                const missing: string[] = [];
                const cfg = this.runtimeConfig;
                if (!cfg.txt2imgWorkflowId) missing.push('文生图工作流');
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

                const newId = 'comfyui_preset_' + Date.now();
                const newPreset: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: newName.trim(),
                    data: structuredClone(this.runtimeConfig),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('drawing', newPreset, 'comfyui');
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
                    settingsStore.savePreset('drawing', toSave, 'comfyui');
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
                const newId = 'comfyui_preset_' + Date.now();
                const cloned: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: `${sourceName} (副本)`,
                    data: structuredClone(this.runtimeConfig),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('drawing', cloned, 'comfyui');
                this.applyActivePreset(newId);
                break;
            }
            case 'rename': {
                if (!this.currentPresetItem) return;
                const newName = window.prompt('请输入预设方案新名称:', this.currentPresetItem.name);
                if (newName && newName.trim() && newName.trim() !== this.currentPresetItem.name) {
                    this.currentPresetItem.name = newName.trim();
                    settingsStore.savePreset('drawing', this.currentPresetItem, 'comfyui');
                    const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'comfyui');
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
                a.download = `comfyui_preset_${this.currentPresetItem.name.replace(/\\s+/g, '_')}.json`;
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
                settingsStore.deletePreset('drawing', deletingId, 'comfyui');
                const remaining = settingsStore.getPresets<DrawingPresetData>('drawing', 'comfyui');
                if (remaining.length > 0) {
                    this.applyActivePreset(remaining[0].id);
                } else {
                    // 方案池删空：保留当前控件参数作为临时未保存草稿，置空方案 ID 并通知工具栏
                    this.currentPresetItem = null;
                    this.initialPresetSnapshot = {};
                    settingsStore.setProviderConfig('comfyui', {
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
                const newId = 'comfyui_preset_' + Date.now();
                const importedItem: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: (parsed.name || '导入的 ComfyUI 方案') + ' (导入)',
                    data: parsed.data,
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('drawing', importedItem, 'comfyui');
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

    // 5. 工作流与提示词模板变更联动

    private handleWorkflowAssetAction(action: PresetActionType, wfId: string, data?: any): void {
        if (action === 'save' && data?.json) {
            try {
                const parsed = JSON.parse(data.json);
                const wf = settingsStore.getPreset<WorkflowPresetData>('workflows', wfId);
                if (wf) {
                    wf.data = { ...wf.data, workflow: parsed };
                    settingsStore.savePreset('workflows', wf);
                }
            } catch (err: unknown) {
                Toast.show('工作流保存失败：JSON 语法错误', { level: 'error' });
            }
        }
        // 资产库变动时全量同步上方引用的选项列表并校验有效性
        this.refreshBindingOptions();
    }

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
     * 刷新文生图/图生图工作流以及提示词预设方案的下拉选项列表，并触发自校验。
     */
    private refreshBindingOptions(): void {
        this.txt2imgWorkflowSelect.setOptions(this.buildWorkflowOptions(this.runtimeConfig.txt2imgWorkflowId));
        this.img2imgWorkflowSelect.setOptions(this.buildWorkflowOptions(this.runtimeConfig.img2imgWorkflowId));
        const boundPromptId = this.runtimeConfig.promptPresetId;
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(boundPromptId));
        this.validateBindings();
    }

    // 6. 服务端资产同步与选项构建

    private async refreshServerAssets(): Promise<number> {
        const provider = providerRegistry.getProvider('comfyui');
        if (provider && typeof provider.fetchModels === 'function') {
            const models = await provider.fetchModels();
            if (Array.isArray(models) && models.length > 0) {
                const currentVal = this.runtimeConfig.baseModel || models[0];
                const opts: SelectOption[] = models.map((m: string) => ({ label: m, value: m }));
                if (currentVal && !models.includes(currentVal)) {
                    opts.unshift({ label: `${currentVal} (未在服务端检测到)`, value: currentVal });
                }
                this.baseModelSelect.setOptions(opts);
                this.baseModelSelect.setValue(currentVal, { silent: true });
                this.runtimeConfig.baseModel = currentVal;
                return models.length;
            }
        }
        return 0;
    }

    private buildWorkflowOptions(currentBoundId?: string): SelectOption[] {
        const workflows = settingsStore.getPresets<WorkflowPresetData>('workflows');
        const opts: SelectOption[] = workflows.map((w) => ({
            label: w.name,
            value: w.id,
        }));
        if (currentBoundId && !workflows.some((w) => w.id === currentBoundId)) {
            opts.unshift({
                label: `[已失效] 未知工作流 (${currentBoundId})`,
                value: currentBoundId,
            });
        }
        return opts;
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
        const cfg = settingsStore.getProviderConfig<{ serverUrl?: string; apiKey?: string; activeDrawingPresetId?: string }>('comfyui');
        const activeDrawingId = cfg?.activeDrawingPresetId || '';

        // 同步服务连接配置
        this.connectionCard.setData({
            serverUrl: cfg?.serverUrl || 'http://127.0.0.1:8188',
            apiKey: cfg?.apiKey || '',
        });

        // 统一应用当前激活方案
        this.applyActivePreset(activeDrawingId);

        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
                const freshCfg = settingsStore.getProviderConfig<{ serverUrl?: string; apiKey?: string; activeDrawingPresetId?: string }>('comfyui');
                this.connectionCard.setData({
                    serverUrl: freshCfg?.serverUrl || 'http://127.0.0.1:8188',
                    apiKey: freshCfg?.apiKey || '',
                });

                const freshActiveId = freshCfg?.activeDrawingPresetId;
                if (freshActiveId && freshActiveId !== this.currentPresetItem?.id) {
                    this.applyActivePreset(freshActiveId, { persist: false });
                }

                if (!payload || payload.key === 'workflows' || payload.key === 'prompts') {
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
