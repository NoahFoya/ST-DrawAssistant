/**
 * OpenAI 兼容生图服务专属设置选项卡视图 (OpenAITabView)。
 *
 * @remarks
 * 基于 Preact JSX、ProviderTabLayout 与 ProviderTabViewModel 构建：
 * 1. 顶部服务连接与状态检测卡片 (ConnectionCardView，支持服务商模板与 Bearer Token)；
 * 2. 生图参数预设主控卡片 (CardView + PresetToolbarView)：包含模型选择、画幅比例 (DimensionPickerView) 及 DALL-E 3 / GPT Image 专属参数；
 * 3. 自定义请求参数 JSON 扩展卡片（支持实时语法校验，非法时标红 .is-invalid 并拦截保存）；
 * 4. 底部提示词预设卡片 (PromptPresetCardView，showLoraInPromptManager: false, showNegativeInPromptManager: false)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import type { ProviderPreset } from '../composite/connection-card';
import {
    CardView,
    SchemaFieldsView,
    SchemaFieldRenderer,
    type FieldSchema,
    DimensionPickerView,
    PresetToolbarView,
    PromptPollingPanelView,
} from '../framework';
import {
    DEFAULT_ASPECT_RATIOS,
    GPT_IMAGE_ASPECT_RATIOS,
    OPENAI_ASPECT_RATIOS,
} from '../composite';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout, ProviderTabView } from './provider-tab-layout';
import { CustomBodyJsonCard, CustomBodyJsonController } from './cloud-tab-helpers';
import {
    OPENAI_MODEL_OPTIONS,
    resolveOpenAIModelCapabilities,
} from '../../provider/openai/openai-models';

const OPENAI_QUALITY_OPTIONS = [
    { label: 'standard (标准)', value: 'standard' },
    { label: 'hd (高清)', value: 'hd' },
];

const GPT_IMAGE_QUALITY_OPTIONS = [
    { label: 'auto (自动)', value: 'auto' },
    { label: 'low (低)', value: 'low' },
    { label: 'medium (中)', value: 'medium' },
    { label: 'high (高)', value: 'high' },
];

const GPT_IMAGE_BACKGROUND_OPTIONS = [
    { label: 'auto (自动)', value: 'auto' },
    { label: 'transparent (透明背景)', value: 'transparent' },
    { label: 'opaque (不透明)', value: 'opaque' },
];

const GPT_IMAGE_OUTPUT_FORMAT_OPTIONS = [
    { label: 'png', value: 'png' },
    { label: 'jpeg', value: 'jpeg' },
    { label: 'webp', value: 'webp' },
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
        id: 'siliconflow',
        label: 'SiliconFlow 硅基流动',
        defaultUrl: 'https://api.siliconflow.cn/v1',
    },
    { id: 'custom', label: '自定义服务', defaultUrl: '' },
];

const GPT_IMAGE_QUALITY_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'quality',
    label: '生成画质 (Quality)',
    type: 'select',
    options: GPT_IMAGE_QUALITY_OPTIONS,
    tooltip: 'GPT Image 系列模型画质档位（auto / low / medium / high）。',
    transform: {
        toView: (v) => {
            const s = String(v || '');
            return ['auto', 'low', 'medium', 'high'].includes(s) ? s : 'medium';
        },
        fromView: (v) => String(v),
    },
};

const GPT_IMAGE_BACKGROUND_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'background',
    label: '背景模式 (Background)',
    type: 'select',
    options: GPT_IMAGE_BACKGROUND_OPTIONS,
    tooltip: 'GPT Image 支持生成透明背景图像（需配合 png 或 webp 输出格式）。',
    transform: {
        toView: (v) => (v as string) || 'auto',
        fromView: (v) => String(v),
    },
};

const GPT_IMAGE_OUTPUT_FORMAT_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'outputFormat',
    label: '输出格式 (Output Format)',
    type: 'segmented',
    options: GPT_IMAGE_OUTPUT_FORMAT_OPTIONS,
    tooltip: 'GPT Image 返回图像编码格式（png / jpeg / webp）。',
    transform: {
        toView: (v) => (v as string) || 'png',
        fromView: (v) => String(v),
    },
};

const QUALITY_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'quality',
    label: '生成画质 (Quality)',
    type: 'select',
    options: OPENAI_QUALITY_OPTIONS,
    tooltip:
        'DALL-E 3 官方画质选项。hd（超清）在面部轮廓、文字细节与微小纹理上具有更高的解析度与一致性，单张计费约为标准版两倍；standard（标准）兼顾生成速度与经济性。',
    transform: {
        toView: (v) => {
            const s = String(v || '');
            return s === 'standard' || s === 'hd' ? s : 'standard';
        },
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
    private readonly customBodyJson: CustomBodyJsonController;

    public constructor() {
        super('da-tab-pane da-view-openai');

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
            promptMessageForNew: '请输入新生图参数预设名称:',
            defaultNewName: '新建预设',
            defaultModels: OPENAI_MODEL_OPTIONS,
            defaultDraftTemplate: () => ({
                baseModel: 'dall-e-3',
                width: 1024,
                height: 1024,
                quality: 'standard',
                style: 'vivid',
            }),
            onPresetApplied: (_preset, draft) => {
                this.customBodyJson?.syncFromDraft((draft.customBodyJson as string) || '');
            },
            canPerformAction: (action) => {
                if ((action === 'save' || action === 'saveAs') && this.customBodyJson && !this.customBodyJson.isValid.value) {
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
                if (
                    typeof cfg.width !== 'number' ||
                    !Number.isFinite(cfg.width) ||
                    cfg.width <= 0 ||
                    typeof cfg.height !== 'number' ||
                    !Number.isFinite(cfg.height) ||
                    cfg.height <= 0
                ) {
                    missing.push('画幅尺寸 (宽/高)');
                }
                return missing;
            },
        });

        this.customBodyJson = new CustomBodyJsonController(this.vm.presetController);

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
                    '第三方中转代理、聚合 API 或特殊微调模型的服务标识名（如硅基流动 FLUX、Kolors 等）。若填写，将覆盖默认下拉选择并直接使用该模型名称发起请求。',
                transform: {
                    toView: (v) => (v as string) || '',
                    fromView: (v) => String(v || '').trim(),
                },
            },
            {
                key: 'promptPresetId',
                label: '提示词预设',
                type: 'select',
                options: () => this.vm.promptPresetOptions.value,
                invalidTooltip: (m) => `关联的提示词预设不存在或已失效 (ID: ${m.promptPresetId || ''})`,
            },
        ];

        this.mountPreact();
    }

    protected renderContent(): VNode {
        const { presetController } = this.vm;
        const draft = presetController.draftConfig.value;
        const dirtyFields = presetController.dirtyFields.value;
        const invalidFields = presetController.invalidFields.value;

        const effectiveModel =
            (draft.customModel && draft.customModel.trim()) || draft.baseModel || 'dall-e-3';
        const capabilities = resolveOpenAIModelCapabilities(effectiveModel);
        const isDallE3 = capabilities.family === 'dall-e-3';
        const isGptImage = capabilities.family === 'gpt-image';

        const isDimsDirty = dirtyFields.has('width') || dirtyFields.has('height');

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
                        onImportFiles={(files) => void presetController.handleImportFiles(files)}
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

                    <PromptPollingPanelView vm={this.vm} />

                    <div className="da-section-banner">
                        <span className="da-section-banner__title">分辨率与画幅</span>
                    </div>

                    <DimensionPickerView
                        key={capabilities.family}
                        embedded={true}
                        width={draft.width ?? 1024}
                        height={draft.height ?? 1024}
                        aspectRatios={
                            isGptImage
                                ? GPT_IMAGE_ASPECT_RATIOS
                                : isDallE3
                                    ? OPENAI_ASPECT_RATIOS
                                    : DEFAULT_ASPECT_RATIOS
                        }
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

                    {isGptImage && (
                        <>
                            <div className="da-section-banner">
                                <span className="da-section-banner__title">GPT Image 专属参数</span>
                            </div>

                            <SchemaFieldRenderer
                                schema={GPT_IMAGE_QUALITY_FIELD}
                                model={draft}
                                dirty={dirtyFields.has('quality')}
                                invalid={invalidFields.has('quality')}
                                onChange={(val) =>
                                    presetController.updateDraft('quality', val as DrawingPresetData['quality'])
                                }
                            />
                            <SchemaFieldRenderer
                                schema={GPT_IMAGE_BACKGROUND_FIELD}
                                model={draft}
                                dirty={dirtyFields.has('background')}
                                invalid={invalidFields.has('background')}
                                onChange={(val) =>
                                    presetController.updateDraft('background', val as DrawingPresetData['background'])
                                }
                            />
                            <SchemaFieldRenderer
                                schema={GPT_IMAGE_OUTPUT_FORMAT_FIELD}
                                model={draft}
                                dirty={dirtyFields.has('outputFormat')}
                                invalid={invalidFields.has('outputFormat')}
                                onChange={(val) =>
                                    presetController.updateDraft('outputFormat', val as DrawingPresetData['outputFormat'])
                                }
                            />
                        </>
                    )}
                </CardView>

                <CustomBodyJsonCard
                    controller={this.customBodyJson}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    placeholder={'{\n  "response_format": "b64_json"\n}'}
                />
            </ProviderTabLayout>
        );
    }

    public override activate(): void {
        super.activate();
        this.customBodyJson.syncOnActivate();
    }

    public override hasUnsavedChanges(): boolean {
        return super.hasUnsavedChanges() || !this.customBodyJson.isValid.value;
    }

    public override async saveUnsavedChanges(): Promise<boolean> {
        if (!this.customBodyJson.validateBeforeSave()) {
            return false;
        }
        return await super.saveUnsavedChanges();
    }

    public override discardUnsavedChanges(): void {
        super.discardUnsavedChanges();
        this.customBodyJson.syncFromDraft();
    }
}
