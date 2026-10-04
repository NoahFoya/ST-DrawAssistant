/**
 * 受控多选框组件 (Checkbox)。
 *
 * @remarks
 * 实现 IControlHandle<boolean> 操作句柄：
 * 1. 支持标准勾选、未勾选与 indeterminate 半选中间态；
 * 2. 支持受控状态绑定与变更通知；
 * 3. 规范无障碍设计与禁用状态。
 */

import type { IControlHandle, SetValueOptions, ControlChangeCallback } from '../types';
import { logger } from '../../util/logger';

export interface CheckboxOptions {
    /** 初始勾选状态，默认 false */
    value?: boolean;
    /** 伴随文本内容 */
    label?: string;
    /** 是否处于半选中间态，默认 false */
    indeterminate?: boolean;
    /** 是否禁用，默认 false */
    disabled?: boolean;
    /** 附加类名 */
    className?: string;
    /** 勾选状态变更回调 */
    onChange?: ControlChangeCallback<boolean>;
}

export class Checkbox implements IControlHandle<boolean> {
    public readonly element: HTMLLabelElement;
    private readonly inputElement: HTMLInputElement;
    private readonly labelElement?: HTMLSpanElement;

    private isChecked = false;
    private isIndeterminateState = false;
    private readonly changeCallbacks = new Set<ControlChangeCallback<boolean>>();
    private readonly changeListener: () => void;

    constructor(options: CheckboxOptions = {}) {
        this.isChecked = options.value ?? false;
        this.isIndeterminateState = options.indeterminate ?? false;

        // 1. 创建包装 label 容器
        this.element = document.createElement('label');
        this.element.classList.add('da-checkbox');
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 原生复选框
        this.inputElement = document.createElement('input');
        this.inputElement.type = 'checkbox';
        this.inputElement.classList.add('da-checkbox__input');
        this.inputElement.checked = this.isChecked;
        this.inputElement.indeterminate = this.isIndeterminateState;
        if (options.disabled) {
            this.inputElement.disabled = true;
            this.element.classList.add('da-checkbox--disabled');
        }
        this.element.appendChild(this.inputElement);

        // 3. 自定义视觉方形盒子与勾选图形
        const box = document.createElement('span');
        box.classList.add('da-checkbox__box');
        box.innerHTML = `<svg class="da-checkbox__icon" width="10" height="10" viewBox="0 0 10 10" fill="none"><path class="da-checkbox__check" d="M2 5L4 7.5L8 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path class="da-checkbox__minus" d="M2.5 5H7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
        this.element.appendChild(box);

        // 4. 文字标签
        if (options.label) {
            this.labelElement = document.createElement('span');
            this.labelElement.classList.add('da-checkbox__label');
            this.labelElement.textContent = options.label;
            this.element.appendChild(this.labelElement);
        }

        // 5. 事件分发
        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }

        this.changeListener = () => {
            this.isChecked = this.inputElement.checked;
            this.isIndeterminateState = false; // 用户交互点击后取消半选态
            this.dispatchChange(this.isChecked);
        };
        this.inputElement.addEventListener('change', this.changeListener);
    }

    public getValue(): boolean {
        return this.isChecked;
    }

    public setValue(value: boolean, options?: boolean | SetValueOptions): void {
        const nextValue = Boolean(value);
        this.isChecked = nextValue;
        this.inputElement.checked = nextValue;
        this.isIndeterminateState = false;
        this.inputElement.indeterminate = false;

        const shouldTrigger = typeof options === 'boolean'
            ? options
            : Boolean(options?.triggerChange && !options?.silent);

        if (shouldTrigger) {
            this.dispatchChange(nextValue);
        }
    }

    public setIndeterminate(indeterminate: boolean): void {
        this.isIndeterminateState = indeterminate;
        this.inputElement.indeterminate = indeterminate;
    }

    public isIndeterminate(): boolean {
        return this.isIndeterminateState;
    }

    public setDisabled(disabled: boolean): void {
        this.inputElement.disabled = disabled;
        if (disabled) {
            this.element.classList.add('da-checkbox--disabled');
        } else {
            this.element.classList.remove('da-checkbox--disabled');
        }
    }

    public setDirty(isDirty: boolean): void {
        if (isDirty) {
            this.element.classList.add('da-checkbox--dirty');
        } else {
            this.element.classList.remove('da-checkbox--dirty');
        }
    }

    public onChange(callback: ControlChangeCallback<boolean>): void {
        this.changeCallbacks.add(callback);
    }

    public setLabel(text: string): void {
        if (this.labelElement) {
            this.labelElement.textContent = text;
        }
    }

    private dispatchChange(value: boolean): void {
        for (const cb of this.changeCallbacks) {
            try {
                cb(value);
            } catch (err) {
                logger.error('[Checkbox] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
    }

    public dispose(): void {
        this.inputElement.removeEventListener('change', this.changeListener);
        this.changeCallbacks.clear();
        this.element.parentElement?.removeChild(this.element);
    }
}
