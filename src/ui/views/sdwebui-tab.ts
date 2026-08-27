/**
 * @module ui/views/sdwebui-tab
 * @description Stable Diffusion WebUI (AUTOMATIC1111) 生图后端配置面板视图 (SDWebUITabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 * 采用 DraftBridge 管理内存工作区到主 Store 的投影同步。
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    IDriverRegistry,
    DEFAULT_SDWEBUI_URL,
    SDWEBUI_SIZE_PRESETS
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
    bindPresetToolbar,
    PresetToolbarElement,
    createPresetToolbarAdapter
} from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { DraftBridge } from '../foundation/draft-bridge';

/** SD WebUI 内存草稿同步字段 */
export const SD_WEBUI_DRAFT_KEYS = [
    'sdModelCheckpoint',
    'sdSamplerName',
    'sdSteps',
    'sdCfgScale',
    'sdWidth',
    'sdHeight',
    'sdClipSkip',
    'sdDenoisingStrength',
    'sdEnableHires',
    'sdHiresUpscaler',
    'sdHiresUpscaleBy',
    'sdHiresSteps',
    'sdHiresDenoise',
    'sdPromptPrefix',
    'sdNegativePrefix',
    'sdPromptSuffix',
    'loras'
] as const;

/**
 * SD-WebUI 后端引擎配置面板视图
 */
export class SDWebUITabView extends BaseTabView {
    private readonly _draftStore: ObservableStore<DrawAssistantSettings>;
    private readonly _rendererDraft: FormRenderer<DrawAssistantSettings>;
    private readonly _rendererMain: FormRenderer<DrawAssistantSettings>;
    private readonly _profileService: ProfileService;

    private _sdProfileToolbar: PresetToolbarElement | null = null;
    private _loraManager: LoraManagerElement | null = null;

    constructor(
        private readonly _store: ObservableStore<DrawAssistantSettings>,
        private readonly _drivers?: IDriverRegistry
    ) {
        super('da-sdwebui-tab');

        this._draftStore = new ObservableStore<DrawAssistantSettings>({ ..._store.getState() });
        this._disposables.add(this._draftStore);

        this._rendererDraft = new FormRenderer<DrawAssistantSettings>(this._draftStore);
        this._rendererMain = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._rendererDraft);
        this._disposables.add(this._rendererMain);

        this._profileService = new ProfileService(_store);

        // 声明式草稿同步桥
        const bridge = new DraftBridge(this._draftStore, this._store, SD_WEBUI_DRAFT_KEYS);
        this._disposables.add(bridge);

        this._buildCards();
        this._setupReactivity();
        this._refreshTab(true);
    }

    private _applySDProfileData(profileData: any): void {
        const patch: Partial<DrawAssistantSettings> = {};
        for (const key of SD_WEBUI_DRAFT_KEYS) {
            if (profileData[key] !== undefined) {
                (patch as any)[key] = profileData[key];
            }
        }
        this._draftStore.update(patch);
    }

    private _refreshTab(silent = true): void {
        const currentState = this._store.getState();
        const missingItems: string[] = [];

        // 1. 刷新快捷方案选择器
        const quickProfileHandle = this._rendererMain.getHandle<SelectControlHandle>('sdProfileId');
        if (quickProfileHandle) {
            const profiles = (currentState.sdProfiles || []).map((profile) => ({ label: profile.name, value: profile.id }));
            quickProfileHandle.setOptions([{ label: '未关联预设', value: '' }, ...profiles]);
            quickProfileHandle.setValue(currentState.sdProfileId || '');
        }

        // 2. 刷新 Toolbar 列表
        if (this._sdProfileToolbar?.refreshPresets) {
            this._sdProfileToolbar.refreshPresets(currentState.sdProfiles || [], currentState.sdProfileId || '');
        }

        // 3. 刷新模型、采样器与放大算法下拉框 + 失效标红检测
        const cachedModels = currentState.cachedModels || [];
        const cachedSamplers = currentState.cachedSamplers || ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ SDE Karras', 'DDIM'];
        const cachedUpscalers = currentState.cachedUpscalers || ['R-ESRGAN 4x+', 'R-ESRGAN 4x+ Anime6B', 'Latent', 'ESRGAN_4x', 'ScuNET'];
        const cachedLoras = currentState.cachedLoras || [];

        const currentDraft = this._draftStore.getState();
        const modelSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('sdModelCheckpoint');
        const samplerSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('sdSamplerName');
        const upscalerSelectHandle = this._rendererDraft.getHandle<SelectControlHandle>('sdHiresUpscaler');

        if (modelSelectHandle) {
            const isMissing = Boolean(currentDraft.sdModelCheckpoint && cachedModels.length > 0 && !cachedModels.includes(currentDraft.sdModelCheckpoint));
            const options = cachedModels.map((modelName) => ({ label: modelName, value: modelName }));
            if (isMissing && currentDraft.sdModelCheckpoint) {
                options.unshift({ label: `⚠️ ${currentDraft.sdModelCheckpoint} (未在后端找到)`, value: currentDraft.sdModelCheckpoint });
                missingItems.push(`主模型 [${currentDraft.sdModelCheckpoint}]`);
            }
            modelSelectHandle.setOptions([{ label: '未选择', value: '' }, ...options]);
            modelSelectHandle.setValue(currentDraft.sdModelCheckpoint || '');
            modelSelectHandle.setError(isMissing, isMissing ? `⚠️ 主模型 [${currentDraft.sdModelCheckpoint}] 未在 SD-WebUI 后端找到！` : undefined);
        }

        if (samplerSelectHandle) {
            const samplers = cachedSamplers.map((samplerName) => ({ label: samplerName, value: samplerName }));
            samplerSelectHandle.setOptions(samplers);
            samplerSelectHandle.setValue(currentDraft.sdSamplerName || 'Euler a');
        }

        if (upscalerSelectHandle) {
            const isMissing = Boolean(currentDraft.sdHiresUpscaler && cachedUpscalers.length > 0 && !cachedUpscalers.includes(currentDraft.sdHiresUpscaler));
            const upscalers = cachedUpscalers.map((upscalerName) => ({ label: upscalerName, value: upscalerName }));
            if (isMissing && currentDraft.sdHiresUpscaler) {
                upscalers.unshift({ label: `⚠️ ${currentDraft.sdHiresUpscaler} (未在后端找到)`, value: currentDraft.sdHiresUpscaler });
                missingItems.push(`放大算法 [${currentDraft.sdHiresUpscaler}]`);
            }
            upscalerSelectHandle.setOptions(upscalers);
            upscalerSelectHandle.setValue(currentDraft.sdHiresUpscaler || 'R-ESRGAN 4x+ Anime6B');
            upscalerSelectHandle.setError(isMissing, isMissing ? `⚠️ 放大算法 [${currentDraft.sdHiresUpscaler}] 未在 SD-WebUI 后端找到！` : undefined);
        }

        // 4. 刷新 LoRA 列表与失效项检测
        if (this._loraManager) {
            this._loraManager.update?.(currentDraft.loras || [], cachedLoras);
            (currentDraft.loras || []).forEach((item) => {
                if (item.name && cachedLoras.length > 0 && !cachedLoras.includes(item.name)) {
                    missingItems.push(`LoRA [${item.name}]`);
                }
            });
        }

        // 若存在失效模型/LoRA 资源且处于非静默模式，弹出警告提示
        if (!silent && missingItems.length > 0) {
            FeedbackService.toastWarning(
                `⚠️ 检测到当前方案中以下资源未在 SD-WebUI 后端找到：\n${missingItems.join('、')}\n相关控件已自动标红，请检查 SD-WebUI 模型目录！`
            );
        }
    }

    private _buildCards(): void {
        this._root.appendChild(this._buildConnectionCard());
        this._root.appendChild(this._buildProfileQuickSwitchCard());
        this._root.appendChild(this._buildSamplingCard());
        this._root.appendChild(this._buildHiresCard());
        this._root.appendChild(this._buildPromptCard());
    }

    // ── C1: API 服务连接卡片 ───────────────────────────────────────────────
    private _buildConnectionCard(): HTMLElement {
        return createConnectionCard({
            title: 'API 服务连接',
            description: '配置 Stable Diffusion WebUI (A1111) HTTP 服务地址，测试连通性并拉取后端模型与 LoRA',
            url: this._store.get('sdWebUrl') || DEFAULT_SDWEBUI_URL,
            placeholder: DEFAULT_SDWEBUI_URL,
            onUrlChange: (newUrl) => this._store.set('sdWebUrl', newUrl),
            onTest: async (url, btn) => {
                btn.disabled = true;
                btn.textContent = '连接中...';
                try {
                    this._store.set('sdWebUrl', url);
                    const driver = this._drivers?.get('sdwebui');
                    if (!driver) {
                        FeedbackService.toastError('🔴 驱动未就绪: SD-WebUI 驱动未注册');
                        return;
                    }

                    const result = driver.checkConnection
                        ? await driver.checkConnection()
                        : { connected: await driver.ping(), latencyMs: 0 };

                    if (result.connected) {
                        const syncResult = driver.syncAssets ? await driver.syncAssets(this._store) : { updatedCount: 0, summary: '', details: {} };
                        this._refreshTab(false);
                        FeedbackService.toastSuccess(
                            `🟢 SD-WebUI 连接成功 (延迟 ${result.latencyMs ?? 0}ms)\n${syncResult.summary}`
                        );
                    } else {
                        FeedbackService.toastError('🔴 SD-WebUI 连接失败: 无法访问后端服务');
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

    // ── C2: 局部方案快捷切换卡片 ─────────────────────────────────────────────
    private _buildProfileQuickSwitchCard(): HTMLElement {
        const getSDProfiles = (): SelectOptionItem[] => [
            { label: '未关联预设', value: '' },
            ...(this._store.get('sdProfiles') || []).map((p) => ({ label: p.name, value: p.id }))
        ];

        const cardC2Schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '局部方案快捷切换',
            description: '在 SD-WebUI 面板顶部直接快速切换并装载预设生图参数方案',
            rows: [
                {
                    key: 'sdProfileId',
                    type: 'select',
                    label: '生图参数方案',
                    helpTooltip: '快捷切换 SD 主模型、采样算法、分辨率及高清修复参数预设。',
                    options: getSDProfiles(),
                    onChangeHook: (id) => {
                        if (id) {
                            const profile = (this._store.get('sdProfiles') || []).find((p) => p.id === id);
                            if (profile?.data) this._applySDProfileData(profile.data);
                        }
                        this._refreshTab(false);
                    }
                }
            ]
        };
        return this._rendererMain.renderCard(cardC2Schema);
    }

    // ── C3: 基础生图与采样参数配置卡片 ───────────────────────────────────────
    private _buildSamplingCard(): HTMLElement {
        const getCachedModels = (): SelectOptionItem[] => [
            { label: '未选择', value: '' },
            ...(this._store.get('cachedModels') || []).map((m) => ({ label: m, value: m }))
        ];
        const getCachedSamplers = (): SelectOptionItem[] =>
            (this._store.get('cachedSamplers') || ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ SDE Karras', 'DDIM']).map((s) => ({ label: s, value: s }));

        this._sdProfileToolbar = bindPresetToolbar({
            adapter: createPresetToolbarAdapter(this._profileService, 'sdProfile', {
                onSave: () => {
                    FeedbackService.toastSuccess('SD 参数预设方案保存成功！');
                }
            }),
            getCurrentData: () => {
                const draft = this._draftStore.getState();
                const currentData: any = {};
                for (const key of SD_WEBUI_DRAFT_KEYS) {
                    currentData[key] = draft[key];
                }
                return currentData;
            },
            applyData: (id) => {
                const profile = (this._store.get('sdProfiles') || []).find((p) => p.id === id);
                if (profile?.data) this._applySDProfileData(profile.data);
                this._refreshTab(false);
            },
            onRefresh: () => this._refreshTab(false)
        });

        const cardC3Schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '基础生图与采样参数配置',
            description: '配置 SD 模型 Checkpoint、采样器算法、分辨率及生成引导系数',
            rows: [
                {
                    type: 'component',
                    label: '生图参数方案管理',
                    renderCustom: () => this._sdProfileToolbar!
                },
                {
                    key: 'sdModelCheckpoint',
                    type: 'select',
                    label: '主模型 (Checkpoint)',
                    helpTooltip: '从 SD-WebUI 后端读取的可用模型列表。',
                    options: getCachedModels()
                },
                {
                    key: 'sdSamplerName',
                    type: 'select',
                    label: '采样算法',
                    options: getCachedSamplers()
                },
                {
                    key: 'sdSteps',
                    type: 'number',
                    label: '采样步数',
                    min: 1,
                    max: 150,
                    step: 1,
                    unit: '步'
                },
                {
                    key: 'sdCfgScale',
                    type: 'number',
                    label: '提示词引导系数 (CFG Scale)',
                    helpTooltip: '控制画面与提示词的相关性，推荐 5.0 ~ 8.0。',
                    min: 1.0,
                    max: 30.0,
                    step: 0.5
                },
                {
                    key: 'sdClipSkip',
                    type: 'number',
                    label: 'CLIP 跳过层 (Clip Skip)',
                    helpTooltip: 'SD1.5/SDXL 通用模型常用 1，二次元动漫模型常用 2。',
                    min: 1,
                    max: 12,
                    step: 1
                },
                {
                    type: 'select',
                    label: '分辨率预设',
                    options: [...SDWEBUI_SIZE_PRESETS],
                    onChangeHook: (val: string) => {
                        if (val !== 'custom') {
                            const [w, h] = val.split('x').map((n) => parseInt(n, 10));
                            if (w && h) this._draftStore.update({ sdWidth: w, sdHeight: h });
                        }
                    }
                },
                {
                    key: 'sdWidth',
                    type: 'number',
                    label: '生成宽度',
                    min: 64,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                },
                {
                    key: 'sdHeight',
                    type: 'number',
                    label: '生成高度',
                    min: 64,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                }
            ]
        };
        return this._rendererDraft.renderCard(cardC3Schema);
    }

    // ── C4: 高清修复与图生图参数配置卡片 (Hires.fix) ──────────────────────────
    private _buildHiresCard(): HTMLElement {
        const getCachedUpscalers = (): SelectOptionItem[] =>
            (this._store.get('cachedUpscalers') || ['R-ESRGAN 4x+', 'R-ESRGAN 4x+ Anime6B', 'Latent', 'ESRGAN_4x', 'ScuNET']).map((u) => ({ label: u, value: u }));

        const cardC4Schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '高清修复与图生图 (Hires.fix)',
            description: '配置 SD 高清修复算法、放大倍数与图生图去噪幅度',
            collapsible: true,
            defaultOpen: false,
            rows: [
                {
                    key: 'sdEnableHires',
                    type: 'toggle',
                    label: '启用高清修复 (Hires.fix)',
                    helpTooltip: '生成低分辨率初图后自动放大并执行二次采样修复细节。'
                },
                {
                    key: 'sdHiresUpscaler',
                    type: 'select',
                    label: '放大算法 (Upscaler)',
                    helpTooltip: '高清修复使用的潜空间或超分辨率算法。',
                    disabledWhen: (s) => !s.sdEnableHires,
                    options: getCachedUpscalers()
                },
                {
                    key: 'sdHiresUpscaleBy',
                    type: 'number',
                    label: '放大倍数 (Upscale)',
                    helpTooltip: '在基础分辨率上的放大倍数 (如 1.5x, 2.0x)。',
                    disabledWhen: (s) => !s.sdEnableHires,
                    min: 1.0,
                    max: 4.0,
                    step: 0.25
                },
                {
                    key: 'sdHiresSteps',
                    type: 'number',
                    label: '高清修复步数 (Hires Steps)',
                    helpTooltip: '二次高清采样的步数（0 表示与原采样步数相同）。',
                    disabledWhen: (s) => !s.sdEnableHires,
                    min: 0,
                    max: 100,
                    step: 1,
                    unit: '步'
                },
                {
                    key: 'sdHiresDenoise',
                    type: 'number',
                    label: '高清修复去噪幅度 (Denoise)',
                    helpTooltip: '二次采样的去噪强度，推荐 0.35 ~ 0.55。',
                    disabledWhen: (s) => !s.sdEnableHires,
                    min: 0.1,
                    max: 1.0,
                    step: 0.05
                },
                {
                    key: 'sdDenoisingStrength',
                    type: 'number',
                    label: '图生图去噪幅度',
                    helpTooltip: '局部重绘与图生图基础去噪强度，推荐 0.6 ~ 0.85。',
                    min: 0.05,
                    max: 1.0,
                    step: 0.05
                }
            ]
        };
        return this._rendererDraft.renderCard(cardC4Schema);
    }

    // ── C5: 提示词模板与 LoRA 增强卡片 ──────────────────────────────────────
    private _buildPromptCard(): HTMLElement {
        const cardC5Schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '提示词模板与 LoRA 增强',
            description: '配置默认正向提示词、负向提示词及 LoRA 模型列表',
            rows: [
                {
                    key: 'sdPromptPrefix',
                    type: 'textarea',
                    label: 'SD 专属正向提示词前缀',
                    placeholder: 'masterpiece, best quality, highly detailed...'
                },
                {
                    key: 'sdPromptSuffix',
                    type: 'textarea',
                    label: 'SD 专属正向提示词后缀',
                    placeholder: 'vibrant lighting, 8k resolution...'
                },
                {
                    key: 'sdNegativePrefix',
                    type: 'textarea',
                    label: 'SD 专属负向提示词',
                    placeholder: 'lowres, bad anatomy, worst quality, text, error...'
                },
                {
                    type: 'component',
                    label: '追加 LoRA 模型预设',
                    renderCustom: () => {
                        this._loraManager = createLoraManagerControl({
                            loras: this._draftStore.get('loras') || this._store.get('loras') || [],
                            cachedLoras: this._store.get('cachedLoras') || [],
                            showExtraWeights: false,
                            onChange: (newLoras) => {
                                this._draftStore.set('loras', newLoras);
                            }
                        });
                        return this._loraManager;
                    }
                }
            ]
        };
        return this._rendererDraft.renderCard(cardC5Schema);
    }

    private _setupReactivity(): void {
        this._disposables.add(
            this._store.subscribe(() => {
                this._refreshTab(true);
            })
        );
    }
}

