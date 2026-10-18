/**
 * 核心采样参数复合卡片 (SamplerCard)。
 *
 * @remarks
 * 为生图提供方（ComfyUI、SD-WebUI/Forge、NovelAI 等）提供统一的核心采样控制外壳：
 * 1. 采样算法 (Sampler) 与调度规则 (Scheduler) 选项列表，支持运行时动态拉取与离线缺省备选；
 * 2. 采样步数 (Steps) 与引导系数 (CFG Scale) 滑块，支持根据模型架构（SD 传统 vs Flux/蒸馏）动态自适应区间；
 * 3. 随机种子 (Seed) 控制器，支持 -1 动态随机与固定种子自由切换、一键随机骰子与快速重置；
 * 4. 可选的图生图/重绘幅度 (Denoise) 参数调节；
 * 5. 级联生命周期注销与事件安全释放。
 */

import type { UIComponent, Disposable } from '../types';
import { Card } from '../components/card';
import { Select } from '../components/select';
import { Slider } from '../components/slider';
import { TextInput } from '../components/text-input';
import { Button } from '../components/button';
import { Badge, type BadgeVariant } from '../components/badge';
import { FormField } from '../components/form-field';
import { logger } from '../../util/logger';

/** 采样算法与调度器动态能力描述 */
export interface SamplerCapabilities {
    /** 支持的采样算法选项列表 */
    readonly samplers: Array<{ value: string; label: string }>;
    /** 支持的调度器选项列表（若后端不支持独立调度器则可为空） */
    readonly schedulers?: Array<{ value: string; label: string }>;
}

/** 滑块区间参数定义 */
export interface RangeConfigItem {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly defaultValue?: number;
}

/** 采样参数滑块区间配置集合 */
export interface SamplerRangeConfig {
    readonly steps?: RangeConfigItem;
    readonly cfgScale?: RangeConfigItem;
    readonly denoise?: RangeConfigItem;
}

/** 采样卡片当前数据状态 */
export interface SamplerCardData {
    /** 采样算法标识 */
    samplerName: string;
    /** 调度规则标识 */
    scheduler?: string;
    /** 采样步数 */
    steps: number;
    /** 提示词引导系数 */
    cfgScale: number;
    /** 重绘去噪强度 (0.0 ~ 1.0) */
    denoise?: number;
    /** 随机种子 (-1 为动态随机，正整数为固定种子) */
    seed: number;
}

/** 采样卡片构造选项 */
export interface SamplerCardOptions {
    /** 卡片主标题，默认 "核心采样参数" */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 是否作为嵌入组件（不创建外层 Card 边框与标题） */
    embedded?: boolean;
    /** 初始数据 */
    initialData?: Partial<SamplerCardData>;
    /** 是否展示调度规则选择框，默认 true */
    showScheduler?: boolean;
    /** 是否展示去噪重绘幅度滑块，默认 false */
    showDenoise?: boolean;
    /** 初始采样算法候选列表（不传则使用内置预置列表） */
    initialSamplers?: Array<{ value: string; label: string }>;
    /** 初始调度规则候选列表（不传则使用内置预置列表） */
    initialSchedulers?: Array<{ value: string; label: string }>;
    /** 初始滑块范围配置（默认使用 SD 传统配置） */
    initialRangeConfig?: SamplerRangeConfig;
    /** 动态能力拉取处理函数 */
    onFetchCapabilities?: () => Promise<SamplerCapabilities>;
    /** 数据变更通知回调 */
    onChange?: (data: SamplerCardData) => void;
}

/** 离线内置推荐采样算法列表 */
export const DEFAULT_OFFLINE_SAMPLERS: Array<{ value: string; label: string }> = [
    { value: 'euler', label: 'Euler' },
    { value: 'euler_ancestral', label: 'Euler a' },
    { value: 'dpmpp_2m', label: 'DPM++ 2M' },
    { value: 'dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
    { value: 'dpmpp_sde', label: 'DPM++ SDE' },
    { value: 'ddim', label: 'DDIM' },
    { value: 'uni_pc', label: 'UniPC' }
];

/** 离线内置推荐调度规则列表 */
export const DEFAULT_OFFLINE_SCHEDULERS: Array<{ value: string; label: string }> = [
    { value: 'normal', label: 'Normal' },
    { value: 'karras', label: 'Karras' },
    { value: 'exponential', label: 'Exponential' },
    { value: 'sgm_uniform', label: 'SGM Uniform' },
    { value: 'simple', label: 'Simple' },
    { value: 'ddim_uniform', label: 'DDIM Uniform' },
    { value: 'beta', label: 'Beta' }
];

/** SD 1.5 / SDXL 传统架构参数范围配置 */
export const SD_RANGE_CONFIG: SamplerRangeConfig = {
    steps: { min: 1, max: 150, step: 1, defaultValue: 25 },
    cfgScale: { min: 1.0, max: 30.0, step: 0.5, defaultValue: 7.0 },
    denoise: { min: 0.0, max: 1.0, step: 0.05, defaultValue: 0.7 }
};

/** Flux / 蒸馏 Turbo 架构参数范围配置 */
export const FLUX_RANGE_CONFIG: SamplerRangeConfig = {
    steps: { min: 1, max: 50, step: 1, defaultValue: 4 },
    cfgScale: { min: 1.0, max: 10.0, step: 0.1, defaultValue: 1.0 },
    denoise: { min: 0.0, max: 1.0, step: 0.05, defaultValue: 0.7 }
};

export class SamplerCard implements UIComponent, Disposable {
    public readonly element: HTMLElement;
    public readonly card?: Card;

    private readonly data: SamplerCardData;
    private readonly options: SamplerCardOptions;
    private readonly disposables: Disposable[] = [];

    // 基础控件实例
    private readonly seedBadge: Badge;
    private readonly samplerSelect: Select;
    private readonly schedulerSelect?: Select;
    private readonly stepsSlider: Slider;
    private readonly cfgScaleSlider: Slider;
    private readonly denoiseSlider?: Slider;
    private readonly seedInput: TextInput;
    private readonly randomSeedButton: Button;
    private readonly resetSeedButton: Button;
    private readonly refreshButton?: Button;

    // 表单容器实例
    private readonly samplerFormField: FormField;
    private readonly schedulerFormField?: FormField;
    private readonly stepsFormField: FormField;
    private readonly cfgScaleFormField: FormField;
    private readonly denoiseFormField?: FormField;
    private readonly seedFormField: FormField;

    constructor(options: SamplerCardOptions = {}) {
        this.options = options;
        const initial = options.initialData ?? {};
        const rangeConfig = options.initialRangeConfig ?? SD_RANGE_CONFIG;

        // 1. 初始化数据状态
        this.data = {
            samplerName: initial.samplerName ?? 'euler',
            scheduler: initial.scheduler ?? 'normal',
            steps: initial.steps ?? (rangeConfig.steps?.defaultValue ?? 25),
            cfgScale: initial.cfgScale ?? (rangeConfig.cfgScale?.defaultValue ?? 7.0),
            denoise: initial.denoise ?? (rangeConfig.denoise?.defaultValue ?? 0.7),
            seed: initial.seed ?? -1
        };

        // 2. 初始化徽标
        this.seedBadge = new Badge({
            text: this.getSeedBadgeText(this.data.seed),
            variant: this.getSeedBadgeVariant(this.data.seed)
        });
        this.disposables.push(this.seedBadge);

        // 3. 构建容器或 Card 外壳
        if (options.embedded) {
            this.element = document.createElement('div');
            this.element.className = 'da-sampler-card da-sampler-card--embedded';
        } else {
            const card = new Card({
                title: options.title ?? '核心采样参数',
                subtitle: options.subtitle,
                collapsible: true,
                defaultCollapsed: false
            });
            card.setBadges([this.seedBadge.element]);
            this.card = card;
            this.element = card.element;
            this.disposables.push(card);
        }

        const append = (el: HTMLElement) => {
            if (this.card) {
                this.card.appendContent(el);
            } else {
                this.element.appendChild(el);
            }
        };

        // 4. 构建采样器选择器
        const samplerOptions = options.initialSamplers ?? DEFAULT_OFFLINE_SAMPLERS;
        this.samplerSelect = new Select({
            options: samplerOptions,
            value: this.data.samplerName,
            onChange: (val) => {
                this.data.samplerName = val;
                this.notifyChange();
            }
        });
        this.samplerFormField = new FormField({
            label: '采样算法',
            tooltip: '控制去噪迭代每一步的数值积分算法（Sampler）',
            control: this.samplerSelect
        });
        append(this.samplerFormField.element);
        this.disposables.push(this.samplerSelect, this.samplerFormField);

        // 5. 构建调度器选择器（可选）
        const showScheduler = options.showScheduler ?? true;
        if (showScheduler) {
            const schedulerOptions = options.initialSchedulers ?? DEFAULT_OFFLINE_SCHEDULERS;
            this.schedulerSelect = new Select({
                options: schedulerOptions,
                value: this.data.scheduler ?? 'normal',
                onChange: (val) => {
                    this.data.scheduler = val;
                    this.notifyChange();
                }
            });
            this.schedulerFormField = new FormField({
                label: '调度规则',
                tooltip: '控制时间步与噪声衰减的离散化时间表（Scheduler，适用于 Forge/ComfyUI/SD 1.9+）',
                control: this.schedulerSelect
            });
            append(this.schedulerFormField.element);
            this.disposables.push(this.schedulerSelect, this.schedulerFormField);
        }

        // 6. 构建步数滑块 (Steps)
        const stepsCfg = rangeConfig.steps ?? { min: 1, max: 150, step: 1, defaultValue: 25 };
        this.stepsSlider = new Slider({
            min: stepsCfg.min,
            max: stepsCfg.max,
            step: stepsCfg.step,
            defaultValue: stepsCfg.defaultValue,
            value: this.data.steps,
            onChange: (val) => {
                this.data.steps = Math.round(val);
                this.notifyChange();
            }
        });
        this.stepsFormField = new FormField({
            label: '采样步数',
            tooltip: '迭代去噪的总步数（Steps），Flux 等蒸馏模型推荐 4~8 步，传统模型推荐 20~35 步',
            control: this.stepsSlider
        });
        append(this.stepsFormField.element);
        this.disposables.push(this.stepsSlider, this.stepsFormField);

        // 7. 构建引导系数滑块 (CFG Scale)
        const cfgScaleCfg = rangeConfig.cfgScale ?? { min: 1.0, max: 30.0, step: 0.5, defaultValue: 7.0 };
        this.cfgScaleSlider = new Slider({
            min: cfgScaleCfg.min,
            max: cfgScaleCfg.max,
            step: cfgScaleCfg.step,
            defaultValue: cfgScaleCfg.defaultValue,
            value: this.data.cfgScale,
            onChange: (val) => {
                this.data.cfgScale = val;
                this.notifyChange();
            }
        });
        this.cfgScaleFormField = new FormField({
            label: '引导系数',
            tooltip: '提示词对画面的约束强度（CFG Scale），Flux/蒸馏模型推荐 1.0~3.5，SD1.5/SDXL 推荐 5.0~8.0',
            control: this.cfgScaleSlider
        });
        append(this.cfgScaleFormField.element);
        this.disposables.push(this.cfgScaleSlider, this.cfgScaleFormField);

        // 8. 构建重绘去噪幅度滑块 (Denoise)（可选）
        const showDenoise = options.showDenoise ?? false;
        if (showDenoise) {
            const denoiseCfg = rangeConfig.denoise ?? { min: 0.0, max: 1.0, step: 0.05, defaultValue: 0.7 };
            this.denoiseSlider = new Slider({
                min: denoiseCfg.min,
                max: denoiseCfg.max,
                step: denoiseCfg.step,
                defaultValue: denoiseCfg.defaultValue,
                value: this.data.denoise ?? 0.7,
                onChange: (val) => {
                    this.data.denoise = val;
                    this.notifyChange();
                }
            });
            this.denoiseFormField = new FormField({
                label: '重绘幅度',
                tooltip: '图生图或局部重绘时的去噪比例（Denoise，0.0 完全保留原图，1.0 完全重绘）',
                control: this.denoiseSlider
            });
            append(this.denoiseFormField.element);
            this.disposables.push(this.denoiseSlider, this.denoiseFormField);
        }

        // 9. 构建随机种子控制器 (Seed Controller)
        const seedContainer = document.createElement('div');
        seedContainer.classList.add('da-sampler-card__seed-control');

        const seedInputWrapper = document.createElement('div');
        seedInputWrapper.classList.add('da-sampler-card__seed-input-wrapper');

        this.seedInput = new TextInput({
            value: String(this.data.seed),
            placeholder: '-1',
            onChange: (val) => {
                const parsed = parseInt(val.trim(), 10);
                const nextSeed = Number.isNaN(parsed) || parsed < 0 ? -1 : parsed;
                this.updateSeedInternal(nextSeed);
            }
        });
        seedInputWrapper.appendChild(this.seedInput.element);

        const seedActions = document.createElement('div');
        seedActions.classList.add('da-sampler-card__seed-actions');

        this.randomSeedButton = new Button({
            label: '🎲 随机',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                const generated = Math.floor(Math.random() * 2147483647) + 1;
                this.updateSeedInternal(generated);
            }
        });

        this.resetSeedButton = new Button({
            label: '↺ 动态',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                this.updateSeedInternal(-1);
            }
        });

        seedActions.appendChild(this.randomSeedButton.element);
        seedActions.appendChild(this.resetSeedButton.element);

        seedContainer.appendChild(seedInputWrapper);
        seedContainer.appendChild(seedActions);

        this.seedFormField = new FormField({
            label: '随机种子',
            tooltip: '随机数种子（Seed），设置为 -1 时每次生成使用动态随机种子，设置为具体正整数时固定画面构图',
            control: seedContainer
        });
        append(this.seedFormField.element);
        this.disposables.push(
            this.seedInput,
            this.randomSeedButton,
            this.resetSeedButton,
            this.seedFormField
        );

        // 10. 构建底部操作栏（若提供了 onFetchCapabilities）
        if (options.onFetchCapabilities || this.hasCustomFetchCapabilities()) {
            const actionRow = document.createElement('div');
            actionRow.classList.add('da-sampler-card__actions-row');

            this.refreshButton = new Button({
                label: '刷新可用参数',
                variant: 'secondary',
                size: 'sm',
                onClick: async () => {
                    await this.refreshCapabilities();
                }
            });
            actionRow.appendChild(this.refreshButton.element);
            append(actionRow);
            this.disposables.push(this.refreshButton);
        }
    }

    /**
     * 获取当前卡片完整的参数数据快照。
     */
    public getData(): SamplerCardData {
        return { ...this.data };
    }

    /**
     * 更新卡片中的参数数据，并同步更新各子控件状态。
     *
     * @param partial 待更新的部分数据
     * @param options 配置选项（如 silent）
     */
    public setData(partial: Partial<SamplerCardData>, options?: { silent?: boolean }): void {
        if (partial.samplerName !== undefined) {
            this.data.samplerName = partial.samplerName;
            this.samplerSelect.setValue(partial.samplerName, { silent: true });
        }
        if (partial.scheduler !== undefined && this.schedulerSelect) {
            this.data.scheduler = partial.scheduler;
            this.schedulerSelect.setValue(partial.scheduler, { silent: true });
        }
        if (partial.steps !== undefined) {
            this.data.steps = partial.steps;
            this.stepsSlider.setValue(partial.steps, { silent: true });
        }
        if (partial.cfgScale !== undefined) {
            this.data.cfgScale = partial.cfgScale;
            this.cfgScaleSlider.setValue(partial.cfgScale, { silent: true });
        }
        if (partial.denoise !== undefined && this.denoiseSlider) {
            this.data.denoise = partial.denoise;
            this.denoiseSlider.setValue(partial.denoise, { silent: true });
        }
        if (partial.seed !== undefined) {
            this.data.seed = partial.seed;
            this.seedInput.setValue(String(partial.seed), { silent: true });
            this.seedBadge.setText(this.getSeedBadgeText(partial.seed));
            this.seedBadge.setVariant(this.getSeedBadgeVariant(partial.seed));
        }

        if (!options?.silent) {
            this.notifyChange();
        }
    }

    /**
     * 动态更新采样算法候选项列表。
     *
     * @param samplers 采样算法选项数组
     */
    public setSamplers(samplers: Array<{ value: string; label: string }>): void {
        this.samplerSelect.setOptions(samplers);
        // 若当前选中的采样器不在新列表中，自动选定第一个可用项
        if (samplers.length > 0 && !samplers.some((s) => s.value === this.data.samplerName)) {
            const fallback = samplers[0].value;
            this.data.samplerName = fallback;
            this.samplerSelect.setValue(fallback, { silent: true });
            this.notifyChange();
        }
    }

    /**
     * 动态更新调度规则候选项列表。
     *
     * @param schedulers 调度规则选项数组
     */
    public setSchedulers(schedulers: Array<{ value: string; label: string }>): void {
        if (!this.schedulerSelect) return;
        this.schedulerSelect.setOptions(schedulers);
        if (schedulers.length > 0 && this.data.scheduler && !schedulers.some((s) => s.value === this.data.scheduler)) {
            const fallback = schedulers[0].value;
            this.data.scheduler = fallback;
            this.schedulerSelect.setValue(fallback, { silent: true });
            this.notifyChange();
        }
    }

    /**
     * 根据模型架构动态更新滑块参数取值范围。
     *
     * @param config 新的滑块区间配置
     */
    public setRangeConfig(config: SamplerRangeConfig): void {
        if (config.steps) {
            this.stepsSlider.setRange(
                config.steps.min,
                config.steps.max,
                config.steps.step,
                config.steps.defaultValue
            );
        }
        if (config.cfgScale) {
            this.cfgScaleSlider.setRange(
                config.cfgScale.min,
                config.cfgScale.max,
                config.cfgScale.step,
                config.cfgScale.defaultValue
            );
        }
        if (config.denoise && this.denoiseSlider) {
            this.denoiseSlider.setRange(
                config.denoise.min,
                config.denoise.max,
                config.denoise.step,
                config.denoise.defaultValue
            );
        }
    }

    /**
     * 触发异步能力拉取并动态更新候选项。
     */
    public async refreshCapabilities(): Promise<void> {
        const executor = typeof this.fetchCapabilities === 'function'
            ? this.fetchCapabilities.bind(this)
            : this.options.onFetchCapabilities;

        if (!executor) return;

        this.refreshButton?.setLoading(true);
        try {
            const result: SamplerCapabilities = await executor();
            if (result.samplers && result.samplers.length > 0) {
                this.setSamplers(result.samplers);
            }
            if (result.schedulers && result.schedulers.length > 0) {
                this.setSchedulers(result.schedulers);
            }
        } catch (err) {
            logger.error('[SamplerCard] 刷新采样能力失败:', err instanceof Error ? err.message : String(err));
        } finally {
            this.refreshButton?.setLoading(false);
        }
    }

    /**
     * 可供子类扩展或重载的能力获取函数定义。
     */
    public async fetchCapabilities?(): Promise<SamplerCapabilities>;

    private hasCustomFetchCapabilities(): boolean {
        return typeof this.fetchCapabilities === 'function';
    }

    private updateSeedInternal(nextSeed: number): void {
        this.data.seed = nextSeed;
        this.seedInput.setValue(String(nextSeed), { silent: true });
        this.seedBadge.setText(this.getSeedBadgeText(nextSeed));
        this.seedBadge.setVariant(this.getSeedBadgeVariant(nextSeed));
        this.notifyChange();
    }

    private getSeedBadgeText(seed: number): string {
        return seed === -1 ? '动态随机' : `固定: ${seed}`;
    }

    private getSeedBadgeVariant(seed: number): BadgeVariant {
        return seed === -1 ? 'info' : 'neutral';
    }

    private notifyChange(): void {
        if (this.options.onChange) {
            try {
                this.options.onChange(this.getData());
            } catch (err) {
                logger.error('[SamplerCard] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
    }

    /**
     * 释放卡片内所有子控件与事件监听。
     */
    public dispose(): void {
        for (const item of this.disposables) {
            try {
                item.dispose();
            } catch {
                // 忽略释放异常
            }
        }
        this.disposables.length = 0;
        this.element.parentElement?.removeChild(this.element);
    }
}
