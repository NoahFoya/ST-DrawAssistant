/**
 * OpenAI 兼容绘图服务专属设置选项卡视图 (OpenAITabView)。
 *
 * @remarks
 * 基于 Preact JSX、SchemaCard 与 ProviderTabViewModel 构建：
 * 1. 服务连接与状态探测卡片 (ConnectionCardView，支持服务商模板与 Bearer Token)；
 * 2. 预设方案主控工具栏 (PresetToolbarView)；
 * 3. 生图模型与提示词方案卡片 (SchemaCard)；
 * 4. 画幅规格与渲染档位卡片 (DimensionPickerView + quality/style)；
 * 5. 自定义请求体 JSON 扩展卡片（实时语法校验，非法时标红 .is-invalid 并拦截保存）；
 * 6. 提示词预设方案卡片 (PromptPresetCardView，showLora: false, showNegativePrompt: false)。
 */

import { signal, type Signal } from '@preact/signals';
import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import type { ProviderPreset } from '../composite/connection-card';
import {
    PreactSettingsView,
    CardView,
    SchemaFieldsView,
    SchemaFieldRenderer,
    type FieldSchema,
    DimensionPickerView,
    PresetToolbarView,
} from '../framework';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout } from './provider-tab-layout';

const OPENAI_MODEL_OPTIONS = [
    { label: 'dall-e-3', value: 'dall-e-3' },
    { label: 'dall-e-2', value: 'dall-e-2' },
    { label: 'black-forest-labs/FLUX.1-schnell', value: 'black-forest-labs/FLUX.1-schnell' },
    { label: 'black-forest-labs/FLUX.1-dev', value: 'black-forest-labs/FLUX.1-dev' },
    { label: 'Kwai-Kolors/Kolors', value: 'Kwai-Kolors/Kolors' },
];

const OPENAI_QUALITY_OPTIONS = [
    { label: 'standard (标准)', value: 'standard' },
    { label: 'hd (高清)', value: 'hd' },
];

const OPENAI_STYLE_OPTIONS = [
    { label: 'vivid (生动)', value: 'vivid' },
    { label: 'natural (写实)', value: 'natural' },
];

const OPENAI_PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: 'openai-official',
        label: 'OpenAI 官方 (https://api.openai.com/v1)',
        defaultUrl: 'https://api.openai.com/v1',
    },
    {
        id: 'siliconflow',
        label: 'SiliconFlow 硅基流动 (https://api.siliconflow.cn/v1)',
        defaultUrl: 'https://api.siliconflow.cn/v1',
    },
    { id: 'custom', label: '自定义中转或自建代理', defaultUrl: '' },
];

const QUALITY_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'quality',
    label: '渲染画质档位',
    type: 'select',
    options: OPENAI_QUALITY_OPTIONS,
    tooltip: 'DALL-E 3 官方画质选项。hd (超清) 具有更高的渲染精细度与细节一致性',
    transform: {
        toView: (v) => (v as string) || 'standard',
        fromView: (v) => String(v),
    },
};

const STYLE_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'style',
    label: '画面风格模式',
    type: 'select',
    options: OPENAI_STYLE_OPTIONS,
    tooltip:
        'DALL-E 3 官方风格选项。vivid (鲜明生动) 色彩饱和且极具戏剧感，natural (自然写实) 柔和写实',
    transform: {
        toView: (v) => (v as string) || 'vivid',
        fromView: (v) => String(v),
    },
};

export class OpenAITabView extends PreactSettingsView {
    public readonly id = 'openai';
    public readonly title = 'OpenAI 兼容';

    public readonly vm: ProviderTabViewModel;
    private readonly modelFields: FieldSchema<DrawingPresetData>[];

    /** 自定义请求体文本框当前输入内容 */
    private readonly rawJsonInput: Signal<string>;
    /** 自定义请求体 JSON 语法是否有效 */
    private readonly isJsonValid: Signal<boolean>;

    public constructor() {
        super('da-tab-pane da-view-openai');

        this.rawJsonInput = signal<string>('');
        this.isJsonValid = signal<boolean>(true);

        this.vm = new ProviderTabViewModel({
            provider: 'openai',
            defaultServerUrl: 'https://api.openai.com/v1',
            defaultServiceId: 'openai-official',
            idPrefix: 'openai_',
            promptMessageForNew: '请输入新方案名称:',
            defaultNewName: '新 OpenAI 兼容方案',
            defaultModels: OPENAI_MODEL_OPTIONS,
            onPresetApplied: (_preset, draft) => {
                const nextJson = (draft.customBodyJson as string) || '';
                this.rawJsonInput.value = nextJson;
                this.checkJsonValidity(nextJson);
            },
            canPerformAction: (action) => {
                if (
                    (action === 'new' || action === 'save' || action === 'saveAs') &&
                    !this.isJsonValid.value
                ) {
                    return {
                        allowed: false,
                        message:
                            '自定义请求体 JSON 语法格式不正确，无法保存方案。请检查括号与双引号',
                    };
                }
                return { allowed: true };
            },
            validateRequired: (cfg) => {
                const missing: string[] = [];
                const effectiveModel =
                    (cfg.customModel && cfg.customModel.trim()) || cfg.baseModel;
                if (!effectiveModel) missing.push('模型标识 (预置或自定义)');
                if (!cfg.width || !cfg.height) missing.push('画幅尺寸 (宽/高)');
                return missing;
            },
        });

        // 初始化同步当前方案的 customBodyJson
        const initialJson =
            (this.vm.presetController.draftConfig.value.customBodyJson as string) || '';
        this.rawJsonInput.value = initialJson;
        this.checkJsonValidity(initialJson);

        this.modelFields = [
            {
                key: 'baseModel',
                label: '生图模型',
                type: 'select',
                options: () => this.vm.effectiveModelOptions.value,
                transform: {
                    toView: (v) => (v as string) || 'dall-e-3',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'customModel',
                label: '自定义模型标识',
                type: 'text',
                placeholder: '可选填写非标或中转模型标识（若填写将覆盖上述下拉选项）',
                tooltip: '第三方中转代理或微调模型专用名称。若填写，生图时将优先采用此标识',
                transform: {
                    toView: (v) => (v as string) || '',
                    fromView: (v) => String(v || '').trim(),
                },
            },
            {
                key: 'promptPresetId',
                label: '提示词预设',
                type: 'select',
                placeholder: '选择关联提示词预设方案',
                options: () => this.vm.promptPresetOptions.value,
            },
        ];

        this.mountPreact();
    }

    private checkJsonValidity(raw: string): boolean {
        const trimmed = raw.trim();
        if (!trimmed) {
            this.isJsonValid.value = true;
            this.vm.presetController.setFieldInvalid('customBodyJson', false);
            return true;
        }
        try {
            JSON.parse(trimmed);
            this.isJsonValid.value = true;
            this.vm.presetController.setFieldInvalid('customBodyJson', false);
            return true;
        } catch {
            this.isJsonValid.value = false;
            this.vm.presetController.setFieldInvalid('customBodyJson', true);
            return false;
        }
    }

    private handleJsonInput(raw: string): void {
        this.rawJsonInput.value = raw;
        if (this.checkJsonValidity(raw)) {
            this.vm.presetController.updateDraft('customBodyJson', raw.trim());
        }
    }

    protected renderContent(): VNode {
        const { presetController } = this.vm;
        const draft = presetController.draftConfig.value;
        const dirtyFields = presetController.dirtyFields.value;
        const invalidFields = presetController.invalidFields.value;

        const isDimsDirty = dirtyFields.has('width') || dirtyFields.has('height');
        const isJsonDirty = dirtyFields.has('customBodyJson');
        const isJsonInvalid = !this.isJsonValid.value || invalidFields.has('customBodyJson');

        const textareaClasses = [
            'da-textarea',
            'da-custom-body-json',
            isJsonDirty ? 'is-dirty' : '',
            isJsonInvalid ? 'is-invalid' : '',
        ]
            .filter(Boolean)
            .join(' ');

        return (
            <ProviderTabLayout
                vm={this.vm}
                showApiKey={true}
                providerPresets={OPENAI_PROVIDER_PRESETS}
                showWorkflowManager={false}
                showLoraInPromptManager={false}
                showNegativeInPromptManager={false}
            >
                <CardView title="生图配置">
                    <PresetToolbarView
                        presets={presetController.toolbarItems.value}
                        activePresetId={presetController.activePresetId.value}
                        dirty={presetController.isDirty.value}
                        onAction={(action, id) => presetController.handleAction(action, id)}
                        onImportFile={(file) => presetController.handleImportFile(file)}
                    />

                    <div className="da-section-banner">
                        <span className="da-section-banner__title">生图模型</span>
                    </div>

                    <SchemaFieldsView
                        fields={this.modelFields}
                        model={draft}
                        dirtyFields={dirtyFields}
                        invalidFields={invalidFields}
                        onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                    />

                    <div className="da-section-banner">
                        <span className="da-section-banner__title">画幅尺寸与比例</span>
                    </div>

                    <DimensionPickerView
                        embedded={true}
                        width={draft.width || 1024}
                        height={draft.height || 1024}
                        dirty={isDimsDirty}
                        onChange={(dims) =>
                            presetController.patchDraft({
                                width: dims.width,
                                height: dims.height,
                            })
                        }
                    />

                    <div className="da-section-banner">
                        <span className="da-section-banner__title">画质与风格 (DALL-E 3)</span>
                    </div>

                    <SchemaFieldRenderer
                        schema={QUALITY_FIELD}
                        model={draft}
                        dirty={dirtyFields.has('quality')}
                        invalid={invalidFields.has('quality')}
                        onChange={(val) => presetController.updateDraft('quality', val)}
                    />
                    <SchemaFieldRenderer
                        schema={STYLE_FIELD}
                        model={draft}
                        dirty={dirtyFields.has('style')}
                        invalid={invalidFields.has('style')}
                        onChange={(val) => presetController.updateDraft('style', val)}
                    />
                </CardView>

                <CardView title="自定义请求体 JSON 扩展">
                    <div className="da-form-row">
                        <div className="da-form-label">JSON 扩展参数</div>
                        <textarea
                            className={textareaClasses}
                            rows={4}
                            placeholder={'{\n  "response_format": "b64_json"\n}'}
                            value={this.rawJsonInput.value}
                            onInput={(e) =>
                                this.handleJsonInput(
                                    (e.currentTarget as HTMLTextAreaElement).value
                                )
                            }
                            onBlur={(e) =>
                                this.handleJsonInput(
                                    (e.currentTarget as HTMLTextAreaElement).value
                                )
                            }
                        />
                    </div>
                </CardView>
            </ProviderTabLayout>
        );
    }

    public override activate(): void {
        this.vm.activate();
    }

    public override deactivate(): void {
        this.vm.deactivate();
    }

    public override dispose(): void {
        this.vm.dispose();
        super.dispose();
    }
}
