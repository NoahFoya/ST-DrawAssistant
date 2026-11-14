/**
 * 受控下拉选择框组件 (Select)。
 *
 * @remarks
 * 实现 ControlHandle<string> 操作句柄：
 * 1. 支持标准选项与分组选项 (<optgroup>)；
 * 2. 支持受控值读写与异步动态刷新选项；
 * 3. 自定义箭头指示与禁用/脏状态。
 */

import type { ControlHandle, SetValueOptions, ControlChangeCallback } from '../types';
import { logger } from '../../util/logger';

export interface SelectOption {
    /** 选项值 */
    value: string;
    /** 选项显示文本 */
    label: string;
    /** 是否禁用该选项 */
    disabled?: boolean;
}

export interface SelectOptGroup {
    /** 分组标题 */
    label: string;
    /** 分组内选项列表 */
    options: SelectOption[];
}

export interface SelectOptions {
    /** 初始选中值 */
    value?: string;
    /** 选项列表或分组列表 */
    options?: Array<SelectOption | SelectOptGroup>;
    /** 空占位提示（当未选择时显示） */
    placeholder?: string;
    /** 是否禁用，默认 false */
    disabled?: boolean;
    /** 附加类名 */
    className?: string;
    /** 是否处于非法/失效告警态，默认 false */
    invalid?: boolean;
    /** 悬浮详细提示说明 */
    tooltip?: string;
    /** 选中值变更回调 */
    onChange?: ControlChangeCallback<string>;
}

export class Select implements ControlHandle<string> {
    public readonly element: HTMLElement;
    private readonly selectElement: HTMLSelectElement;

    private currentValue = '';
    private placeholder?: string;
    private readonly changeCallbacks = new Set<ControlChangeCallback<string>>();
    private readonly changeListener: () => void;

    constructor(options: SelectOptions = {}) {
        this.placeholder = options.placeholder;
        this.currentValue = options.value ?? '';

        // 1. 创建容器
        this.element = document.createElement('div');
        this.element.classList.add('da-select-wrapper');
        if (options.className) {
            this.element.classList.add(...options.className.trim().split(/\s+/).filter(Boolean));
        }

        // 2. 原生 select
        this.selectElement = document.createElement('select');
        this.selectElement.classList.add('da-select');
        if (options.disabled) {
            this.selectElement.disabled = true;
            this.element.classList.add('da-select-wrapper--disabled');
        }

        // 3. 填充选项
        if (options.options) {
            this.renderOptions(options.options);
        }
        if (this.currentValue) {
            this.selectElement.value = this.currentValue;
        }

        // 4. 自定义下拉箭头
        const arrow = document.createElement('span');
        arrow.classList.add('da-select__arrow');
        arrow.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        this.element.appendChild(this.selectElement);
        this.element.appendChild(arrow);

        // 5. 绑定事件
        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }

        this.changeListener = () => {
            const prevValue = this.currentValue;
            const nextValue = this.selectElement.value;
            this.currentValue = nextValue;
            if (this.dispatchChange(nextValue) === false) {
                this.currentValue = prevValue;
                this.selectElement.value = prevValue;
            }
        };
        this.selectElement.addEventListener('change', this.changeListener);

        if (options.invalid) {
            this.setInvalid(true, options.tooltip);
        }
    }

    public getValue(): string {
        return this.currentValue;
    }

    public setValue(value: string, options?: boolean | SetValueOptions): void {
        const nextValue = value ?? '';
        this.currentValue = nextValue;
        this.selectElement.value = nextValue;

        const shouldTrigger = typeof options === 'boolean'
            ? options
            : Boolean(options?.triggerChange && !options?.silent);

        if (shouldTrigger) {
            this.dispatchChange(nextValue);
        }
    }

    public setOptions(options: Array<SelectOption | SelectOptGroup>): void {
        this.renderOptions(options);
        this.selectElement.value = this.currentValue;
    }

    public setDisabled(disabled: boolean): void {
        this.selectElement.disabled = disabled;
        if (disabled) {
            this.element.classList.add('da-select-wrapper--disabled');
        } else {
            this.element.classList.remove('da-select-wrapper--disabled');
        }
    }

    public setDirty(isDirty: boolean): void {
        if (isDirty) {
            this.element.classList.add('da-select-wrapper--dirty');
        } else {
            this.element.classList.remove('da-select-wrapper--dirty');
        }
    }

    /**
     * 设置控件非法/失效告警态，触发红色描边并绑定悬浮提示。
     */
    public setInvalid(invalid: boolean, tooltip?: string): void {
        if (invalid) {
            this.element.classList.add('is-invalid');
            if (tooltip) {
                this.selectElement.title = tooltip;
            }
        } else {
            this.element.classList.remove('is-invalid');
            this.selectElement.title = '';
        }
    }

    public onChange(callback: ControlChangeCallback<string>): void {
        this.changeCallbacks.add(callback);
    }

    private renderOptions(items: Array<SelectOption | SelectOptGroup>): void {
        this.selectElement.innerHTML = '';

        if (this.placeholder) {
            const placeholderOpt = document.createElement('option');
            placeholderOpt.value = '';
            placeholderOpt.textContent = this.placeholder;
            placeholderOpt.disabled = true;
            if (!this.currentValue) {
                placeholderOpt.selected = true;
            }
            this.selectElement.appendChild(placeholderOpt);
        }

        for (const item of items) {
            if ('options' in item) {
                // 分组选项
                const optGroup = document.createElement('optgroup');
                optGroup.label = item.label;
                for (const subOption of item.options) {
                    optGroup.appendChild(this.createOptionElement(subOption));
                }
                this.selectElement.appendChild(optGroup);
            } else {
                // 普通选项
                this.selectElement.appendChild(this.createOptionElement(item));
            }
        }
    }

    private createOptionElement(option: SelectOption): HTMLOptionElement {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        if (option.disabled) {
            opt.disabled = true;
        }
        return opt;
    }

    private dispatchChange(value: string): boolean {
        let accepted = true;
        for (const cb of this.changeCallbacks) {
            try {
                if (cb(value) === false) {
                    accepted = false;
                }
            } catch (err) {
                logger.error('[Select] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
        return accepted;
    }

    public dispose(): void {
        this.selectElement.removeEventListener('change', this.changeListener);
        this.changeCallbacks.clear();
        this.element.parentElement?.removeChild(this.element);
    }
}
