/**
 * 受控数值步进微调输入组件 (NumberInput)。
 *
 * @remarks
 * 实现 IControlHandle<number> 操作句柄：
 * 1. 支持区间约束 [min, max] 与步长增减按钮 (+/-)；
 * 2. 失焦自动进行合法性校验与精度对齐；
 * 3. 支持键盘上下箭头微调；
 * 4. 具备受控更新与脏状态指示。
 */

import type { IControlHandle, SetValueOptions, ControlChangeCallback } from '../types';
import { logger } from '../../util/logger';

export interface NumberInputOptions {
    /** 初始数值，默认 0 */
    value?: number;
    /** 最小值限制 */
    min?: number;
    /** 最大值限制 */
    max?: number;
    /** 步长，默认 1 */
    step?: number;
    /** 小数精度位数，默认 0 */
    precision?: number;
    /** 是否禁用，默认 false */
    disabled?: boolean;
    /** 单位后缀（如 px, % 等） */
    unit?: string;
    /** 附加类名 */
    className?: string;
    /** 值变更回调 */
    onChange?: ControlChangeCallback<number>;
}

export class NumberInput implements IControlHandle<number> {
    public readonly element: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly minusBtn: HTMLButtonElement;
    private readonly plusBtn: HTMLButtonElement;

    private currentValue: number;
    private readonly min?: number;
    private readonly max?: number;
    private readonly step: number;
    private readonly precision: number;

    private readonly changeCallbacks = new Set<ControlChangeCallback<number>>();
    private readonly minusListener: () => void;
    private readonly plusListener: () => void;
    private readonly changeListener: () => void;
    private readonly blurListener: () => void;

    constructor(options: NumberInputOptions = {}) {
        this.min = options.min;
        this.max = options.max;
        this.step = options.step ?? 1;
        this.precision = options.precision ?? this.inferPrecision(this.step);

        const rawValue = options.value ?? (this.min ?? 0);
        this.currentValue = this.clampAndFormat(rawValue);

        // 1. 创建容器
        this.element = document.createElement('div');
        this.element.classList.add('da-number-input');
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 减号按钮
        this.minusBtn = document.createElement('button');
        this.minusBtn.type = 'button';
        this.minusBtn.classList.add('da-number-input__btn', 'da-number-input__btn--minus');
        this.minusBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
        this.minusListener = () => this.stepDown();
        this.minusBtn.addEventListener('click', this.minusListener);
        this.element.appendChild(this.minusBtn);

        // 3. 原生数值输入框
        this.inputElement = document.createElement('input');
        this.inputElement.type = 'number';
        this.inputElement.classList.add('da-input', 'da-number-input__field');
        if (this.min !== undefined) this.inputElement.min = String(this.min);
        if (this.max !== undefined) this.inputElement.max = String(this.max);
        this.inputElement.step = String(this.step);
        this.inputElement.value = this.currentValue.toFixed(this.precision);

        this.changeListener = () => {
            const parsed = parseFloat(this.inputElement.value);
            if (!isNaN(parsed)) {
                this.updateValue(parsed, true);
            }
        };
        this.blurListener = () => {
            const parsed = parseFloat(this.inputElement.value);
            const clamped = isNaN(parsed) ? (this.min ?? 0) : parsed;
            this.updateValue(clamped, false);
            this.inputElement.value = this.currentValue.toFixed(this.precision);
        };

        this.inputElement.addEventListener('input', this.changeListener);
        this.inputElement.addEventListener('blur', this.blurListener);
        this.element.appendChild(this.inputElement);

        // 4. 加号按钮
        this.plusBtn = document.createElement('button');
        this.plusBtn.type = 'button';
        this.plusBtn.classList.add('da-number-input__btn', 'da-number-input__btn--plus');
        this.plusBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2V8M2 5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
        this.plusListener = () => this.stepUp();
        this.plusBtn.addEventListener('click', this.plusListener);
        this.element.appendChild(this.plusBtn);

        // 5. 单位
        if (options.unit) {
            const unitEl = document.createElement('span');
            unitEl.classList.add('da-number-input__unit');
            unitEl.textContent = options.unit;
            this.element.appendChild(unitEl);
        }

        if (options.disabled) {
            this.setDisabled(true);
        }

        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }
        this.updateBtnStates();
    }

    public getValue(): number {
        return this.currentValue;
    }

    public setValue(value: number, options?: boolean | SetValueOptions): void {
        const nextValue = this.clampAndFormat(value);
        this.currentValue = nextValue;
        this.inputElement.value = nextValue.toFixed(this.precision);
        this.updateBtnStates();

        const shouldTrigger = typeof options === 'boolean'
            ? options
            : Boolean(options?.triggerChange && !options?.silent);

        if (shouldTrigger) {
            this.dispatchChange(nextValue);
        }
    }

    public stepUp(): void {
        if (this.inputElement.disabled) return;
        const target = this.currentValue + this.step;
        this.updateValue(target, true);
    }

    public stepDown(): void {
        if (this.inputElement.disabled) return;
        const target = this.currentValue - this.step;
        this.updateValue(target, true);
    }

    public setDisabled(disabled: boolean): void {
        this.inputElement.disabled = disabled;
        this.minusBtn.disabled = disabled;
        this.plusBtn.disabled = disabled;
        if (disabled) {
            this.element.classList.add('da-number-input--disabled');
        } else {
            this.element.classList.remove('da-number-input--disabled');
            this.updateBtnStates();
        }
    }

    public setDirty(isDirty: boolean): void {
        if (isDirty) {
            this.element.classList.add('da-number-input--dirty');
        } else {
            this.element.classList.remove('da-number-input--dirty');
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
        if (this.min !== undefined && result < this.min) result = this.min;
        if (this.max !== undefined && result > this.max) result = this.max;
        return parseFloat(result.toFixed(this.precision));
    }

    private updateValue(target: number, trigger: boolean): void {
        const clamped = this.clampAndFormat(target);
        const hasChanged = clamped !== this.currentValue;
        this.currentValue = clamped;
        this.inputElement.value = clamped.toFixed(this.precision);
        this.updateBtnStates();

        if (trigger && hasChanged) {
            this.dispatchChange(clamped);
        }
    }

    private updateBtnStates(): void {
        if (this.inputElement.disabled) return;
        if (this.min !== undefined) {
            this.minusBtn.disabled = this.currentValue <= this.min;
        }
        if (this.max !== undefined) {
            this.plusBtn.disabled = this.currentValue >= this.max;
        }
    }

    private dispatchChange(value: number): void {
        for (const cb of this.changeCallbacks) {
            try {
                cb(value);
            } catch (err) {
                logger.error('[NumberInput] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
    }

    public dispose(): void {
        this.minusBtn.removeEventListener('click', this.minusListener);
        this.plusBtn.removeEventListener('click', this.plusListener);
        this.inputElement.removeEventListener('input', this.changeListener);
        this.inputElement.removeEventListener('blur', this.blurListener);
        this.changeCallbacks.clear();
        this.element.parentElement?.removeChild(this.element);
    }
}
