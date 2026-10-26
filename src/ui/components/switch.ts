/**
 * 受控拨动开关组件 (Switch)。
 *
 * @remarks
 * 实现 IControlHandle<boolean> 操作句柄：
 * 1. 胶囊轨道滑动动画；
 * 2. 支持受控布尔值绑定与变更通知；
 * 3. 支持标签文本与禁用态。
 */

import type { IControlHandle, SetValueOptions, ControlChangeCallback } from '../types';
import { logger } from '../../util/logger';

export interface SwitchOptions {
    /** 初始开关状态，默认 false */
    value?: boolean;
    /** 开关伴随标签文本 */
    label?: string;
    /** 是否禁用，默认 false */
    disabled?: boolean;
    /** 附加类名 */
    className?: string;
    /** 状态切换回调 */
    onChange?: ControlChangeCallback<boolean>;
}

export class Switch implements IControlHandle<boolean> {
    public readonly element: HTMLLabelElement;
    private readonly inputElement: HTMLInputElement;
    private readonly labelElement?: HTMLSpanElement;

    private isChecked = false;
    private readonly changeCallbacks = new Set<ControlChangeCallback<boolean>>();
    private readonly changeListener: () => void;

    constructor(options: SwitchOptions = {}) {
        this.isChecked = options.value ?? false;

        // 1. 创建包装 label 容器
        this.element = document.createElement('label');
        this.element.classList.add('da-switch');
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 原生 checkbox
        this.inputElement = document.createElement('input');
        this.inputElement.type = 'checkbox';
        this.inputElement.classList.add('da-switch__input');
        this.inputElement.checked = this.isChecked;
        if (options.disabled) {
            this.inputElement.disabled = true;
            this.element.classList.add('da-switch--disabled');
        }
        this.element.appendChild(this.inputElement);

        // 3. 胶囊轨道与滑动块
        const track = document.createElement('span');
        track.classList.add('da-switch__track');

        const thumb = document.createElement('span');
        thumb.classList.add('da-switch__thumb');
        track.appendChild(thumb);
        this.element.appendChild(track);

        // 4. 辅助文字
        if (options.label) {
            this.labelElement = document.createElement('span');
            this.labelElement.classList.add('da-switch__label');
            this.labelElement.textContent = options.label;
            this.element.appendChild(this.labelElement);
        }

        // 5. 事件分发
        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }

        this.changeListener = () => {
            this.isChecked = this.inputElement.checked;
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

        const shouldTrigger = typeof options === 'boolean'
            ? options
            : Boolean(options?.triggerChange && !options?.silent);

        if (shouldTrigger) {
            this.dispatchChange(nextValue);
        }
    }

    public toggle(): void {
        if (this.inputElement.disabled) return;
        this.setValue(!this.isChecked, { triggerChange: true });
    }

    public setDisabled(disabled: boolean): void {
        this.inputElement.disabled = disabled;
        if (disabled) {
            this.element.classList.add('da-switch--disabled');
        } else {
            this.element.classList.remove('da-switch--disabled');
        }
    }

    public setDirty(isDirty: boolean): void {
        if (isDirty) {
            this.element.classList.add('da-switch--dirty');
        } else {
            this.element.classList.remove('da-switch--dirty');
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
                logger.error('[Switch] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
    }

    public dispose(): void {
        this.inputElement.removeEventListener('change', this.changeListener);
        this.changeCallbacks.clear();
        this.element.parentElement?.removeChild(this.element);
    }
}
