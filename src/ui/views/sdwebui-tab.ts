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
    createFilePresetAdapter,
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
    private _drawingProfileSummaries: PresetItem<SDDrawingProfileData>[] = [];
    private _promptProfileSummaries: PresetItem<PromptProfileData>[] = [];
    private _activeDrawingBaseline: SDDrawingProfileData | null = null;

    constructor(
        private readonly _mainStore: SettingsStore,
        driverRegistry?: DriverRegistry,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super('da-sdwebui-tab');
        this._driverRegistry = driverRegistry;

        const storedConfig: Record<string, any> = (this._mainStore.getEngineConfig('sdwebui') as any) || {};

        const activeDrawingProfileId: string = String(storedConfig.activeDrawingProfileId || '');

        const activePromptProfileId: string = String(storedConfig.activePromptProfileId || '');

        // 初始化运行时表单配置：剥离历史残留的方案大对象数组
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
        const isInitiallyConnected = driver?.isConnected?.() || !!initialCatalog;

        return createConnectionCard({
            title: '服务连接',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: DEFAULT_SDWEBUI_CONFIG.serverUrl,
            placeholder: 'http://127.0.0.1:7860',
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
                            // 资产同步探测失败不阻断整体连通状态
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
        const drawingAdapter = createFilePresetAdapter<SDDrawingProfileData>({
            category: 'drawing',
            subCategory: 'sdwebui',
            label: '绘图参数',
            getPresets: () => this._getDrawingProfiles(),
            getActiveId: () => this._getActiveDrawingId(),
            onPresetsChange: (presets, activeId) => {
                this._drawingProfileSummaries = presets;
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
                label: '主模型 Checkpoint',
                description: '基础生图底模文件名',
                options: this._getModelSelectOptions()
            },
            {
                key: 'vae',
                type: 'select',
                label: 'VAE 滤镜',
                description: '色彩与纹理编解码模型 (可选)',
                options: this._getVaeSelectOptions()
            },
            {
                key: 'clipSkip',
                type: 'number',
                label: 'CLIP 跳过层',
                description: 'SD 1.5 建议为 1，二次元动漫模型建议为 2',
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
                description: '常用画幅比例预设，选择后自动同步宽高数值',
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
                label: '引导系数 (CFG Scale)',
                description: '提示词贴合程度，通常建议 6.0 ~ 8.0',
                min: 1.0,
                max: 30.0,
                step: 0.5
            },
            {
                key: 'seed',
                type: 'number',
                label: '随机种子 (Seed)',
                description: '-1 为完全随机，填入固定数值可复现构图',
                min: -1,
                max: 2147483647,
                step: 1
            },
            {
                key: 'restoreFaces',
                type: 'toggle',
                label: '面部修复'
            },
            {
                key: 'denoisingStrength',
                type: 'number',
                label: '图生图去噪幅度',
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
                label: '放大算法',
                disabledWhen: (s) => !s.enableHires,
                options: this._cachedUpscalers.map((u) => ({ label: u, value: u }))
            },
            {
                key: 'hiresScale',
                type: 'number',
                label: '放大倍数',
                disabledWhen: (s) => !s.enableHires,
                min: 1.1,
                max: 4.0,
                step: 0.1,
                unit: 'x'
            },
            {
                key: 'hiresSteps',
                type: 'number',
                label: '高清修复步数',
                description: '设为 0 表示复用原采样步数',
                disabledWhen: (s) => !s.enableHires,
                min: 0,
                max: 100,
                step: 1,
                unit: '步'
            },
            {
                key: 'hiresDenoise',
                type: 'number',
                label: '高清修复去噪幅度',
                disabledWhen: (s) => !s.enableHires,
                min: 0.05,
                max: 1.0,
                step: 0.05
            }
        ];
        hiresRows.forEach((r) => hiresGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(hiresGroup.root);

        // 4. 提示词预设设置分组 (默认展开)
        const promptGroup = createSectionGroup({
            title: '提示词预设设置',
            collapsible: true,
            defaultOpen: true
        });
        const promptRows: FormRowSchema<SDWebUIConfig>[] = [
            {
                key: 'promptProfileId',
                type: 'select',
                label: '关联提示词方案',
                description: '选择当前绘图主方案绑定的提示词预设方案',
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
                this._promptProfileSummaries = profiles;
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
        return this._drawingProfileSummaries;
    }

    private _getActiveDrawingId(): string {
        return this._engineStore.get('activeDrawingProfileId') || '';
    }

    private _getPromptProfiles(): PresetItem<PromptProfileData>[] {
        return this._promptProfileSummaries;
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

    private _getModelSelectOptions() {
        const cur = this._engineStore.get('model');
        const opts = [
            { label: '留空使用后端默认模型', value: '' },
            ...this._cachedModels.map((m) => {
                const val = typeof m === 'string' ? m : (m.title || m.name);
                return { label: formatModelDisplayLabel(m), value: val };
            })
        ];
        if (cur && !opts.some((o) => o.value === cur)) {
            opts.push({ label: `${cur} (当前配置)`, value: cur });
        }
        return opts;
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
            const samplerHandle = this._renderer.getHandle<SelectHandle>('sampler');
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

    /** 异步按需加载预设方案 (先加载轻量摘要列表，仅按需加载当前激活项详情) */
    private async _loadDiskPresets(): Promise<void> {
        try {
            // 1. 绘图参数主方案：仅拉取轻量摘要列表
            const summaries = await PresetStore.listSummary<SDDrawingProfileData>('drawing', 'sdwebui');
            this._drawingProfileSummaries = Array.isArray(summaries) ? summaries : [];
            const currentDrawingId = this._getActiveDrawingId();
            const matched = this._drawingProfileSummaries.find((p) => p.id === currentDrawingId) || this._drawingProfileSummaries[0];
            if (matched) {
                this._engineStore.set('activeDrawingProfileId', matched.id);
                const fullProfile = await PresetStore.get<SDDrawingProfileData>('drawing', matched.id, 'sdwebui');
                if (fullProfile?.data) {
                    this._activeDrawingBaseline = JSON.parse(JSON.stringify(fullProfile.data));
                    this._engineStore.update(fullProfile.data);
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            } else {
                this._engineStore.set('activeDrawingProfileId', '');
                this._activeDrawingBaseline = null;
            }
            this._drawingToolbarHandle?.refreshPresets?.(this._drawingProfileSummaries, this._engineStore.get('activeDrawingProfileId'));

            // 2. 通用提示词预设：仅拉取轻量摘要列表
            const promptSummaries = await PresetStore.listSummary<PromptProfileData>('prompts');
            this._promptProfileSummaries = Array.isArray(promptSummaries) ? promptSummaries : [];
            this._refreshPromptProfileSelectOptions();
            this._promptPresetManagerHandle?.refresh();
            this._promptPresetManagerHandle?.toolbar?.refreshPresets?.(
                this._promptProfileSummaries,
                this._engineStore.get('activePromptProfileId') || (this._promptProfileSummaries[0]?.id ?? '')
            );
        } catch (err) {
            this._logger.error('SdWebUITabView: 加载预设方案失败', err);
            FeedbackService.toastError('加载 SD-WebUI 预设方案失败');
            this._drawingProfileSummaries = [];
            this._promptProfileSummaries = [];
            this._drawingToolbarHandle?.refreshPresets?.([], '');
        }
    }
}
