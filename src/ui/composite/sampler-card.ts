/**
 * 采样超参数卡片组件 (SamplerCard)
 * 封装采样器、调度器、迭代步数、CFG Scale 与随机种子控制器。
 * 供 SD-WebUI 与 ComfyUI 生图引擎界面共用。
 */

import { SamplerParamsModel } from './types';
import { createSelect, SelectHandle } from '../components/select';
import { createNumberInput, NumberInputHandle } from '../components/input';
import { createIconButton, IconButtonHandle } from '../components/button';
import { createFormField } from '../components/form-field';
import { SelectOptionItem } from '../components/types';

export const DEFAULT_SAMPLERS = [
    'euler',
    'euler_ancestral',
    'dpmpp_2m',
    'dpmpp_sde',
    'dpmpp_2m_sde',
    'heun',
    'dpm_2',
    'lms',
    'ddim',
    'uni_pc'
];

export const DEFAULT_SCHEDULERS = [
    'normal',
    'karras',
    'exponential',
    'sgm_uniform',
    'simple',
    'ddim_uniform'
];

export interface SamplerCardOptions {
    value?: Partial<SamplerParamsModel>;
    samplers?: string[];
    schedulers?: string[];
    onChange?: (val: SamplerParamsModel) => void;
    className?: string;
}

export interface SamplerCardHandle {
    readonly element: HTMLElement;
    getValue(): SamplerParamsModel;
    setValue(val: Partial<SamplerParamsModel>): void;
    setSamplers(samplers: string[]): void;
    setSchedulers(schedulers: string[]): void;
    setDisabled(disabled: boolean): void;
    dispose(): void;
}

export function createSamplerCard(options: SamplerCardOptions = {}): SamplerCardHandle {
    const root = document.createElement('div');
    root.className = 'da-sampler-card da-card';
    if (options.className) root.classList.add(options.className);

    const body = document.createElement('div');
    body.className = 'da-card__body';

    let currentParams: SamplerParamsModel = {
        sampler: options.value?.sampler || 'euler',
        scheduler: options.value?.scheduler || 'normal',
        steps: options.value?.steps ?? 20,
        cfgScale: options.value?.cfgScale ?? 7.0,
        seed: options.value?.seed ?? -1
    };

    let availableSamplers = options.samplers || DEFAULT_SAMPLERS;
    let availableSchedulers = options.schedulers || DEFAULT_SCHEDULERS;

    const toOptions = (list: string[]): SelectOptionItem[] =>
        list.map((item) => ({ label: item, value: item }));

    // 1. 采样算法
    const samplerSelect: SelectHandle = createSelect({
        options: toOptions(availableSamplers),
        value: currentParams.sampler,
        onChange: (val) => {
            currentParams.sampler = val;
            triggerChange();
        }
    });
    const samplerRow = createFormField({
        label: '采样算法 (Sampler)',
        helpText: '降噪扩散算法模型，推荐 euler 或 dpmpp_2m',
        control: samplerSelect
    });
    body.appendChild(samplerRow.element);

    // 2. 调度器模式
    const schedulerSelect: SelectHandle = createSelect({
        options: toOptions(availableSchedulers),
        value: currentParams.scheduler,
        onChange: (val) => {
            currentParams.scheduler = val;
            triggerChange();
        }
    });
    const schedulerRow = createFormField({
        label: '调度器 (Scheduler)',
        helpText: '采样噪声时间步衰减曲线，推荐 karras 或 normal',
        control: schedulerSelect
    });
    body.appendChild(schedulerRow.element);

    // 3. 采样步数
    const stepsInput: NumberInputHandle = createNumberInput({
        value: currentParams.steps,
        min: 1,
        max: 150,
        step: 1,
        unit: '步',
        variant: 'short',
        onChange: (val) => {
            currentParams.steps = val;
            triggerChange();
        }
    });
    const stepsRow = createFormField({
        label: '迭代步数 (Steps)',
        helpText: '生成计算迭代轮数，一般推荐 20 ~ 30 步',
        control: stepsInput
    });
    body.appendChild(stepsRow.element);

    // 4. CFG Scale (提示词引导系数)
    const cfgInput: NumberInputHandle = createNumberInput({
        value: currentParams.cfgScale,
        min: 1.0,
        max: 30.0,
        step: 0.5,
        unit: 'CFG',
        variant: 'short',
        onChange: (val) => {
            currentParams.cfgScale = val;
            triggerChange();
        }
    });
    const cfgRow = createFormField({
        label: '提示词相关性 (CFG)',
        helpText: '画面对提示词的服从强度，过高易导致画面过饱和或崩坏',
        control: cfgInput
    });
    body.appendChild(cfgRow.element);

    // 5. 随机种子 (带随机骰子按钮)
    const seedWrap = document.createElement('div');
    seedWrap.className = 'da-seed-wrapper';
    seedWrap.style.display = 'flex';
    seedWrap.style.alignItems = 'center';
    seedWrap.style.gap = '6px';

    const seedInput: NumberInputHandle = createNumberInput({
        value: currentParams.seed,
        min: -1,
        max: 99999999999999,
        step: 1,
        variant: 'short',
        onChange: (val) => {
            currentParams.seed = val;
            triggerChange();
        }
    });

    const diceBtn: IconButtonHandle = createIconButton({
        icon: 'dice',
        title: '设为随机种子 (-1)',
        onClick: () => {
            currentParams.seed = -1;
            seedInput.setValue(-1);
            triggerChange();
        }
    });

    seedWrap.appendChild(seedInput.element);
    seedWrap.appendChild(diceBtn.element);

    const seedRow = createFormField({
        label: '随机种子 (Seed)',
        helpText: '固定数值可重现画面细节，设为 -1 代表每次出图生成随机种子',
        control: seedWrap
    });
    body.appendChild(seedRow.element);

    root.appendChild(body);

    const triggerChange = () => {
        options.onChange?.({ ...currentParams });
    };

    return {
        element: root,
        getValue(): SamplerParamsModel {
            return { ...currentParams };
        },
        setValue(val: Partial<SamplerParamsModel>): void {
            if (val.sampler !== undefined) {
                currentParams.sampler = val.sampler;
                samplerSelect.setValue(val.sampler);
            }
            if (val.scheduler !== undefined) {
                currentParams.scheduler = val.scheduler;
                schedulerSelect.setValue(val.scheduler);
            }
            if (val.steps !== undefined) {
                currentParams.steps = val.steps;
                stepsInput.setValue(val.steps);
            }
            if (val.cfgScale !== undefined) {
                currentParams.cfgScale = val.cfgScale;
                cfgInput.setValue(val.cfgScale);
            }
            if (val.seed !== undefined) {
                currentParams.seed = val.seed;
                seedInput.setValue(val.seed);
            }
        },
        setSamplers(samplers: string[]): void {
            availableSamplers = samplers;
            samplerSelect.setOptions(toOptions(samplers), currentParams.sampler);
        },
        setSchedulers(schedulers: string[]): void {
            availableSchedulers = schedulers;
            schedulerSelect.setOptions(toOptions(schedulers), currentParams.scheduler);
        },
        setDisabled(disabled: boolean): void {
            samplerSelect.setDisabled(disabled);
            schedulerSelect.setDisabled(disabled);
            stepsInput.setDisabled(disabled);
            cfgInput.setDisabled(disabled);
            seedInput.setDisabled(disabled);
            diceBtn.setDisabled(disabled);
        },
        dispose(): void {
            samplerSelect.dispose?.();
            schedulerSelect.dispose?.();
            stepsInput.dispose?.();
            cfgInput.dispose?.();
            seedInput.dispose?.();
            diceBtn.dispose();
            samplerRow.dispose?.();
            schedulerRow.dispose?.();
            stepsRow.dispose?.();
            cfgRow.dispose?.();
            seedRow.dispose?.();
            root.remove();
        }
    };
}
