/**
 * ST-DrawAssistant 复合数值滑块原子控件。
 *
 * @remarks
 * 包含轨道滑块与等宽数字输入框双向联动，动态维护 --slider-percent 渐变进度。
 * 支持连续拖动与键盘精准微调。
 */

import type { SetValueOptions, SliderComponent, SliderOptions } from './types';

export function createSlider(options: SliderOptions): SliderComponent {
    const container = document.createElement('div');
    container.classList.add('da-slider-composite');

    if (options.className) {
        container.classList.add(...options.className.split(' ').filter(Boolean));
    }
    if (options.disabled) {
        container.classList.add('is-disabled');
    }

    const min = options.min;
    const max = options.max;
    const step = options.step !== undefined ? options.step : 1;
    const initialVal = options.value !== undefined ? options.value : min;

    // 1. 滑块轨道与滑钮
    const trackWrap = document.createElement('div');
    trackWrap.classList.add('da-slider-track-wrap');

    const rangeInput = document.createElement('input');
    rangeInput.type = 'range';
    rangeInput.classList.add('da-slider-range');
    rangeInput.min = String(min);
    rangeInput.max = String(max);
    rangeInput.step = String(step);
    rangeInput.value = String(initialVal);
    if (options.disabled) {
        rangeInput.disabled = true;
    }

    trackWrap.appendChild(rangeInput);
    container.appendChild(trackWrap);

    // 2. 右侧数字微调框 (默认开启)
    let numberInput: HTMLInputElement | undefined;
    if (options.showInput !== false) {
        numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.classList.add('da-input', 'da-input--num-short');
        numberInput.min = String(min);
        numberInput.max = String(max);
        numberInput.step = String(step);
        numberInput.value = String(initialVal);
        if (options.disabled) {
            numberInput.disabled = true;
        }
        container.appendChild(numberInput);
    }

    // 3. 动态维护 CSS 变量进度值
    const updatePercent = (numVal: number) => {
        const clamped = Math.max(min, Math.min(max, numVal));
        const span = max - min;
        const percent = span > 0 ? ((clamped - min) / span) * 100 : 0;
        rangeInput.style.setProperty('--slider-percent', `${percent.toFixed(2)}%`);
    };

    updatePercent(initialVal);

    // 4. 事件联动处理
    let rangeInputHandler: ((e: Event) => void) | null = null;
    let rangeChangeHandler: ((e: Event) => void) | null = null;
    let numInputHandler: ((e: Event) => void) | null = null;
    let numChangeHandler: ((e: Event) => void) | null = null;

    rangeInputHandler = () => {
        const val = parseFloat(rangeInput.value);
        updatePercent(val);
        if (numberInput) {
            numberInput.value = String(val);
        }
        options.onInput?.(val);
    };
    rangeInput.addEventListener('input', rangeInputHandler);

    rangeChangeHandler = () => {
        const val = parseFloat(rangeInput.value);
        options.onChange?.(val);
    };
    rangeInput.addEventListener('change', rangeChangeHandler);

    if (numberInput) {
        numInputHandler = () => {
            const val = parseFloat(numberInput!.value);
            if (!Number.isNaN(val)) {
                rangeInput.value = String(val);
                updatePercent(val);
                options.onInput?.(val);
            }
        };
        numberInput.addEventListener('input', numInputHandler);

        numChangeHandler = () => {
            let val = parseFloat(numberInput!.value);
            if (Number.isNaN(val)) {
                val = min;
            }
            val = Math.max(min, Math.min(max, val));
            numberInput!.value = String(val);
            rangeInput.value = String(val);
            updatePercent(val);
            options.onChange?.(val);
        };
        numberInput.addEventListener('change', numChangeHandler);
    }

    return {
        get element() {
            return container;
        },
        get rangeElement() {
            return rangeInput;
        },
        get numberInputElement() {
            return numberInput;
        },
        getValue(): number {
            return parseFloat(rangeInput.value);
        },
        setValue(value: number, setValOptions?: SetValueOptions): void {
            const clamped = Math.max(min, Math.min(max, value));
            rangeInput.value = String(clamped);
            if (numberInput) {
                numberInput.value = String(clamped);
            }
            updatePercent(clamped);
            if (setValOptions?.triggerChange) {
                options.onChange?.(clamped);
            }
        },
        setDisabled(disabled: boolean): void {
            container.classList.toggle('is-disabled', disabled);
            rangeInput.disabled = disabled;
            if (numberInput) {
                numberInput.disabled = disabled;
            }
        },
        markDirty(dirty: boolean): void {
            container.classList.toggle('is-dirty', dirty);
            if (numberInput) {
                numberInput.classList.toggle('is-dirty', dirty);
            }
        },
        setDirty(isDirty: boolean): void {
            this.markDirty(isDirty);
        },
        dispose(): void {
            if (rangeInputHandler) {
                rangeInput.removeEventListener('input', rangeInputHandler);
                rangeInputHandler = null;
            }
            if (rangeChangeHandler) {
                rangeInput.removeEventListener('change', rangeChangeHandler);
                rangeChangeHandler = null;
            }
            if (numberInput && numInputHandler) {
                numberInput.removeEventListener('input', numInputHandler);
                numInputHandler = null;
            }
            if (numberInput && numChangeHandler) {
                numberInput.removeEventListener('change', numChangeHandler);
                numChangeHandler = null;
            }
        },
    };
}
