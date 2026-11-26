/**
 * ComfyUI 生图服务专属设置选项卡视图 (ComfyUITabView)。
 *
 * @remarks
 * 基于 Preact JSX、ProviderTabLayout 与 ProviderTabViewModel 构建：
 * 1. 顶部服务连接与状态检测卡片 (ProviderTabLayout 内置 ConnectionCardView)；
 * 2. 生图参数预设工具栏 (PresetToolbarView) 与统一配置卡片 (CardView)：包含模型/工作流字段 (SchemaFieldsView)、画幅尺寸 (DimensionPickerView) 与采样控制 (SamplerCardView)；
 * 3. 底部工作流管理器 (WorkflowCardView) 与提示词/LoRA 预设卡片 (PromptPresetCardView)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    CardView,
    SchemaFieldsView,
    type FieldSchema,
    PromptPollingPanelView,
} from '../framework';
import { DimensionPicker, SamplerCard, PresetToolbar } from '../composite';
import { COMFY_DEFAULT_SAMPLERS, COMFY_DEFAULT_SCHEDULERS } from '../../domain';
import { ProviderTabState } from '../state';
import { ProviderTabLayout, createProviderTabView } from './provider-tab-layout';

export function ComfyUITab(props: {
    vm: ProviderTabState;
    workflowFields: FieldSchema<DrawingPresetData>[];
    modelFields: FieldSchema<DrawingPresetData>[];
}): VNode {
    const { vm, workflowFields, modelFields } = props;
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

    return (
        <ProviderTabLayout
            vm={vm}
            connectionTitle="服务连接"
            urlPlaceholder="http://127.0.0.1:8188"
            showApiKey={false}
            showWorkflowManager={true}
            showLoraInPromptManager={true}
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
                    <span className="da-section-banner__title">工作流模板</span>
                </div>

                <SchemaFieldsView
                    fields={workflowFields}
                    model={draft}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                />

                <PromptPollingPanelView vm={vm} />

                <div className="da-section-banner">
                    <span className="da-section-banner__title">模型配置</span>
                </div>

                <SchemaFieldsView
                    fields={modelFields}
                    model={draft}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                />

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
                    samplers={vm.samplerOptions.value}
                    schedulers={vm.schedulerOptions.value}
                    dirty={isSamplerDirty}
                    data={{
                        samplerName: draft.samplerName || 'euler_ancestral',
                        scheduler: draft.scheduler || 'normal',
                        steps: draft.steps ?? 28,
                        cfgScale: draft.cfgScale ?? 6,
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

export function createComfyUITabView() {
    const vm = new ProviderTabState({
        provider: 'comfyui',
        defaultServerUrl: 'http://127.0.0.1:8188',
        idPrefix: 'comfyui_preset_',
        promptMessageForNew: '请输入新生图参数预设名称:',
        defaultNewName: '新建预设',
        defaultSamplers: [...COMFY_DEFAULT_SAMPLERS],
        defaultSchedulers: [...COMFY_DEFAULT_SCHEDULERS],
        defaultDraftTemplate: () => ({
            width: 832,
            height: 1216,
            samplerName: 'euler_ancestral',
            scheduler: 'normal',
            steps: 28,
            cfgScale: 6,
            seed: -1,
        }),
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

    const workflowFields: FieldSchema<DrawingPresetData>[] = [
        {
            key: 'txt2imgWorkflowId',
            label: '文生图工作流 (txt2img)',
            type: 'select',
            placeholder: '选择文生图工作流',
            tooltip:
                '选择 API 格式的出图工作流：单文件底模选「Checkpoint」，分立底模（如 Flux / Qwen / MOSS）选「UNet」，两者均自动串联内置 LoraLoader 注入所选 LoRA。',
            options: () => vm.txt2imgWorkflowOptions.value,
            invalidTooltip: (m) => `关联的文生图工作流不存在或已失效 (ID: ${m.txt2imgWorkflowId || ''})`,
        },
        {
            key: 'inpaintPresetId',
            label: '局部重绘工作流 (Inpaint)',
            type: 'select',
            tooltip:
                '画板局部重绘专用，需选用包含底图与蒙版输入节点的工作流。',
            options: () => vm.inpaintPresetOptions.value,
            invalidTooltip: (m) => `关联的局部重绘工作流不存在或已失效 (ID: ${m.inpaintPresetId || ''})`,
        },
        {
            key: 'promptPresetId',
            label: '提示词预设',
            type: 'select',
            options: () => vm.promptPresetOptions.value,
            invalidTooltip: (m) => `关联的提示词预设不存在或已失效 (ID: ${m.promptPresetId || ''})`,
        },
    ];

    const modelFields: FieldSchema<DrawingPresetData>[] = [
        {
            key: 'baseModel',
            label: '主模型',
            type: 'select',
            placeholder: '选择主模型文件',
            tooltip:
                '单文件整合模型请配合「Checkpoint」工作流，分立扩散模型（diffusion_models / unet）请配合「UNet」工作流并在下方指定 CLIP 与 VAE。',
            options: () => vm.effectiveModelOptions.value,
            invalidTooltip: (m) => `当前服务端未检测到该主模型 (${m.baseModel || ''})`,
        },
        {
            key: 'clipName',
            label: 'CLIP 模型',
            type: 'select',
            tooltip:
                'Checkpoint 整合模型通常保留「使用模型内置」即可；UNet 分立模型须在此选定配套 CLIP 编码器。',
            options: () => vm.effectiveClipOptions.value,
            invalidTooltip: (m) => `当前服务端未检测到该 CLIP (${m.clipName || ''})`,
        },
        {
            key: 'vaeName',
            label: 'VAE 模型',
            type: 'select',
            tooltip:
                'Checkpoint 整合模型通常保留「使用模型内置」即可；UNet 分立模型须在此选定配套 VAE。',
            options: () => vm.effectiveVaeOptions.value,
            invalidTooltip: (m) => `当前服务端未检测到该 VAE (${m.vaeName || ''})`,
        },
    ];

    return createProviderTabView({
        id: 'comfyui',
        title: 'ComfyUI',
        className: 'da-tab-pane da-view-comfyui',
        vm,
        render: () => <ComfyUITab vm={vm} workflowFields={workflowFields} modelFields={modelFields} />,
    });
}
