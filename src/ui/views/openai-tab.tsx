/**
 * OpenAI 兼容生图服务专属设置选项卡视图 (OpenAITabView)。
 *
 * @remarks
 * 基于 Preact JSX、ProviderTabLayout 与 ProviderTabViewModel 构建：
 * 1. 顶部服务连接与状态检测卡片 (ConnectionCardView，支持服务商模板与 Bearer Token)；
 * 2. 生图预设主控卡片 (CardView + PresetToolbarView)：包含模型选择、画幅比例 (DimensionPickerView) 及 DALL-E 3 专属 quality/style；
 * 3. 自定义请求参数 JSON 扩展卡片（支持实时语法校验，非法时标红 .is-invalid 并拦截保存）；
 * 4. 底部提示词预设卡片 (PromptPresetCardView，showLoraInPromptManager: false, showNegativeInPromptManager: false)。
 */

import { signal, type Signal } from '@preact/signals';
import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import type { ProviderPreset } from '../composite/connection-card';
import {
    CardView,
    SchemaFieldsView,
    SchemaFieldRenderer,
    TextareaControl,
    type FieldSchema,
    DimensionPickerView,
    OPENAI_ASPECT_RATIOS,
    PresetToolbarView,
} from '../framework';
import { Toast } from '../feedback/toast';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout, ProviderTabView } from './provider-tab-layout';

const OPENAI_MODEL_OPTIONS = [
    { label: 'dall-e-3', value: 'dall-e-3' },
    { label: 'dall-e-2', value: 'dall-e-2' },
    { label: 'gpt-image-1', value: 'gpt-image-1' },
    { label: 'gemini-2.5-flash-image', value: 'gemini-2.5-flash-image' },
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
        label: 'OpenAI 官方',
        defaultUrl: 'https://api.openai.com/v1',
    },
    {
        id: 'google-gemini',
        label: 'Google Gemini',
        defaultUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    {
        id: 'siliconflow',
        label: 'SiliconFlow 硅基流动',
        defaultUrl: 'https://api.siliconflow.cn/v1',
    },
    { id: 'custom', label: '自定义服务', defaultUrl: '' },
];

const QUALITY_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'quality',
    label: '生成画质 (Quality)',
    type: 'select',
    options: OPENAI_QUALITY_OPTIONS,
    tooltip:
        'DALL-E 3 官方画质选项。hd（超清）在面部轮廓、文字细节与微小纹理上具有更高的解析度与一致性，单张计费约为标准版两倍；standard（标准）兼顾生成速度与经济性。',
    transform: {
        toView: (v) => (v as string) || 'standard',
        fromView: (v) => String(v),
    },
};

const STYLE_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'style',
    label: '画面风格 (Style)',
    type: 'select',
    options: OPENAI_STYLE_OPTIONS,
    tooltip:
        'DALL-E 3 画面风格选项。vivid（鲜明生动）具有更高饱和度、强烈戏剧光影与超现实艺术张力；natural（自然写实）色彩更柔和真实，类似相机直接拍摄的质感。',
    transform: {
        toView: (v) => (v as string) || 'vivid',
        fromView: (v) => String(v),
    },
};

export class OpenAITabView extends ProviderTabView {
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
            serviceProfiles: {
                defaultUrls: Object.fromEntries(
                    OPENAI_PROVIDER_PRESETS.filter((p) => p.defaultUrl).map((p) => [
                        p.id,
                        p.defaultUrl,
                    ])
                ),
            },
            idPrefix: 'openai_',
            promptMessageForNew: '请输入新生图预设名称:',
            defaultNewName: '新建预设',
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
                            '自定义请求体 JSON 语法格式不正确，无法保存预设。请检查括号与双引号',
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

        // 初始化同步当前预设的 customBodyJson
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
                tooltip:
                    '第三方中转代理、聚合 API 或特殊微调模型的服务标识名（如硅基流动 FLUX、Kolors 等）。若填写，将覆盖默认下拉选择并直接写入请求体 model 字段。',
                transform: {
                    toView: (v) => (v as string) || '',
                    fromView: (v) => String(v || '').trim(),
                },
            },
            {
                key: 'promptPresetId',
                label: '提示词预设',
                type: 'select',
                placeholder: '选择关联提示词预设',
                options: () => this.vm.promptPresetOptions.value,
                invalidTooltip: (m) => `关联的提示词预设不存在或已失效 (ID: ${m.promptPresetId || ''})`,
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
            const parsed: unknown = JSON.parse(trimmed);
            const isPlainObject =
                parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
            this.isJsonValid.value = isPlainObject;
            this.vm.presetController.setFieldInvalid('customBodyJson', !isPlainObject);
            return isPlainObject;
        } catch {
            this.isJsonValid.value = false;
            this.vm.presetController.setFieldInvalid('customBodyJson', true);
            return false;
        }
    }

    private handleJsonInput(raw: string): void {
        this.rawJsonInput.value = raw;
        this.checkJsonValidity(raw);
        this.vm.presetController.updateDraft('customBodyJson', raw.trim());
    }

    protected renderContent(): VNode {
        const { presetController } = this.vm;
        const draft = presetController.draftConfig.value;
        const dirtyFields = presetController.dirtyFields.value;
        const invalidFields = presetController.invalidFields.value;

        const effectiveModel =
            (draft.customModel && draft.customModel.trim()) || draft.baseModel || 'dall-e-3';
        const isDallE3 = effectiveModel.toLowerCase().includes('dall-e-3');

        const isDimsDirty = dirtyFields.has('width') || dirtyFields.has('height');
        const isJsonDirty = dirtyFields.has('customBodyJson');
        const isJsonInvalid = !this.isJsonValid.value || invalidFields.has('customBodyJson');

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
                        <span className="da-section-banner__title">分辨率与画幅</span>
                    </div>

                    <DimensionPickerView
                        embedded={true}
                        width={draft.width || 1024}
                        height={draft.height || 1024}
                        aspectRatios={OPENAI_ASPECT_RATIOS}
                        alignMultiple={8}
                        dirty={isDimsDirty}
                        onChange={(dims) =>
                            presetController.patchDraft({
                                width: dims.width,
                                height: dims.height,
                            })
                        }
                    />

                    {isDallE3 && (
                        <>
                            <div className="da-section-banner">
                                <span className="da-section-banner__title">画质与风格 (DALL-E 3)</span>
                            </div>

                            <SchemaFieldRenderer
                                schema={QUALITY_FIELD}
                                model={draft}
                                dirty={dirtyFields.has('quality')}
                                invalid={invalidFields.has('quality')}
                                onChange={(val) =>
                                    presetController.updateDraft('quality', val as DrawingPresetData['quality'])
                                }
                            />
                            <SchemaFieldRenderer
                                schema={STYLE_FIELD}
                                model={draft}
                                dirty={dirtyFields.has('style')}
                                invalid={invalidFields.has('style')}
                                onChange={(val) =>
                                    presetController.updateDraft('style', val as DrawingPresetData['style'])
                                }
                            />
                        </>
                    )}
                </CardView>

                <CardView title="自定义请求参数 (JSON)">
                    <div className="da-textarea-row">
                        <div className="da-textarea-header">
                            <label className="da-field-label">JSON 附加参数</label>
                            <span className="da-field-help">
                                可选填入合法 JSON 对象，生图请求时将合并至请求体顶层
                            </span>
                        </div>
                        <TextareaControl
                            className="da-custom-body-json"
                            monospace
                            rows={4}
                            dirty={isJsonDirty}
                            invalid={isJsonInvalid}
                            placeholder={'{\n  "response_format": "b64_json"\n}'}
                            value={this.rawJsonInput.value}
                            onChange={(val) => this.handleJsonInput(val)}
                            onBlur={(val) => this.handleJsonInput(val)}
                        />
                    </div>
                </CardView>
            </ProviderTabLayout>
        );
    }

    public override hasUnsavedChanges(): boolean {
        return super.hasUnsavedChanges() || !this.isJsonValid.value;
    }

    public override async saveUnsavedChanges(): Promise<boolean> {
        if (!this.isJsonValid.value) {
            Toast.show('自定义请求参数 (JSON) 语法无效，请修正后再保存', { level: 'error' });
            return false;
        }
        return await super.saveUnsavedChanges();
    }

    public override discardUnsavedChanges(): void {
        super.discardUnsavedChanges();
        const restored = this.vm.presetController.draftConfig.value.customBodyJson || '';
        this.rawJsonInput.value = restored;
        this.checkJsonValidity(restored);
    }
}
