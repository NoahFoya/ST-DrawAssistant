/**
 * NovelAI 生图后端配置面板视图 (NovelAITabView)
 * 提供三部分设置卡片：
 * 1. 服务连接：端点地址、API Token 与连通性测试
 * 2. 绘图参数预设：模型选择、画幅采样、画质生成控制与提示词方案关联
 * 3. 提示词预设：前缀、后缀与通用负向词方案管理
 */

import { CoreEventMap } from '../../types';
import { TypedEventBus, Logger } from '../../utils';
import { SettingsStore, PresetStore } from '../../state';
import { DriverRegistry } from '../../services/drivers';
import {
    DEFAULT_NOVELAI_CONFIG,
    NovelAIDrawingProfileData,
    NovelAIEngineConfig,
    snapTo64
} from '../../services/drivers/novelai-driver';
import {
    FormRenderer,
    FormRowSchema,
    SelectHandle,
    bindPresetToolbar,
    createPresetStoreAdapter,
    PresetItem,
    createPromptPresetManager,
    PromptPresetManagerHandle,
    PromptProfileData,
    createConnectionCard
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

/** NovelAI 常用画幅分辨率预设（对齐 64 整倍数） */
export const NOVELAI_RESOLUTION_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    // Normal 标准
    { label: '832 × 1216 (标准竖图 · Normal Portrait)', value: '832x1216' },
    { label: '1216 × 832 (标准横图 · Normal Landscape)', value: '1216x832' },
    { label: '1024 × 1024 (标准方图 · Normal Square)', value: '1024x1024' },
    // Large 高分辨率
    { label: '1024 × 1536 (高分竖图 · Large Portrait)', value: '1024x1536' },
    { label: '1536 × 1024 (高分横图 · Large Landscape)', value: '1536x1024' },
    { label: '1472 × 1472 (高分方图 · Large Square)', value: '1472x1472' },
    // Small 低消耗
    { label: '512 × 768 (低消竖图 · Small Portrait)', value: '512x768' },
    { label: '768 × 512 (低消横图 · Small Landscape)', value: '768x512' },
    { label: '640 × 640 (低消方图 · Small Square)', value: '640x640' },
    // Wallpaper 壁纸
    { label: '1920 × 1088 (16:9 壁纸横屏)', value: '1920x1088' },
    { label: '1088 × 1920 (9:16 壁纸竖屏)', value: '1088x1920' }
] as const;

/** NovelAI 配置类型定义 */
export interface NovelAIConfig extends NovelAIEngineConfig {
    [key: string]: any;
}

export class NovelAITabView extends BaseTabView {
    private readonly _logger = new Logger('NovelAITabView');
    private readonly _engineStore: EngineFormStore<NovelAIConfig>;
    private readonly _renderer: FormRenderer<NovelAIConfig>;
    private readonly _driverRegistry?: DriverRegistry;

    private _promptPresetManagerHandle: PromptPresetManagerHandle | null = null;
    private _drawingToolbarHandle: any = null;
    private _widthInput: HTMLInputElement | null = null;
    private _heightInput: HTMLInputElement | null = null;
    private _opusBadge: HTMLElement | null = null;
    private _resolutionSelectHandle: SelectHandle | null = null;
    private _drawingProfiles: PresetItem<NovelAIDrawingProfileData>[] = [];
    private _promptProfiles: PresetItem<PromptProfileData>[] = [];
    private _activeDrawingBaseline: NovelAIDrawingProfileData | null = null;

    constructor(
        private readonly _mainStore: SettingsStore,
        driverRegistry?: DriverRegistry,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super();
        this._driverRegistry = driverRegistry;

        const storedConfig: Record<string, any> = (this._mainStore.getEngineConfig('novelai') as any) || {};

        const activeDrawingProfileId: string = String(storedConfig.activeDrawingProfileId || '');
        const activePromptProfileId: string = String(storedConfig.activePromptProfileId || '');

        const initialConfig: NovelAIConfig = {
            ...DEFAULT_NOVELAI_CONFIG,
            ...storedConfig,
            activeDrawingProfileId,
            activePromptProfileId
        };
        delete (initialConfig as any).drawingProfiles;
        delete (initialConfig as any).promptProfiles;

        this._engineStore = new EngineFormStore<NovelAIConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('novelai', data);
        });
        this._mainStore.setEngineConfig('novelai', initialConfig);
        this._disposables.add(this._engineStore);

        this._renderer = new FormRenderer<NovelAIConfig>(this._engineStore);
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
        this._checkDimensionDirty();
    }

    private _checkDimensionDirty(): void {
        const curW = this._engineStore.get('width');
        const curH = this._engineStore.get('height');
        const baseW = this._activeDrawingBaseline?.width;
        const baseH = this._activeDrawingBaseline?.height;
        if (this._widthInput) {
            const isDirty = baseW !== undefined && curW !== baseW;
            this._widthInput.classList.toggle('is-dirty', isDirty);
            this._widthInput.title = isDirty ? '宽度已修改 (未保存)' : '输入宽度 (64 整数倍)';
        }
        if (this._heightInput) {
            const isDirty = baseH !== undefined && curH !== baseH;
            this._heightInput.classList.toggle('is-dirty', isDirty);
            this._heightInput.title = isDirty ? '高度已修改 (未保存)' : '输入高度 (64 整数倍)';
        }
    }

    private _buildCards(): void {
        // 卡片 1: 服务连接与凭据
        this._root.appendChild(this._buildConnectionCard());

        // 卡片 2: 绘图参数预设 (主方案统一管理：模型设置、画幅与采样、画质生成控制、关联提示词方案)
        this._root.appendChild(this._buildDrawingPresetCard());

        // 卡片 3: 提示词预设管理器 (PromptPresetManager 纯文本模式)
        this._root.appendChild(this._buildPromptPresetCard());
    }

    // --- 卡片 1: 服务连接与凭据 (Connection & Auth) ---

    private _buildConnectionCard(): HTMLElement {
        const driver = this._driverRegistry?.get('novelai');

        return createConnectionCard({
            title: '服务连接与凭据',
            description: '配置 NovelAI 官方端点或第三方反代地址与授权凭据',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: DEFAULT_NOVELAI_CONFIG.serverUrl,
            placeholder: 'https://image.novelai.net',
            buttonText: '测试连接',
            onUrlChange: (newUrl) => this._engineStore.set('serverUrl', newUrl),
            credentialExtension: {
                title: 'API Token',
                helpTooltip: 'NovelAI 官方令牌 (pst-...) 或第三方反代授权凭据。',
                value: this._engineStore.get('apiKey') || '',
                placeholder: 'pst-...',
                onChange: (newToken) => this._engineStore.set('apiKey', newToken)
            },
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
                                if (catalog?.models) {
                                    FeedbackService.toastInfo(`已同步官方模型目录，共 ${catalog.models.length} 个模型可用`);
                                }
                            }
                        } catch {
                            // 资产同步探测异常不阻断整体连通状态
                        }
                    } else {
                        const errMsg = res?.message || '无法访问 NovelAI 服务';
                        const isAuthError = /token|auth|401|凭据|令牌/i.test(errMsg);
                        card?.setStatus('error', '连接失败');
                        if (isAuthError) {
                            card?.setError(true, `已失效：${errMsg}`, 'credential');
                        } else {
                            card?.setError(true, `已失效：${errMsg}`, 'url');
                        }
                        FeedbackService.toastError(`连接失败: ${errMsg}`);
                    }
                } catch (e: any) {
                    const errMsg = e?.message || String(e);
                    const isAuthError = /token|auth|401|凭据|令牌/i.test(errMsg);
                    card?.setStatus('error', '测试异常');
                    if (isAuthError) {
                        card?.setError(true, `已失效：${errMsg}`, 'credential');
                    } else {
                        card?.setError(true, `已失效：${errMsg}`, 'url');
                    }
                    FeedbackService.toastError(`测试异常: ${errMsg}`);
                }
            }
        });
    }

    // --- 卡片 2: 绘图参数预设 (主方案管理器) ---

    private _buildDrawingPresetCard(): HTMLElement {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({ title: '绘图参数预设' });
        card.header.appendChild(header);

        // 挂载顶部全宽绘图主方案工具栏
        const drawingAdapter = createPresetStoreAdapter<NovelAIDrawingProfileData>({
            category: 'drawing',
            subCategory: 'novelai',
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
                    this._updateResolutionPresetSelect();
                    this._updateDimensionsInputs();
                    this._updateOpusBadge();
                    this._checkDimensionDirty();
                    this._drawingToolbarHandle?.setDirty?.(false);
                    if (preset.data.promptProfileId && this._promptPresetManagerHandle) {
                        this._engineStore.set('activePromptProfileId', preset.data.promptProfileId);
                        this._promptPresetManagerHandle.refresh();
                    }
                }
            }
        });

        const drawingToolbar = bindPresetToolbar<NovelAIDrawingProfileData>({
            adapter: {
                ...drawingAdapter,
                saveProfile: async (id, data) => {
                    await drawingAdapter.saveProfile(id, data);
                    this._activeDrawingBaseline = JSON.parse(JSON.stringify(data));
                    this._checkDimensionDirty();
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
                    this._updateResolutionPresetSelect();
                    this._updateDimensionsInputs();
                    this._updateOpusBadge();
                    this._checkDimensionDirty();
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
        const modelRows: FormRowSchema<NovelAIConfig>[] = [
            {
                key: 'model',
                type: 'select',
                label: '生图主模型 (Model)',
                options: [
                    { label: 'NAI 4.5: NAI Diffusion V4.5 Full (完整版 · 推荐)', value: 'nai-diffusion-4-5-full' },
                    { label: 'NAI 4.5: NAI Diffusion V4.5 Curated (精选版)', value: 'nai-diffusion-4-5-curated' },
                    { label: 'NAI 4: NAI Diffusion V4 Curated (精选预览版)', value: 'nai-diffusion-4-curated-preview' },
                    { label: 'NAI 4: NAI Diffusion V4 Full (完整版)', value: 'nai-diffusion-4-full' },
                    { label: 'NAI 5: NAI Diffusion V5 Full (最新完整版)', value: 'nai-diffusion-5-full' },
                    { label: 'NAI 5: NAI Diffusion V5 Curated (最新精选版)', value: 'nai-diffusion-5-curated' },
                    { label: 'NAI 3: NAI Diffusion V3 (Anime 经典底模)', value: 'nai-diffusion-3' },
                    { label: 'NAI 3: NAI Diffusion Furry V3 (毛茸茸模型)', value: 'nai-diffusion-furry-3' },
                    { label: 'Safe Diffusion (通用兼容模型)', value: 'safe-diffusion' }
                ]
            }
        ];
        modelRows.forEach((r) => modelGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(modelGroup.root);

        // 2. 画幅与采样设置分组 (默认展开)
        const samplingGroup = createSectionGroup({
            title: '画幅与采样设置',
            collapsible: true,
            defaultOpen: true
        });

        // 预设分辨率下拉
        const resPresetRow: FormRowSchema<NovelAIConfig> = {
            type: 'select',
            label: '分辨率预设',
            options: [...NOVELAI_RESOLUTION_PRESETS],
            onCreated: (handle) => {
                this._resolutionSelectHandle = handle;
                this._updateResolutionPresetSelect();
            },
            onChangeHook: (val: string) => {
                if (val !== 'custom') {
                    const [w, h] = val.split('x').map((n) => parseInt(n, 10));
                    if (w && h) {
                        this._engineStore.set('width', w);
                        this._engineStore.set('height', h);
                        this._updateDimensionsInputs();
                        this._updateOpusBadge();
                        this._checkDimensionDirty();
                    }
                }
            }
        };
        samplingGroup.body.appendChild(this._renderer.renderRow(resPresetRow));

        // 尺寸微调与 ⇄ 互换及 Opus 免点状态
        samplingGroup.body.appendChild(this._buildDimensionAndSwapRow());

        const samplingRows: FormRowSchema<NovelAIConfig>[] = [
            {
                key: 'sampler',
                type: 'select',
                label: '采样方法 (Sampler)',
                options: [
                    { label: 'k_euler', value: 'k_euler' },
                    { label: 'k_euler_ancestral', value: 'k_euler_ancestral' },
                    { label: 'k_dpmpp_2s_ancestral', value: 'k_dpmpp_2s_ancestral' },
                    { label: 'k_dpmpp_2m_sde', value: 'k_dpmpp_2m_sde' },
                    { label: 'k_dpmpp_2m', value: 'k_dpmpp_2m' },
                    { label: 'k_dpmpp_sde', value: 'k_dpmpp_sde' },
                    { label: 'ddim_v3', value: 'ddim_v3' }
                ]
            },
            {
                key: 'noiseSchedule',
                type: 'select',
                label: '调度类型 (Schedule)',
                helpTooltip: '扩散过程中的加噪/去噪步长变化曲线。',
                options: [
                    { label: 'karras (经典平滑 · 推荐)', value: 'karras' },
                    { label: 'native (原生步进)', value: 'native' },
                    { label: 'exponential (指数调度)', value: 'exponential' },
                    { label: 'polyexponential (多重指数)', value: 'polyexponential' }
                ]
            },
            {
                key: 'steps',
                type: 'number',
                label: '采样步数 (Steps)',
                helpTooltip: '通常建议 28 步，超过 28 步将失去 Opus 免点资格。',
                min: 1,
                max: 50,
                step: 1,
                unit: '步',
                onChangeHook: () => {
                    this._updateOpusBadge();
                }
            },
            {
                key: 'scale',
                type: 'number',
                label: '提示词引导系数 (CFG Scale)',
                helpTooltip: '模型贴合提示词的强烈程度，通常建议 5.0 ~ 7.0。',
                min: 1.0,
                max: 20.0,
                step: 0.5
            },
            {
                key: 'cfgRescale',
                type: 'number',
                label: '色彩过饱和抑制 (CFG Rescale)',
                helpTooltip: '抑制高引导系数下的画面过曝与锐化黑边烧焦。',
                min: 0.0,
                max: 1.0,
                step: 0.05
            },
            {
                key: 'seed',
                type: 'number',
                label: '随机种子 (Seed)',
                helpTooltip: '-1 为完全随机，填入固定数值可复现构图。',
                min: -1,
                max: 4294967295,
                step: 1
            }
        ];
        samplingRows.forEach((r) => samplingGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(samplingGroup.root);

        // 3. 画质与生成控制分组 (默认展开)
        const qualityGroup = createSectionGroup({
            title: '画质与生成控制',
            collapsible: true,
            defaultOpen: true
        });
        const isNonV3 = (s: NovelAIConfig) => {
            const m = s.model || '';
            return !(m.includes('nai-diffusion-3') || m.includes('safe-diffusion') || m.includes('furry-3'));
        };

        const qualityRows: FormRowSchema<NovelAIConfig>[] = [
            {
                key: 'ucPreset',
                type: 'select',
                label: '负向词预设 (UC Preset)',
                helpTooltip: 'NovelAI 官方特调负向质量滤镜。',
                options: [
                    { label: '重度过滤 (Heavy · 官方默认推荐)', value: 0 },
                    { label: '轻度过滤 (Light)', value: 1 },
                    { label: '人体形态增强 (Human Anatomy)', value: 2 },
                    { label: '无内置预设 (None)', value: 3 }
                ]
            },
            {
                key: 'qualityToggle',
                type: 'toggle',
                label: '添加官方画质标签 (masterpiece, best quality)'
            },
            {
                key: 'convertPromptSyntax',
                type: 'toggle',
                label: '语法智能转换 ((tag:1.2) 自动转 {tag})'
            },
            {
                key: 'smeaMode',
                type: 'select',
                label: 'SMEA 细节增强模式 (仅 V3 架构生效)',
                helpTooltip: '仅 V3 架构生效；V4 及以上多模态模型由底层原生支持大图采样，无需且不支持 SMEA。',
                disabledWhen: isNonV3,
                options: [
                    { label: '不使用 (None)', value: 'none' },
                    { label: 'Auto (自适应)', value: 'auto' },
                    { label: 'SMEA (大图精细采样)', value: 'smea' },
                    { label: 'SMEA + DYN (动态高频采样 · 推荐)', value: 'smea_dyn' }
                ]
            },
            {
                key: 'decrisper',
                type: 'toggle',
                label: '去焦平滑 (Decrisper)',
                helpTooltip: '平滑色阶阶梯，减少高引导噪点 (仅 V3 架构生效)。',
                disabledWhen: isNonV3
            },
            {
                key: 'variety',
                type: 'toggle',
                label: '构图多样化 (Variety)'
            }
        ];
        qualityRows.forEach((r) => qualityGroup.body.appendChild(this._renderer.renderRow(r)));
        card.body.appendChild(qualityGroup.root);

        // 4. 提示词预设设置分组 (默认展开)
        const promptGroup = createSectionGroup({
            title: '提示词预设设置',
            collapsible: true,
            defaultOpen: true
        });
        const promptRows: FormRowSchema<NovelAIConfig>[] = [
            {
                key: 'promptProfileId',
                type: 'select',
                label: '提示词预设方案',
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

    private _buildDimensionAndSwapRow(): HTMLElement {
        const row = createRow(['left', 'right'], { align: 'center', divided: true });
        row.slots[0].appendChild(createFieldLabel({
            title: '尺寸微调与画幅翻转',
            helpTooltip: '必须满足 64 像素整倍数对齐；点击 ⇄ 快速互换宽与高。'
        }));

        const container = document.createElement('div');
        container.className = 'da-input-group';

        // 宽度输入
        const widthInput = document.createElement('input');
        widthInput.type = 'number';
        widthInput.className = 'da-input da-input--number da-flex-1';
        widthInput.min = '64';
        widthInput.max = '2048';
        widthInput.step = '64';
        widthInput.value = String(this._engineStore.get('width') || 832);
        widthInput.addEventListener('change', () => {
            const w = snapTo64(parseInt(widthInput.value, 10), 832);
            widthInput.value = String(w);
            this._engineStore.set('width', w);
            this._resolutionSelectHandle?.setValue('custom');
            this._updateOpusBadge();
            this._checkDimensionDirty();
        });
        this._widthInput = widthInput;

        // 互换按钮
        const swapBtn = document.createElement('button');
        swapBtn.type = 'button';
        swapBtn.className = 'da-btn da-btn--secondary da-btn--sm da-nowrap';
        swapBtn.textContent = '⇄ 互换';
        swapBtn.title = '一键互换宽高数值';
        swapBtn.onclick = () => {
            const curW = snapTo64(parseInt(widthInput.value, 10), 832);
            const curH = snapTo64(parseInt(heightInput.value, 10), 1216);
            widthInput.value = String(curH);
            heightInput.value = String(curW);
            this._engineStore.set('width', curH);
            this._engineStore.set('height', curW);
            this._resolutionSelectHandle?.setValue('custom');
            this._updateOpusBadge();
            this._checkDimensionDirty();
        };

        // 高度输入
        const heightInput = document.createElement('input');
        heightInput.type = 'number';
        heightInput.className = 'da-input da-input--number da-flex-1';
        heightInput.min = '64';
        heightInput.max = '2048';
        heightInput.step = '64';
        heightInput.value = String(this._engineStore.get('height') || 1216);
        heightInput.addEventListener('change', () => {
            const h = snapTo64(parseInt(heightInput.value, 10), 1216);
            heightInput.value = String(h);
            this._engineStore.set('height', h);
            this._resolutionSelectHandle?.setValue('custom');
            this._updateOpusBadge();
            this._checkDimensionDirty();
        });
        this._heightInput = heightInput;

        // Opus 免点徽标
        const opusBadge = document.createElement('span');
        this._opusBadge = opusBadge;
        this._updateOpusBadge();

        container.appendChild(widthInput);
        container.appendChild(swapBtn);
        container.appendChild(heightInput);
        container.appendChild(opusBadge);

        row.slots[1].appendChild(container);
        this._checkDimensionDirty();
        return row.root;
    }

    private _updateOpusBadge(): void {
        if (!this._opusBadge) return;
        const w = this._engineStore.get('width') ?? 832;
        const h = this._engineStore.get('height') ?? 1216;
        const s = this._engineStore.get('steps') ?? 28;
        const isFree = (w * h <= 1048576) && (s <= 28);
        if (isFree) {
            this._opusBadge.className = 'da-badge da-badge--success';
            this._opusBadge.textContent = '✨ Opus 免点';
            this._opusBadge.title = '当前尺寸与步数满足 Opus 会员免点出图条件 (<= 1048576 px 且 <= 28 步)';
        } else {
            this._opusBadge.className = 'da-badge da-badge--warn';
            this._opusBadge.textContent = '🪙 消耗点数';
            this._opusBadge.title = '当前尺寸或步数超出免点范围，将消耗 Anlas 点数';
        }
    }

    private _updateDimensionsInputs(): void {
        const w = this._engineStore.get('width') ?? 832;
        const h = this._engineStore.get('height') ?? 1216;
        if (this._widthInput) this._widthInput.value = String(w);
        if (this._heightInput) this._heightInput.value = String(h);
        this._checkDimensionDirty();
    }

    private _updateResolutionPresetSelect(): void {
        if (!this._resolutionSelectHandle) return;
        const w = this._engineStore.get('width') ?? 832;
        const h = this._engineStore.get('height') ?? 1216;
        const found = NOVELAI_RESOLUTION_PRESETS.find((p) => p.value === `${w}x${h}`);
        this._resolutionSelectHandle.setValue(found ? found.value : 'custom');
    }

    // --- 卡片 3: 提示词预设管理器 (PromptPresetManager 纯文本模式) ---

    private _buildPromptPresetCard(): HTMLElement {
        this._promptPresetManagerHandle = createPromptPresetManager({
            title: '提示词预设管理器',
            enableLora: false,
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
            }
        });

        this._disposables.add(this._promptPresetManagerHandle);
        return this._promptPresetManagerHandle;
    }

    // --- 内部数据流与方案选项联动 ---

    private _extractCurrentDrawingData(): NovelAIDrawingProfileData {
        const s = this._engineStore.getState();
        return {
            model: s.model,
            width: s.width,
            height: s.height,
            sampler: s.sampler,
            noiseSchedule: s.noiseSchedule,
            steps: s.steps,
            scale: s.scale,
            cfgRescale: s.cfgRescale,
            seed: s.seed,
            qualityToggle: s.qualityToggle,
            ucPreset: s.ucPreset,
            convertPromptSyntax: s.convertPromptSyntax,
            smeaMode: s.smeaMode,
            smea: s.smea,
            smeaDyn: s.smeaDyn,
            decrisper: s.decrisper,
            variety: s.variety,
            uncondScale: s.uncondScale,
            promptProfileId: s.promptProfileId || this._getActivePromptId()
        };
    }

    private _getDrawingProfiles(): PresetItem<NovelAIDrawingProfileData>[] {
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
        handle?.setOptions(this._getPromptProfileSelectOptions());
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

    /** 异步按需加载预设方案与激活方案 */
    private async _loadDiskPresets(): Promise<void> {
        try {
            // 1. 绘图主方案：拉取预设列表并应用激活项
            const presets = await PresetStore.list<NovelAIDrawingProfileData>('drawing', 'novelai');
            this._drawingProfiles = Array.isArray(presets) ? presets : [];
            const currentDrawingId = this._getActiveDrawingId();
            const matched = this._drawingProfiles.find((p) => p.id === currentDrawingId) || this._drawingProfiles[0];
            if (matched) {
                this._engineStore.set('activeDrawingProfileId', matched.id);
                if (matched.data) {
                    this._activeDrawingBaseline = JSON.parse(JSON.stringify(matched.data));
                    this._engineStore.update(matched.data);
                    this._updateResolutionPresetSelect();
                    this._updateDimensionsInputs();
                    this._updateOpusBadge();
                    this._checkDimensionDirty();
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
            this._logger.error('NovelAITabView: 加载预设方案失败', err);
            FeedbackService.toastError('加载 NovelAI 预设方案失败');
            this._drawingProfiles = [];
            this._promptProfiles = [];
            this._drawingToolbarHandle?.refreshPresets?.([], '');
        }
    }
}
