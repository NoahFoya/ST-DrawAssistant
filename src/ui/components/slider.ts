/**
 * 受控连续范围滑块组件 (Slider)。
 *
 * @remarks
 * 实现 IControlHandle<number> 操作句柄：
 * 1. 原生 range 滑块并集成实时数值指示气泡与单位后缀；
 * 2. 支持双击滑块重置为默认基准值；
 * 3. 支持精确步长与区间边界截断。
 */

import type { IControlHandle, SetValueOptions, ControlChangeCallback } from '../types';
import { logger } from '../../util/logger';

export interface SliderOptions {
    /** 初始滑块值 */
    value?: number;
    /** 最小值，默认 0 */
    min?: number;
    /** 最大值，默认 100 */
    max?: number;
    /** 步长，默认 1 */
    step?: number;
    /** 双击重置默认基准值 */
    defaultValue?: number;
    /** 是否在右侧展示实时数值，默认 true */
    showValue?: boolean;
    /** 数值单位后缀 (如 px, %, s 等) */
    unit?: string;
    /** 小数精度位数，默认 0 */
    precision?: number;
    /** 是否禁用，默认 false */
    disabled?: boolean;
    /** 附加类名 */
    className?: string;
    /** 数值变更回调 */
    onChange?: ControlChangeCallback<number>;
}

export class Slider implements IControlHandle<number> {
    public readonly element: HTMLElement;
    private readonly rangeInput: HTMLInputElement;
    private readonly valueDisplay?: HTMLElement;

    private currentValue: number;
    private defaultValue?: number;
    private min: number;
    private max: number;
    private step: number;
    private precision: number;
    private readonly unit: string;

    private readonly changeCallbacks = new Set<ControlChangeCallback<number>>();
    private readonly inputListener: () => void;
    private readonly dblclickListener: () => void;

    constructor(options: SliderOptions = {}) {
        this.min = options.min ?? 0;
        this.max = options.max ?? 100;
        this.step = options.step ?? 1;
        this.precision = options.precision ?? this.inferPrecision(this.step);
        this.unit = options.unit ?? '';
        this.defaultValue = options.defaultValue;

        const raw = options.value ?? (this.defaultValue ?? this.min);
        this.currentValue = this.clampAndFormat(raw);

        // 1. 创建容器
        this.element = document.createElement('div');
        this.element.classList.add('da-slider-wrapper');
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 原生 range input
        this.rangeInput = document.createElement('input');
        this.rangeInput.type = 'range';
        this.rangeInput.classList.add('da-slider');
        this.rangeInput.min = String(this.min);
        this.rangeInput.max = String(this.max);
        this.rangeInput.step = String(this.step);
        this.rangeInput.value = String(this.currentValue);
        if (options.disabled) {
            this.rangeInput.disabled = true;
            this.element.classList.add('da-slider-wrapper--disabled');
        }
        this.element.appendChild(this.rangeInput);

        // 3. 数值文本指示
        const showValue = options.showValue ?? true;
        if (showValue) {
            this.valueDisplay = document.createElement('span');
            this.valueDisplay.classList.add('da-slider__value');
            this.updateDisplay();
            this.element.appendChild(this.valueDisplay);
        }

        // 4. 事件监听
        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }

        this.inputListener = () => {
            const parsed = parseFloat(this.rangeInput.value);
            this.currentValue = this.clampAndFormat(parsed);
            this.updateDisplay();
            this.dispatchChange(this.currentValue);
        };
        this.rangeInput.addEventListener('input', this.inputListener);

        this.dblclickListener = () => {
            if (this.defaultValue !== undefined && !this.rangeInput.disabled) {
                this.resetToDefault();
            }
        };
        this.rangeInput.addEventListener('dblclick', this.dblclickListener);
    }

    public getValue(): number {
        return this.currentValue;
    }

    public setValue(value: number, options?: boolean | SetValueOptions): void {
        const nextValue = this.clampAndFormat(value);
        this.currentValue = nextValue;
        this.rangeInput.value = String(nextValue);
        this.updateDisplay();

        const shouldTrigger = typeof options === 'boolean'
            ? options
            : Boolean(options?.triggerChange && !options?.silent);

        if (shouldTrigger) {
            this.dispatchChange(nextValue);
        }
    }

    public resetToDefault(): void {
        if (this.defaultValue !== undefined) {
            this.setValue(this.defaultValue, { triggerChange: true });
        }
    }

    /**
     * 动态更新滑块取值区间与步长。
     *
     * @param min 最小值
     * @param max 最大值
     * @param step 步长
     * @param defaultValue 双击重置基准值
     */
    public setRange(min: number, max: number, step?: number, defaultValue?: number): void {
        this.min = min;
        this.max = max;
        if (step !== undefined) {
            this.step = step;
            this.precision = this.inferPrecision(step);
            this.rangeInput.step = String(step);
        }
        if (defaultValue !== undefined) {
            this.defaultValue = defaultValue;
        }
        this.rangeInput.min = String(min);
        this.rangeInput.max = String(max);
        this.setValue(this.currentValue);
    }

    public setDisabled(disabled: boolean): void {
        this.rangeInput.disabled = disabled;
        if (disabled) {
            this.element.classList.add('da-slider-wrapper--disabled');
        } else {
            this.element.classList.remove('da-slider-wrapper--disabled');
        }
    }

    public setDirty(isDirty: boolean): void {
        if (isDirty) {
            this.element.classList.add('da-slider-wrapper--dirty');
        } else {
            this.element.classList.remove('da-slider-wrapper--dirty');
        }
    }

    public onChange(callback: ControlChangeCallback<number>): void {
        this.changeCallbacks.add(callback);
    }

    private inferPrecision(step: number): number {
        const stepStr = String(step);
        const decimalIdx = stepStr.indexOf('.');
        return decimalIdx >= 0 ? stepStr.length - decimalIdx - 1 : 0;
    }

    private clampAndFormat(val: number): number {
        let result = val;
        if (result < this.min) result = this.min;
        if (result > this.max) result = this.max;
        return parseFloat(result.toFixed(this.precision));
    }

    private updateDisplay(): void {
        if (this.valueDisplay) {
            this.valueDisplay.textContent = `${this.currentValue.toFixed(this.precision)}${this.unit}`;
        }
    }

    private dispatchChange(value: number): void {
        for (const cb of this.changeCallbacks) {
            try {
                cb(value);
            } catch (err) {
                logger.error('[Slider] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
    }

    public dispose(): void {
        this.rangeInput.removeEventListener('input', this.inputListener);
        this.rangeInput.removeEventListener('dblclick', this.dblclickListener);
        this.changeCallbacks.clear();
        this.element.parentElement?.removeChild(this.element);
    }
}
