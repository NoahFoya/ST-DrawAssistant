/**
 * NovelAI 生图服务专属设置选项卡视图 (NovelAITabView)。
 *
 * @remarks
 * 基于 Preact JSX、ProviderTabLayout、SchemaCard 与 ProviderTabState 构建：
 * 1. 顶部服务连接与状态检测卡片 (ConnectionCardView，支持官方/自定义预设切换与 Bearer Token)；
 * 2. 生图参数预设主控卡片 (CardView + PresetToolbarView)：包含模型与画质参数 (SchemaFieldsView)、轮询候选池入口行 (PromptPollingPanelView)、画幅尺寸 (DimensionPickerView)、采样与调度控制 (SamplerCardView) 与 CFG Rescale；
 * 3. V3 模型采样增强选项卡片 (SchemaCard，仅 V3 系列模型时渲染 SMEA 与 Decrisper 选项)；
 * 4. 底部提示词预设卡片 (PromptPresetCardView，showLoraInPromptManager: false)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    CardView,
    SchemaCard,
    SchemaFieldsView,
    SchemaFieldRenderer,
    type FieldSchema,
    PromptPollingPanelView,
} from '../framework';
import { DimensionPicker, SamplerCard, PresetToolbar } from '../composite';
import {
    NOVELAI_RANGE_CONFIG,
    NOVELAI_OFFICIAL_SERVICE_ID,
    NOVELAI_IMAGE_HOST,
    OFFICIAL_NOVELAI_MODELS,
    NOVELAI_SAMPLER_OPTIONS,
    NOVELAI_SCHEDULER_OPTIONS,
    NOVELAI_SMEA_MODE_OPTIONS,
    formatNovelAIModelLabel,
    getProviderServiceProfileRules,
    getProviderServiceProfiles,
    resolveNovelAIModelFamily,
} from '../../domain';
import type { ProviderPreset } from '../composite/connection-card';
import { ProviderTabState } from '../state';
import { ProviderTabLayout, createProviderTabView } from './provider-tab-layout';

const NOVELAI_PROVIDER_PRESETS: ProviderPreset[] = [...getProviderServiceProfiles('novelai')];

const CFG_RESCALE_FIELD: FieldSchema<DrawingPresetData> = {
    key: 'cfgRescale',
    label: 'CFG 重缩放 (CFG Rescale)',
    type: 'number',
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

export function NovelAITab(props: {
    vm: ProviderTabState;
    modelFields: FieldSchema<DrawingPresetData>[];
    advancedFields: FieldSchema<DrawingPresetData>[];
}): VNode {
    const { vm, modelFields, advancedFields } = props;
    const { presetController } = vm;
    const draft = presetController.draftConfig.value;
    const dirtyFields = presetController.dirtyFields.value;
    const invalidFields = presetController.invalidFields.value;

    const isDimsDirty = dirtyFields.has('width') || dirtyFields.has('height');
    const isSamplerDirty =
        dirtyFields.has('samplerName') ||
        dirtyFields.has('scheduler') ||
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
            vm={vm}
            connectionTitle="服务连接"
            showApiKey={true}
            providerPresets={NOVELAI_PROVIDER_PRESETS}
            presetLabel="服务商"
            presetTooltip="选择使用 NovelAI 官方云端服务或第三方反代/中转服务地址"
            urlPlaceholder="例如 https://example.com/novelai"
            showWorkflowManager={false}
            showLoraInPromptManager={false}
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
                    <span className="da-section-banner__title">模型与画质</span>
                </div>

                <SchemaFieldsView
                    fields={modelFields}
                    model={draft}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                />

                <PromptPollingPanelView vm={vm} />

                <div className="da-section-banner">
                    <span className="da-section-banner__title">分辨率与画幅</span>
                </div>

                <DimensionPicker
                    embedded={true}
                    width={draft.width || 832}
                    height={draft.height || 1216}
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

                <SamplerCard
                    embedded={true}
                    showScheduler={true}
                    rangeConfig={NOVELAI_RANGE_CONFIG}
                    samplers={vm.samplerOptions.value}
                    schedulers={vm.schedulerOptions.value}
                    dirty={isSamplerDirty}
                    data={{
                        samplerName: draft.samplerName || 'k_euler_ancestral',
                        scheduler: draft.scheduler || 'karras',
                        steps: draft.steps ?? 28,
                        cfgScale: draft.cfgScale ?? 5.0,
                        seed: draft.seed ?? -1,
                    }}
                    onChange={(s) =>
                        presetController.patchDraft({
                            samplerName: s.samplerName,
                            scheduler: s.scheduler,
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
                    onChange={(val) =>
                        presetController.updateDraft('cfgRescale', val as number | undefined)
                    }
                />
            </CardView>

            {isV3Model && (
                <SchemaCard
                    schema={{
                        id: 'novelai-advanced',
                        title: 'V3 采样增强选项',
                        fields: advancedFields,
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

export function createNovelAITabView() {
    const vm = new ProviderTabState({
        provider: 'novelai',
        defaultServerUrl: NOVELAI_IMAGE_HOST,
        defaultServiceId: NOVELAI_OFFICIAL_SERVICE_ID,
        idPrefix: 'novelai_',
        promptMessageForNew: '请输入新生图参数预设名称:',
        defaultNewName: '新建预设',
        defaultModels: OFFICIAL_NOVELAI_MODELS.map((id) => ({
            label: formatNovelAIModelLabel(id),
            value: id,
        })),
        serviceProfiles: {
            fixedUrls: {
                ...(getProviderServiceProfileRules('novelai')?.fixedUrls || {}),
            },
        },
        defaultSamplers: [...NOVELAI_SAMPLER_OPTIONS],
        defaultSchedulers: [...NOVELAI_SCHEDULER_OPTIONS],
        validateRequired: (cfg) => {
            const missing: string[] = [];
            const effectiveModel = (cfg.customModel && cfg.customModel.trim()) || cfg.baseModel;
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

    const modelFields: FieldSchema<DrawingPresetData>[] = [
        {
            key: 'baseModel',
            label: '生图模型',
            type: 'select',
            options: () => vm.effectiveModelOptions.value,
            tooltip:
                '选择 NovelAI 官方生图模型。Full 完整模型数据集更广，适合多样化构图与多画师串风格融合；Curated 精选模型倾向标准简洁画风，搭配复杂画师串时建议优先选用 Full 模型。',
            transform: {
                toView: (v) => (v as string) || 'nai-diffusion-4-5-full',
                fromView: (v) => String(v),
            },
        },
        {
            key: 'customModel',
            label: '自定义模型标识',
            type: 'text',
            placeholder: '可选填写第三方接口模型标识（若填写将覆盖上述下拉选项）',
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
            options: () => vm.promptPresetOptions.value,
            tooltip:
                '选择生图时自动拼接的正负向提示词预设（或启用多预设随机轮询）；搭配画师串预设时建议选用 Full 模型与 karras 调度器。',
            invalidTooltip: (m) => `关联的提示词预设不存在或已失效 (ID: ${m.promptPresetId || ''})`,
        },
        {
            key: 'convertSyntax',
            label: '权重语法自动转换',
            type: 'switch',
            tooltip:
                '开启后将 SD 圆括号权重（如 (masterpiece:1.2) 与 ((tag))）自动转为对应架构语法：V4 / V4.5 / V5 转为原生 weight::tag::，V3 模型转为 {tag} / [tag]。',
            transform: {
                toView: (v) => v !== false,
                fromView: (v) => Boolean(v),
            },
        },
    ];

    const advancedFields: FieldSchema<DrawingPresetData>[] = [
        {
            key: 'smeaMode',
            label: 'SMEA 采样增强',
            type: 'select',
            options: [...NOVELAI_SMEA_MODE_OPTIONS],
            tooltip:
                '仅 V3 架构模型可用：在高分辨率生图时减少多肢体与构图畸变；V4 及以上模型已原生优化，无需开启。',
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

    return createProviderTabView({
        id: 'novelai',
        title: 'NovelAI',
        className: 'da-tab-pane da-view-novelai',
        vm,
        render: () => <NovelAITab vm={vm} modelFields={modelFields} advancedFields={advancedFields} />,
    });
}
