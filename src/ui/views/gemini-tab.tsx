/**
 * Google Gemini 原生生图服务专属设置选项卡视图 (GeminiTabView)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import type { ProviderPreset } from '../composite/connection-card';
import {
    CardView,
    SchemaFieldsView,
    type FieldSchema,
    PresetToolbarView,
    PromptPollingPanelView,
} from '../framework';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout, ProviderTabView } from './provider-tab-layout';
import { CustomBodyJsonCard, CustomBodyJsonController } from './cloud-tab-helpers';
import {
    GEMINI_API_BASE,
    GEMINI_ASPECT_RATIO_OPTIONS,
    GEMINI_CUSTOM_SERVICE_ID,
    GEMINI_MODEL_OPTIONS,
    GEMINI_OFFICIAL_SERVICE_ID,
    buildGeminiImageSizeOptions,
    resolveGeminiModelCapabilities,
} from '../../domain';

const GEMINI_PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: GEMINI_OFFICIAL_SERVICE_ID,
        label: 'Google Gemini 官方',
        defaultUrl: GEMINI_API_BASE,
    },
    {
        id: GEMINI_CUSTOM_SERVICE_ID,
        label: '自定义中转 / 代理',
        defaultUrl: '',
    },
];

const ASPECT_RATIO_OPTIONS = GEMINI_ASPECT_RATIO_OPTIONS;

function getEffectiveModel(draft: DrawingPresetData): string {
    return (draft.customModel && draft.customModel.trim()) || draft.baseModel || 'gemini-2.5-flash-image';
}

export class GeminiTabView extends ProviderTabView {
    public readonly id = 'gemini';
    public readonly title = 'Google Gemini';

    public readonly vm: ProviderTabViewModel;
    private readonly modelFields: FieldSchema<DrawingPresetData>[];
    private readonly imageConfigFields: FieldSchema<DrawingPresetData>[];
    private readonly customBodyJson: CustomBodyJsonController;

    public constructor() {
        super('da-tab-pane da-view-gemini');

        this.vm = new ProviderTabViewModel({
            provider: 'gemini',
            defaultServerUrl: GEMINI_API_BASE,
            defaultServiceId: GEMINI_OFFICIAL_SERVICE_ID,
            serviceProfiles: {
                defaultUrls: Object.fromEntries(
                    GEMINI_PROVIDER_PRESETS.filter((p) => p.defaultUrl).map((p) => [
                        p.id,
                        p.defaultUrl,
                    ])
                ),
            },
            idPrefix: 'gemini_',
            promptMessageForNew: '请输入新生图参数预设名称:',
            defaultNewName: '新建预设',
            defaultModels: GEMINI_MODEL_OPTIONS,
            defaultDraftTemplate: () => ({
                baseModel: 'gemini-2.5-flash-image',
                aspectRatio: '1:1',
            }),
            onPresetApplied: (_preset, draft) => {
                this.customBodyJson?.syncFromDraft((draft.customBodyJson as string) || '');
            },
            canPerformAction: (action) => {
                if ((action === 'save' || action === 'saveAs') && this.customBodyJson && !this.customBodyJson.isValid.value) {
                    return {
                        allowed: false,
                        message: '自定义请求体 JSON 语法格式不正确，无法保存预设。请检查括号与双引号',
                    };
                }
                return { allowed: true };
            },
            validateRequired: (cfg) => {
                const missing: string[] = [];
                const effectiveModel = getEffectiveModel(cfg);
                if (!effectiveModel) missing.push('模型标识 (预置或自定义)');
                if (!cfg.aspectRatio) missing.push('画幅比例');
                return missing;
            },
        });

        this.customBodyJson = new CustomBodyJsonController(this.vm.presetController);

        const syncImageSizeForModel = () => {
            const latest = this.vm.presetController.draftConfig.value;
            const caps = resolveGeminiModelCapabilities(getEffectiveModel(latest));
            if (!caps.supportsImageSize) {
                return;
            }
            const curSize = String(latest.imageSize || '');
            if (curSize.toLowerCase() === 'auto') {
                return;
            }
            if (!curSize && caps.allowsDefaultEmptyImageSize) {
                return;
            }
            if (!caps.supportedImageSizes.includes(curSize)) {
                const fallbackSize = caps.supportedImageSizes.includes('1K')
                    ? '1K'
                    : (caps.supportedImageSizes[0] ?? '1K');
                this.vm.presetController.updateDraft('imageSize', fallbackSize);
            }
        };

        this.modelFields = [
            {
                key: 'baseModel',
                label: '生图模型',
                type: 'select',
                options: () => this.vm.effectiveModelOptions.value,
                transform: {
                    toView: (v) => (v as string) || 'gemini-2.5-flash-image',
                    fromView: (v) => String(v),
                },
                onAfterChange: syncImageSizeForModel,
            },
            {
                key: 'customModel',
                label: '自定义模型标识',
                type: 'text',
                placeholder: '可选填写模型 ID（如 gemini-3.1-flash-image-preview）',
                tooltip: '若填写，将覆盖上方下拉选择并直接使用该模型名称发起请求。',
                transform: {
                    toView: (v) => (v as string) || '',
                    fromView: (v) => String(v || '').trim(),
                },
                onAfterChange: syncImageSizeForModel,
            },
            {
                key: 'promptPresetId',
                label: '提示词预设',
                type: 'select',
                options: () => this.vm.promptPresetOptions.value,
                invalidTooltip: (m) => `关联的提示词预设不存在或已失效 (ID: ${m.promptPresetId || ''})`,
            },
        ];

        this.imageConfigFields = [
            {
                key: 'aspectRatio',
                label: '画幅比例',
                type: 'select',
                options: ASPECT_RATIO_OPTIONS,
                tooltip:
                    'Gemini 原生 imageConfig.aspectRatio 参数；选择「自动」时由模型或参考图自行决定构图比例。',
                transform: {
                    toView: (v) => (v as string) || '1:1',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'imageSize',
                label: '分辨率档位',
                type: 'segmented',
                options: (m) => {
                    const capabilities = resolveGeminiModelCapabilities(getEffectiveModel(m));
                    return buildGeminiImageSizeOptions(capabilities);
                },
                tooltip:
                    '仅部分高阶模型支持该参数（gemini-3.1-flash-image-preview 支持 512px/1K/2K/4K；gemini-3-pro-image-preview 支持 1K/2K/4K）；选用「自动」时不显式传递档位，交由模型默认决定；2.5 Flash Image 自动隐藏。',
                visibleWhen: (m) =>
                    resolveGeminiModelCapabilities(getEffectiveModel(m)).supportsImageSize,
                transform: {
                    toView: (v, m) => {
                        const capabilities = resolveGeminiModelCapabilities(getEffectiveModel(m));
                        const supported = capabilities.supportedImageSizes;
                        const s = String(v || '');
                        if (s.toLowerCase() === 'auto') {
                            return 'auto';
                        }
                        if (capabilities.allowsDefaultEmptyImageSize) {
                            return supported.includes(s) ? s : 'auto';
                        }
                        if (supported.includes(s)) return s;
                        return supported.includes('1K') ? '1K' : (supported[0] ?? '1K');
                    },
                    fromView: (v) => String(v || ''),
                },
            },
        ];

        this.mountPreact();
    }

    protected renderContent(): VNode {
        const { presetController } = this.vm;
        const draft = presetController.draftConfig.value;
        const dirtyFields = presetController.dirtyFields.value;
        const invalidFields = presetController.invalidFields.value;

        return (
            <ProviderTabLayout
                vm={this.vm}
                showApiKey={true}
                apiKeyPlaceholder="输入 Google AI Studio API Key"
                apiKeyTooltip="Gemini 原生接口使用 x-goog-api-key 请求头进行鉴权。"
                urlPlaceholder="https://generativelanguage.googleapis.com/v1beta"
                providerPresets={GEMINI_PROVIDER_PRESETS}
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
                        <span className="da-section-banner__title">原生图像参数 (imageConfig)</span>
                    </div>

                    <SchemaFieldsView
                        fields={this.imageConfigFields}
                        model={draft}
                        dirtyFields={dirtyFields}
                        invalidFields={invalidFields}
                        onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                    />
                </CardView>

                <CustomBodyJsonCard
                    controller={this.customBodyJson}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    placeholder={'{\n  "safetySettings": []\n}'}
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
