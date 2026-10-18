/**
 * ComfyUI 绘图服务专属设置选项卡视图 (ComfyUITabView)。
 *
 * @remarks
 * 基于 Preact JSX、SchemaCard 与 ProviderTabViewModel 构建：
 * 1. 服务连接与状态探测卡片 (ConnectionCardView)；
 * 2. 预设方案主控工具栏 (PresetToolbarView)；
 * 3. 模型与工作流声明式表单卡片 (SchemaCard)；
 * 4. 画幅尺寸与采样控制卡片 (DimensionPickerView + SamplerCardView)；
 * 5. 工作流预设管理器 (WorkflowCardView) 与提示词预设管理器 (PromptPresetManagerView)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    PreactSettingsView,
    CardView,
    SchemaFieldsView,
    type FieldSchema,
    DimensionPickerView,
    SamplerCardView,
} from '../framework';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout } from './provider-tab-template';

const COMFY_SAMPLER_OPTIONS = [
    { label: 'euler', value: 'euler' },
    { label: 'euler_ancestral', value: 'euler_ancestral' },
    { label: 'dpmpp_2m', value: 'dpmpp_2m' },
    { label: 'dpmpp_2m_sde', value: 'dpmpp_2m_sde' },
    { label: 'dpmpp_sde', value: 'dpmpp_sde' },
    { label: 'uni_pc', value: 'uni_pc' },
    { label: 'ddim', value: 'ddim' },
];

const COMFY_SCHEDULER_OPTIONS = [
    { label: 'normal', value: 'normal' },
    { label: 'karras', value: 'karras' },
    { label: 'exponential', value: 'exponential' },
    { label: 'sgm_uniform', value: 'sgm_uniform' },
    { label: 'simple', value: 'simple' },
    { label: 'ddim_uniform', value: 'ddim_uniform' },
    { label: 'beta', value: 'beta' },
];

export class ComfyUITabView extends PreactSettingsView {
    public readonly id = 'comfyui';
    public readonly title = 'ComfyUI';

    public readonly vm: ProviderTabViewModel;
    private readonly modelWorkflowFields: FieldSchema<DrawingPresetData>[];

    public constructor() {
        super('da-tab-pane da-view-comfyui');

        this.vm = new ProviderTabViewModel({
            provider: 'comfyui',
            defaultServerUrl: 'http://127.0.0.1:8188',
            idPrefix: 'comfyui_preset_',
            promptMessageForNew: '请输入新绘图方案名称:',
            defaultNewName: '新建方案',
            defaultSamplers: COMFY_SAMPLER_OPTIONS,
            defaultSchedulers: COMFY_SCHEDULER_OPTIONS,
            checkWorkflowBindings: true,
            validateRequired: (cfg) => {
                const missing: string[] = [];
                if (!cfg.baseModel) missing.push('主模型');
                if (!cfg.txt2imgWorkflowId) missing.push('文生图工作流');
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

        this.modelWorkflowFields = [
            {
                key: 'txt2imgWorkflowId',
                label: '文生图工作流',
                type: 'select',
                placeholder: '选择文生图工作流',
                options: () => this.vm.txt2imgWorkflowOptions.value,
            },
            {
                key: 'img2imgWorkflowId',
                label: '图生图工作流',
                type: 'select',
                options: () => this.vm.img2imgWorkflowOptions.value,
            },
            {
                key: 'promptPresetId',
                label: '提示词预设方案',
                type: 'select',
                placeholder: '选择关联提示词预设方案',
                options: () => this.vm.promptPresetOptions.value,
            },
            {
                key: 'divider_model',
                type: 'divider',
            },
            {
                key: 'baseModel',
                label: '主模型',
                type: 'select',
                placeholder: '选择主模型文件',
                options: () => this.vm.effectiveModelOptions.value,
            },
            {
                key: 'clipName',
                label: 'CLIP 编码器',
                type: 'select',
                options: () => this.vm.effectiveClipOptions.value,
            },
            {
                key: 'vaeName',
                label: 'VAE 编解码器',
                type: 'select',
                options: () => this.vm.effectiveVaeOptions.value,
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
            dirtyFields.has('scheduler') ||
            dirtyFields.has('steps') ||
            dirtyFields.has('cfgScale') ||
            dirtyFields.has('seed') ||
            dirtyFields.has('denoise');

        return (
            <ProviderTabLayout
                vm={this.vm}
                connectionTitle="服务连接"
                urlPlaceholder="http://127.0.0.1:8188"
                showApiKey={false}
                showWorkflowManager={true}
                showLoraInPromptManager={true}
            >
                <CardView title="生图配置">
                    <SchemaFieldsView
                        fields={this.modelWorkflowFields}
                        model={draft}
                        dirtyFields={dirtyFields}
                        invalidFields={invalidFields}
                        onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                    />

                    <div className="da-settings-divider" />

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

                    <div className="da-settings-divider" />

                    <SamplerCardView
                        embedded={true}
                        showScheduler={true}
                        showDenoise={true}
                        samplers={this.vm.samplerOptions.value}
                        schedulers={this.vm.schedulerOptions.value}
                        dirty={isSamplerDirty}
                        data={{
                            samplerName: draft.samplerName || 'euler',
                            scheduler: draft.scheduler || 'normal',
                            steps: draft.steps || 20,
                            cfgScale: draft.cfgScale || 3.5,
                            seed: draft.seed ?? -1,
                            denoise: draft.denoise ?? 1.0,
                        }}
                        onChange={(s) =>
                            presetController.patchDraft({
                                samplerName: s.samplerName,
                                scheduler: s.scheduler,
                                steps: s.steps,
                                cfgScale: s.cfgScale,
                                seed: s.seed,
                                denoise: s.denoise,
                            })
                        }
                    />
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
