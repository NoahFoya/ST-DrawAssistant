/**
 * 复合数值滑块控件 (Slider)
 *
 * 功能：
 * 1. 组合原生 range 轨道与等宽数字微调输入框 (NumberInput)；
 * 2. 支持宏观平滑拖动与微观精准定点，双向无缝联动；
 * 3. 动态更新 --slider-percent CSS 变量，驱动进度高亮条实时着色。
 *
 * Tips：
 * 1. 滑动与输入联动时采用 isInternalUpdating 锁防重入，避免事件死循环；
 * 2. 支持 setRange 动态调整极值区间与步长，并自动重新钳制当前值。
 */

import type { BaseControlOptions, IControlHandle } from '@types';
import { createNumberInput, NumberInputHandle } from './input';

export interface SliderOptions extends BaseControlOptions {
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    precision?: number;
    /** 是否并排内联等宽上下箭头微调框，默认为 true */
    showNumberInput?: boolean;
    numberVariant?: 'normal' | 'short' | 'small';
    onChange?: (val: number) => void;
}

export interface SliderHandle extends IControlHandle<number> {
    readonly sliderElement: HTMLInputElement;
    readonly numberInputHandle?: NumberInputHandle;
    setRange(min: number, max: number, step?: number): void;
    focus(): void;
    select(): void;
}

export function createSlider(options: SliderOptions): SliderHandle {
    let min = options.min ?? 0;
    let max = options.max ?? 100;
    let step = options.step ?? 1;

    // 计算步长有效小数位数
    const getPrecision = (num: number): number => {
        const s = num.toString();
        const dot = s.indexOf('.');
        return dot >= 0 ? s.length - dot - 1 : 0;
    };
    const precision = options.precision ?? getPrecision(step);

    const clamp = (val: number): number => {
        const clamped = Math.min(max, Math.max(min, val));
        return parseFloat(clamped.toFixed(precision));
    };

    let currentValue = clamp(options.value ?? options.defaultValue ?? min);

    // 1. 根容器
    const root = document.createElement('div');
    root.className = 'da-slider-composite';
    if (options.className) root.classList.add(options.className);
    if (options.disabled) root.classList.add('is-disabled');

    // 2. 滑块轨道容器
    const trackWrap = document.createElement('div');
    trackWrap.className = 'da-slider-track-wrap';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'da-slider-range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(currentValue);
    if (options.id) slider.id = options.id;
    if (options.name) slider.name = options.name;
    if (options.disabled) slider.disabled = true;
    if (options.ariaLabel) slider.setAttribute('aria-label', options.ariaLabel);

    const updatePercent = (val: number) => {
        const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
        slider.style.setProperty('--slider-percent', `${pct}%`);
    };

    updatePercent(currentValue);
    trackWrap.appendChild(slider);
    root.appendChild(trackWrap);

    // 3. 右侧内联等宽上下箭头微调框 (NumberInput)
    let numberComp: NumberInputHandle | undefined;
    const showNumberInput = options.showNumberInput !== false;

    let isInternalUpdating = false;

    if (showNumberInput) {
        numberComp = createNumberInput({
            value: currentValue,
            defaultValue: options.defaultValue ?? min,
            min,
            max,
            step,
            unit: options.unit,
            variant: options.numberVariant ?? 'small',
            disabled: options.disabled,
            ariaLabel: options.ariaLabel ? `${options.ariaLabel} 数值` : undefined,
            onChange: (num) => {
                if (isInternalUpdating) return;
                const clamped = clamp(num);
                currentValue = clamped;
                isInternalUpdating = true;
                slider.value = String(clamped);
                updatePercent(clamped);
                isInternalUpdating = false;
                options.onChange?.(clamped);
            }
        });
        root.appendChild(numberComp.element);
    }

    // 4. 滑块事件绑定
    const onSliderInput = () => {
        if (isInternalUpdating) return;
        const num = clamp(parseFloat(slider.value));
        currentValue = num;
        updatePercent(num);
        if (numberComp) {
            isInternalUpdating = true;
            numberComp.setValue(num);
            isInternalUpdating = false;
        }
        options.onChange?.(num);
    };

    slider.addEventListener('input', onSliderInput);
    slider.addEventListener('change', onSliderInput);

    return {
        element: root,
        sliderElement: slider,
        numberInputHandle: numberComp,
        getValue(): number {
            return currentValue;
        },
        setValue(val: number): void {
            const clamped = clamp(val);
            currentValue = clamped;
            slider.value = String(clamped);
            updatePercent(clamped);
            if (numberComp) {
                isInternalUpdating = true;
                numberComp.setValue(clamped);
                isInternalUpdating = false;
            }
        },
        setRange(newMin: number, newMax: number, newStep?: number): void {
            min = newMin;
            max = newMax;
            if (newStep !== undefined) step = newStep;
            slider.min = String(min);
            slider.max = String(max);
            slider.step = String(step);
            const clamped = clamp(currentValue);
            this.setValue(clamped);
        },
        setDisabled(disabled: boolean): void {
            slider.disabled = disabled;
            root.classList.toggle('is-disabled', disabled);
            numberComp?.setDisabled(disabled);
        },
        setDirty(isDirty: boolean): void {
            root.classList.toggle('is-dirty', isDirty);
            slider.classList.toggle('is-dirty', isDirty);
            numberComp?.setDirty?.(isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            root.classList.toggle('is-invalid', hasError);
            slider.classList.toggle('is-invalid', hasError);
            numberComp?.setError?.(hasError, message);
        },
        focus(): void {
            if (numberComp) {
                numberComp.focus();
            } else {
                slider.focus();
            }
        },
        select(): void {
            if (numberComp) {
                numberComp.select();
            } else {
                slider.focus();
            }
        },
        dispose(): void {
            slider.removeEventListener('input', onSliderInput);
            slider.removeEventListener('change', onSliderInput);
            numberComp?.dispose?.();
            root.remove();
        }
    };
}
