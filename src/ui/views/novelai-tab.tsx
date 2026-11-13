/**
 * NovelAI 生图服务专属设置选项卡视图 (NovelAITabView)。
 *
 * @remarks
 * 基于 Preact JSX、ProviderTabLayout、SchemaCard 与 ProviderTabViewModel 构建：
 * 1. 顶部服务连接与状态检测卡片 (ConnectionCardView，支持官方/自定义预设切换与 Bearer Token)；
 * 2. 生图预设主控卡片 (CardView + PresetToolbarView)：包含模型与画质参数 (SchemaFieldsView)、画幅尺寸 (DimensionPickerView)、采样控制 (SamplerCardView) 与 CFG Rescale；
 * 3. V3 模型高级特性卡片 (SchemaCard，仅 V3 系列模型时渲染 SMEA 选项)；
 * 4. 底部提示词预设卡片 (PromptPresetCardView，showLoraInPromptManager: false)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    PreactSettingsView,
    CardView,
    SchemaCard,
    SchemaFieldsView,
    SchemaFieldRenderer,
    type FieldSchema,
    DimensionPickerView,
    SamplerCardView,
    NOVELAI_RANGE_CONFIG,
    PresetToolbarView,
} from '../framework';
import type { ProviderPreset } from '../composite/connection-card';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout } from './provider-tab-layout';
import {
    NOVELAI_OFFICIAL_SERVICE_ID,
    NOVELAI_CUSTOM_SERVICE_ID,
    NOVELAI_IMAGE_HOST,
    OFFICIAL_NOVELAI_MODELS,
    formatNovelAIModelLabel,
    resolveNovelAIModelFamily,
} from '../../provider/novelai/novelai-models';

const NOVELAI_PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: NOVELAI_OFFICIAL_SERVICE_ID,
        label: 'NovelAI 官方',
        defaultUrl: NOVELAI_IMAGE_HOST,
        urlEditable: false,
    },
    {
        id: NOVELAI_CUSTOM_SERVICE_ID,
        label: '自定义服务',
        defaultUrl: '',
        urlEditable: true,
    },
];

const SMEA_MODE_OPTIONS = [
    { label: 'SMEA + DYN (动态增强)', value: 'smea_dyn' },
    { label: 'SMEA (采样增强)', value: 'smea' },
    { label: 'None (关闭)', value: 'none' },
];

const NOVELAI_SAMPLER_OPTIONS = [
    { label: 'k_euler', value: 'k_euler' },
    { label: 'k_euler_ancestral', value: 'k_euler_ancestral' },
    { label: 'k_dpmpp_2s_ancestral', value: 'k_dpmpp_2s_ancestral' },
    { label: 'k_dpmpp_2m', value: 'k_dpmpp_2m' },
    { label: 'k_dpmpp_sde', value: 'k_dpmpp_sde' },
    { label: 'ddim', value: 'ddim' },
];

const CFG_RESCALE_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'cfgRescale',
    label: 'CFG 重缩放 (CFG Rescale)',
    type: 'slider',
    min: 0.0,
    max: 1.0,
    step: 0.02,
    defaultValue: 0.0,
    precision: 2,
    tooltip:
        'CFG 动态重缩放 (Rescale)。高引导系数下用于平衡色彩，有效防止画面过饱和、高光过曝或边缘发焦（推荐 0.0~0.4）。',
    transform: {
        toView: (v) => Number(v ?? 0.0),
        fromView: (v) => Number(v),
    },
};

export class NovelAITabView extends PreactSettingsView {
    public readonly id = 'novelai';
    public readonly title = 'NovelAI';

    public readonly vm: ProviderTabViewModel;
    private readonly modelFields: FieldSchema<DrawingPresetData>[];
    private readonly advancedFields: FieldSchema<DrawingPresetData>[];

    public constructor() {
        super('da-tab-pane da-view-novelai');

        this.vm = new ProviderTabViewModel({
            provider: 'novelai',
            defaultServerUrl: NOVELAI_IMAGE_HOST,
            defaultServiceId: NOVELAI_OFFICIAL_SERVICE_ID,
            idPrefix: 'novelai_',
            promptMessageForNew: '请输入新生图预设名称:',
            defaultNewName: '新建预设',
            defaultModels: OFFICIAL_NOVELAI_MODELS.map((id) => ({
                label: formatNovelAIModelLabel(id),
                value: id,
            })),
            serviceProfiles: {
                fixedUrls: {
                    [NOVELAI_OFFICIAL_SERVICE_ID]: NOVELAI_IMAGE_HOST,
                },
            },
            defaultSamplers: NOVELAI_SAMPLER_OPTIONS,
            validateRequired: (cfg) => {
                const missing: string[] = [];
                const effectiveModel =
                    (cfg.customModel && cfg.customModel.trim()) || cfg.baseModel;
                if (!effectiveModel) missing.push('生图模型 (预置或自定义)');
                if (!cfg.width || !cfg.height) missing.push('画幅尺寸 (宽/高)');
                if (!cfg.samplerName) missing.push('采样算法');
                if (cfg.steps === undefined || cfg.steps === null || Number.isNaN(cfg.steps)) {
                    missing.push('采样步数');
                }
                if (
                    cfg.cfgScale === undefined ||
                    cfg.cfgScale === null ||
                    Number.isNaN(cfg.cfgScale)
                ) {
                    missing.push('提示词引导系数 (CFG)');
                }
                return missing;
            },
        });

        this.modelFields = [
            {
                key: 'baseModel',
                label: '生图模型',
                type: 'select',
                options: () => this.vm.effectiveModelOptions.value,
                transform: {
                    toView: (v) => (v as string) || 'nai-diffusion-4-5-full',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'customModel',
                label: '自定义模型标识',
                type: 'text',
                placeholder: '可选填写第三方端点模型标识（若填写将覆盖上述下拉选项）',
                tooltip:
                    '第三方反向代理或第三方兼容服务端自建的模型标识名。若填写，将覆盖默认预置下拉选项并以此名称向服务端发起请求。',
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
            },
            {
                key: 'convertSyntax',
                label: '权重语法自动转换',
                type: 'switch',
                tooltip:
                    '开启后自动将 SD 惯用的圆括号权重语法（如 (masterpiece:1.2)）转换为 NovelAI 专有的花括号增强语法（如 {masterpiece}），防止模型误解析权重数值。',
                transform: {
                    toView: (v) => v !== false,
                    fromView: (v) => Boolean(v),
                },
            },
        ];

        this.advancedFields = [
            {
                key: 'smeaMode',
                label: 'SMEA 采样增强 (SMEA)',
                type: 'select',
                options: SMEA_MODE_OPTIONS,
                tooltip:
                    '正弦采样与动态特征增强算法（仅支持 V3 架构模型）。在大分辨率（如 1024×1024 以上）生成时，能显著抑制多头、多肢体或构图杂乱；V4/V4.5 模型已原生优化，无需开启。',
                disabledWhen: (m) => {
                    const effectiveModel =
                        (m.customModel && String(m.customModel).trim()) ||
                        m.baseModel ||
                        'nai-diffusion-4-5-full';
                    return resolveNovelAIModelFamily(effectiveModel) !== 'v3';
                },
                transform: {
                    toView: (v) => (v as string) || 'smea_dyn',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'decrisper',
                label: '焦黑抑制 (Decrisper)',
                type: 'switch',
                tooltip:
                    '高频噪点平滑技术。通过衰减极端像素极值，有效消除高对比度边缘产生的焦黑噪点与过锐化伪影。',
            },
        ];

        this.mountPreact();
    }

    protected renderContent(): VNode {
        const { presetController } = this.vm;
        const draft = presetController.draftConfig.value;
        const dirtyFields = presetController.dirtyFields.value;
        const invalidFields = presetController.invalidFields.value;

        const isDimsDirty = dirtyFields.has('width') || dirtyFields.has('height');
        const isSamplerDirty =
            dirtyFields.has('samplerName') ||
            dirtyFields.has('steps') ||
            dirtyFields.has('cfgScale') ||
            dirtyFields.has('seed');

        const effectiveModel =
            (draft.customModel && String(draft.customModel).trim()) ||
            draft.baseModel ||
            'nai-diffusion-4-5-full';
        const isV3Model = resolveNovelAIModelFamily(effectiveModel) === 'v3';

        return (
            <ProviderTabLayout
                vm={this.vm}
                connectionTitle="服务连接"
                showApiKey={true}
                providerPresets={NOVELAI_PROVIDER_PRESETS}
                presetLabel="服务商"
                presetTooltip="选择使用 NovelAI 官方云端服务或第三方反代/中转端点"
                urlPlaceholder="例如 https://example.com/novelai"
                showWorkflowManager={false}
                showLoraInPromptManager={false}
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
                        <span className="da-section-banner__title">模型与画质</span>
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
                        width={draft.width || 832}
                        height={draft.height || 1216}
                        alignMultiple={64}
                        dirty={isDimsDirty}
                        onChange={(dims) =>
                            presetController.patchDraft({
                                width: dims.width,
                                height: dims.height,
                            })
                        }
                    />

                    <div className="da-section-banner">
                        <span className="da-section-banner__title">采样与步数</span>
                    </div>

                    <SamplerCardView
                        embedded={true}
                        showScheduler={false}
                        rangeConfig={NOVELAI_RANGE_CONFIG}
                        samplers={this.vm.samplerOptions.value}
                        dirty={isSamplerDirty}
                        data={{
                            samplerName: draft.samplerName || 'k_euler',
                            steps: draft.steps ?? 28,
                            cfgScale: draft.cfgScale ?? 5.0,
                            seed: draft.seed ?? -1,
                        }}
                        onChange={(s) =>
                            presetController.patchDraft({
                                samplerName: s.samplerName,
                                steps: s.steps,
                                cfgScale: s.cfgScale,
                                seed: s.seed,
                            })
                        }
                    />
                    <SchemaFieldRenderer
                        schema={CFG_RESCALE_FIELD}
                        model={draft}
                        dirty={dirtyFields.has('cfgRescale')}
                        invalid={invalidFields.has('cfgRescale')}
                        onChange={(val) => presetController.updateDraft('cfgRescale', val as number | undefined)}
                    />
                </CardView>

                {isV3Model && (
                    <SchemaCard
                        schema={{
                            id: 'novelai-advanced',
                            title: '高级特性 (V3 架构遗留)',
                            fields: this.advancedFields,
                        }}
                        model={draft}
                        dirtyFields={dirtyFields}
                        invalidFields={invalidFields}
                        onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                    />
                )}
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
