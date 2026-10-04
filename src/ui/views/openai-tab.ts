/**
 * OpenAI 兼容绘图服务专属设置选项卡主视图 (OpenAITabView)。
 *
 * @remarks
 * 为 OpenAI 兼容接口（DALL-E 3、FLUX API、Grok Imagine、SiliconFlow 等）提供专属设置与预设管理能力：
 * 1. 服务通信与鉴权：配置服务商模板、Base URL 与 Bearer Token，支持服务端健康探测与动态模型拉取；
 * 2. 预设工具栏：集成 PresetToolbar 提供统一的预设切换、新增、克隆、导入导出与删除能力；
 * 3. 核心模型与提示词方案：支持标准常用模型、自定义模型标识输入与提示词预设方案绑定；
 * 4. 画幅尺寸与渲染档位：格式化为 WxH 规格、DALL-E 3 官方 quality（画质）与 style（风格）档位；
 * 5. 自定义请求体扩展：支持向 /v1/images/generations 合并任意专有参数，失焦实时 JSON 语法校验与红框阻断；
 * 6. 提示词模板管理：云端大模型接口无外置 LoRA 挂载能力，配置 showLora: false 纯粹管理正负向模板词库；
 * 7. 变更检测与依赖校验：集中比对草稿与持久化快照驱动 .is-dirty 黄框，引用的提示词失效时驱动 .is-invalid 红框；
 * 8. 单一事实来源：通信归属 providers.openai，绘画参数归属 drawing/openai，提示词通过 promptPresetId 绑定。
 */

import type { SettingsView } from '../types';
import type { DrawingPresetData, PresetItem, PromptPresetData } from '@types';
import { Card } from '../components/card';
import { FormField } from '../components/form-field';
import { Select } from '../components/select';
import { TextInput } from '../components/text-input';
import { ConnectionCard, type ProviderPreset } from '../composite/connection-card';
import { PresetToolbar } from '../composite/preset-toolbar';
import { DimensionPicker } from '../composite/dimension-picker';
import { PromptPresetManager, type PromptCardData } from '../composite/prompt-preset-manager';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';
import { eventBus } from '../../util/event-bus';
import { logger } from '../../util/logger';
import { Toast } from '../feedback/toast';

/** 常见已知 OpenAI 兼容生图模型候选列表 */
const OPENAI_MODEL_OPTIONS = [
    { label: 'dall-e-3 (OpenAI 官方旗舰)', value: 'dall-e-3' },
    { label: 'dall-e-2 (OpenAI 快速版本)', value: 'dall-e-2' },
    { label: 'black-forest-labs/FLUX.1-schnell', value: 'black-forest-labs/FLUX.1-schnell' },
    { label: 'black-forest-labs/FLUX.1-dev', value: 'black-forest-labs/FLUX.1-dev' },
    { label: 'Kwai-Kolors/Kolors', value: 'Kwai-Kolors/Kolors' },
];

/** DALL-E 3 官方画质档位选项 */
const OPENAI_QUALITY_OPTIONS = [
    { label: 'standard (标准画质)', value: 'standard' },
    { label: 'hd (超清细节)', value: 'hd' },
];

/** DALL-E 3 官方风格模式选项 */
const OPENAI_STYLE_OPTIONS = [
    { label: 'vivid (鲜明生动 - 超现实饱和度)', value: 'vivid' },
    { label: 'natural (自然写实 - 柔和自然质感)', value: 'natural' },
];

/** 预置服务商模板列表 */
const OPENAI_PROVIDER_PRESETS: ProviderPreset[] = [
    { id: 'openai-official', label: 'OpenAI 官方 (https://api.openai.com/v1)', defaultUrl: 'https://api.openai.com/v1' },
    { id: 'siliconflow', label: 'SiliconFlow 硅基流动 (https://api.siliconflow.cn/v1)', defaultUrl: 'https://api.siliconflow.cn/v1' },
    { id: 'custom', label: '自定义中转或自建代理', defaultUrl: '' },
];

export class OpenAITabView implements SettingsView {
    public readonly id = 'openai';
    public readonly title = 'OpenAI 兼容';
    public readonly element: HTMLElement;

    // 复合组件成员
    private connectionCard!: ConnectionCard;
    private presetToolbar!: PresetToolbar;
    private dimensionPicker!: DimensionPicker;
    private promptPresetManager!: PromptPresetManager;

    // 模型与提示词方案卡片原子控件
    private modelSelect!: Select;
    private customModelInput!: TextInput;
    private promptPresetSelect!: Select;

    // 画幅规格与渲染档位原子控件
    private qualitySelect!: Select;
    private styleSelect!: Select;

    // 自定义请求体 JSON 扩展原子控件
    private customBodyTextarea!: HTMLTextAreaElement;
    private isJsonValid = true;

    // 状态管理
    private currentPresetItem: PresetItem<DrawingPresetData> | null = null;
    private initialPresetSnapshot: DrawingPresetData = {};
    private runtimeConfig: DrawingPresetData = {};
    private readonly dirtyFields = new Set<string>();
    private readonly disposables: Array<{ dispose: () => void }> = [];
    private unlistenSettings: (() => void) | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.classList.add('da-tab-pane', 'da-view-openai');

        // 1. 初始化解析当前激活方案（单一事实 SSOT）
        const cfg = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('openai');
        this.applyActivePreset(cfg?.activeDrawingPresetId ?? '', { persist: false, silent: true });

        // 2. 组装卡片层次结构与初值回填
        this.buildView();
    }

    // 1. 方案激活与状态重置

    /**
     * 单一入口统一处理：应用并切换激活的绘图预设方案。
     *
     * @param presetId 目标方案标识符
     * @param options 配置选项 (persist: 是否持久化至 providers.openai, silent: 是否跳过控件更新)
     */
    private applyActivePreset(presetId: string, options?: { persist?: boolean; silent?: boolean }): void {
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'openai');
        let target = presets.find((p) => p.id === presetId);

        if (!target && presets.length > 0) {
            target = presets[0];
        }

        if (target) {
            this.currentPresetItem = target;
            this.initialPresetSnapshot = structuredClone(target.data || {});
            this.runtimeConfig = structuredClone(target.data || {});

            const currentActiveId = settingsStore.getProviderConfig<{ activeDrawingPresetId?: string }>('openai')?.activeDrawingPresetId;
            if (options?.persist !== false && target.id !== currentActiveId) {
                settingsStore.setProviderConfig('openai', {
                    activeDrawingPresetId: target.id,
                });
            }
        } else {
            // 白板状态：无激活方案，保留当前草稿，清空持久化 ID
            this.currentPresetItem = null;
            this.initialPresetSnapshot = {};
            if (options?.persist !== false) {
                settingsStore.setProviderConfig('openai', {
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
        this.buildModelAndPromptCard();
        this.buildDimensionAndQualityCard();
        this.buildCustomBodyCard();
        this.buildPromptPresetManagementCard();

        // 初始填充工具栏与回填数据
        const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'openai');
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
        const cfg = settingsStore.getProviderConfig<{
            serverUrl?: string;
            apiKey?: string;
            serviceId?: string;
        }>('openai');

        this.connectionCard = new ConnectionCard({
            initialData: {
                serverUrl: cfg?.serverUrl || 'https://api.openai.com/v1',
                apiKey: cfg?.apiKey || '',
                activePresetId: cfg?.serviceId || 'openai-official',
            },
            showApiKey: true,
            providerPresets: OPENAI_PROVIDER_PRESETS,
            onChange: (data) => {
                settingsStore.setProviderConfig('openai', {
                    serverUrl: data.serverUrl,
                    apiKey: data.apiKey,
                    serviceId: data.activePresetId,
                });
            },
            onTestPing: async (_serverUrl: string, _apiKey?: string) => {
                const provider = providerRegistry.getProvider('openai');
                if (!provider?.checkHealth) {
                    throw new Error('未注册 OpenAI 兼容服务提供方');
                }
                const res = await provider.checkHealth();
                if (res.status !== 'ok') {
                    throw new Error(res.message || '连接失败');
                }
                return res;
            },
            onFetchAssets: async () => {
                const provider = providerRegistry.getProvider('openai');
                if (provider && typeof provider.fetchModels === 'function') {
                    const models = await provider.fetchModels();
                    if (Array.isArray(models) && models.length > 0) {
                        const mergedOptions = [...OPENAI_MODEL_OPTIONS];
                        for (const m of models) {
                            if (!mergedOptions.some((opt) => opt.value === m)) {
                                mergedOptions.push({ label: m, value: m });
                            }
                        }
                        this.modelSelect.setOptions(mergedOptions);
                        return { count: models.length, message: `已成功拉取 ${models.length} 个兼容生图模型` };
                    }
                }
                return { count: 0, message: '未发现可用图像模型或服务端不支持 /v1/models 查询' };
            },
        });

        this.element.appendChild(this.connectionCard.element);
        this.disposables.push(this.connectionCard);
    }

    /**
     * 绘画参数方案主控工具栏 (PresetToolbar)
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
     * 核心生图模型与提示词方案卡片
     */
    private buildModelAndPromptCard(): void {
        const card = new Card({
            title: '生图模型与提示词方案',
            subtitle: '配置云端目标模型架构与关联绑定的提示词模板',
            collapsible: true,
        });

        // 1. 核心生图模型
        const initialModel = (this.runtimeConfig.baseModel as string) || 'dall-e-3';
        this.modelSelect = new Select({
            options: OPENAI_MODEL_OPTIONS,
            value: initialModel,
            onChange: (val) => {
                this.runtimeConfig.baseModel = val;
                this.evaluateDirtyState();
            },
        });
        const modelField = new FormField({
            label: '核心生图模型',
            tooltip: '指定发送至 /v1/images/generations 的 model 参数',
            control: this.modelSelect,
        });
        card.getBodyElement().appendChild(modelField.element);
        this.disposables.push(modelField, this.modelSelect);

        // 2. 自定义模型标识 (用于第三方代理或自建端点)
        this.customModelInput = new TextInput({
            value: (this.runtimeConfig.customModel as string) || '',
            placeholder: '可选填写非标或中转模型标识（若填写将覆盖上述下拉选项）',
            onChange: (val) => {
                this.runtimeConfig.customModel = val.trim();
                this.evaluateDirtyState();
            },
        });
        const customModelField = new FormField({
            label: '自定义模型标识',
            tooltip: '第三方中转代理或微调模型专用名称。若填写，生图时将优先采用此标识',
            control: this.customModelInput,
        });
        card.getBodyElement().appendChild(customModelField.element);
        this.disposables.push(customModelField, this.customModelInput);

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
            tooltip: '关联的提示词词库模板。出图时将自动融合正向前缀与后缀描述词',
            control: this.promptPresetSelect,
        });
        card.getBodyElement().appendChild(promptField.element);
        this.disposables.push(promptField, this.promptPresetSelect);

        this.element.appendChild(card.element);
        this.disposables.push(card);
    }

    /**
     * 画幅规格与官方渲染档位卡片 (DimensionPicker + quality/style)
     */
    private buildDimensionAndQualityCard(): void {
        const card = new Card({
            title: '画幅规格与渲染档位',
            subtitle: '设置输出分辨率与 DALL-E 官方画质及风格选项',
            collapsible: true,
        });

        // 1. 画幅尺寸复合控件
        this.dimensionPicker = new DimensionPicker({
            initialData: {
                width: this.runtimeConfig.width || 1024,
                height: this.runtimeConfig.height || 1024,
            },
            onChange: (val) => {
                this.runtimeConfig.width = val.width;
                this.runtimeConfig.height = val.height;
                this.evaluateDirtyState();
            },
        });
        card.getBodyElement().appendChild(this.dimensionPicker.element);
        this.disposables.push(this.dimensionPicker);

        // 2. 渲染画质档位 (DALL-E 3: quality)
        const initialQuality = (this.runtimeConfig.quality as string) || 'standard';
        this.qualitySelect = new Select({
            options: OPENAI_QUALITY_OPTIONS,
            value: initialQuality,
            onChange: (val) => {
                this.runtimeConfig.quality = val;
                this.evaluateDirtyState();
            },
        });
        const qualityField = new FormField({
            label: '渲染画质档位',
            tooltip: 'DALL-E 3 官方画质选项。hd (超清) 具有更高的渲染精细度与细节一致性',
            control: this.qualitySelect,
        });
        card.getBodyElement().appendChild(qualityField.element);
        this.disposables.push(qualityField, this.qualitySelect);

        // 3. 画面风格模式 (DALL-E 3: style)
        const initialStyle = (this.runtimeConfig.style as string) || 'vivid';
        this.styleSelect = new Select({
            options: OPENAI_STYLE_OPTIONS,
            value: initialStyle,
            onChange: (val) => {
                this.runtimeConfig.style = val;
                this.evaluateDirtyState();
            },
        });
        const styleField = new FormField({
            label: '画面风格模式',
            tooltip: 'DALL-E 3 官方风格选项。vivid (鲜明生动) 色彩饱和且极具戏剧感，natural (自然写实) 柔和写实',
            control: this.styleSelect,
        });
        card.getBodyElement().appendChild(styleField.element);
        this.disposables.push(styleField, this.styleSelect);

        this.element.appendChild(card.element);
        this.disposables.push(card);
    }

    /**
     * 自定义请求体 JSON 扩展卡片 (默认折叠收纳)
     */
    private buildCustomBodyCard(): void {
        const card = new Card({
            title: '自定义请求体 JSON 扩展',
            subtitle: '支持向 /v1/images/generations 请求体合并任意第三方专有参数 (如 FLUX 的 guidance_scale)',
            collapsible: true,
            defaultCollapsed: true,
        });

        const textareaContainer = document.createElement('div');
        textareaContainer.classList.add('da-form-row');

        const label = document.createElement('div');
        label.classList.add('da-form-label');
        label.textContent = 'JSON 扩展参数';

        this.customBodyTextarea = document.createElement('textarea');
        this.customBodyTextarea.classList.add('da-textarea', 'da-custom-body-json');
        this.customBodyTextarea.rows = 4;
        this.customBodyTextarea.placeholder = '{\n  "response_format": "b64_json"\n}';
        this.customBodyTextarea.value = (this.runtimeConfig.customBodyJson as string) || '';

        const handleJsonUpdate = () => {
            const val = this.customBodyTextarea.value;
            const valid = this.validateJson(val);
            if (valid) {
                this.runtimeConfig.customBodyJson = val.trim();
            }
            this.evaluateDirtyState();
        };

        this.customBodyTextarea.addEventListener('input', handleJsonUpdate);
        this.customBodyTextarea.addEventListener('blur', handleJsonUpdate);

        textareaContainer.appendChild(label);
        textareaContainer.appendChild(this.customBodyTextarea);
        card.getBodyElement().appendChild(textareaContainer);

        this.element.appendChild(card.element);
        this.disposables.push(card);
    }

    /**
     * 提示词预设方案管理卡片 (默认折叠收纳，云端闭源模型接口不支持外置 LoRA 模型)
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
            showNegativePrompt: false,
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
     * 校验自定义请求体 JSON 字符串合法性。
     */
    private validateJson(raw: string): boolean {
        const trimmed = raw.trim();
        if (!trimmed) {
            this.customBodyTextarea.classList.remove('is-invalid');
            this.isJsonValid = true;
            return true;
        }
        try {
            JSON.parse(trimmed);
            this.customBodyTextarea.classList.remove('is-invalid');
            this.isJsonValid = true;
            return true;
        } catch {
            this.customBodyTextarea.classList.add('is-invalid');
            this.isJsonValid = false;
            return false;
        }
    }

    /**
     * 检测表单当前输入与方案基准值的差异，同步标记变更字段并驱动工具栏状态。
     */
    private evaluateDirtyState(): void {
        const cur = this.runtimeConfig;
        const base = this.initialPresetSnapshot;

        this.dirtyFields.clear();

        // 1. 模型字段与提示词方案
        const isModelDirty = String(cur.baseModel ?? '') !== String(base.baseModel ?? '');
        this.modelSelect.setDirty(isModelDirty);
        if (isModelDirty) this.dirtyFields.add('baseModel');

        const isCustomModelDirty = String(cur.customModel ?? '') !== String(base.customModel ?? '');
        this.customModelInput.setDirty(isCustomModelDirty);
        if (isCustomModelDirty) this.dirtyFields.add('customModel');

        const curPromptId = cur.promptPresetId ?? '';
        const basePromptId = base.promptPresetId ?? '';
        const isPromptDirty = String(curPromptId) !== String(basePromptId);
        this.promptPresetSelect.setDirty(isPromptDirty);
        if (isPromptDirty) this.dirtyFields.add('promptPresetId');

        // 2. 画幅尺寸字段
        const isDimsDirty = cur.width !== base.width || cur.height !== base.height;
        this.dimensionPicker.element.classList.toggle('is-dirty', isDimsDirty);
        if (isDimsDirty) this.dirtyFields.add('dimensions');

        // 3. 官方质感与风格档位
        const isQualityDirty = String(cur.quality ?? '') !== String(base.quality ?? '');
        this.qualitySelect.setDirty(isQualityDirty);
        if (isQualityDirty) this.dirtyFields.add('quality');

        const isStyleDirty = String(cur.style ?? '') !== String(base.style ?? '');
        this.styleSelect.setDirty(isStyleDirty);
        if (isStyleDirty) this.dirtyFields.add('style');

        // 4. 自定义请求体 JSON 字段
        const isJsonDirty = String(cur.customBodyJson ?? '').trim() !== String(base.customBodyJson ?? '').trim();
        this.customBodyTextarea.classList.toggle('is-dirty', isJsonDirty);
        if (isJsonDirty) this.dirtyFields.add('customBodyJson');

        // 5. 校验绑定有效性并驱动工具栏
        this.validateBindings();
        this.presetToolbar.setDirty(this.dirtyFields.size > 0);
    }

    /**
     * 校验当前方案引用的提示词预设有效性，若引用的预设已失效则标记红色高亮。
     */
    private validateBindings(): void {
        const promptPresets = settingsStore.getPresets<PromptPresetData>('prompts');
        const promptId = this.runtimeConfig.promptPresetId;

        // 若配置了引用但库中不存在，标记失效描边
        const isPromptInvalid = Boolean(promptId && !promptPresets.some((p) => p.id === promptId));
        this.promptPresetSelect.element.classList.toggle('is-invalid', isPromptInvalid);
    }

    /**
     * 构建提示词预设方案下拉选项列表。
     */
    private buildPromptPresetOptions(activeId?: string): Array<{ label: string; value: string }> {
        const promptPresets = settingsStore.getPresets<PromptPresetData>('prompts');
        const options = promptPresets.map((p) => ({
            label: p.name || '未命名提示词预设',
            value: p.id,
        }));

        // 若当前选中的预设已被删除，追加失效标记回填
        if (activeId && !promptPresets.some((p) => p.id === activeId)) {
            options.unshift({
                label: `[已失效] ${activeId}`,
                value: activeId,
            });
        }

        return options;
    }

    /**
     * 将当前运行时配置回填同步至各控件视图。
     */
    private syncControlsFromRuntime(): void {
        this.modelSelect.setValue((this.runtimeConfig.baseModel as string) || 'dall-e-3');
        this.customModelInput.setValue((this.runtimeConfig.customModel as string) || '');

        const promptId = this.runtimeConfig.promptPresetId ?? '';
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(promptId));
        this.promptPresetSelect.setValue(promptId);

        this.dimensionPicker.setData({
            width: this.runtimeConfig.width || 1024,
            height: this.runtimeConfig.height || 1024,
        });

        this.qualitySelect.setValue((this.runtimeConfig.quality as string) || 'standard');
        this.styleSelect.setValue((this.runtimeConfig.style as string) || 'vivid');

        this.customBodyTextarea.value = (this.runtimeConfig.customBodyJson as string) || '';
        this.validateJson(this.customBodyTextarea.value);

        this.evaluateDirtyState();
    }

    // 4. 方案运维动作响应

    private handlePresetAction(action: string, presetId?: string): void {
        switch (action) {
            case 'select':
                if (presetId) this.applyActivePreset(presetId);
                break;

            case 'new': {
                if (!this.isJsonValid) {
                    Toast.show('自定义请求体 JSON 语法格式不正确，无法新建方案。请检查括号与双引号', { level: 'error' });
                    return;
                }

                // 1. 完整性校验：模型标识与画幅尺寸为必填
                const missing: string[] = [];
                const cfg = this.runtimeConfig;
                const effectiveModel = (cfg.customModel && cfg.customModel.trim()) || cfg.baseModel;
                if (!effectiveModel) missing.push('模型标识 (预置或自定义)');
                if (!cfg.width || !cfg.height) missing.push('画幅尺寸 (宽/高)');

                if (missing.length > 0) {
                    Toast.show(`无法创建方案，以下必填项尚未配置：${missing.join('、')}`, { level: 'warning', duration: 3500 });
                    return;
                }

                const name = window.prompt('请输入新方案名称:', '新 OpenAI 兼容方案');
                if (!name || !name.trim()) return;

                const newId = `openai_${Date.now()}`;
                const newPreset: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: name.trim(),
                    data: structuredClone(this.runtimeConfig),
                };

                settingsStore.savePreset('drawing', newPreset, 'openai');
                this.applyActivePreset(newId);
                break;
            }

            case 'save':
                if (!this.isJsonValid) {
                    Toast.show('自定义请求体 JSON 语法格式不正确，无法保存方案。请检查括号与双引号', { level: 'error' });
                    return;
                }
                if (this.currentPresetItem) {
                    const toSave: PresetItem<DrawingPresetData> = {
                        ...this.currentPresetItem,
                        data: structuredClone(this.runtimeConfig),
                    };
                    settingsStore.savePreset('drawing', toSave, 'openai');
                    this.initialPresetSnapshot = structuredClone(this.runtimeConfig);
                    this.dirtyFields.clear();
                    this.presetToolbar.setDirty(false);
                    this.syncControlsFromRuntime();
                    logger.info(`[OpenAITabView] 已保存方案: ${toSave.name}`);
                }
                break;

            case 'saveAs': {
                if (!this.isJsonValid) {
                    Toast.show('自定义请求体 JSON 语法格式不正确，无法另存为新方案', { level: 'error' });
                    return;
                }
                if (!this.currentPresetItem) return;
                const newId = `openai_${Date.now()}`;
                const cloned: PresetItem<DrawingPresetData> = {
                    id: newId,
                    name: `${this.currentPresetItem.name} (副本)`,
                    data: structuredClone(this.runtimeConfig),
                };
                settingsStore.savePreset('drawing', cloned, 'openai');
                this.applyActivePreset(newId);
                break;
            }

            case 'rename': {
                if (!this.currentPresetItem) return;
                const newName = window.prompt('请输入方案新名称:', this.currentPresetItem.name);
                if (newName && newName.trim() && newName.trim() !== this.currentPresetItem.name) {
                    this.currentPresetItem.name = newName.trim();
                    settingsStore.savePreset('drawing', this.currentPresetItem, 'openai');
                    const presets = settingsStore.getPresets<DrawingPresetData>('drawing', 'openai');
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
                    downloadAnchor.setAttribute('download', `${this.currentPresetItem.name || 'openai-preset'}.json`);
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
                    settingsStore.deletePreset('drawing', deletingId, 'openai');
                    const remaining = settingsStore.getPresets<DrawingPresetData>('drawing', 'openai');
                    if (remaining.length > 0) {
                        this.applyActivePreset(remaining[0].id);
                    } else {
                        // 方案池删空：保留当前草稿，置空方案 ID
                        this.currentPresetItem = null;
                        this.initialPresetSnapshot = {};
                        settingsStore.setProviderConfig('openai', {
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
                    id: `openai_${Date.now()}`,
                    name: parsed.name || file.name.replace(/\.[^/.]+$/, ''),
                    data: parsed.data || parsed,
                };
                settingsStore.savePreset('drawing', importedItem, 'openai');
                this.applyActivePreset(importedItem.id);
            } catch (err) {
                logger.error('[OpenAITabView] 方案导入失败:', err);
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
                const name = window.prompt('请输入新提示词预设名称:', '二次元/写实通用描述词模板');
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
        const promptId = this.runtimeConfig.promptPresetId ?? '';
        this.promptPresetSelect.setOptions(this.buildPromptPresetOptions(promptId));
        this.validateBindings();
    }

    // 5. 生命周期管理与状态同步

    public activate(): void {
        const cfg = settingsStore.getProviderConfig<{
            serverUrl?: string;
            apiKey?: string;
            serviceId?: string;
            activeDrawingPresetId?: string;
        }>('openai');

        if (cfg) {
            this.connectionCard.setData({
                serverUrl: cfg.serverUrl || 'https://api.openai.com/v1',
                apiKey: cfg.apiKey || '',
                activePresetId: cfg.serviceId || 'openai-official',
            });
        }
        const targetPresetId = cfg?.activeDrawingPresetId;
        if (targetPresetId && targetPresetId !== this.currentPresetItem?.id) {
            this.applyActivePreset(targetPresetId, { persist: false });
        }

        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
                if (payload?.key === 'providers' || !payload?.key) {
                    const freshCfg = settingsStore.getProviderConfig<{
                        serverUrl?: string;
                        apiKey?: string;
                        serviceId?: string;
                    }>('openai');

                    if (freshCfg) {
                        this.connectionCard.setData({
                            serverUrl: freshCfg.serverUrl || 'https://api.openai.com/v1',
                            apiKey: freshCfg.apiKey || '',
                            activePresetId: freshCfg.serviceId || 'openai-official',
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
