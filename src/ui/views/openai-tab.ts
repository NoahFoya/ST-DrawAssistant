/**
 * OpenAI 兼容格式大模型绘图配置面板视图 (OpenAITabView)
 *
 * 负责大模型绘图界面的呈现与交互：
 * 1. 挂载独立的服务连接卡片组件 (OpenAIServiceCard)，支持在主流供应商与自定义服务间无缝切换；
 * 2. 结合选定供应商特性能力动态控制绘图参数显隐 (画质、风格、扩散步数/CFG/种子/负向提示词)；
 * 3. 维护绘图参数方案预设工具栏、分辨率画幅自适应计算及直连凭据配置。
 */

import { CoreEventMap } from '../../types';
import { TypedEventBus, Logger } from '../../utils';
import { SettingsStore, PresetStore } from '../../state';
import { DriverRegistry } from '../../services/drivers';
import {
    OpenAIDrawingProfileData,
    OpenAIPresetItem,
    OpenAIEngineConfig,
    OpenAIProviderType,
    OpenAIProviderSettings,
    PROVIDER_CAPABILITIES,
    DEFAULT_OPENAI_CONFIG,
    PRESET_OPENAI_MODELS,
    IMAGE_MODEL_KEYWORD_REGEX,
    createDefaultOpenAIProviders,
    getActiveProviderSettings
} from '../../services/drivers/openai-driver';
import {
    bindPresetToolbar,
    createFilePresetAdapter,
    createOpenAIServiceCard,
    OpenAIServiceCardElement
} from '../components';
import {
    createCard,
    createCardHeader,
    createRow,
    createFieldLabel,
    createSectionGroup
} from '../layout/container-factory';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { EngineFormStore } from '../foundation/form-binder';

/** 常用画幅尺寸预设选项 */
export const OPENAI_RESOLUTION_PRESETS: Array<{ label: string; width: number; height: number }> = [
    { label: '1024 × 1024 (1:1 方形)', width: 1024, height: 1024 },
    { label: '1024 × 1536 (2:3 纵向人像)', width: 1024, height: 1536 },
    { label: '1536 × 1024 (3:2 横向风景)', width: 1536, height: 1024 },
    { label: '1024 × 1792 (9:16 手机壁纸)', width: 1024, height: 1792 },
    { label: '1792 × 1024 (16:9 电脑宽屏)', width: 1792, height: 1024 },
    { label: '512 × 512 (1:1 轻量小图)', width: 512, height: 512 }
];

export class OpenAITabView extends BaseTabView {
    private readonly _logger = new Logger('OpenAITabView');
    private readonly _engineStore: EngineFormStore<OpenAIEngineConfig>;
    private readonly _driverRegistry?: DriverRegistry;

    // 卡片 1: 独立服务连接卡片组件引用
    private _serviceCard?: OpenAIServiceCardElement;

    // 卡片 2: 方案与动态绘图参数 DOM 引用
    private _modelSelectEl?: HTMLSelectElement;
    private _customModelInputEl?: HTMLInputElement;
    private _resPresetSelectEl?: HTMLSelectElement;
    private _widthInputEl?: HTMLInputElement;
    private _heightInputEl?: HTMLInputElement;
    private _qualityRowEl?: HTMLElement;
    private _qualitySelectEl?: HTMLSelectElement;
    private _styleRowEl?: HTMLElement;
    private _styleSelectEl?: HTMLSelectElement;
    private _diffusionGroupEl?: HTMLElement;
    private _negPromptInputEl?: HTMLTextAreaElement;
    private _stepsInputEl?: HTMLInputElement;
    private _cfgInputEl?: HTMLInputElement;
    private _seedInputEl?: HTMLInputElement;

    private _drawingToolbarHandle: any = null;
    private _drawingProfileSummaries: OpenAIPresetItem<OpenAIDrawingProfileData>[] = [];
    private _activeDrawingBaseline: OpenAIDrawingProfileData | null = null;

    constructor(
        private readonly _mainStore: SettingsStore,
        driverRegistry?: DriverRegistry,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super('da-openai-tab');
        this._driverRegistry = driverRegistry;

        const stored = _mainStore.getEngineConfig('openai') as Partial<OpenAIEngineConfig> | undefined;
        const defaults = createDefaultOpenAIProviders();
        const activeProvider: OpenAIProviderType = stored?.activeProvider || 'openai-official';
        const providers: Record<OpenAIProviderType, OpenAIProviderSettings> = {
            ...defaults,
            ...(stored?.providers || {})
        };

        if (!providers[activeProvider]) {
            providers[activeProvider] = { ...(defaults[activeProvider] || defaults['custom']) };
        }
        if (stored?.serverUrl) {
            providers[activeProvider].serverUrl = stored.serverUrl;
        }
        if (stored?.apiKey) {
            providers[activeProvider].apiKey = stored.apiKey;
        }

        const activeSettings = providers[activeProvider];
        const activeDrawingProfileId = stored?.activeDrawingProfileId || '';

        const initialConfig: OpenAIEngineConfig = {
            ...DEFAULT_OPENAI_CONFIG,
            ...stored,
            activeProvider,
            providers,
            serverUrl: activeSettings.serverUrl,
            apiKey: activeSettings.apiKey,
            dynamicModels: activeSettings.dynamicModels || [],
            activeDrawingProfileId
        };
        delete (initialConfig as any).drawingProfiles;

        this._engineStore = new EngineFormStore<OpenAIEngineConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('openai', data);
        });
        this._mainStore.setEngineConfig('openai', initialConfig);
        this._disposables.add(this._engineStore);

        this._activeDrawingBaseline = this._extractCurrentDrawingData();

        // 监听表单参数变动比对基准快照驱动工具栏脏状态
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
        // 卡片 1: 独立的大模型生图服务连接与提供商卡片
        this._root.appendChild(this._buildConnectionCard());

        // 卡片 2: 绘图参数预设与动态参数自适应卡片
        this._root.appendChild(this._buildDrawingPresetCard());

        // 初始化完成后执行一次提供商特性联动刷新
        const activeProvider = this._engineStore.get('activeProvider') || 'openai-official';
        this._applyProviderCapabilities(activeProvider);
    }

    // --- 卡片 1: 独立服务连接卡片挂载与事件调度 ---

    private _buildConnectionCard(): HTMLElement {
        const activeProvider = this._engineStore.get('activeProvider') || 'openai-official';
        const providers = this._engineStore.get('providers') || createDefaultOpenAIProviders();

        this._serviceCard = createOpenAIServiceCard({
            activeProvider,
            providers,
            onProviderChange: (newProvider, newSettings) => {
                this._engineStore.set('activeProvider', newProvider);
                this._engineStore.set('serverUrl', newSettings.serverUrl);
                this._engineStore.set('apiKey', newSettings.apiKey);
                this._engineStore.set('dynamicModels', newSettings.dynamicModels || []);

                this._applyProviderCapabilities(newProvider);
                this._refreshModelSelectOptions(newSettings.dynamicModels || []);
                FeedbackService.toastInfo(`已切换提供商: ${PROVIDER_CAPABILITIES[newProvider]?.name || newProvider}`);
            },
            onSettingsChange: (provider, newSettings) => {
                const currentProviders = this._engineStore.get('providers') || createDefaultOpenAIProviders();
                currentProviders[provider] = { ...newSettings };
                this._engineStore.set('providers', { ...currentProviders });

                const active = this._engineStore.get('activeProvider');
                if (provider === active) {
                    this._engineStore.set('serverUrl', newSettings.serverUrl);
                    this._engineStore.set('apiKey', newSettings.apiKey);
                }
            },
            onTestConnection: async (provider, settings, btn) => {
                btn.disabled = true;
                btn.textContent = '测试中...';

                try {
                    const driver = this._driverRegistry?.get('openai');
                    const res = await driver?.checkHealth();
                    if (res?.ok) {
                        this._serviceCard?.updateStatusBadge(res.latencyMs);
                        settings.lastLatencyMs = res.latencyMs;
                        settings.lastConnectedAt = Date.now();

                        const currentProviders = this._engineStore.get('providers') || createDefaultOpenAIProviders();
                        currentProviders[provider] = { ...settings };
                        this._engineStore.set('providers', { ...currentProviders });

                        FeedbackService.toastSuccess(`连接成功 (延迟: ${res.latencyMs}ms)`);
                        this._mainStore.flush();

                        // 自动触发同步远端模型目录
                        void this._syncModelsForProvider(provider, settings, true);
                    } else {
                        FeedbackService.toastError(`连接失败: ${res?.message || '无法访问服务端点'}`);
                    }
                } catch (e: any) {
                    FeedbackService.toastError(`测试异常: ${e?.message || e}`);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '测试连接';
                }
            },
            onSyncModels: async (provider, settings, btn) => {
                btn.disabled = true;
                btn.textContent = '同步中...';
                try {
                    await this._syncModelsForProvider(provider, settings, false);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '同步远端模型';
                }
            }
        });

        this._disposables.add(this._serviceCard);
        return this._serviceCard;
    }

    private async _syncModelsForProvider(
        provider: OpenAIProviderType,
        settings: OpenAIProviderSettings,
        silent = false
    ): Promise<void> {
        const driver = this._driverRegistry?.get('openai');
        if (!driver || typeof driver.syncAssets !== 'function') return;

        try {
            const catalog = await driver.syncAssets();
            if (catalog?.models && catalog.models.length > 0) {
                const modelStrings: string[] = catalog.models.map((m) => (typeof m === 'string' ? m : m.name));
                settings.dynamicModels = modelStrings;
                const currentProviders = this._engineStore.get('providers') || createDefaultOpenAIProviders();
                currentProviders[provider] = { ...settings };
                this._engineStore.set('providers', { ...currentProviders });

                const active = this._engineStore.get('activeProvider');
                if (provider === active) {
                    this._engineStore.set('dynamicModels', modelStrings);
                    this._refreshModelSelectOptions(modelStrings);
                }

                const imageCount = modelStrings.filter(m => IMAGE_MODEL_KEYWORD_REGEX.test(m)).length;
                if (!silent) {
                    FeedbackService.toastSuccess(`已同步模型目录，共 ${modelStrings.length} 个模型 (含 ${imageCount} 个绘图模型)`);
                }
            }
        } catch (err: any) {
            if (!silent) {
                FeedbackService.toastError(`同步模型失败: ${err?.message || err}`);
            }
        }
    }

    // --- 卡片 2: 绘图参数预设与动态参数自适应卡片 ---

    private _buildDrawingPresetCard(): HTMLElement {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({ title: '绘图参数预设' });
        card.header.appendChild(header);

        const drawingAdapter = createFilePresetAdapter<OpenAIDrawingProfileData>({
            category: 'drawing',
            subCategory: 'openai',
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
                    this._engineStore.update(preset.data as any);
                    this._updateProfileFields(preset.data);
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            }
        });

        const drawingToolbar = bindPresetToolbar<OpenAIDrawingProfileData>({
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
                    this._engineStore.update(this._activeDrawingBaseline as any);
                    this._updateProfileFields(this._activeDrawingBaseline);
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            }
        });
        this._drawingToolbarHandle = drawingToolbar;
        card.body.appendChild(drawingToolbar);

        card.body.appendChild(this._buildModelGroup());
        card.body.appendChild(this._buildCanvasGroup());
        card.body.appendChild(this._buildProviderSpecificGroup());
        card.body.appendChild(this._buildDiffusionControlsGroup());
        card.body.appendChild(this._buildAdvancedGroup());

        return card.root;
    }

    /** 分组 1: 模型设置 */
    private _buildModelGroup(): HTMLElement {
        const group = createSectionGroup({
            title: '模型设置',
            collapsible: true,
            defaultOpen: true
        });

        const modelRow = createRow(['left', 'right'], { align: 'center', divided: true });
        modelRow.slots[0].appendChild(createFieldLabel({
            title: '模型选择',
            description: '选择常用推荐模型或远端探测拉取到的可用模型'
        }));

        this._modelSelectEl = document.createElement('select');
        this._modelSelectEl.className = 'da-select da-w-full';
        const activeSettings = this._getActiveSettings();
        this._refreshModelSelectOptions(activeSettings.dynamicModels || []);

        const s = this._engineStore.getAll();
        const currentProfile = this._getCurrentProfile();
        const initialModel = currentProfile?.model || s.model || 'gpt-image-2';
        this._modelSelectEl.value = initialModel;

        this._modelSelectEl.addEventListener('change', () => {
            const selectedModel = this._modelSelectEl!.value;
            if (this._customModelInputEl) {
                this._customModelInputEl.value = selectedModel;
            }
            this._updateCurrentProfile({ model: selectedModel });
        });

        modelRow.slots[1].appendChild(this._modelSelectEl);
        group.body.appendChild(modelRow.root);

        const customModelRow = createRow(['left', 'right'], { align: 'center' });
        customModelRow.slots[0].appendChild(createFieldLabel({
            title: '手动指定模型',
            description: '直接输入自定义或私有微调模型完整标识'
        }));

        this._customModelInputEl = document.createElement('input');
        this._customModelInputEl.type = 'text';
        this._customModelInputEl.className = 'da-input da-w-full';
        this._customModelInputEl.placeholder = '例如: gpt-image-2 或 flux-schnell';
        this._customModelInputEl.value = initialModel;

        this._customModelInputEl.addEventListener('change', () => {
            const typedModel = this._customModelInputEl!.value.trim();
            if (typedModel) {
                if (this._modelSelectEl) {
                    const exists = Array.from(this._modelSelectEl.options).some(o => o.value === typedModel);
                    if (exists) {
                        this._modelSelectEl.value = typedModel;
                    }
                }
                this._updateCurrentProfile({ model: typedModel });
            }
        });

        customModelRow.slots[1].appendChild(this._customModelInputEl);
        group.body.appendChild(customModelRow.root);

        return group.root;
    }

    /** 分组 2: 画幅与分辨率设置 */
    private _buildCanvasGroup(): HTMLElement {
        const group = createSectionGroup({
            title: '画幅与分辨率',
            collapsible: true,
            defaultOpen: true
        });

        const s = this._engineStore.getAll();
        const currentProfile = this._getCurrentProfile();

        const presetRow = createRow(['left', 'right'], { align: 'center', divided: true });
        presetRow.slots[0].appendChild(createFieldLabel({
            title: '常用比例预设',
            description: '快速选择标准化画幅尺寸'
        }));

        this._resPresetSelectEl = document.createElement('select');
        this._resPresetSelectEl.className = 'da-select da-w-full';

        for (const preset of OPENAI_RESOLUTION_PRESETS) {
            const opt = document.createElement('option');
            opt.value = `${preset.width}x${preset.height}`;
            opt.textContent = preset.label;
            this._resPresetSelectEl.appendChild(opt);
        }

        const customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = '自定义分辨率...';
        this._resPresetSelectEl.appendChild(customOpt);

        this._resPresetSelectEl.addEventListener('change', () => {
            const val = this._resPresetSelectEl!.value;
            if (val !== 'custom') {
                const [w, h] = val.split('x').map(Number);
                if (this._widthInputEl) this._widthInputEl.value = String(w);
                if (this._heightInputEl) this._heightInputEl.value = String(h);
                this._updateCurrentProfile({ width: w, height: h, sizePreset: val });
            }
        });

        presetRow.slots[1].appendChild(this._resPresetSelectEl);
        group.body.appendChild(presetRow.root);

        const customSizeRow = createRow(['left', 'right'], { align: 'center' });
        customSizeRow.slots[0].appendChild(createFieldLabel({
            title: '分辨率数值 (宽 × 高)',
            description: '精确像素尺寸 (常见推荐: 1024x1024 / 1792x1024)'
        }));

        const sizeContainer = document.createElement('div');
        sizeContainer.style.display = 'flex';
        sizeContainer.style.alignItems = 'center';
        sizeContainer.style.gap = '8px';
        sizeContainer.style.width = '100%';

        this._widthInputEl = document.createElement('input');
        this._widthInputEl.type = 'number';
        this._widthInputEl.className = 'da-input da-input--number';
        this._widthInputEl.style.flex = '1';
        this._widthInputEl.min = '256';
        this._widthInputEl.max = '4096';
        this._widthInputEl.step = '64';
        this._widthInputEl.value = String(currentProfile?.width || s.width || 1024);
        this._widthInputEl.addEventListener('change', () => this._handleDimensionChange());

        const xLabel = document.createElement('span');
        xLabel.textContent = '×';
        xLabel.style.fontWeight = 'bold';
        xLabel.style.color = 'var(--da-text-muted)';

        this._heightInputEl = document.createElement('input');
        this._heightInputEl.type = 'number';
        this._heightInputEl.className = 'da-input da-input--number';
        this._heightInputEl.style.flex = '1';
        this._heightInputEl.min = '256';
        this._heightInputEl.max = '4096';
        this._heightInputEl.step = '64';
        this._heightInputEl.value = String(currentProfile?.height || s.height || 1024);
        this._heightInputEl.addEventListener('change', () => this._handleDimensionChange());

        sizeContainer.appendChild(this._widthInputEl);
        sizeContainer.appendChild(xLabel);
        sizeContainer.appendChild(this._heightInputEl);
        customSizeRow.slots[1].appendChild(sizeContainer);
        group.body.appendChild(customSizeRow.root);

        this._updateResolutionPresetMatch();
        return group.root;
    }

    /** 分组 3: 官方与标准模型特性参数 (画质 / 风格) */
    private _buildProviderSpecificGroup(): HTMLElement {
        const group = createSectionGroup({
            title: '图像特性 (画质 / 风格)',
            collapsible: true,
            defaultOpen: true
        });

        const s = this._engineStore.getAll();
        const currentProfile = this._getCurrentProfile();

        // 1. 画质档位
        const qualityRow = createRow(['left', 'right'], { align: 'center', divided: true });
        this._qualityRowEl = qualityRow.root;
        qualityRow.slots[0].appendChild(createFieldLabel({
            title: '图像画质 (Quality)',
            description: 'DALL-E 3、Grok 等服务支持的画质精度等级'
        }));

        this._qualitySelectEl = document.createElement('select');
        this._qualitySelectEl.className = 'da-select da-w-full';
        const activeProvider = this._engineStore.get('activeProvider') || 'openai-official';
        const cap = PROVIDER_CAPABILITIES[activeProvider] || PROVIDER_CAPABILITIES['custom'];
        this._updateQualitySelectOptions(cap.qualityOptions || ['standard', 'hd']);
        this._qualitySelectEl.value = currentProfile?.quality || s.quality || 'standard';

        this._qualitySelectEl.addEventListener('change', () => {
            this._updateCurrentProfile({ quality: this._qualitySelectEl!.value });
        });
        qualityRow.slots[1].appendChild(this._qualitySelectEl);
        group.body.appendChild(qualityRow.root);

        // 2. 图像风格 (Style)
        const styleRow = createRow(['left', 'right'], { align: 'center' });
        this._styleRowEl = styleRow.root;
        styleRow.slots[0].appendChild(createFieldLabel({
            title: '画面风格 (Style)',
            description: '画面表现风格倾向 (vivid 生动戏剧化 / natural 自然纪实)'
        }));

        this._styleSelectEl = document.createElement('select');
        this._styleSelectEl.className = 'da-select da-w-full';
        const styleOptions = [
            { value: 'vivid', label: 'vivid (生动鲜明/戏剧感 - 推荐)' },
            { value: 'natural', label: 'natural (自然纪实/柔和真实)' }
        ];
        for (const opt of styleOptions) {
            const el = document.createElement('option');
            el.value = opt.value;
            el.textContent = opt.label;
            this._styleSelectEl.appendChild(el);
        }
        this._styleSelectEl.value = currentProfile?.style || s.style || 'vivid';
        this._styleSelectEl.addEventListener('change', () => {
            this._updateCurrentProfile({ style: this._styleSelectEl!.value });
        });
        styleRow.slots[1].appendChild(this._styleSelectEl);
        group.body.appendChild(styleRow.root);

        return group.root;
    }

    /** 分组 4: 开源扩散模型进阶参数 (硅基流动 / Together 等) */
    private _buildDiffusionControlsGroup(): HTMLElement {
        const group = createSectionGroup({
            title: '开源扩散参数 (FLUX / Kolors / SD3.5)',
            collapsible: true,
            defaultOpen: true
        });
        this._diffusionGroupEl = group.root;

        const s = this._engineStore.getAll();
        const currentProfile = this._getCurrentProfile();

        // 1. 负向提示词
        const negRow = createRow(['left', 'right'], { align: 'top', divided: true });
        negRow.slots[0].appendChild(createFieldLabel({
            title: '方案专属负向词',
            description: '仅在当前供应商支持负向提示词时生效 (如 Kolors/SD 等)'
        }));

        this._negPromptInputEl = document.createElement('textarea');
        this._negPromptInputEl.className = 'da-textarea da-w-full';
        this._negPromptInputEl.rows = 2;
        this._negPromptInputEl.placeholder = 'blurry, low quality, distorted, bad anatomy...';
        this._negPromptInputEl.value = currentProfile?.negativePrompt || s.negativePrompt || '';
        this._negPromptInputEl.addEventListener('change', () => {
            this._updateCurrentProfile({ negativePrompt: this._negPromptInputEl!.value.trim() });
        });
        negRow.slots[1].appendChild(this._negPromptInputEl);
        group.body.appendChild(negRow.root);

        // 2. 采样步数与 CFG Scale
        const numRow = createRow(['left', 'right'], { align: 'center', divided: true });
        numRow.slots[0].appendChild(createFieldLabel({
            title: '步数与引导系数',
            description: 'Steps (推理步数) 与 CFG (提示词引导系数)'
        }));

        const numContainer = document.createElement('div');
        numContainer.style.display = 'flex';
        numContainer.style.alignItems = 'center';
        numContainer.style.gap = '8px';
        numContainer.style.width = '100%';

        this._stepsInputEl = document.createElement('input');
        this._stepsInputEl.type = 'number';
        this._stepsInputEl.className = 'da-input da-input--number';
        this._stepsInputEl.style.flex = '1';
        this._stepsInputEl.min = '1';
        this._stepsInputEl.max = '100';
        this._stepsInputEl.value = String(currentProfile?.steps ?? s.steps ?? 20);
        this._stepsInputEl.title = 'Steps 采样步数 (FLUX.1-schnell 建议 4 步)';
        this._stepsInputEl.addEventListener('change', () => {
            this._updateCurrentProfile({ steps: Number(this._stepsInputEl!.value) });
        });

        this._cfgInputEl = document.createElement('input');
        this._cfgInputEl.type = 'number';
        this._cfgInputEl.className = 'da-input da-input--number';
        this._cfgInputEl.style.flex = '1';
        this._cfgInputEl.min = '0';
        this._cfgInputEl.max = '30';
        this._cfgInputEl.step = '0.5';
        this._cfgInputEl.value = String(currentProfile?.cfgScale ?? s.cfgScale ?? 7.0);
        this._cfgInputEl.title = 'CFG Scale 提示词引导系数';
        this._cfgInputEl.addEventListener('change', () => {
            this._updateCurrentProfile({ cfgScale: Number(this._cfgInputEl!.value) });
        });

        numContainer.appendChild(this._stepsInputEl);
        numContainer.appendChild(this._cfgInputEl);
        numRow.slots[1].appendChild(numContainer);
        group.body.appendChild(numRow.root);

        // 3. 随机种子
        const seedRow = createRow(['left', 'right'], { align: 'center' });
        seedRow.slots[0].appendChild(createFieldLabel({
            title: '随机种子 (Seed)',
            description: '-1 表示每次生成使用随机数种子'
        }));

        const seedContainer = document.createElement('div');
        seedContainer.style.display = 'flex';
        seedContainer.style.alignItems = 'center';
        seedContainer.style.gap = '6px';
        seedContainer.style.width = '100%';

        this._seedInputEl = document.createElement('input');
        this._seedInputEl.type = 'number';
        this._seedInputEl.className = 'da-input da-input--number';
        this._seedInputEl.style.flex = '1';
        this._seedInputEl.value = String(currentProfile?.seed ?? s.seed ?? -1);
        this._seedInputEl.addEventListener('change', () => {
            this._updateCurrentProfile({ seed: Number(this._seedInputEl!.value) });
        });

        const randomSeedBtn = document.createElement('button');
        randomSeedBtn.type = 'button';
        randomSeedBtn.className = 'da-btn da-btn--secondary';
        randomSeedBtn.textContent = '🎲 随机';
        randomSeedBtn.title = '重置为 -1 随机种子';
        randomSeedBtn.style.padding = '4px 8px';
        randomSeedBtn.onclick = () => {
            this._seedInputEl!.value = '-1';
            this._updateCurrentProfile({ seed: -1 });
        };

        seedContainer.appendChild(this._seedInputEl);
        seedContainer.appendChild(randomSeedBtn);
        seedRow.slots[1].appendChild(seedContainer);
        group.body.appendChild(seedRow.root);

        return group.root;
    }

    /** 分组 5: 进阶参数与额外载荷 */
    private _buildAdvancedGroup(): HTMLElement {
        const group = createSectionGroup({
            title: '进阶载荷参数',
            collapsible: true,
            defaultOpen: false
        });

        const s = this._engineStore.getAll();
        const currentProfile = this._getCurrentProfile();

        const extraRow = createRow(['left', 'right'], { align: 'center' });
        extraRow.slots[0].appendChild(createFieldLabel({
            title: '方案附加请求载荷 (JSON)',
            description: '合并至 POST 请求体的底层 JSON 参数'
        }));

        const extraInput = document.createElement('input');
        extraInput.type = 'text';
        extraInput.className = 'da-input da-w-full';
        extraInput.placeholder = '{"background": "transparent"}';
        extraInput.value = currentProfile?.extraBodyJson || s.extraBodyJson || '';
        extraInput.addEventListener('change', () => {
            this._updateCurrentProfile({ extraBodyJson: extraInput.value.trim() });
        });
        extraRow.slots[1].appendChild(extraInput);
        group.body.appendChild(extraRow.root);

        return group.root;
    }

    // --- 提供商特性动态联动 ---

    private _getActiveSettings(): OpenAIProviderSettings {
        const { settings } = getActiveProviderSettings(this._engineStore.getAll());
        return settings;
    }

    private _applyProviderCapabilities(providerType: OpenAIProviderType): void {
        const capability = PROVIDER_CAPABILITIES[providerType] || PROVIDER_CAPABILITIES['custom'];

        // 1. 风格显隐控制
        if (this._styleRowEl) {
            this._styleRowEl.style.display = capability.allowStyle ? '' : 'none';
        }

        // 2. 画质显隐控制与选项重构
        if (this._qualityRowEl) {
            this._qualityRowEl.style.display = capability.allowQuality ? '' : 'none';
        }
        if (capability.qualityOptions && capability.qualityOptions.length > 0) {
            this._updateQualitySelectOptions(capability.qualityOptions);
        }

        // 3. 扩散进阶参数显隐控制
        const hasDiffusion = capability.allowSteps || capability.allowCfgScale || capability.allowSeed || capability.allowNegativePrompt;
        if (this._diffusionGroupEl) {
            this._diffusionGroupEl.style.display = hasDiffusion ? '' : 'none';
        }

        // 4. 刷新模型选择框
        const activeSettings = this._getActiveSettings();
        this._refreshModelSelectOptions(activeSettings.dynamicModels || []);
    }

    private _updateQualitySelectOptions(options: string[]): void {
        if (!this._qualitySelectEl) return;
        const currentVal = this._qualitySelectEl.value;
        this._qualitySelectEl.innerHTML = '';
        for (const opt of options) {
            const el = document.createElement('option');
            el.value = opt;
            el.textContent = `${opt} (${opt === 'standard' ? '标准' : opt === 'hd' || opt === 'high' ? '高清' : opt})`;
            this._qualitySelectEl.appendChild(el);
        }
        if (options.includes(currentVal)) {
            this._qualitySelectEl.value = currentVal;
        } else if (options.length > 0) {
            this._qualitySelectEl.selectedIndex = 0;
        }
    }

    private _refreshModelSelectOptions(dynamicModels: string[]): void {
        if (!this._modelSelectEl) return;
        const currentVal = this._modelSelectEl.value || this._getCurrentProfile()?.model || this._engineStore.get('model') || 'gpt-image-2';
        this._modelSelectEl.innerHTML = '';

        const activeProvider = this._engineStore.get('activeProvider') || 'openai-official';
        const capability = PROVIDER_CAPABILITIES[activeProvider] || PROVIDER_CAPABILITIES['custom'];

        const imageModels: string[] = [];
        const otherModels: string[] = [];

        for (const m of dynamicModels) {
            if (IMAGE_MODEL_KEYWORD_REGEX.test(m)) {
                imageModels.push(m);
            } else {
                otherModels.push(m);
            }
        }

        if (imageModels.length > 0) {
            const groupEl = document.createElement('optgroup');
            groupEl.label = '远端绘图模型';
            for (const id of imageModels) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                groupEl.appendChild(opt);
            }
            this._modelSelectEl.appendChild(groupEl);
        }

        const presetGroup = document.createElement('optgroup');
        presetGroup.label = `${capability.name} 推荐模型`;
        const candidateModels = capability.recommendedModels.length > 0 ? capability.recommendedModels : PRESET_OPENAI_MODELS;
        for (const p of candidateModels) {
            if (!imageModels.includes(p.id)) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                presetGroup.appendChild(opt);
            }
        }
        this._modelSelectEl.appendChild(presetGroup);

        if (otherModels.length > 0) {
            const allGroup = document.createElement('optgroup');
            allGroup.label = '其他检测模型';
            for (const id of otherModels) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                allGroup.appendChild(opt);
            }
            this._modelSelectEl.appendChild(allGroup);
        }

        const exists = Array.from(this._modelSelectEl.options).some(o => o.value === currentVal);
        if (exists) {
            this._modelSelectEl.value = currentVal;
        } else if (currentVal) {
            const customOpt = document.createElement('option');
            customOpt.value = currentVal;
            customOpt.textContent = `${currentVal} (当前配置)`;
            this._modelSelectEl.insertBefore(customOpt, this._modelSelectEl.firstChild);
            this._modelSelectEl.value = currentVal;
        } else if (this._modelSelectEl.options.length > 0) {
            this._modelSelectEl.selectedIndex = 0;
        }
    }

    private _updateProfileFields(profile: OpenAIDrawingProfileData): void {
        if (this._modelSelectEl && profile.model) {
            this._modelSelectEl.value = profile.model;
        }
        if (this._customModelInputEl && profile.model) {
            this._customModelInputEl.value = profile.model;
        }
        if (this._widthInputEl && profile.width) {
            this._widthInputEl.value = String(profile.width);
        }
        if (this._heightInputEl && profile.height) {
            this._heightInputEl.value = String(profile.height);
        }
        if (this._qualitySelectEl && profile.quality) {
            this._qualitySelectEl.value = profile.quality;
        }
        if (this._styleSelectEl && profile.style) {
            this._styleSelectEl.value = profile.style;
        }
        if (this._stepsInputEl && profile.steps !== undefined) {
            this._stepsInputEl.value = String(profile.steps);
        }
        if (this._cfgInputEl && profile.cfgScale !== undefined) {
            this._cfgInputEl.value = String(profile.cfgScale);
        }
        if (this._seedInputEl && profile.seed !== undefined) {
            this._seedInputEl.value = String(profile.seed);
        }
        if (this._negPromptInputEl) {
            this._negPromptInputEl.value = profile.negativePrompt || '';
        }
        this._updateResolutionPresetMatch();
    }

    private _getDrawingProfiles(): OpenAIPresetItem<OpenAIDrawingProfileData>[] {
        return this._drawingProfileSummaries;
    }

    private _getActiveDrawingId(): string {
        return this._engineStore.get('activeDrawingProfileId') || '';
    }

    private _getCurrentProfile(): OpenAIDrawingProfileData | null {
        const profiles = this._getDrawingProfiles();
        const activeId = this._getActiveDrawingId();
        const found = profiles.find(p => p.id === activeId);
        return found?.data || null;
    }

    private _extractCurrentDrawingData(): OpenAIDrawingProfileData {
        const current = this._getCurrentProfile();
        const s = this._engineStore.getAll();
        const w = Number(this._widthInputEl?.value) || s.width || 1024;
        const h = Number(this._heightInputEl?.value) || s.height || 1024;
        return {
            model: this._customModelInputEl?.value.trim() || this._modelSelectEl?.value || s.model || 'gpt-image-2',
            width: w,
            height: h,
            sizePreset: this._resPresetSelectEl?.value || (typeof s.sizePreset === 'string' ? s.sizePreset : `${w}x${h}`),
            quality: this._qualitySelectEl?.value || s.quality || 'standard',
            style: this._styleSelectEl?.value || s.style || 'vivid',
            responseFormat: current?.responseFormat || s.responseFormat || 'b64_json',
            n: current?.n || s.n || 1,
            steps: Number(this._stepsInputEl?.value) || s.steps || 20,
            cfgScale: Number(this._cfgInputEl?.value) || s.cfgScale || 7.0,
            seed: Number(this._seedInputEl?.value) ?? s.seed ?? -1,
            negativePrompt: this._negPromptInputEl?.value || s.negativePrompt || '',
            customHeadersJson: current?.customHeadersJson || s.customHeadersJson,
            extraBodyJson: current?.extraBodyJson || s.extraBodyJson
        };
    }

    private _updateCurrentProfile(partial: Partial<OpenAIDrawingProfileData>): void {
        this._engineStore.update(partial as any);
    }

    private _handleDimensionChange(): void {
        const w = Number(this._widthInputEl?.value) || 1024;
        const h = Number(this._heightInputEl?.value) || 1024;
        this._updateResolutionPresetMatch();
        this._updateCurrentProfile({ width: w, height: h });
    }

    private _updateResolutionPresetMatch(): void {
        if (!this._resPresetSelectEl || !this._widthInputEl || !this._heightInputEl) return;
        const w = Number(this._widthInputEl.value);
        const h = Number(this._heightInputEl.value);
        const matchKey = `${w}x${h}`;

        const match = OPENAI_RESOLUTION_PRESETS.find(p => p.width === w && p.height === h);
        if (match) {
            this._resPresetSelectEl.value = matchKey;
        } else {
            this._resPresetSelectEl.value = 'custom';
        }
    }

    /** 按需加载预设方案 */
    private async _loadDiskPresets(): Promise<void> {
        try {
            const summaries = await PresetStore.listSummary<OpenAIDrawingProfileData>('drawing', 'openai');
            this._drawingProfileSummaries = Array.isArray(summaries) ? summaries : [];
            const currentDrawingId = this._getActiveDrawingId();
            const matched = this._drawingProfileSummaries.find((p) => p.id === currentDrawingId) || this._drawingProfileSummaries[0];
            if (matched) {
                this._engineStore.set('activeDrawingProfileId', matched.id);
                const fullProfile = await PresetStore.get<OpenAIDrawingProfileData>('drawing', matched.id, 'openai');
                if (fullProfile?.data) {
                    this._activeDrawingBaseline = JSON.parse(JSON.stringify(fullProfile.data));
                    this._engineStore.update(fullProfile.data as any);
                    this._updateProfileFields(fullProfile.data);
                    this._drawingToolbarHandle?.setDirty?.(false);
                }
            } else {
                this._engineStore.set('activeDrawingProfileId', '');
                this._activeDrawingBaseline = null;
            }
            this._drawingToolbarHandle?.refreshPresets?.(this._drawingProfileSummaries, this._engineStore.get('activeDrawingProfileId'));
        } catch (err) {
            this._logger.error('OpenAITabView: 加载预设方案失败', err);
            FeedbackService.toastError('加载 OpenAI 预设方案失败');
            this._drawingProfileSummaries = [];
            this._drawingToolbarHandle?.refreshPresets?.([], '');
        }
    }
}
