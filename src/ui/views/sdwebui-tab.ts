/**
 * SD-WebUI (A1111 / Forge / reForge / SD.Next) 配置面板视图 (SDWebUITabView)
 * 提供三部分设置卡片：
 * 1. 服务连接：后端地址、连通性测试与模型资产拉取
 * 2. 绘图参数预设：模型、采样器、分辨率、高清修复等参数方案管理
 * 3. 提示词预设：前后缀、负向提示词与 LoRA 方案管理
 */

import { CoreEventMap } from '../../types';
import { TypedEventBus, Logger } from '../../utils';
import { SettingsStore, PresetStore } from '../../state';
import { DriverRegistry } from '../../services/drivers';
import {
    DEFAULT_SDWEBUI_CONFIG,
    SDDrawingProfileData,
    SdWebUIEngineConfig
} from '../../services/drivers/sdwebui-driver';
import { ProviderAssetCatalog, ModelAssetItem } from '../../types';
import { formatModelDisplayLabel } from '../../services/drivers/model-asset-utils';
import {
    FormRenderer,
    FormRowSchema,
    createConnectionCard,
    SelectHandle,
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

/** SD-WebUI 常用画幅分辨率预设（含 SD 1.5 与 SDXL 标准规格） */
export const SDWEBUI_RESOLUTION_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    { label: '512 × 768 (2:3 竖图 · SD 1.5)', value: '512x768' },
    { label: '768 × 512 (3:2 横图 · SD 1.5)', value: '768x512' },
    { label: '512 × 512 (1:1 方图 · SD 1.5)', value: '512x512' },
    { label: '832 × 1216 (2:3 竖图 · SDXL)', value: '832x1216' },
    { label: '1216 × 832 (3:2 横图 · SDXL)', value: '1216x832' },
    { label: '1024 × 1024 (1:1 方图 · SDXL)', value: '1024x1024' },
    { label: '720 × 1280 (9:16 移动端全屏)', value: '720x1280' },
    { label: '1280 × 720 (16:9 宽屏壁纸)', value: '1280x720' }
] as const;

/** SD-WebUI 配置类型定义 */
export interface SDWebUIConfig extends SdWebUIEngineConfig {
    [key: string]: any;
}

export class SDWebUITabView extends BaseTabView {
    private readonly _logger = new Logger('SdWebUITabView');
    private readonly _engineStore: EngineFormStore<SDWebUIConfig>;
    private readonly _renderer: FormRenderer<SDWebUIConfig>;
    private readonly _driverRegistry?: DriverRegistry;

    private _promptPresetManagerHandle: PromptPresetManagerHandle | null = null;
    private _drawingToolbarHandle: any = null;
    private _cachedModels: Array<string | ModelAssetItem> = [];
    private _cachedVaes: string[] = [];
    private _cachedSamplers: string[] = ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ SDE Karras', 'DPM++ 2M SDE Karras', 'DDIM'];
    private _cachedSchedulers: string[] = ['Automatic', 'Karras', 'Exponential', 'SGM Uniform', 'Simple'];
    private _cachedUpscalers: string[] = ['R-ESRGAN 4x+ Anime6B', 'R-ESRGAN 4x+', 'Latent', 'ESRGAN_4x', 'ScuNET'];
    private _cachedLoras: string[] = [];
    private _drawingProfiles: PresetItem<SDDrawingProfileData>[] = [];
    private _promptProfiles: PresetItem<PromptProfileData>[] = [];
    private _activeDrawingBaseline: SDDrawingProfileData | null = null;

    constructor(
        private readonly _mainStore: SettingsStore,
        driverRegistry?: DriverRegistry,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super();
        this._driverRegistry = driverRegistry;

        const storedConfig: Record<string, any> = (this._mainStore.getEngineConfig('sdwebui') as any) || {};

        const activeDrawingProfileId: string = String(storedConfig.activeDrawingProfileId || '');

        const activePromptProfileId: string = String(storedConfig.activePromptProfileId || '');

        // 运行时表单仅维护当前生效项与标量配置，预设列表由 PresetStore 单独持久化
        const initialConfig: SDWebUIConfig = {
            ...DEFAULT_SDWEBUI_CONFIG,
            ...storedConfig,
            activeDrawingProfileId,
            activePromptProfileId
        };
        delete (initialConfig as any).drawingProfiles;
        delete (initialConfig as any).promptProfiles;

        this._engineStore = new EngineFormStore<SDWebUIConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('sdwebui', data);
        });
        this._mainStore.setEngineConfig('sdwebui', initialConfig);
        this._disposables.add(this._engineStore);

        this._renderer = new FormRenderer<SDWebUIConfig>(this._engineStore);
        this._disposables.add(this._renderer);

        this._activeDrawingBaseline = this._extractCurrentDrawingData();

        // 监听表单数据变动以实时比对方案基准快照并驱动工具栏脏状态
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
        // 卡片 1: 服务连接卡片
        this._root.appendChild(this._buildConnectionCard());

        // 卡片 2: 绘图参数预设卡片 (主方案统一管理：模型设置、采样设置、高清修复设置、关联提示词方案设置)
        this._root.appendChild(this._buildDrawingPresetCard());

        // 卡片 3: 提示词预设管理器卡片 (PromptPresetManager 独立通用组件)
        this._root.appendChild(this._buildPromptPresetCard());
    }

    // --- 卡片 1: 服务连接 (ConnectionCard) ---

    private _buildConnectionCard(): HTMLElement {
        const driver = this._driverRegistry?.get('sdwebui');
        const initialCatalog = driver?.getAssetCatalog?.();
        if (initialCatalog) {
            if (initialCatalog.models) this._cachedModels = [...initialCatalog.models];
            if (initialCatalog.vaes) this._cachedVaes = [...initialCatalog.vaes];
            if (initialCatalog.samplers) this._cachedSamplers = [...initialCatalog.samplers];
            if (initialCatalog.schedulers) this._cachedSchedulers = [...initialCatalog.schedulers];
            if (initialCatalog.upscalers) this._cachedUpscalers = [...initialCatalog.upscalers];
            if (initialCatalog.loras) this._cachedLoras = [...initialCatalog.loras];
        }

        return createConnectionCard({
            title: '服务连接',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: DEFAULT_SDWEBUI_CONFIG.serverUrl,
            placeholder: 'http://127.0.0.1:7860',
            buttonText: '测试连接',
            onUrlChange: (newUrl) => this._engineStore.set('serverUrl', newUrl),
            onTest: async (_url, _btn, card) => {
                card?.setStatus('testing');
                try {
                    const res = await driver?.checkHealth();
                    if (res?.ok) {
                        card?.setStatus('success', '连接成功');
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
                            // 资产同步探测失败不阻断整体连通状态
                        }
                    } else {
                        const errMsg = res?.message || '无法访问后端服务';
                        card?.setStatus('error', '连接失败');
                        card?.setError(true, `已失效：${errMsg}`);
                        FeedbackService.toastError(`连接失败: ${errMsg}`);
                    }
                } catch (e: any) {
                    const errMsg = e?.message || String(e);
                    card?.setStatus('error', '连接异常');
                    card?.setError(true, `已失效：${errMsg}`);
                    FeedbackService.toastError(`连接异常: ${errMsg}`);
                }
            }
        });
    }

    // --- 卡片 2: 绘图参数预设 (主方案管理器) ---

    private _buildDrawingPresetCard(): HTMLElement {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({ title: '绘图参数预设' });
        card.header.appendChild(header);

        let resolutionSelectHandle: SelectHandle | null = null;
        let widthHandle: any = null;
        let heightHandle: any = null;

        const matchPreset = (w: number, h: number): string => {
            const found = SDWEBUI_RESOLUTION_PRESETS.find((p) => p.value === `${w}x${h}`);
            return found ? found.value : 'custom';
        };

        const updateResolutionPresetSelect = () => {
            if (!resolutionSelectHandle) return;
            const w = this._engineStore.get('width') ?? 512;
            const h = this._engineStore.get('height') ?? 768;
            resolutionSelectHandle.setValue(matchPreset(w, h));
        };

        // 挂载顶部全宽绘图主方案工具栏
        const drawingAdapter = createPresetStoreAdapter<SDDrawingProfileData>({
            category: 'drawing',
            subCategory: 'sdwebui',
            label: '绘图参数',
            getPresets: () => this._getDrawingProfiles(),
            getActiveId: () => this._getActiveDrawingId(),
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
                    if (preset.data.promptProfileId && this._promptPresetManagerHandle) {
                        this._engineStore.set('activePromptProfileId', preset.data.promptProfileId);
                        this._promptPresetManagerHandle.refresh();
                    }
                }
            }
        });

        const drawingToolbar = bindPresetToolbar<SDDrawingProfileData>({
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
                        message: '当前绘图参数方案有未保存的修改，切换将放弃修改，是否继续？',
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
        const modelRows: FormRowSchema<SDWebUIConfig>[] = [
            {
                key: 'model',
                type: 'select',
                label: '生图主模型 (Base Model)',
                helpTooltip: '去噪生成核心底模。支持全量整合包 (Checkpoint)、独立扩散核心 (UNet / DiT) 与量化模型 (GGUF / NF4)。',
                options: this._getModelSelectOptions()
            },
            {
                key: 'vae',
                type: 'select',
                label: 'VAE 模型 (VAE)',
                helpTooltip: '用于将潜空间特征解码为可视图像，影响画面的色彩饱和度与精细度。',
                options: this._getVaeSelectOptions()
            },
            {
                key: 'clipSkip',
                type: 'number',
                label: 'CLIP 跳过层数 (Clip Skip)',
                helpTooltip: 'SD 1.5 模型通常建议为 1，二次元动漫模型通常建议为 2。',
                min: 1,
                max: 12,
                step: 1,
                unit: '层'
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
        const samplingRows: FormRowSchema<SDWebUIConfig>[] = [
            {
                type: 'select',
                label: '分辨率预设',
                options: [...SDWEBUI_RESOLUTION_PRESETS],
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
                label: '生成宽度 (Width)',
                min: 64,
                max: 2048,
                step: 64,
                unit: 'px',
                onCreated: (handle) => {
                    widthHandle = handle;
                },
                onChangeHook: () => {
                    resolutionSelectHandle?.setValue('custom');
                }
            },
            {
                key: 'height',
                type: 'number',
                label: '生成高度 (Height)',
                min: 64,
                max: 2048,
                step: 64,
                unit: 'px',
                onCreated: (handle) => {
                    heightHandle = handle;
                },
                onChangeHook: () => {
                    resolutionSelectHandle?.setValue('custom');
                }
            },
            {
                key: 'samplerName',
                type: 'select',
                label: '采样方法 (Sampler)',
                options: this._cachedSamplers.map((s) => ({ label: s, value: s }))
            },
            {
                key: 'scheduler',
                type: 'select',
                label: '调度类型 (Schedule type)',
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
                label: '提示词引导系数 (CFG Scale)',
                helpTooltip: '提示词贴合程度，数值越高越贴合提示词，通常建议 6.0 ~ 8.0。',
                min: 1.0,
                max: 30.0,
                step: 0.5
            },
            {
                key: 'seed',
                type: 'number',
                label: '随机种子 (Seed)',
                helpTooltip: '-1 为完全随机，填入固定数值可复现构图。',
                min: -1,
                max: 2147483647,
                step: 1
            },
            {
                key: 'restoreFaces',
                type: 'toggle',
                label: '面部修复 (Restore Faces)'
            },
            {
                key: 'denoisingStrength',
                type: 'number',
                label: '重绘幅度 (Denoising strength)',
                helpTooltip: '图生图或局部重绘时的变化强度，数值越小越接近原图，默认推荐 0.6 ~ 0.75。',
                min: 0.05,
                max: 1.0,
                step: 0.05
            }
        ];
        samplingRows.forEach((r) => samplingGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(samplingGroup.root);

        // 3. 高清修复设置 (Hires.fix) 分组 (默认展开)
        const hiresGroup = createSectionGroup({
            title: '高清修复 (Hires.fix)',
            collapsible: true,
            defaultOpen: true
        });
        const hiresRows: FormRowSchema<SDWebUIConfig>[] = [
            {
                key: 'enableHires',
                type: 'toggle',
                label: '启用高清修复'
            },
            {
                key: 'hiresUpscaler',
                type: 'select',
                label: '放大算法 (Upscaler)',
                disabledWhen: (s) => !s.enableHires,
                options: this._cachedUpscalers.map((u) => ({ label: u, value: u }))
            },
            {
                key: 'hiresScale',
                type: 'number',
                label: '放大倍率 (Upscale by)',
                disabledWhen: (s) => !s.enableHires,
                min: 1.1,
                max: 4.0,
                step: 0.1,
                unit: 'x'
            },
            {
                key: 'hiresSteps',
                type: 'number',
                label: '高分重绘步数 (Hires steps)',
                helpTooltip: '设为 0 表示复用原采样步数。',
                disabledWhen: (s) => !s.enableHires,
                min: 0,
                max: 100,
                step: 1,
                unit: '步'
            },
            {
                key: 'hiresDenoise',
                type: 'number',
                label: '重绘幅度 (Denoising strength)',
                helpTooltip: '高清潜空间去噪强度，数值过大可能导致画面崩坏，推荐 0.3 ~ 0.45。',
                disabledWhen: (s) => !s.enableHires,
                min: 0.05,
                max: 1.0,
                step: 0.05
            }
        ];
        hiresRows.forEach((r) => hiresGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(hiresGroup.root);

        // 4. 关联提示词预设设置分组 (默认展开)
        const promptGroup = createSectionGroup({
            title: '关联提示词预设',
            collapsible: true,
            defaultOpen: true
        });
        const promptRows: FormRowSchema<SDWebUIConfig>[] = [
            {
                key: 'promptProfileId',
                type: 'select',
                label: '关联提示词方案',
                helpTooltip: '生图时将自动合并该方案的正向提示词前缀、后缀、负向词与 LoRA 模型。',
                options: this._getPromptProfileSelectOptions(),
                onChangeHook: (selectedId: string) => {
                    this._engineStore.set('activePromptProfileId', selectedId);
                    this._promptPresetManagerHandle?.refresh();
                }
            }
        ];
        promptRows.forEach((r) => promptGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(promptGroup.root);

        return card.root;
    }

    // --- 卡片 3: 提示词预设管理器 (PromptPresetManager 独立组件) ---

    private _buildPromptPresetCard(): HTMLElement {
        this._promptPresetManagerHandle = createPromptPresetManager({
            title: '提示词预设管理器',
            showExtraWeights: false,
            cachedLoras: this._cachedLoras,
            getProfiles: () => this._getPromptProfiles(),
            getCurrentProfileId: () => this._getActivePromptId(),
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

    // --- 内部数据流与联动更新 ---

    private _extractCurrentDrawingData(): SDDrawingProfileData {
        const s = this._engineStore.getState();
        return {
            model: s.model,
            vae: s.vae,
            clipSkip: s.clipSkip,
            width: s.width,
            height: s.height,
            samplerName: s.samplerName,
            scheduler: s.scheduler,
            steps: s.steps,
            cfgScale: s.cfgScale,
            seed: s.seed,
            restoreFaces: s.restoreFaces,
            denoisingStrength: s.denoisingStrength,
            enableHires: s.enableHires,
            hiresUpscaler: s.hiresUpscaler,
            hiresScale: s.hiresScale,
            hiresSteps: s.hiresSteps,
            hiresDenoise: s.hiresDenoise,
            promptProfileId: s.promptProfileId || this._getActivePromptId()
        };
    }

    private _getDrawingProfiles(): PresetItem<SDDrawingProfileData>[] {
        return this._drawingProfiles;
    }

    private _getActiveDrawingId(): string {
        return this._engineStore.get('activeDrawingProfileId') || '';
    }

    private _getPromptProfiles(): PresetItem<PromptProfileData>[] {
        return this._promptProfiles;
    }

    private _getActivePromptId(): string {
        return this._engineStore.get('activePromptProfileId') || '';
    }

    private _refreshPromptProfileSelectOptions(): void {
        const handle = this._renderer.getHandle<SelectHandle>('promptProfileId');
        if (handle) {
            handle.setOptions(this._getPromptProfileSelectOptions());
        }
    }

    private _getPromptProfileSelectOptions() {
        const profiles = this._getPromptProfiles();
        if (profiles.length === 0) {
            return [{ label: '(无预设方案)', value: '' }];
        }
        return profiles.map((p) => ({
            label: p.name || p.id,
            value: p.id
        }));
    }

    private _getModelSelectOptions(): Array<{ label: string; value: string; group?: string }> {
        const cur = this._engineStore.get('model');
        const opts: Array<{ label: string; value: string; group?: string }> = [
            { label: '留空使用后端默认模型', value: '' },
            ...this._cachedModels.map((m) => {
                const val = typeof m === 'string' ? m : (m.title || m.name);
                return {
                    label: formatModelDisplayLabel(m),
                    value: val,
                    group: this._getModelGroupName(m)
                };
            })
        ];
        if (cur && !opts.some((o) => o.value === cur)) {
            opts.push({ label: `${cur} (当前配置)`, value: cur, group: '当前配置' });
        }
        return opts;
    }

    private _getModelGroupName(item: string | ModelAssetItem): string {
        if (typeof item === 'string') return '全量模型 (Checkpoints)';
        switch ((item.type || '').toLowerCase()) {
            case 'unet':
            case 'diffusion_model':
                return '独立扩散核心 (Diffusion Models / UNet)';
            case 'gguf':
            case 'nf4':
                return '量化模型 (GGUF / NF4)';
            case 'diffusers':
                return '分立管道 (Diffusers)';
            case 'checkpoint':
            default:
                return '全量模型 (Checkpoints)';
        }
    }

    private _getVaeSelectOptions() {
        const cur = this._engineStore.get('vae');
        const opts = [
            { label: '自动 (Automatic)', value: '' },
            { label: '无 (None)', value: 'None' },
            ...this._cachedVaes.map((v) => ({ label: v, value: v }))
        ];
        if (cur && !opts.some((o) => o.value === cur)) {
            opts.push({ label: `${cur} (当前配置)`, value: cur });
        }
        return opts;
    }

    private _onAssetsSynced(catalog: ProviderAssetCatalog): void {
        if (catalog.models && catalog.models.length > 0) {
            this._cachedModels = [...catalog.models];
            const modelHandle = this._renderer.getHandle<SelectHandle>('model');
            if (modelHandle) {
                modelHandle.setOptions(this._getModelSelectOptions());
            }
        }

        if (catalog.vaes && catalog.vaes.length > 0) {
            this._cachedVaes = [...catalog.vaes];
            const vaeHandle = this._renderer.getHandle<SelectHandle>('vae');
            if (vaeHandle) {
                vaeHandle.setOptions(this._getVaeSelectOptions());
            }
        }

        if (Array.isArray(catalog.samplers) && catalog.samplers.length > 0) {
            this._cachedSamplers = [...catalog.samplers];
            const samplerHandle = this._renderer.getHandle<SelectHandle>('samplerName');
            samplerHandle?.setOptions(this._cachedSamplers.map((s) => ({ label: s, value: s })));
        }

        if (Array.isArray(catalog.schedulers) && catalog.schedulers.length > 0) {
            this._cachedSchedulers = [...catalog.schedulers];
            const schedulerHandle = this._renderer.getHandle<SelectHandle>('scheduler');
            schedulerHandle?.setOptions(this._cachedSchedulers.map((s) => ({ label: s, value: s })));
        }

        if (Array.isArray(catalog.upscalers) && catalog.upscalers.length > 0) {
            this._cachedUpscalers = [...catalog.upscalers];
            const upscalerHandle = this._renderer.getHandle<SelectHandle>('hiresUpscaler');
            upscalerHandle?.setOptions(this._cachedUpscalers.map((u) => ({ label: u, value: u })));
        }

        if (catalog.loras && catalog.loras.length > 0) {
            this._cachedLoras = [...catalog.loras];
            this._promptPresetManagerHandle?.updateCachedLoras(this._cachedLoras);
        }

        const modelCount = catalog.models?.length ?? 0;
        const vaeCount = catalog.vaes?.length ?? 0;
        const loraCount = catalog.loras?.length ?? 0;
        FeedbackService.toastInfo(`已同步远端资产: ${modelCount} 模型, ${vaeCount} VAE, ${loraCount} LoRA`);
    }

    /** 异步按需加载预设方案与激活方案 */
    private async _loadDiskPresets(): Promise<void> {
        try {
            // 1. 绘图参数主方案：拉取预设列表并应用激活项
            const presets = await PresetStore.list<SDDrawingProfileData>('drawing', 'sdwebui');
            this._drawingProfiles = Array.isArray(presets) ? presets : [];
            const currentDrawingId = this._getActiveDrawingId();
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
        } catch (err) {
            this._logger.error('SdWebUITabView: 加载预设方案失败', err);
            FeedbackService.toastError('加载 SD-WebUI 预设方案失败');
            this._drawingProfiles = [];
            this._promptProfiles = [];
            this._drawingToolbarHandle?.refreshPresets?.([], '');
        }
    }
}
