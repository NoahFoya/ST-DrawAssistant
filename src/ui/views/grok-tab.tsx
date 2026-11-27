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
    PromptPollingPanelView,
} from '../framework';
import { PresetToolbar } from '../composite';
import { ProviderTabState, CustomBodyJsonController } from '../state';
import { ProviderTabLayout, createProviderTabView } from './provider-tab-layout';
import { CustomBodyJsonCard } from './cloud-tab-helpers';
import {
    GROK_API_BASE,
    GROK_ASPECT_RATIO_OPTIONS,
    GROK_MODEL_OPTIONS,
    GROK_OFFICIAL_SERVICE_ID,
    GROK_RESOLUTIONS,
    getProviderServiceProfileRules,
    getProviderServiceProfiles,
    resolveGrokModelCapabilities,
} from '../../domain';

const GROK_PROVIDER_PRESETS: ProviderPreset[] = [...getProviderServiceProfiles('grok')];

const ASPECT_RATIO_OPTIONS = GROK_ASPECT_RATIO_OPTIONS;

const RESOLUTION_OPTIONS = GROK_RESOLUTIONS.map((res) => ({
    label: res.toUpperCase(),
    value: res,
}));

function getEffectiveModel(draft: DrawingPresetData): string {
    return (draft.customModel && draft.customModel.trim()) || draft.baseModel || 'grok-imagine-image';
}

export function GrokTab(props: {
    vm: ProviderTabState;
    modelFields: FieldSchema<DrawingPresetData>[];
    imageConfigFields: FieldSchema<DrawingPresetData>[];
    customBodyJson: CustomBodyJsonController;
}): VNode {
    const { vm, modelFields, imageConfigFields, customBodyJson } = props;
    const { presetController } = vm;
    const draft = presetController.draftConfig.value;
    const dirtyFields = presetController.dirtyFields.value;
    const invalidFields = presetController.invalidFields.value;
    const capabilities = resolveGrokModelCapabilities(getEffectiveModel(draft));

    return (
        <ProviderTabLayout
            vm={vm}
            showApiKey={true}
            apiKeyPlaceholder="输入 xAI API Key (Bearer)"
            urlPlaceholder="https://api.x.ai/v1"
            providerPresets={GROK_PROVIDER_PRESETS}
            showWorkflowManager={false}
            showLoraInPromptManager={false}
            showNegativeInPromptManager={false}
        >
            <CardView title="生图配置">
                <PresetToolbar
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
                    fields={modelFields}
                    model={draft}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                />

                <PromptPollingPanelView vm={vm} />

                {(capabilities.supportsAspectRatio || capabilities.supportsResolution) && (
                    <>
                        <div className="da-section-banner">
                            <span className="da-section-banner__title">原生图像参数</span>
                        </div>

                        <SchemaFieldsView
                            fields={imageConfigFields}
                            model={draft}
                            dirtyFields={dirtyFields}
                            invalidFields={invalidFields}
                            onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                        />
                    </>
                )}
            </CardView>

            <CustomBodyJsonCard
                controller={customBodyJson}
                dirtyFields={dirtyFields}
                invalidFields={invalidFields}
                placeholder={'{\n  "user": "st-draw"\n}'}
            />
        </ProviderTabLayout>
    );
}

export function createGrokTabView() {
    let customBodyJson: CustomBodyJsonController | null = null;

    const grokRules = getProviderServiceProfileRules('grok');
    const vm = new ProviderTabState({
        provider: 'grok',
        defaultServerUrl: GROK_API_BASE,
        defaultServiceId: GROK_OFFICIAL_SERVICE_ID,
        serviceProfiles: {
            defaultUrls: { ...(grokRules?.defaultUrls || {}) },
        },
        idPrefix: 'grok_',
        promptMessageForNew: '请输入新生图参数预设名称:',
        defaultNewName: '新建预设',
        defaultModels: GROK_MODEL_OPTIONS,
        defaultDraftTemplate: () => ({
            baseModel: 'grok-imagine-image',
            aspectRatio: 'auto',
            resolution: '1k',
        }),
        onPresetApplied: (_preset, draft) => {
            customBodyJson?.syncFromDraft((draft.customBodyJson as string) || '');
        },
        canPerformAction: (action) => {
            if ((action === 'save' || action === 'saveAs') && customBodyJson && !customBodyJson.isValid.value) {
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

    customBodyJson = new CustomBodyJsonController(vm.presetController);

    const modelFields: FieldSchema<DrawingPresetData>[] = [
        {
            key: 'baseModel',
            label: '生图模型',
            type: 'select',
            options: () => vm.effectiveModelOptions.value,
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
            tooltip:
                '出图时自动附加在画面描述前后的画风与构图补充预设（也支持多预设随机轮询）。如果希望完全按剧情指令或原句出图，选「未选择提示词预设」留空即可。',
            options: () => vm.promptPresetOptions.value,
            invalidTooltip: (m) => `关联的提示词预设不存在或已失效 (ID: ${m.promptPresetId || ''})`,
        },
    ];

    const imageConfigFields: FieldSchema<DrawingPresetData>[] = [
        {
            key: 'aspectRatio',
            label: '画幅比例',
            type: 'select',
            options: ASPECT_RATIO_OPTIONS,
            tooltip:
                'xAI Grok Imagine 原生 aspect_ratio 参数（选择「自动」时由模型决定构图）。旧版 grok-2-image 不支持该参数。',
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

    return createProviderTabView({
        id: 'grok',
        title: 'xAI Grok',
        className: 'da-tab-pane da-view-grok',
        vm,
        customBodyJson,
        render: () => (
            <GrokTab
                vm={vm}
                modelFields={modelFields}
                imageConfigFields={imageConfigFields}
                customBodyJson={customBodyJson!}
            />
        ),
    });
}
