/**
 * SD-WebUI / Forge 绘图服务专属设置选项卡视图 (SDWebUITabView)。
 *
 * @remarks
 * 基于 Preact JSX、SchemaCard 与 ProviderTabViewModel 构建：
 * 1. 服务连接与状态探测卡片 (ConnectionCardView)；
 * 2. 预设方案主控工具栏 (PresetToolbarView)；
 * 3. 模型与网络架构卡片 (SchemaCard)；
 * 4. 画幅尺寸与采样控制卡片 (DimensionPickerView + SamplerCardView)；
 * 5. 高清修复 (Hires. fix) 级联声明式卡片 (SchemaCard，子项通过 disabledWhen 联动)；
 * 6. 底部提示词与通用 LoRA 预设管理器 (PromptPresetManagerView)。
 */

import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import {
    PreactSettingsView,
    CardView,
    SchemaCard,
    SchemaFieldsView,
    type FieldSchema,
    DimensionPickerView,
    SamplerCardView,
} from '../framework';
import { ProviderTabViewModel } from '../viewmodels';
import { ProviderTabLayout } from './provider-tab-template';

const SDWEBUI_DEFAULT_SAMPLERS = [
    { label: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
    { label: 'DPM++ SDE Karras', value: 'DPM++ SDE Karras' },
    { label: 'DPM++ 2S a Karras', value: 'DPM++ 2S a Karras' },
    { label: 'Euler a', value: 'Euler a' },
    { label: 'Euler', value: 'Euler' },
    { label: 'DDIM', value: 'DDIM' },
    { label: 'UniPC', value: 'UniPC' },
];

const HIRES_UPSCALER_OPTIONS = [
    { label: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
    { label: 'R-ESRGAN 4x+', value: 'R-ESRGAN 4x+' },
    { label: 'Latent', value: 'Latent' },
    { label: 'Latent (antialiased)', value: 'Latent (antialiased)' },
    { label: 'Latent (bicubic)', value: 'Latent (bicubic)' },
    { label: '4x-UltraSharp', value: '4x-UltraSharp' },
    { label: 'ESRGAN_4x', value: 'ESRGAN_4x' },
];

export class SDWebUITabView extends PreactSettingsView {
    public readonly id = 'sdwebui';
    public readonly title = 'SD-WebUI / Forge';

    public readonly vm: ProviderTabViewModel;
    private readonly modelFields: FieldSchema<DrawingPresetData>[];
    private readonly hiresFields: FieldSchema<DrawingPresetData>[];

    public constructor() {
        super('da-tab-pane da-view-sdwebui');

        this.vm = new ProviderTabViewModel({
            provider: 'sdwebui',
            defaultServerUrl: 'http://127.0.0.1:7860',
            idPrefix: 'sdwebui_preset_',
            promptMessageForNew: '请输入新绘图方案名称:',
            defaultNewName: '新建方案',
            defaultSamplers: SDWEBUI_DEFAULT_SAMPLERS,
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

        this.modelFields = [
            {
                key: 'baseModel',
                label: '主模型',
                type: 'select',
                placeholder: '选择主模型文件',
                options: () => this.vm.effectiveModelOptions.value,
            },
            {
                key: 'vaeName',
                label: '外置 VAE',
                type: 'select',
                tooltip: '变分自编码器。留空或选 automatic 时采用主模型内置 VAE',
                options: () => this.vm.effectiveVaeOptions.value,
                transform: {
                    toView: (v) => (v as string) || 'automatic',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'clipSkip',
                label: 'CLIP 跳过层',
                type: 'slider',
                min: 1,
                max: 12,
                step: 1,
                defaultValue: 2,
                unit: ' 层',
                tooltip:
                    '文本编码器倒数第几层特征输出。二次元模型通常推荐设为 2，真实系模型常设为 1',
                transform: {
                    toView: (v) => Number(v ?? 2),
                    fromView: (v) => Number(v),
                },
            },
            {
                key: 'promptPresetId',
                label: '提示词预设',
                type: 'select',
                placeholder: '选择关联提示词预设方案',
                options: () => this.vm.promptPresetOptions.value,
            },
        ];

        this.hiresFields = [
            {
                key: 'enableHires',
                label: '启用高清修复',
                type: 'switch',
                tooltip: '开启后将先生成基准分辨率图像，随后按倍率放大并进行二次重绘采样',
            },
            {
                key: 'hiresUpscaler',
                label: '放大算法',
                type: 'select',
                options: HIRES_UPSCALER_OPTIONS,
                tooltip: '用于拉伸分辨率的算法模型，如 Latent 潜空间算法、ESRGAN 纹理增强算法等',
                disabledWhen: (m) => !m.enableHires,
                transform: {
                    toView: (v) => (v as string) || 'R-ESRGAN 4x+ Anime6B',
                    fromView: (v) => String(v),
                },
            },
            {
                key: 'hiresScale',
                label: '放大倍率',
                type: 'slider',
                min: 1.0,
                max: 4.0,
                step: 0.05,
                defaultValue: 1.5,
                precision: 2,
                unit: 'x',
                tooltip: '最终图像分辨率相对于基准画幅尺寸的倍数（例如 1.5x 或 2.0x）',
                disabledWhen: (m) => !m.enableHires,
                transform: {
                    toView: (v) => Number(v ?? 1.5),
                    fromView: (v) => Number(v),
                },
            },
            {
                key: 'hiresSteps',
                label: '高清步数',
                type: 'slider',
                min: 0,
                max: 50,
                step: 1,
                defaultValue: 15,
                unit: ' 步',
                tooltip: '放大后的二次去噪采样步数，设为 0 表示沿用基础采样步数',
                disabledWhen: (m) => !m.enableHires,
                transform: {
                    toView: (v) => Number(v ?? 15),
                    fromView: (v) => Number(v),
                },
            },
            {
                key: 'hiresDenoise',
                label: '高清重绘幅度',
                type: 'slider',
                min: 0.0,
                max: 1.0,
                step: 0.01,
                defaultValue: 0.45,
                precision: 2,
                tooltip: '放大后的去噪重绘强度。过高可能改变构图与脸型，推荐 0.35 ~ 0.55',
                disabledWhen: (m) => !m.enableHires,
                transform: {
                    toView: (v) => Number(v ?? 0.45),
                    fromView: (v) => Number(v),
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

        const isDimsDirty = dirtyFields.has('width') || dirtyFields.has('height');
        const isSamplerDirty =
            dirtyFields.has('samplerName') ||
            dirtyFields.has('steps') ||
            dirtyFields.has('cfgScale') ||
            dirtyFields.has('seed') ||
            dirtyFields.has('denoise');

        return (
            <ProviderTabLayout
                vm={this.vm}
                connectionTitle="服务连接"
                urlPlaceholder="http://127.0.0.1:7860"
                showApiKey={false}
                showWorkflowManager={false}
                showLoraInPromptManager={true}
            >
                <CardView title="生图配置">
                    <SchemaFieldsView
                        fields={this.modelFields}
                        model={draft}
                        dirtyFields={dirtyFields}
                        invalidFields={invalidFields}
                        onFieldChange={(key, val) => presetController.updateDraft(key, val)}
                    />

                    <div className="da-settings-divider" />

                    <DimensionPickerView
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

                    <div className="da-settings-divider" />

                    <SamplerCardView
                        embedded={true}
                        showScheduler={false}
                        showDenoise={true}
                        samplers={this.vm.samplerOptions.value}
                        dirty={isSamplerDirty}
                        data={{
                            samplerName: draft.samplerName || 'DPM++ 2M Karras',
                            steps: draft.steps || 28,
                            cfgScale: draft.cfgScale || 7.0,
                            seed: draft.seed ?? -1,
                            denoise: draft.denoise ?? 0.7,
                        }}
                        onChange={(s) =>
                            presetController.patchDraft({
                                samplerName: s.samplerName,
                                steps: s.steps,
                                cfgScale: s.cfgScale,
                                seed: s.seed,
                                denoise: s.denoise,
                            })
                        }
                    />
                </CardView>

                <SchemaCard
                    schema={{
                        id: 'sdwebui-hires',
                        title: '高清修复 (Hires. fix)',
                        fields: this.hiresFields,
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
