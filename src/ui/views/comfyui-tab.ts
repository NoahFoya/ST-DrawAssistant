/**
 * ComfyUI 生图后端配置面板视图 (ComfyUITabView)
 * 提供四部分设置卡片：
 * 1. 服务连接：后端地址、连通性测试与模型资产拉取
 * 2. 绘图参数预设：采样器、调度器、分辨率与方案引用关联
 * 3. 提示词预设：前后缀、负向词与 LoRA 方案管理
 * 4. 工作流预设：工作流方案管理、映射变量与工作流编辑器
 */

import { CoreEventMap } from '../../types';
import { TypedEventBus, Logger } from '../../utils';
import { SettingsStore, PresetStore } from '../../state';
import { DriverRegistry } from '../../services/drivers';
import { ProviderAssetCatalog, ModelAssetItem } from '../../types';
import { DEFAULT_COMFYUI_CONFIG } from '../../services/drivers/comfyui-driver';
import { formatModelDisplayLabel } from '../../services/drivers/model-asset-utils';
import {
    FormRenderer,
    FormRowSchema,
    createConnectionCard,
    SelectHandle,
    createWorkflowPresetCard,
    WorkflowPresetCardHandle,
    PresetProfileItem,
    WorkflowProfileData,
    bindPresetToolbar,
    createPresetStoreAdapter,
    PresetItem,
    createPromptPresetManager,
    PromptPresetManagerHandle,
    PromptProfileData
} from '../components';
import {
    createCard,
    createCardHeader,
    createSectionGroup
} from '../layout/container-factory';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { EngineFormStore } from '../foundation/form-binder';
import { openWorkflowModal } from '../layout/workflow-modal';

/** ComfyUI 分辨率预设常量（以常见画幅比例定义，'WxH' 格式） */
export const COMFYUI_RESOLUTION_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    { label: '1024 × 1024 (1:1 方图)', value: '1024x1024' },
    { label: '832 × 1216 (2:3 竖图)', value: '832x1216' },
    { label: '1216 × 832 (3:2 横图)', value: '1216x832' },
    { label: '1024 × 1344 (3:4 竖图)', value: '1024x1344' },
    { label: '1344 × 1024 (4:3 横图)', value: '1344x1024' },
    { label: '768 × 1344 (9:16 超竖)', value: '768x1344' },
    { label: '1344 × 768 (16:9 超横)', value: '1344x768' },
    { label: '512 × 512 (1:1 经典)', value: '512x512' },
    { label: '512 × 768 (2:3 经典)', value: '512x768' },
    { label: '768 × 512 (3:2 经典)', value: '768x512' }
] as const;

/** ComfyUI 绘图参数预设方案数据结构 (卡片 2 主方案) */
export interface ComfyDrawingProfileData {
    model?: string;
    clipName?: string;
    vaeName?: string;
    samplerName?: string;
    scheduler?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    promptProfileId?: string;
    txt2imgWorkflowId?: string;
    img2imgWorkflowId?: string;
    inpaintWorkflowId?: string;
}

/** ComfyUI 视图状态配置接口 */
export interface ComfyUIConfig extends ComfyDrawingProfileData, PromptProfileData {
    serverUrl?: string;
    activeDrawingProfileId?: string;
    drawingProfiles?: PresetItem<ComfyDrawingProfileData>[];
    activePromptProfileId?: string;
    promptProfiles?: PresetItem<PromptProfileData>[];
    activeWorkflowProfileId?: string;
    workflowProfiles?: PresetProfileItem<WorkflowProfileData>[];
    workflowJson?: string;
    [key: string]: any;
}

export class ComfyUITabView extends BaseTabView {
    private readonly _logger = new Logger('ComfyUITabView');
    private readonly _engineStore: EngineFormStore<ComfyUIConfig>;
    private readonly _renderer: FormRenderer<ComfyUIConfig>;
    private readonly _driverRegistry?: DriverRegistry;

    private _promptPresetManagerHandle: PromptPresetManagerHandle | null = null;
    private _workflowCardHandle: WorkflowPresetCardHandle | null = null;
    private _drawingToolbarHandle: any = null;

    private _cachedModels: Array<string | ModelAssetItem> = [];
    private _cachedClips: string[] = [];
    private _cachedVaes: string[] = [];
    private _cachedSamplers: string[] = [
        'euler',
        'euler_ancestral',
        'dpmpp_2m',
        'dpmpp_2m_sde',
        'dpmpp_sde',
        'ddim',
        'uni_pc'
    ];
    private _cachedSchedulers: string[] = [
        'normal',
        'karras',
        'exponential',
        'sgm_uniform',
        'simple'
    ];
    private _cachedLoras: string[] = [];
    private _drawingProfiles: PresetItem<ComfyDrawingProfileData>[] = [];
    private _promptProfiles: PresetItem<PromptProfileData>[] = [];
    private _workflowProfiles: PresetItem<WorkflowProfileData>[] = [];
    private _activeDrawingBaseline: ComfyDrawingProfileData | null = null;

    constructor(
        private readonly _mainStore: SettingsStore,
        driverRegistry?: DriverRegistry,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super('da-comfyui-tab');
        this._driverRegistry = driverRegistry;

        const storedConfig: Record<string, any> = (this._mainStore.getEngineConfig('comfyui') as any) || {};

        const initialConfig: ComfyUIConfig = {
            ...DEFAULT_COMFYUI_CONFIG,
            ...storedConfig,
            serverUrl: storedConfig.serverUrl || DEFAULT_COMFYUI_CONFIG.serverUrl || 'http://127.0.0.1:8188',
            activeDrawingProfileId: storedConfig.activeDrawingProfileId || '',
            activePromptProfileId: storedConfig.activePromptProfileId || '',
            activeWorkflowProfileId: storedConfig.activeWorkflowProfileId || ''
        };
        delete (initialConfig as any).drawingProfiles;
        delete (initialConfig as any).promptProfiles;
        delete (initialConfig as any).workflowProfiles;

        this._engineStore = new EngineFormStore<ComfyUIConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('comfyui', data);
        });
        this._mainStore.setEngineConfig('comfyui', initialConfig);
        this._disposables.add(this._engineStore);

        this._renderer = new FormRenderer<ComfyUIConfig>(this._engineStore);
        this._disposables.add(this._renderer);

        this._activeDrawingBaseline = this._extractCurrentDrawingData();

        // 监听表单参数变动以实时比对方案基准快照并驱动工具栏脏状态
        this._disposables.add(
            this._engineStore.subscribe(() => {
                this._checkDrawingDirty();
            })
        );

        this._buildCards();
        this._loadDiskPresets();

        if (this._events) {
            this._disposables.add(
                this._events.on('presets:reset', () => {
                    void this._loadDiskPresets();
                })
            );
            this._disposables.add(
                this._events.on('presets:imported', () => {
                    void this._loadDiskPresets();
                })
            );
        }
    }

    private _checkDrawingDirty(): void {
        if (!this._drawingToolbarHandle || !this._activeDrawingBaseline) return;
        const current = this._extractCurrentDrawingData();
        const isDirty = JSON.stringify(current) !== JSON.stringify(this._activeDrawingBaseline);
        this._drawingToolbarHandle.setDirty?.(isDirty);
    }

    private _buildCards(): void {
        // 卡片 1：服务连接
        this._root.appendChild(this._buildConnectionCard());

        // 卡片 2：绘图参数预设 (驱动主方案)
        this._root.appendChild(this._buildDrawingProfileCard());

        // 卡片 3：提示词预设管理器 (独立组件)
        this._root.appendChild(this._buildPromptPresetCard());

        // 卡片 4：工作流预设管理器 (独立组件)
        this._root.appendChild(this._buildWorkflowPresetCard());
    }

    // --- 卡片 1: 服务连接 (ConnectionCard) ---

    private _buildConnectionCard(): HTMLElement {
        const driver = this._driverRegistry?.get('comfyui');
        const initialCatalog = driver?.getAssetCatalog?.();
        if (initialCatalog) {
            if (initialCatalog.models) this._cachedModels = [...initialCatalog.models];
            if (initialCatalog.clips) this._cachedClips = [...initialCatalog.clips];
            if (initialCatalog.vaes) this._cachedVaes = [...initialCatalog.vaes];
            if (initialCatalog.samplers) this._cachedSamplers = [...initialCatalog.samplers];
            if (initialCatalog.schedulers) this._cachedSchedulers = [...initialCatalog.schedulers];
            if (initialCatalog.loras) this._cachedLoras = [...initialCatalog.loras];
        }
        const isInitiallyConnected = driver?.isConnected?.() || !!initialCatalog;

        return createConnectionCard({
            title: '服务连接',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: 'http://127.0.0.1:8188',
            placeholder: 'http://127.0.0.1:8188',
            buttonText: isInitiallyConnected ? '刷新链接状态' : '测试连接',
            onUrlChange: (newUrl) => this._engineStore.set('serverUrl', newUrl),
            onTest: async (_url, btn) => {
                const isRefreshing = btn.textContent === '刷新链接状态';
                btn.disabled = true;
                btn.textContent = isRefreshing ? '刷新中...' : '连接中...';
                let success = false;
                try {
                    const res = await driver?.checkHealth();
                    if (res?.ok) {
                        success = true;
                        FeedbackService.toastSuccess(`连接成功 (延迟 ${res.latencyMs}ms)`);

                        // 测试成功后立即跳过防抖保存至宿主配置文件 settings.json
                        this._mainStore.flush();

                        try {
                            if (driver && typeof driver.syncAssets === 'function') {
                                const catalog = await driver.syncAssets();
                                if (catalog) {
                                    this._onAssetsSynced(catalog);
                                }
                            }
                        } catch {
                            // 资产探测失败不阻断连通成功状态
                        }
                    } else {
                        FeedbackService.toastError(`连接失败: ${res?.message || '无法访问后端服务'}`);
                    }
                } catch (e: any) {
                    FeedbackService.toastError(`连接异常: ${e?.message || e}`);
                } finally {
                    btn.disabled = false;
                    btn.textContent = success ? '刷新链接状态' : '测试连接';
                }
            }
        });
    }

    // --- 卡片 2: 绘图参数预设 (主方案管理器) ---
    // 排序层级：顶部方案条 → 【模型设置】 → 【采样设置】 → 【提示词预设设置】 → 【工作流设置】

    private _buildDrawingProfileCard(): HTMLElement {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({ title: '绘图参数预设' });
        card.header.appendChild(header);

        let resolutionSelectHandle: SelectHandle | null = null;
        let widthHandle: any = null;
        let heightHandle: any = null;

        const matchPreset = (w: number, h: number): string => {
            const found = COMFYUI_RESOLUTION_PRESETS.find((p) => p.value === `${w}x${h}`);
            return found ? found.value : 'custom';
        };

        const updateResolutionPresetSelect = () => {
            if (!resolutionSelectHandle) return;
            const w = this._engineStore.get('width') ?? 832;
            const h = this._engineStore.get('height') ?? 1216;
            resolutionSelectHandle.setValue(matchPreset(w, h));
        };

        // 挂载顶部全宽绘图主方案工具栏
        const drawingAdapter = createPresetStoreAdapter<ComfyDrawingProfileData>({
            category: 'drawing',
            subCategory: 'comfyui',
            label: '绘图参数',
            getPresets: () => this._getDrawingProfiles(),
            getActiveId: () => this._engineStore.get('activeDrawingProfileId') || '',
            onPresetsChange: (presets, activeId) => {
                this._drawingProfiles = presets;
                this._engineStore.set('activeDrawingProfileId', activeId);
            },
            onApply: (preset) => {
                if (preset.data) {
                    this._activeDrawingBaseline = JSON.parse(JSON.stringify(preset.data));
                    this._engineStore.update(preset.data);
                    updateResolutionPresetSelect();
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            }
        });

        const drawingToolbar = bindPresetToolbar<ComfyDrawingProfileData>({
            adapter: {
                ...drawingAdapter,
                saveProfile: async (id, data) => {
                    await drawingAdapter.saveProfile(id, data);
                    this._activeDrawingBaseline = JSON.parse(JSON.stringify(data));
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            },
            getCurrentData: () => this._extractCurrentDrawingData(),
            onBeforeSelect: async (_newId) => {
                if (this._drawingToolbarHandle?.isDirty?.()) {
                    return await FeedbackService.confirm({
                        title: '未保存修改提示',
                        message: '当前绘图参数方案有未保存的修改，切换方案将放弃这些修改，是否继续？',
                        confirmText: '放弃修改并切换'
                    });
                }
                return true;
            },
            onResetOverride: () => {
                if (this._activeDrawingBaseline) {
                    this._engineStore.update(this._activeDrawingBaseline);
                    updateResolutionPresetSelect();
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            }
        });
        this._drawingToolbarHandle = drawingToolbar;
        card.body.appendChild(drawingToolbar);

        // 1. 模型设置分组 (默认展开)
        const modelGroup = createSectionGroup({
            title: '模型设置',
            collapsible: true,
            defaultOpen: true
        });
        const modelRows: FormRowSchema<ComfyUIConfig>[] = [
            {
                key: 'model',
                type: 'select',
                label: '主模型',
                description: '生成基础模型文件名',
                options: this._getModelSelectOptions()
            },
            {
                key: 'clipName',
                type: 'select',
                label: 'CLIP 模型',
                description: '文本特征提取模型 (可选)',
                options: this._getClipSelectOptions()
            },
            {
                key: 'vaeName',
                type: 'select',
                label: 'VAE 滤镜',
                description: '图像编解码模型 (可选)',
                options: this._getVaeSelectOptions()
            }
        ];
        modelRows.forEach((r) => modelGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(modelGroup.root);

        // 2. 采样设置分组 (默认展开，含分辨率预设与宽高双向联动)
        const samplingGroup = createSectionGroup({
            title: '采样设置',
            collapsible: true,
            defaultOpen: true
        });
        const samplingRows: FormRowSchema<ComfyUIConfig>[] = [
            {
                type: 'select',
                label: '分辨率预设',
                description: '常用画幅比例预设，选择后自动同步宽高数值',
                options: [...COMFYUI_RESOLUTION_PRESETS],
                onCreated: (handle) => {
                    resolutionSelectHandle = handle;
                    updateResolutionPresetSelect();
                },
                onChangeHook: (val: string) => {
                    if (val !== 'custom') {
                        const [w, h] = val.split('x').map((n) => parseInt(n, 10));
                        if (w && h) {
                            this._engineStore.set('width', w);
                            this._engineStore.set('height', h);
                            widthHandle?.setValue?.(w);
                            heightHandle?.setValue?.(h);
                        }
                    }
                }
            },
            {
                key: 'width',
                type: 'number',
                label: '生成宽度',
                min: 64,
                max: 2048,
                step: 64,
                unit: 'px',
                onCreated: (handle) => {
                    widthHandle = handle;
                },
                onChangeHook: () => {
                    updateResolutionPresetSelect();
                }
            },
            {
                key: 'height',
                type: 'number',
                label: '生成高度',
                min: 64,
                max: 2048,
                step: 64,
                unit: 'px',
                onCreated: (handle) => {
                    heightHandle = handle;
                },
                onChangeHook: () => {
                    updateResolutionPresetSelect();
                }
            },
            {
                key: 'samplerName',
                type: 'select',
                label: '采样算法 (Sampler)',
                options: this._cachedSamplers.map((s) => ({ label: s, value: s }))
            },
            {
                key: 'scheduler',
                type: 'select',
                label: '调度算法 (Scheduler)',
                options: this._cachedSchedulers.map((s) => ({ label: s, value: s }))
            },
            {
                key: 'steps',
                type: 'number',
                label: '采样步数 (Steps)',
                min: 1,
                max: 150,
                step: 1,
                unit: '步'
            },
            {
                key: 'cfgScale',
                type: 'number',
                label: '提示词引导系数 (CFG)',
                min: 1.0,
                max: 30.0,
                step: 0.5
            }
        ];
        samplingRows.forEach((r) => samplingGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(samplingGroup.root);

        // 3. 提示词预设设置分组 (默认展开)
        const promptGroup = createSectionGroup({
            title: '提示词预设设置',
            collapsible: true,
            defaultOpen: true
        });
        const promptRows: FormRowSchema<ComfyUIConfig>[] = [
            {
                key: 'promptProfileId',
                type: 'select',
                label: '提示词预设方案',
                description: '选择当前生效的提示词与 LoRA 方案',
                options: this._getPromptProfileSelectOptions()
            }
        ];
        promptRows.forEach((r) => promptGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(promptGroup.root);

        // 4. 工作流设置分组 (默认展开)
        const workflowGroup = createSectionGroup({
            title: '工作流设置',
            collapsible: true,
            defaultOpen: true
        });
        const workflowRows: FormRowSchema<ComfyUIConfig>[] = [
            {
                key: 'txt2imgWorkflowId',
                type: 'select',
                label: '文生图工作流',
                options: this._getWorkflowProfileSelectOptions()
            },
            {
                key: 'img2imgWorkflowId',
                type: 'select',
                label: '图生图工作流',
                options: this._getWorkflowProfileSelectOptions()
            },
            {
                key: 'inpaintWorkflowId',
                type: 'select',
                label: '局部重绘工作流',
                options: this._getWorkflowProfileSelectOptions()
            }
        ];
        workflowRows.forEach((r) => workflowGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(workflowGroup.root);

        return card.root;
    }

    // --- 卡片 3: 提示词预设管理器 (PromptPresetManager 独立组件) ---

    private _buildPromptPresetCard(): HTMLElement {
        this._promptPresetManagerHandle = createPromptPresetManager({
            title: '提示词预设管理器',
            getProfiles: () => this._getPromptProfiles(),
            getCurrentProfileId: () => this._engineStore.get('activePromptProfileId') || '',
            cachedLoras: this._cachedLoras,
            showExtraWeights: true,
            onProfilesChange: (profiles, activeId) => {
                this._promptProfiles = profiles;
                this._engineStore.set('activePromptProfileId', activeId);
                this._refreshPromptProfileSelectOptions();
            },
            onDataChange: (activeData) => {
                this._engineStore.set('promptPrefix', activeData.promptPrefix || '');
                this._engineStore.set('promptSuffix', activeData.promptSuffix || '');
                this._engineStore.set('negativePrompt', activeData.negativePrompt || '');
                this._engineStore.set('loras', activeData.loras || []);
            }
        });

        this._disposables.add(this._promptPresetManagerHandle);
        return this._promptPresetManagerHandle;
    }

    // --- 卡片 4: 工作流预设管理器 (WorkflowPresetManager 独立组件) ---

    private _buildWorkflowPresetCard(): HTMLElement {
        this._workflowCardHandle = createWorkflowPresetCard({
            title: '工作流预设管理器',
            description: '',
            label: '工作流方案',
            workflowMode: 'txt2img',
            fieldLabel: '工作流 JSON 定义',
            helpTooltip: '请在 ComfyUI Web 界面中开启 Dev Mode 后点击 Save (API Format) 导出并粘贴在此处。',
            getProfiles: () => this._getWorkflowProfiles(),
            getCurrentProfileId: () => this._getActiveWorkflowId(),
            getCurrentJson: () => this._getActiveWorkflowJson(),
            onProfilesChange: (profiles, activeId) => {
                this._workflowProfiles = profiles;
                this._engineStore.set('activeWorkflowProfileId', activeId);
                const active = profiles.find((p) => p.id === activeId) || profiles[0];
                if (active?.data?.json) {
                    this._engineStore.set('workflowJson', active.data.json);
                }
                this._refreshWorkflowProfileSelectOptions();
            },
            onJsonChange: (json) => {
                this._engineStore.set('workflowJson', json);
            },
            onRefresh: () => {},
            onOpenWorkflow: (currentJson) => {
                openWorkflowModal(currentJson, {
                    targetType: 'txt2img',
                    onSave: (updatedJson) => {
                        this._engineStore.set('workflowJson', updatedJson);
                        this._workflowCardHandle?.refresh();
                    }
                });
            }
        });

        this._disposables.add(this._workflowCardHandle);
        return this._workflowCardHandle;
    }

    // --- 内部数据流与联动更新 ---

    private _extractCurrentDrawingData(): ComfyDrawingProfileData {
        const model = this._engineStore.get('model') || '';
        return {
            model,
            clipName: this._engineStore.get('clipName') || '',
            vaeName: this._engineStore.get('vaeName') || '',
            samplerName: this._engineStore.get('samplerName') || 'euler_ancestral',
            scheduler: this._engineStore.get('scheduler') || 'normal',
            steps: this._engineStore.get('steps') ?? 28,
            cfgScale: this._engineStore.get('cfgScale') ?? 6.5,
            width: this._engineStore.get('width') ?? 832,
            height: this._engineStore.get('height') ?? 1216,
            promptProfileId: this._engineStore.get('promptProfileId') || 'default_prompt',
            txt2imgWorkflowId: this._engineStore.get('txt2imgWorkflowId') || 'default_txt2img',
            img2imgWorkflowId: this._engineStore.get('img2imgWorkflowId') || 'default_img2img',
            inpaintWorkflowId: this._engineStore.get('inpaintWorkflowId') || 'default_inpaint'
        };
    }

    private _onAssetsSynced(catalog: ProviderAssetCatalog): void {
        this._cachedModels = catalog.models || [];
        this._cachedClips = catalog.clips || [];
        this._cachedVaes = catalog.vaes || [];
        if (catalog.samplers && catalog.samplers.length > 0) {
            this._cachedSamplers = catalog.samplers;
        }
        if (catalog.schedulers && catalog.schedulers.length > 0) {
            this._cachedSchedulers = catalog.schedulers;
        }
        this._cachedLoras = catalog.loras || [];

        // 刷新主模型、CLIP、VAE 下拉框选项
        const modelSelect = this._renderer.getHandle<SelectHandle>('model');
        if (modelSelect) modelSelect.setOptions(this._getModelSelectOptions());

        const clipSelect = this._renderer.getHandle<SelectHandle>('clipName');
        if (clipSelect) clipSelect.setOptions(this._getClipSelectOptions());

        const vaeSelect = this._renderer.getHandle<SelectHandle>('vaeName');
        if (vaeSelect) vaeSelect.setOptions(this._getVaeSelectOptions());

        const samplerSelect = this._renderer.getHandle<SelectHandle>('samplerName');
        if (samplerSelect) samplerSelect.setOptions(this._cachedSamplers.map((s) => ({ label: s, value: s })));

        const schedulerSelect = this._renderer.getHandle<SelectHandle>('scheduler');
        if (schedulerSelect) schedulerSelect.setOptions(this._cachedSchedulers.map((s) => ({ label: s, value: s })));

        // 刷新提示词预设管理器的 LoRA 候选列表
        this._promptPresetManagerHandle?.updateCachedLoras(this._cachedLoras);

        FeedbackService.toastInfo(
            `已同步远端资产: ${this._cachedModels.length} 个主模型，${this._cachedClips.length} 个 CLIP，${this._cachedVaes.length} 个 VAE，${this._cachedLoras.length} 个 LoRA`
        );
    }

    private _getModelSelectOptions(): Array<{ label: string; value: string }> {
        const opts: Array<{ label: string; value: string }> = [{ label: '请选择或同步主模型...', value: '' }];
        if (this._cachedModels.length > 0) {
            this._cachedModels.forEach((m) => {
                const val = typeof m === 'string' ? m : m.name;
                opts.push({ label: formatModelDisplayLabel(m), value: val });
            });
        }
        const cur = this._engineStore.get('model');
        if (cur && !opts.some((o) => o.value === cur)) {
            opts.push({ label: `${cur} (当前配置)`, value: cur });
        }
        return opts;
    }

    private _getClipSelectOptions(): Array<{ label: string; value: string }> {
        const opts: Array<{ label: string; value: string }> = [{ label: '(不指定 / 工作流默认)', value: '' }];
        if (this._cachedClips.length > 0) {
            this._cachedClips.forEach((c) => opts.push({ label: c, value: c }));
        }
        const cur = this._engineStore.get('clipName');
        if (cur && !opts.some((o) => o.value === cur)) {
            opts.push({ label: `${cur} (当前配置)`, value: cur });
        }
        return opts;
    }

    private _getVaeSelectOptions(): Array<{ label: string; value: string }> {
        const opts: Array<{ label: string; value: string }> = [{ label: '(不指定 / 工作流默认)', value: '' }];
        if (this._cachedVaes.length > 0) {
            this._cachedVaes.forEach((v) => opts.push({ label: v, value: v }));
        }
        const cur = this._engineStore.get('vaeName');
        if (cur && !opts.some((o) => o.value === cur)) {
            opts.push({ label: `${cur} (当前配置)`, value: cur });
        }
        return opts;
    }

    private _getPromptProfileSelectOptions(): Array<{ label: string; value: string }> {
        const profiles: PresetItem<PromptProfileData>[] = this._engineStore.get('promptProfiles') || [];
        return profiles.map((p) => ({ label: p.name, value: p.id }));
    }

    private _getWorkflowProfileSelectOptions(): Array<{ label: string; value: string }> {
        const profiles = this._getWorkflowProfiles();
        return profiles.map((p) => ({ label: p.name, value: p.id }));
    }

    private _refreshPromptProfileSelectOptions(): void {
        const handle = this._renderer.getHandle<SelectHandle>('promptProfileId');
        if (handle) {
            handle.setOptions(this._getPromptProfileSelectOptions());
        }
    }

    private _refreshWorkflowProfileSelectOptions(): void {
        const options = this._getWorkflowProfileSelectOptions();
        const txt2img = this._renderer.getHandle<SelectHandle>('txt2imgWorkflowId');
        if (txt2img) txt2img.setOptions(options);

        const img2img = this._renderer.getHandle<SelectHandle>('img2imgWorkflowId');
        if (img2img) img2img.setOptions(options);

        const inpaint = this._renderer.getHandle<SelectHandle>('inpaintWorkflowId');
        if (inpaint) inpaint.setOptions(options);
    }

    private _getPromptProfiles(): PresetItem<PromptProfileData>[] {
        return this._promptProfiles;
    }

    private _getWorkflowProfiles(): PresetProfileItem<WorkflowProfileData>[] {
        return this._workflowProfiles;
    }

    private _getActiveWorkflowId(): string {
        return this._engineStore.get('activeWorkflowProfileId') || '';
    }

    private _getActiveWorkflowJson(): string {
        const profiles = this._getWorkflowProfiles();
        const activeId = this._getActiveWorkflowId();
        const active = profiles.find((p) => p.id === activeId);
        return active?.data?.json || (this._engineStore.get('workflowJson') || DEFAULT_COMFYUI_CONFIG.workflowJson || '');
    }

    private _getDrawingProfiles(): PresetItem<ComfyDrawingProfileData>[] {
        return this._drawingProfiles;
    }

    /** 异步按需加载预设方案与激活方案 */
    private async _loadDiskPresets(): Promise<void> {
        try {
            // 1. 绘图主方案：拉取预设列表并应用激活项
            const presets = await PresetStore.list<ComfyDrawingProfileData>('drawing', 'comfyui');
            this._drawingProfiles = Array.isArray(presets) ? presets : [];
            const currentDrawingId = this._engineStore.get('activeDrawingProfileId');
            const matched = this._drawingProfiles.find((p) => p.id === currentDrawingId) || this._drawingProfiles[0];
            if (matched) {
                this._engineStore.set('activeDrawingProfileId', matched.id);
                if (matched.data) {
                    this._activeDrawingBaseline = JSON.parse(JSON.stringify(matched.data));
                    this._engineStore.update(matched.data);
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            } else {
                this._engineStore.set('activeDrawingProfileId', '');
                this._activeDrawingBaseline = null;
            }
            this._drawingToolbarHandle?.refreshPresets?.(this._drawingProfiles, this._engineStore.get('activeDrawingProfileId'));

            // 2. 通用提示词预设：拉取预设列表并刷新组件
            const promptPresets = await PresetStore.list<PromptProfileData>('prompts');
            this._promptProfiles = Array.isArray(promptPresets) ? promptPresets : [];
            this._refreshPromptProfileSelectOptions();
            this._promptPresetManagerHandle?.refresh();
            this._promptPresetManagerHandle?.toolbar?.refreshPresets?.(
                this._promptProfiles,
                this._engineStore.get('activePromptProfileId') || (this._promptProfiles[0]?.id ?? '')
            );

            // 3. 工作流预设：拉取预设列表并刷新组件
            const workflowPresets = await PresetStore.list<WorkflowProfileData>('workflows');
            this._workflowProfiles = Array.isArray(workflowPresets) ? workflowPresets : [];
            this._refreshWorkflowProfileSelectOptions();
            this._workflowCardHandle?.refresh();
            this._workflowCardHandle?.toolbar?.refreshPresets?.(
                this._workflowProfiles,
                this._getActiveWorkflowId() || (this._workflowProfiles[0]?.id ?? '')
            );
        } catch (err) {
            this._logger.error('ComfyUITabView: 加载预设方案失败', err);
            FeedbackService.toastError('加载 ComfyUI 预设方案失败');
            this._drawingProfiles = [];
            this._promptProfiles = [];
            this._workflowProfiles = [];
            this._drawingToolbarHandle?.refreshPresets?.([], '');
        }
    }
}
