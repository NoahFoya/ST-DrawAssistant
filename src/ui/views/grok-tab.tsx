/**
 * xAI Grok 原生生图服务专属设置选项卡视图 (GrokTabView)。
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
    GROK_API_BASE,
    GROK_ASPECT_RATIOS,
    GROK_CUSTOM_SERVICE_ID,
    GROK_MODEL_OPTIONS,
    GROK_OFFICIAL_SERVICE_ID,
    GROK_RESOLUTIONS,
    resolveGrokModelCapabilities,
} from '../../provider/grok/grok-models';

const GROK_PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: GROK_OFFICIAL_SERVICE_ID,
        label: 'xAI Grok 官方',
        defaultUrl: GROK_API_BASE,
    },
    {
        id: GROK_CUSTOM_SERVICE_ID,
        label: '自定义中转 / 代理',
        defaultUrl: '',
    },
];

const ASPECT_RATIO_OPTIONS = GROK_ASPECT_RATIOS.map((ratio) => ({
    label: ratio,
    value: ratio,
}));

const RESOLUTION_OPTIONS = GROK_RESOLUTIONS.map((res) => ({
    label: res.toUpperCase(),
    value: res,
}));

function getEffectiveModel(draft: DrawingPresetData): string {
    return (draft.customModel && draft.customModel.trim()) || draft.baseModel || 'grok-imagine-image';
}

export class GrokTabView extends ProviderTabView {
    public readonly id = 'grok';
    public readonly title = 'xAI Grok';

    public readonly vm: ProviderTabViewModel;
    private readonly modelFields: FieldSchema<DrawingPresetData>[];
    private readonly imageConfigFields: FieldSchema<DrawingPresetData>[];
    private readonly customBodyJson: CustomBodyJsonController;

    public constructor() {
        super('da-tab-pane da-view-grok');

        this.vm = new ProviderTabViewModel({
            provider: 'grok',
            defaultServerUrl: GROK_API_BASE,
            defaultServiceId: GROK_OFFICIAL_SERVICE_ID,
            serviceProfiles: {
                defaultUrls: Object.fromEntries(
                    GROK_PROVIDER_PRESETS.filter((p) => p.defaultUrl).map((p) => [
                        p.id,
                        p.defaultUrl,
                    ])
                ),
            },
            idPrefix: 'grok_',
            promptMessageForNew: '请输入新生图参数预设名称:',
            defaultNewName: '新建预设',
            defaultModels: GROK_MODEL_OPTIONS,
            defaultDraftTemplate: () => ({
                baseModel: 'grok-imagine-image',
                aspectRatio: '1:1',
                resolution: '1k',
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
                if (
                    resolveGrokModelCapabilities(effectiveModel).supportsAspectRatio &&
                    !cfg.aspectRatio
                ) {
                    missing.push('画幅比例');
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
                    toView: (v) => (v as string) || 'grok-imagine-image',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'customModel',
                label: '自定义模型标识',
                type: 'text',
                placeholder: '可选填写模型 ID（如 grok-imagine-image-pro）',
                tooltip: '若填写，将覆盖上方下拉选择并直接使用该模型名称发起请求。',
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

        this.imageConfigFields = [
            {
                key: 'aspectRatio',
                label: '画幅比例',
                type: 'select',
                options: ASPECT_RATIO_OPTIONS,
                tooltip: 'xAI Grok Imagine 原生 aspect_ratio 参数。旧版 grok-2-image 不支持该参数。',
                visibleWhen: (m) =>
                    resolveGrokModelCapabilities(getEffectiveModel(m)).supportsAspectRatio,
                transform: {
                    toView: (v) => (v as string) || '1:1',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'resolution',
                label: '分辨率档位',
                type: 'segmented',
                options: RESOLUTION_OPTIONS,
                tooltip: 'Grok Imagine 支持 1K 与 2K 分辨率档位输出。',
                visibleWhen: (m) =>
                    resolveGrokModelCapabilities(getEffectiveModel(m)).supportsResolution,
                transform: {
                    toView: (v) => (v as string) || '1k',
                    fromView: (v) => String(v),
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
        const capabilities = resolveGrokModelCapabilities(getEffectiveModel(draft));

        return (
            <ProviderTabLayout
                vm={this.vm}
                showApiKey={true}
                apiKeyPlaceholder="输入 xAI API Key (Bearer)"
                urlPlaceholder="https://api.x.ai/v1"
                providerPresets={GROK_PROVIDER_PRESETS}
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

                    {(capabilities.supportsAspectRatio || capabilities.supportsResolution) && (
                        <>
                            <div className="da-section-banner">
                                <span className="da-section-banner__title">原生图像参数</span>
                            </div>

                            <SchemaFieldsView
                                fields={this.imageConfigFields}
                                model={draft}
                                dirtyFields={dirtyFields}
                                invalidFields={invalidFields}
                                onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                            />
                        </>
                    )}
                </CardView>

                <CustomBodyJsonCard
                    controller={this.customBodyJson}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    placeholder={'{\n  "user": "st-draw"\n}'}
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
