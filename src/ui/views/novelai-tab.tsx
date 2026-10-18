/**
 * NovelAI 绘图服务专属设置选项卡视图 (NovelAITabView)。
 *
 * @remarks
 * 基于 Preact JSX、SchemaCard 与 ProviderTabViewModel 构建：
 * 1. 服务连接与状态探测卡片 (ConnectionCardView，支持 Bearer Token)；
 * 2. 预设方案主控工具栏 (PresetToolbarView)；
 * 3. 模型版本与提示词增强卡片 (SchemaCard)；
 * 4. 画幅尺寸与采样控制卡片 (DimensionPickerView + SamplerCardView + CFG Rescale)；
 * 5. 渲染增强与高级特性卡片 (SchemaCard，SMEA 根据所选模型自动禁用/启用)；
 * 6. 提示词预设管理器 (PromptPresetManagerView，showLora: false)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    PreactSettingsView,
    CardView,
    SchemaCard,
    SchemaFieldRenderer,
    type FieldSchema,
    DimensionPickerView,
    SamplerCardView,
} from '../framework';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout } from './provider-tab-template';

const NOVELAI_MODEL_OPTIONS = [
    { label: 'NAI Diffusion Anime V5 (Full)', value: 'nai-diffusion-5-full' },
    { label: 'NAI Diffusion Anime V5 (Curated)', value: 'nai-diffusion-5-curated-preview' },
    { label: 'NAI Diffusion Anime V4.5 (Full)', value: 'nai-diffusion-4-5-full' },
    { label: 'NAI Diffusion Anime V4.5 (Curated)', value: 'nai-diffusion-4-5-curated-preview' },
    { label: 'NAI Diffusion Anime V4 (Full)', value: 'nai-diffusion-4-full' },
    { label: 'NAI Diffusion Anime V4 (Curated)', value: 'nai-diffusion-4-curated-preview' },
    { label: 'NAI Diffusion Anime V3', value: 'nai-diffusion-3' },
    { label: 'NAI Diffusion Furry V3', value: 'nai-diffusion-furry-3' },
];

const UC_PRESET_OPTIONS = [
    { label: 'Heavy (通用防崩)', value: 'Heavy' },
    { label: 'Light (轻度过滤)', value: 'Light' },
    { label: 'Human Focus (聚焦人物)', value: 'Human Focus' },
    { label: 'None (不使用)', value: 'None' },
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
    label: '引导重缩放',
    type: 'slider',
    min: 0.0,
    max: 1.0,
    step: 0.05,
    defaultValue: 0.0,
    precision: 2,
    tooltip: 'CFG Rescale 算法。有效降低高引导系数 (CFG) 引起的色彩过饱和与过曝失真',
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
            defaultServerUrl: 'https://image.novelai.net',
            idPrefix: 'novelai_',
            promptMessageForNew: '请输入新方案名称:',
            defaultNewName: '新 NovelAI 方案',
            defaultModels: NOVELAI_MODEL_OPTIONS,
            defaultSamplers: NOVELAI_SAMPLER_OPTIONS,
            validateRequired: (cfg) => {
                const missing: string[] = [];
                if (!cfg.baseModel) missing.push('核心生图模型');
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
                key: 'ucPreset',
                label: '负向模板预设',
                type: 'select',
                options: UC_PRESET_OPTIONS,
                tooltip:
                    'Undesired Content 官方内置负向过滤模板，Heavy 防崩较强，None 表示完全纯净',
                transform: {
                    toView: (v) => (v as string) || 'Heavy',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'promptPresetId',
                label: '提示词预设',
                type: 'select',
                placeholder: '选择关联提示词预设方案',
                options: () => this.vm.promptPresetOptions.value,
            },
            {
                key: 'qualityTags',
                label: '自动追加画质标签',
                type: 'switch',
                tooltip:
                    '生成时自动在提示词前追加 masterpiece, best quality 等官方推荐画质标签',
                transform: {
                    toView: (v) => v !== false,
                    fromView: (v) => Boolean(v),
                },
            },
            {
                key: 'convertSyntax',
                label: '权重语法自动转换',
                type: 'switch',
                tooltip:
                    '自动将 SD 风格 (tag:1.2) 转换为 NovelAI 专有的 {tag} 花括号增强语法',
                transform: {
                    toView: (v) => v !== false,
                    fromView: (v) => Boolean(v),
                },
            },
        ];

        this.advancedFields = [
            {
                key: 'smeaMode',
                label: 'SMEA 渲染模式',
                type: 'select',
                options: SMEA_MODE_OPTIONS,
                tooltip:
                    '多通正弦采样算法（仅限 V3 模型）。有效抑制高分辨率生成时的人物多肢体崩坏',
                disabledWhen: (m) => {
                    const model = String(m.baseModel || 'nai-diffusion-4-5-full');
                    return !model.includes('-3');
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
                tooltip: '平滑色彩高频边缘，减少过锐化造成的杂色斑点与焦黑伪影',
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

        return (
            <ProviderTabLayout
                vm={this.vm}
                connectionTitle="服务连接"
                showApiKey={true}
                showWorkflowManager={false}
                showLoraInPromptManager={false}
            >
                <SchemaCard
                    schema={{
                        id: 'novelai-model',
                        title: '模型与预设',
                        collapsible: true,
                        fields: this.modelFields,
                    }}
                    model={draft}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                />

                <CardView title="尺寸与采样" collapsible={true}>
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
                    <SamplerCardView
                        embedded={true}
                        showScheduler={false}
                        showDenoise={false}
                        samplers={this.vm.samplerOptions.value}
                        dirty={isSamplerDirty}
                        data={{
                            samplerName: draft.samplerName || 'k_euler',
                            steps: draft.steps || 28,
                            cfgScale: draft.cfgScale || 5.0,
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
                        field={CFG_RESCALE_FIELD}
                        model={draft}
                        dirty={dirtyFields.has('cfgRescale')}
                        invalid={invalidFields.has('cfgRescale')}
                        onChange={(val) => presetController.updateDraft('cfgRescale', val)}
                    />
                </CardView>

                <SchemaCard
                    schema={{
                        id: 'novelai-advanced',
                        title: '高级特性',
                        collapsible: true,
                        fields: this.advancedFields,
                    }}
                    model={draft}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                />
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
