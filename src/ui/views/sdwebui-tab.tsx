/**
 * SD-WebUI / Forge 生图服务专属设置选项卡视图 (SDWebUITabView)。
 *
 * @remarks
 * 基于 Preact JSX、ProviderTabLayout、SchemaCard 与 ProviderTabState 构建：
 * 1. 顶部服务连接与状态检测卡片 (ConnectionCardView)；
 * 2. 生图参数预设主控卡片 (CardView + PresetToolbarView)：包含模型与网络架构字段 (SchemaFieldsView)、画幅尺寸 (DimensionPickerView) 与采样控制 (SamplerCardView)；
 * 3. 高清修复 (Hires. fix) 级联声明式卡片 (SchemaCard，子项通过 disabledWhen 联动)；
 * 4. 底部提示词与通用 LoRA 预设卡片 (PromptPresetCardView)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    CardView,
    SchemaCard,
    SchemaFieldsView,
    type FieldSchema,
    PromptPollingPanelView,
} from '../framework';
import { DimensionPicker, SamplerCard, PresetToolbar } from '../composite';
import {
    SDWEBUI_DEFAULT_SAMPLERS,
    SDWEBUI_DEFAULT_SCHEDULERS,
    HIRES_UPSCALER_OPTIONS,
} from '../../domain';
import { ProviderTabState } from '../state';
import { ProviderTabLayout, createProviderTabView } from './provider-tab-layout';

export function SDWebUITab(props: {
    vm: ProviderTabState;
    modelFields: FieldSchema<DrawingPresetData>[];
    hiresFields: FieldSchema<DrawingPresetData>[];
}): VNode {
    const { vm, modelFields, hiresFields } = props;
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
            urlPlaceholder="http://127.0.0.1:7860"
            showApiKey={false}
            showWorkflowManager={false}
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
                    <span className="da-section-banner__title">模型与 VAE</span>
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
                    samplers={vm.samplerOptions.value}
                    schedulers={vm.schedulerOptions.value}
                    dirty={isSamplerDirty}
                    data={{
                        samplerName: draft.samplerName || 'Euler a',
                        scheduler: draft.scheduler || 'Automatic',
                        steps: draft.steps ?? 28,
                        cfgScale: draft.cfgScale ?? 5.5,
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

            <SchemaCard
                schema={{
                    id: 'sdwebui-hires',
                    title: '高清修复 (Hires. fix)',
                    fields: hiresFields,
                }}
                model={draft}
                dirtyFields={dirtyFields}
                invalidFields={invalidFields}
                onFieldChange={(key, val) => presetController.updateDraft(key, val)}
            />
        </ProviderTabLayout>
    );
}

export function createSDWebUITabView() {
    const vm = new ProviderTabState({
        provider: 'sdwebui',
        defaultServerUrl: 'http://127.0.0.1:7860',
        idPrefix: 'sdwebui_preset_',
        promptMessageForNew: '请输入新生图参数预设名称:',
        defaultNewName: '新建预设',
        defaultSamplers: [...SDWEBUI_DEFAULT_SAMPLERS],
        defaultSchedulers: [...SDWEBUI_DEFAULT_SCHEDULERS],
        defaultDraftTemplate: () => ({
            width: 832,
            height: 1216,
            samplerName: 'Euler a',
            scheduler: 'Automatic',
            steps: 28,
            cfgScale: 5.5,
            seed: -1,
        }),
        validateRequired: (cfg) => {
            const missing: string[] = [];
            if (!cfg.baseModel) missing.push('主模型');
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
            label: '主模型',
            type: 'select',
            placeholder: '选择主模型文件',
            options: () => vm.effectiveModelOptions.value,
            invalidTooltip: (m) => `当前服务端未检测到该主模型 (${m.baseModel || ''})`,
        },
        {
            key: 'vaeName',
            label: 'VAE 模型',
            type: 'select',
            tooltip:
                '负责将潜空间特征解码为正常色彩与画质。若出图发灰、泛白或色彩失真，通常为未挂载或错配 VAE 所致；若主模型已内置烘焙 VAE，选择 automatic 即可。',
            options: () => vm.effectiveVaeOptions.value,
            invalidTooltip: (m) => `当前服务端未检测到该 VAE (${m.vaeName || ''})`,
            transform: {
                toView: (v) => (v as string) || 'automatic',
                fromView: (v) => String(v),
            },
        },
        {
            key: 'clipSkip',
            label: 'CLIP 跳过层数 (CLIP Skip)',
            type: 'number',
            min: 1,
            max: 4,
            step: 1,
            defaultValue: 2,
            unit: ' 层',
            tooltip:
                'CLIP 文本编码器截断层数。二次元/动漫模型通常在第 2 层（倒数第 2 层）捕获最丰富的特征，推荐设为 2；传统真实系模型或 SDXL 多推荐设为 1。',
            transform: {
                toView: (v) => Number(v ?? 2),
                fromView: (v) => Number(v),
            },
        },
        {
            key: 'promptPresetId',
            label: '提示词预设',
            type: 'select',
            tooltip:
                '出图时自动拼接在画面描述前后的正负向画风/质量词预设（也支持切换随机轮询，轮流套用不同画风）。如果想完全由剧情 AI 或手写指令决定画风，选「未选择提示词预设」留空即可。',
            options: () => vm.promptPresetOptions.value,
            invalidTooltip: (m) => `关联的提示词预设不存在或已失效 (ID: ${m.promptPresetId || ''})`,
        },
    ];

    const hiresFields: FieldSchema<DrawingPresetData>[] = [
        {
            key: 'enableHires',
            label: '启用高清修复 (Hires. fix)',
            type: 'switch',
        },
        {
            key: 'hiresUpscaler',
            label: '放大算法',
            type: 'select',
            options: [...HIRES_UPSCALER_OPTIONS],
            tooltip:
                '高清放大算法。Latent 系列通过二次去噪丰富细节（较消耗显存）；R-ESRGAN 系列与 4x-UltraSharp 专注于增强边缘清晰度（显存开销小，动漫风格推荐 R-ESRGAN 4x+ Anime6B）。',
            disabledWhen: (m) => !m.enableHires,
            transform: {
                toView: (v) => (v as string) || 'R-ESRGAN 4x+ Anime6B',
                fromView: (v) => String(v),
            },
        },
        {
            key: 'hiresScale',
            label: '放大倍率',
            type: 'number',
            min: 1.0,
            max: 4.0,
            step: 0.05,
            defaultValue: 1.5,
            precision: 2,
            unit: 'x',
            disabledWhen: (m) => !m.enableHires,
            transform: {
                toView: (v) => Number(v ?? 1.5),
                fromView: (v) => Number(v),
            },
        },
        {
            key: 'hiresSteps',
            label: '高清修复步数',
            type: 'number',
            min: 0,
            max: 50,
            step: 1,
            defaultValue: 15,
            unit: ' 步',
            tooltip:
                '二次重绘去噪步数。设为 0 时直接复用基准采样步数；通常推荐 10~20 步，过高容易产生杂质伪影并拖慢出图速度。',
            disabledWhen: (m) => !m.enableHires,
            transform: {
                toView: (v) => Number(v ?? 15),
                fromView: (v) => Number(v),
            },
        },
        {
            key: 'hiresDenoise',
            label: '重绘幅度',
            type: 'number',
            min: 0.0,
            max: 1.0,
            step: 0.01,
            defaultValue: 0.45,
            precision: 2,
            tooltip:
                '放大后的二次去噪幅度。决定放大阶段允许重塑细节的程度：推荐 0.35~0.50；低于 0.3 画面易出现模糊涂抹感；高于 0.6 可能改变原有面部结构或产生多肢体错误。',
            disabledWhen: (m) => !m.enableHires,
            transform: {
                toView: (v) => Number(v ?? 0.45),
                fromView: (v) => Number(v),
            },
        },
    ];

    return createProviderTabView({
        id: 'sdwebui',
        title: 'SD-WebUI / Forge',
        className: 'da-tab-pane da-view-sdwebui',
        vm,
        render: () => <SDWebUITab vm={vm} modelFields={modelFields} hiresFields={hiresFields} />,
    });
}
