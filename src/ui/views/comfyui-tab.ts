/**
 * @module ui/views/comfyui-tab
 * @description ComfyUI 生图后端配置面板视图 (ComfyUITabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 * 采用 DraftBridge 管理内存工作区到主 Store 的投影同步。
 * 遵循 5 大核心功能卡片体系，全宽卡片工具栏，无冗余前置标签。
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    ModelProfileData,
    PromptProfileData,
    IDriverRegistry,
    DEFAULT_COMFYUI_URL,
    COMFYUI_SIZE_PRESETS
} from '../../core';
import { ProfileService } from '../../domain';
import {
    FormRenderer,
    SectionCardSchema,
    createConnectionCard,
    createLoraManagerControl,
    SelectOptionItem,
    SelectControlHandle,
    LoraManagerElement,
    createWorkflowPresetCard,
    bindPresetToolbar,
    PresetToolbarElement,
    WorkflowPresetCardHandle,
    createPresetToolbarAdapter
} from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { DraftBridge } from '../foundation/draft-bridge';

/** ComfyUI 内存草稿同步字段 */
export const COMFYUI_DRAFT_KEYS = [
    'ckptName',
    'clipName',
    'vaeName',
    'width',
    'height',
    'steps',
    'cfgScale',
    'samplerName',
    'scheduler',
    'checkpointPositivePrefix',
    'checkpointNegativePrefix',
    'promptPrefix',
    'negativePrefix',
    'promptSuffix',
    'loras',
    'inpaintDenoise',
    'inpaintMaskBlur',
    'inpaintGrowMask'
] as const;

/**
 * ComfyUI 后端引擎配置面板视图
 */
export class ComfyUITabView extends BaseTabView {
    private readonly _draftStore: ObservableStore<DrawAssistantSettings>;
    private readonly _rendererDraft: FormRenderer<DrawAssistantSettings>;
    private readonly _rendererMain: FormRenderer<DrawAssistantSettings>;
    private readonly _profileService: ProfileService;

    private _modelPresetToolbar: PresetToolbarElement | null = null;
    private _promptPresetToolbar: PresetToolbarElement | null = null;
    private _loraManager: LoraManagerElement | null = null;
    private _txt2ImgWorkflowCardHandle: WorkflowPresetCardHandle | null = null;
    private _inpaintWorkflowCardHandle: WorkflowPresetCardHandle | null = null;

    constructor(
        private readonly _store: ObservableStore<DrawAssistantSettings>,
        private readonly _drivers?: IDriverRegistry
    ) {
        super('da-comfyui-tab');

        this._draftStore = new ObservableStore<DrawAssistantSettings>({ ..._store.getState() });
        this._disposables.add(this._draftStore);

        this._rendererDraft = new FormRenderer<DrawAssistantSettings>(this._draftStore);
        this._rendererMain = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._rendererDraft);
        this._disposables.add(this._rendererMain);

        this._profileService = new ProfileService(_store);

        // 声明式草稿同步桥
        const bridge = new DraftBridge(this._draftStore, this._store, COMFYUI_DRAFT_KEYS);
        this._disposables.add(bridge);

        this._buildCards();
        this._setupReactivity();
        this._refreshTab(true);
    }

    private _applyModelProfileData(profileData: ModelProfileData): void {
        const patch: Partial<DrawAssistantSettings> = {};
        if (profileData.ckptName !== undefined) patch.ckptName = profileData.ckptName;
        if (profileData.clipName !== undefined) patch.clipName = profileData.clipName;
        if (profileData.vaeName !== undefined) patch.vaeName = profileData.vaeName;
        if (profileData.width !== undefined) patch.width = profileData.width;
        if (profileData.height !== undefined) patch.height = profileData.height;
        if (profileData.steps !== undefined) patch.steps = profileData.steps;
        if (profileData.cfgScale !== undefined) patch.cfgScale = profileData.cfgScale;
        if (profileData.samplerName !== undefined) patch.samplerName = profileData.samplerName;
        if (profileData.scheduler !== undefined) patch.scheduler = profileData.scheduler;
        if (profileData.checkpointPositivePrefix !== undefined) patch.checkpointPositivePrefix = profileData.checkpointPositivePrefix;
        if (profileData.checkpointNegativePrefix !== undefined) patch.checkpointNegativePrefix = profileData.checkpointNegativePrefix;
        if (profileData.inpaintDenoise !== undefined) patch.inpaintDenoise = profileData.inpaintDenoise;
        if (profileData.inpaintMaskBlur !== undefined) patch.inpaintMaskBlur = profileData.inpaintMaskBlur;
        if (profileData.inpaintGrowMask !== undefined) patch.inpaintGrowMask = profileData.inpaintGrowMask;
        this._draftStore.update(patch);
    }

    private _applyPromptProfileData(profileData: PromptProfileData): void {
        const patch: Partial<DrawAssistantSettings> = {};
        if (profileData.promptPrefix !== undefined) patch.promptPrefix = profileData.promptPrefix;
        if (profileData.negativePrefix !== undefined) patch.negativePrefix = profileData.negativePrefix;
        if (profileData.promptSuffix !== undefined) patch.promptSuffix = profileData.promptSuffix;
        if (profileData.loras !== undefined) patch.loras = profileData.loras;
        this._draftStore.update(patch);
    }

    private _refreshTab(silent = true): void {
        const currentState = this._store.getState();
        const missingItems: string[] = [];

        // 1. 刷新 Toolbar 列表
        if (this._modelPresetToolbar?.refreshPresets) {
            this._modelPresetToolbar.refreshPresets(currentState.comfyModelProfiles || [], currentState.comfyModelProfileId || '');
        }
        if (this._promptPresetToolbar?.refreshPresets) {
            this._promptPresetToolbar.refreshPresets(currentState.comfyPromptProfiles || [], currentState.comfyPromptProfileId || '');
        }

        // 2. 刷新模型与采样下拉框 + 失效标红检测
        const cachedModels = currentState.cachedModels || [];
        const cachedClips = currentState.cachedClips || [];
        const cachedVaes = currentState.cachedVaes || [];
        const cachedLoras = currentState.cachedLoras || [];

        const currentDraft = this._draftStore.getState();
        const modelSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('ckptName');
        const clipSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('clipName');
        const vaeSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('vaeName');
        const samplerSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('samplerName');
        const schedulerSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('scheduler');

        if (modelSelectHandle) {
            const isMissing = Boolean(currentDraft.ckptName && cachedModels.length > 0 && !cachedModels.includes(currentDraft.ckptName));
            const options = cachedModels.map((modelName) => ({ label: modelName, value: modelName }));
            if (isMissing && currentDraft.ckptName) {
                options.unshift({ label: `⚠️ ${currentDraft.ckptName} (未在后端找到)`, value: currentDraft.ckptName });
                missingItems.push(`主模型 [${currentDraft.ckptName}]`);
            }
            modelSelectHandle.setOptions([{ label: '未选择', value: '' }, ...options]);
            modelSelectHandle.setValue(currentDraft.ckptName || '');
            modelSelectHandle.setError(isMissing, isMissing ? `⚠️ 主模型 [${currentDraft.ckptName}] 未在 ComfyUI 后端找到！` : undefined);
        }

        if (clipSelectHandle) {
            const isMissing = Boolean(currentDraft.clipName && cachedClips.length > 0 && !cachedClips.includes(currentDraft.clipName));
            const options = cachedClips.map((clipName) => ({ label: clipName, value: clipName }));
            if (isMissing && currentDraft.clipName) {
                options.unshift({ label: `⚠️ ${currentDraft.clipName} (未在后端找到)`, value: currentDraft.clipName });
                missingItems.push(`CLIP 编码器 [${currentDraft.clipName}]`);
            }
            clipSelectHandle.setOptions([{ label: '使用模型内置', value: '' }, ...options]);
            clipSelectHandle.setValue(currentDraft.clipName || '');
            clipSelectHandle.setError(isMissing, isMissing ? `⚠️ CLIP 编码器 [${currentDraft.clipName}] 未在 ComfyUI 后端找到！` : undefined);
        }

        if (vaeSelectHandle) {
            const isMissing = Boolean(currentDraft.vaeName && cachedVaes.length > 0 && !cachedVaes.includes(currentDraft.vaeName));
            const options = cachedVaes.map((vaeName) => ({ label: vaeName, value: vaeName }));
            if (isMissing && currentDraft.vaeName) {
                options.unshift({ label: `⚠️ ${currentDraft.vaeName} (未在后端找到)`, value: currentDraft.vaeName });
                missingItems.push(`VAE 解码器 [${currentDraft.vaeName}]`);
            }
            vaeSelectHandle.setOptions([{ label: '使用模型内置', value: '' }, ...options]);
            vaeSelectHandle.setValue(currentDraft.vaeName || '');
            vaeSelectHandle.setError(isMissing, isMissing ? `⚠️ VAE 解码器 [${currentDraft.vaeName}] 未在 ComfyUI 后端找到！` : undefined);
        }

        if (samplerSelectHandle) {
            const samplers = (currentState.cachedSamplers || ['euler_ancestral', 'euler', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc']).map((samplerName) => ({ label: samplerName, value: samplerName }));
            samplerSelectHandle.setOptions(samplers);
            samplerSelectHandle.setValue(currentDraft.samplerName || 'euler_ancestral');
        }
        if (schedulerSelectHandle) {
            const schedulers = (currentState.cachedSchedulers || ['normal', 'karras', 'exponential', 'sgm_uniform']).map((schedulerName) => ({ label: schedulerName, value: schedulerName }));
            schedulerSelectHandle.setOptions(schedulers);
            schedulerSelectHandle.setValue(currentDraft.scheduler || 'normal');
        }

        // 3. 刷新 LoRA 列表与失效项检测
        if (this._loraManager) {
            this._loraManager.update?.(currentDraft.loras || [], cachedLoras);
            (currentDraft.loras || []).forEach((item) => {
                if (item.name && cachedLoras.length > 0 && !cachedLoras.includes(item.name)) {
                    missingItems.push(`LoRA [${item.name}]`);
                }
            });
        }

        // 4. 刷新工作流卡片
        this._txt2ImgWorkflowCardHandle?.refresh();
        this._inpaintWorkflowCardHandle?.refresh();

        // 若存在失效资源且处于非静默模式，弹出警告提示
        if (!silent && missingItems.length > 0) {
            FeedbackService.toastWarning(
                `⚠️ 检测到当前方案中以下资源未在 ComfyUI 后端找到：\n${missingItems.join('、')}\n相关控件已自动标红，请检查 ComfyUI 模型目录！`
            );
        }
    }

    private _buildCards(): void {
        this._root.appendChild(this._buildConnectionCard());
        this._root.appendChild(this._buildModelSamplingCard());
        this._root.appendChild(this._buildPromptLoraCard());
        this._root.appendChild(this._buildTxt2ImgWorkflowCard());
        this._root.appendChild(this._buildInpaintWorkflowCard());
    }

    // ── 卡片 1: API 服务连接 ────────────────────────────────────────────────
    private _buildConnectionCard(): HTMLElement {
        return createConnectionCard({
            title: 'API 服务连接',
            description: '配置 ComfyUI 服务地址，测试连通性并同步后端模型与 LoRA 资产',
            url: this._store.get('serverUrl') || DEFAULT_COMFYUI_URL,
            placeholder: DEFAULT_COMFYUI_URL,
            onUrlChange: (newUrl) => this._store.set('serverUrl', newUrl),
            onTest: async (url, btn) => {
                btn.disabled = true;
                btn.textContent = '连接中...';
                try {
                    this._store.set('serverUrl', url);
                    const driver = this._drivers?.get('comfyui');
                    if (!driver) {
                        FeedbackService.toastError('🔴 驱动未就绪: ComfyUI 驱动未注册');
                        return;
                    }

                    const result = driver.checkConnection
                        ? await driver.checkConnection()
                        : { connected: await driver.ping(), latencyMs: 0 };

                    if (result.connected) {
                        const syncResult = driver.syncAssets ? await driver.syncAssets(this._store) : { updatedCount: 0, summary: '', details: {} };
                        this._refreshTab(false);
                        FeedbackService.toastSuccess(
                            `🟢 ComfyUI 连接成功 (延迟 ${result.latencyMs ?? 0}ms)\n${syncResult.summary}`
                        );
                    } else {
                        FeedbackService.toastError('🔴 ComfyUI 连接失败: 无法访问后端服务');
                    }
                } catch (err: any) {
                    FeedbackService.toastError(`🔴 连接异常: ${err?.message || err}`);
                } finally {
                    if (btn && btn.isConnected) {
                        btn.disabled = false;
                        btn.textContent = '测试连接';
                    }
                }
            }
        });
    }

    // ── 卡片 2: 模型与采样参数 ──────────────────────────────────────────────
    private _buildModelSamplingCard(): HTMLElement {
        const getCachedModels = (): SelectOptionItem[] => [
            { label: '未选择', value: '' },
            ...(this._store.get('cachedModels') || []).map((m) => ({ label: m, value: m }))
        ];
        const getCachedClips = (): SelectOptionItem[] => [
            { label: '使用模型内置', value: '' },
            ...(this._store.get('cachedClips') || []).map((c) => ({ label: c, value: c }))
        ];
        const getCachedVaes = (): SelectOptionItem[] => [
            { label: '使用模型内置', value: '' },
            ...(this._store.get('cachedVaes') || []).map((v) => ({ label: v, value: v }))
        ];
        const getCachedSamplers = (): SelectOptionItem[] =>
            (this._store.get('cachedSamplers') || ['euler_ancestral', 'euler', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc']).map((s) => ({ label: s, value: s }));
        const getCachedSchedulers = (): SelectOptionItem[] =>
            (this._store.get('cachedSchedulers') || ['normal', 'karras', 'exponential', 'sgm_uniform']).map((s) => ({ label: s, value: s }));

        this._modelPresetToolbar = bindPresetToolbar({
            adapter: createPresetToolbarAdapter(this._profileService, 'model', {
                onSave: () => {
                    FeedbackService.toastSuccess('模型参数预设保存成功！');
                }
            }),
            getCurrentData: () => {
                const draft = this._draftStore.getState();
                return {
                    ckptName: draft.ckptName,
                    clipName: draft.clipName,
                    vaeName: draft.vaeName,
                    width: draft.width,
                    height: draft.height,
                    steps: draft.steps,
                    cfgScale: draft.cfgScale,
                    samplerName: draft.samplerName,
                    scheduler: draft.scheduler,
                    checkpointPositivePrefix: draft.checkpointPositivePrefix,
                    checkpointNegativePrefix: draft.checkpointNegativePrefix
                };
            },
            applyData: (id) => {
                const profile = (this._store.get('comfyModelProfiles') || []).find((p) => p.id === id);
                if (profile?.data) this._applyModelProfileData(profile.data);
                this._refreshTab(false);
            },
            onRefresh: () => this._refreshTab(false)
        });

        const cardC2Schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '模型与采样参数',
            description: '配置底模、CLIP 编码器、VAE 解码器、采样算法、分辨率及起手式',
            rows: [
                {
                    type: 'component',
                    label: '',
                    renderCustom: () => this._modelPresetToolbar!
                },
                {
                    key: 'ckptName',
                    type: 'select',
                    label: '主模型 (Base Model)',
                    helpTooltip: '从 ComfyUI 后端读取的所有可用底模。',
                    options: getCachedModels()
                },
                {
                    key: 'clipName',
                    type: 'select',
                    label: 'CLIP 编码器',
                    helpTooltip: '指定独立 CLIP 文本编码器。若无需额外覆盖，保持“使用模型内置”即可。',
                    options: getCachedClips()
                },
                {
                    key: 'vaeName',
                    type: 'select',
                    label: 'VAE 解码器',
                    helpTooltip: '指定独立 VAE 解码器。若无需额外覆盖，保持“使用模型内置”即可。',
                    options: getCachedVaes()
                },
                {
                    key: 'samplerName',
                    type: 'select',
                    label: '采样算法 (Sampler)',
                    options: getCachedSamplers()
                },
                {
                    key: 'scheduler',
                    type: 'select',
                    label: '调度器 (Scheduler)',
                    options: getCachedSchedulers()
                },
                {
                    type: 'select',
                    label: '分辨率预设',
                    options: [...COMFYUI_SIZE_PRESETS],
                    onChangeHook: (val: string) => {
                        if (val !== 'custom') {
                            const [w, h] = val.split('x').map((n) => parseInt(n, 10));
                            if (w && h) this._draftStore.update({ width: w, height: h });
                        }
                    }
                },
                {
                    key: 'width',
                    type: 'number',
                    label: '图像宽度 (Width)',
                    min: 64,
                    max: 4096,
                    step: 8,
                    unit: 'px'
                },
                {
                    key: 'height',
                    type: 'number',
                    label: '图像高度 (Height)',
                    min: 64,
                    max: 4096,
                    step: 8,
                    unit: 'px'
                },
                {
                    key: 'steps',
                    type: 'number',
                    label: '采样步数 (Steps)',
                    min: 1,
                    max: 150,
                    step: 1
                },
                {
                    key: 'cfgScale',
                    type: 'number',
                    label: '引导系数 (CFG Scale)',
                    min: 1.0,
                    max: 30.0,
                    step: 0.5
                },
                {
                    key: 'checkpointPositivePrefix',
                    type: 'textarea',
                    label: '正向起手式 (Positive)',
                    helpTooltip: '绑定到当前预设的推荐正向起手词/质量词，生图时自动置于正向提示词最前。',
                    placeholder: 'masterpiece, best quality, anime artwork...'
                },
                {
                    key: 'checkpointNegativePrefix',
                    type: 'textarea',
                    label: '负向起手式 (Negative)',
                    helpTooltip: '绑定到当前预设的推荐负向起手词/通用排除词，生图时自动置于负向提示词最前。',
                    placeholder: 'lowres, bad anatomy, worst quality...'
                }
            ]
        };
        return this._rendererDraft.renderCard(cardC2Schema);
    }

    // ── 卡片 3: ComfyUI 提示词模板与 LoRA 增强 ──────────────────────────────
    private _buildPromptLoraCard(): HTMLElement {
        this._promptPresetToolbar = bindPresetToolbar({
            adapter: createPresetToolbarAdapter(this._profileService, 'prompt', {
                onSave: () => {
                    FeedbackService.toastSuccess('提示词模板预设保存成功！');
                }
            }),
            getCurrentData: () => {
                const draft = this._draftStore.getState();
                return {
                    promptPrefix: draft.promptPrefix,
                    negativePrefix: draft.negativePrefix,
                    promptSuffix: draft.promptSuffix,
                    loras: draft.loras
                };
            },
            applyData: (id) => {
                const profile = (this._store.get('comfyPromptProfiles') || []).find((p) => p.id === id);
                if (profile?.data) this._applyPromptProfileData(profile.data);
                this._refreshTab(false);
            },
            onRefresh: () => this._refreshTab(false)
        });

        const cardC3Schema: SectionCardSchema<DrawAssistantSettings> = {
            title: 'ComfyUI 提示词模板与 LoRA 增强',
            description: '维护通用正向词前后缀、负向排除词及 LoRA 动态选择与权重列表',
            rows: [
                {
                    type: 'component',
                    label: '',
                    renderCustom: () => this._promptPresetToolbar!
                },
                {
                    key: 'promptPrefix',
                    type: 'textarea',
                    label: '正向前缀 (Prefix)',
                    helpTooltip: '通用画质词与风格前缀，生图时自动附加在所有正向提示词开头。',
                    placeholder: 'masterpiece, best quality, highly detailed...'
                },
                {
                    key: 'promptSuffix',
                    type: 'textarea',
                    label: '正向后缀 (Suffix)',
                    helpTooltip: '通用光影与细节修饰词，生图时自动附加在所有正向提示词结尾。',
                    placeholder: 'vibrant lighting, 8k resolution...'
                },
                {
                    key: 'negativePrefix',
                    type: 'textarea',
                    label: '负向词 (Negative)',
                    helpTooltip: '通用负向排除词与崩坏修复词，生图时自动附加在负向提示词中。',
                    placeholder: 'lowres, bad anatomy, worst quality, text, error...'
                },
                {
                    type: 'component',
                    label: '',
                    renderCustom: () => {
                        this._loraManager = createLoraManagerControl({
                            loras: this._draftStore.get('loras') || this._store.get('loras') || [],
                            cachedLoras: this._store.get('cachedLoras') || [],
                            showExtraWeights: true,
                            onChange: (newLoras) => {
                                this._draftStore.set('loras', newLoras);
                            }
                        });
                        return this._loraManager;
                    }
                }
            ]
        };
        return this._rendererDraft.renderCard(cardC3Schema);
    }

    // ── 卡片 4: 文生图工作流预设 ─────────────────────────────────────────────
    private _buildTxt2ImgWorkflowCard(): HTMLElement {
        this._txt2ImgWorkflowCardHandle = createWorkflowPresetCard({
            title: '文生图工作流预设',
            description: '维护文生图 API 格式工作流 JSON，支持通过蓝图编辑器绑定变量',
            label: '文生图工作流',
            blueprintMode: 'txt2img',
            fieldLabel: 'API 工作流 JSON',
            helpTooltip: 'ComfyUI 开启 Dev Mode 导出的 API 格式工作流 JSON。可点击右侧按钮打开可视化蓝图。',
            placeholder: '请输入 API 格式 Workflow JSON，或使用上方工具栏导入与选择工作流...',
            getProfiles: () => this._store.get('comfyTxt2ImgWorkflows') || [],
            getCurrentProfileId: () => this._store.get('comfyTxt2ImgWorkflowId') || '',
            getCurrentJson: () => this._store.get('workflowJson') || '',
            onProfilesChange: (profiles, activeId) => {
                this._store.set('comfyTxt2ImgWorkflows', profiles);
                this._store.set('comfyTxt2ImgWorkflowId', activeId);
            },
            onJsonChange: (json) => this._store.set('workflowJson', json),
            onRefresh: () => this._refreshTab(false)
        });
        return this._txt2ImgWorkflowCardHandle;
    }

    // ── 卡片 5: 局部重绘工作流与参数 ─────────────────────────────────────────
    private _buildInpaintWorkflowCard(): HTMLElement {
        this._inpaintWorkflowCardHandle = createWorkflowPresetCard({
            title: '局部重绘工作流与参数',
            description: '配置局部重绘 API 格式工作流 JSON 及遮罩融合参数',
            collapsible: true,
            defaultOpen: false,
            label: '重绘工作流',
            blueprintMode: 'inpaint',
            fieldLabel: 'API 工作流 JSON',
            helpTooltip: '用于 Mask 掩码抠图与局部重绘的 ComfyUI 工作流。可点击右侧按钮打开可视化蓝图。',
            placeholder: '请输入 API 格式局部重绘 Workflow JSON，或使用上方工具栏导入与选择工作流...',
            getProfiles: () => this._store.get('comfyInpaintWorkflows') || [],
            getCurrentProfileId: () => this._store.get('comfyInpaintWorkflowId') || '',
            getCurrentJson: () => this._store.get('inpaintWorkflowJson') || '',
            onProfilesChange: (profiles, activeId) => {
                this._store.set('comfyInpaintWorkflows', profiles);
                this._store.set('comfyInpaintWorkflowId', activeId);
            },
            onJsonChange: (json) => this._store.set('inpaintWorkflowJson', json),
            onRefresh: () => this._refreshTab(false)
        });

        // 挂载局部重绘融合参数行 (平铺接入重绘卡片主体，杜绝双重卡片嵌套)
        const bodyEl = this._inpaintWorkflowCardHandle.querySelector('.da-card__body') || this._inpaintWorkflowCardHandle;
        const inpaintRows = [
            {
                key: 'inpaintDenoise' as const,
                type: 'number' as const,
                label: '重绘去噪幅度 (Denoise)',
                helpTooltip: '局部重绘与图生图的去噪强度，推荐 0.6 ~ 0.85。',
                min: 0.05,
                max: 1.0,
                step: 0.05
            },
            {
                key: 'inpaintMaskBlur' as const,
                type: 'number' as const,
                label: '蒙版羽化 (Mask Blur)',
                helpTooltip: '重绘遮罩边缘的高斯模糊过渡像素，推荐 4 ~ 12 px。',
                min: 0,
                max: 64,
                step: 1,
                unit: 'px'
            },
            {
                key: 'inpaintGrowMask' as const,
                type: 'number' as const,
                label: '蒙版边缘扩展 (Grow Mask)',
                helpTooltip: '将遮罩边缘向外扩展指定像素以覆盖更多上下文，推荐 0 ~ 16 px。',
                min: 0,
                max: 64,
                step: 1,
                unit: 'px'
            }
        ];

        inpaintRows.forEach((rowSchema) => {
            bodyEl.appendChild(this._rendererDraft.renderRow(rowSchema));
        });

        return this._inpaintWorkflowCardHandle;
    }

    private _setupReactivity(): void {
        this._disposables.add(
            this._store.subscribe(() => {
                this._refreshTab(true);
            })
        );
    }
}
