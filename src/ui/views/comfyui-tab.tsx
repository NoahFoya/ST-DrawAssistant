/**
 * ComfyUI 生图服务专属设置选项卡视图 (ComfyUITabView)。
 *
 * @remarks
 * 基于 Preact JSX、ProviderTabLayout 与 ProviderTabViewModel 构建：
 * 1. 顶部服务连接与状态检测卡片 (ProviderTabLayout 内置 ConnectionCardView)；
 * 2. 生图预设工具栏 (PresetToolbarView) 与统一配置卡片 (CardView)：包含模型/工作流字段 (SchemaFieldsView)、画幅尺寸 (DimensionPickerView) 与采样控制 (SamplerCardView)；
 * 3. 底部工作流管理器 (WorkflowCardView) 与提示词/LoRA 预设卡片 (PromptPresetCardView)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    CardView,
    SchemaFieldsView,
    type FieldSchema,
    DimensionPickerView,
    SamplerCardView,
    PresetToolbarView,
} from '../framework';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout, ProviderTabView } from './provider-tab-layout';

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

export class ComfyUITabView extends ProviderTabView {
    public readonly id = 'comfyui';
    public readonly title = 'ComfyUI';

    public readonly vm: ProviderTabViewModel;
    private readonly workflowFields: FieldSchema<DrawingPresetData>[];
    private readonly modelFields: FieldSchema<DrawingPresetData>[];

    public constructor() {
        super('da-tab-pane da-view-comfyui');

        this.vm = new ProviderTabViewModel({
            provider: 'comfyui',
            defaultServerUrl: 'http://127.0.0.1:8188',
            idPrefix: 'comfyui_preset_',
            promptMessageForNew: '请输入新生图预设名称:',
            defaultNewName: '新建预设',
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

        this.workflowFields = [
            {
                key: 'txt2imgWorkflowId',
                label: '文生图工作流 (txt2img)',
                type: 'select',
                placeholder: '选择文生图工作流',
                options: () => this.vm.txt2imgWorkflowOptions.value,
                invalidTooltip: (m) => `关联的文生图工作流不存在或已失效 (ID: ${m.txt2imgWorkflowId || ''})`,
            },
            {
                key: 'inpaintPresetId',
                label: '默认局部重绘预设 (Inpaint)',
                type: 'select',
                placeholder: '选择局部重绘预设',
                options: () => this.vm.inpaintPresetOptions.value,
                invalidTooltip: (m) => `关联的局部重绘预设不存在或已失效 (ID: ${m.inpaintPresetId || ''})`,
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

        this.modelFields = [
            {
                key: 'baseModel',
                label: '主模型',
                type: 'select',
                placeholder: '选择主模型文件',
                options: () => this.vm.effectiveModelOptions.value,
                invalidTooltip: (m) => `当前服务端未检测到该主模型 (${m.baseModel || ''})`,
            },
            {
                key: 'clipName',
                label: 'CLIP 模型',
                type: 'select',
                options: () => this.vm.effectiveClipOptions.value,
                invalidTooltip: (m) => `当前服务端未检测到该 CLIP (${m.clipName || ''})`,
            },
            {
                key: 'vaeName',
                label: 'VAE 模型',
                type: 'select',
                options: () => this.vm.effectiveVaeOptions.value,
                invalidTooltip: (m) => `当前服务端未检测到该 VAE (${m.vaeName || ''})`,
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
            dirtyFields.has('seed');

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
                    <PresetToolbarView
                        presets={presetController.toolbarItems.value}
                        activePresetId={presetController.activePresetId.value}
                        dirty={presetController.isDirty.value}
                        onAction={(action, id) => presetController.handleAction(action, id)}
                        onImportFile={(file) => presetController.handleImportFile(file)}
                    />

                    <div className="da-section-banner">
                        <span className="da-section-banner__title">工作流模板</span>
                    </div>

                    <SchemaFieldsView
                        fields={this.workflowFields}
                        model={draft}
                        dirtyFields={dirtyFields}
                        invalidFields={invalidFields}
                        onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                    />

                    <div className="da-section-banner">
                        <span className="da-section-banner__title">模型配置</span>
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
                        alignMultiple={8}
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
                        showScheduler={true}
                        samplers={this.vm.samplerOptions.value}
                        schedulers={this.vm.schedulerOptions.value}
                        dirty={isSamplerDirty}
                        data={{
                            samplerName: draft.samplerName || 'euler',
                            scheduler: draft.scheduler || 'normal',
                            steps: draft.steps ?? 20,
                            cfgScale: draft.cfgScale ?? 3.5,
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
                </CardView>
            </ProviderTabLayout>
        );
    }
}
