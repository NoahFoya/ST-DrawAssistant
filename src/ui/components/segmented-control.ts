/**
 * 分段选择器组件 (SegmentedControl)。
 *
 * @remarks
 * 实现 IControlHandle<string> 接口，呈现类似 macOS 风格的胶囊分段条：
 * 1. 结构紧凑，适合 2~4 个高频互斥选项即点即切；
 * 2. 支持受控读写与变更广播；
 * 3. 遵循 WAI-ARIA radiogroup 键盘与无障碍交互规范。
 */

import type { IControlHandle, SetValueOptions, ControlChangeCallback } from '../types';

export interface SegmentedControlOption {
    /** 选项值 */
    value: string;
    /** 选项显示文本 */
    label: string;
    /** 是否禁用该选项 */
    disabled?: boolean;
}

export interface SegmentedControlOptions {
    /** 初始选中值 */
    value?: string;
    /** 选项列表 */
    options: SegmentedControlOption[];
    /** 是否禁用整个组件，默认 false */
    disabled?: boolean;
    /** 附加类名 */
    className?: string;
    /** 选中值变更回调 */
    onChange?: ControlChangeCallback<string>;
}

export class SegmentedControl implements IControlHandle<string> {
    public readonly element: HTMLElement;
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private readonly changeCallbacks = new Set<ControlChangeCallback<string>>();
    private readonly clickListeners = new Map<HTMLButtonElement, () => void>();

    private currentValue = '';
    private isDisabled = false;

    constructor(options: SegmentedControlOptions) {
        this.isDisabled = options.disabled ?? false;
        this.currentValue = options.value ?? (options.options[0]?.value ?? '');

        // 1. 创建容器
        this.element = document.createElement('div');
        this.element.className = 'da-segmented';
        this.element.setAttribute('role', 'radiogroup');
        if (options.className) {
            this.element.classList.add(options.className);
        }
        if (this.isDisabled) {
            this.element.classList.add('is-disabled');
        }

        // 2. 注册初始变更监听
        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }

        // 3. 构建分段按钮
        for (const opt of options.options) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'da-segmented__item';
            btn.setAttribute('role', 'radio');
            btn.setAttribute('data-value', opt.value);
            btn.textContent = opt.label;

            const isChecked = opt.value === this.currentValue;
            btn.setAttribute('aria-checked', isChecked ? 'true' : 'false');
            if (isChecked) {
                btn.classList.add('is-active');
            }

            if (opt.disabled || this.isDisabled) {
                btn.disabled = true;
                btn.classList.add('is-disabled');
            }

            const listener = () => {
                if (this.isDisabled || opt.disabled) return;
                if (this.currentValue !== opt.value) {
                    this.setValue(opt.value, { triggerChange: true });
                }
            };
            btn.addEventListener('click', listener);
            this.clickListeners.set(btn, listener);

            this.buttons.set(opt.value, btn);
            this.element.appendChild(btn);
        }
    }

    /**
     * 获取当前选中的选项值。
     */
    public getValue(): string {
        return this.currentValue;
    }

    /**
     * 设置选中项值。
     *
     * @param value 目标选项值
     * @param options 配置选项或是否触发回调的布尔值
     */
    public setValue(value: string, options?: boolean | SetValueOptions): void {
        const prevValue = this.currentValue;
        this.currentValue = value;

        for (const [val, btn] of this.buttons.entries()) {
            const isMatch = val === value;
            btn.setAttribute('aria-checked', isMatch ? 'true' : 'false');
            if (isMatch) {
                btn.classList.add('is-active');
            } else {
                btn.classList.remove('is-active');
            }
        }

        let shouldTrigger = false;
        if (typeof options === 'boolean') {
            shouldTrigger = options;
        } else if (options && typeof options === 'object') {
            if (options.silent) {
                shouldTrigger = false;
            } else if (options.triggerChange) {
                shouldTrigger = true;
            }
        }

        if (shouldTrigger && prevValue !== value) {
            for (const cb of this.changeCallbacks) {
                cb(value);
            }
        }
    }

    /**
     * 注册值变更监听回调。
     *
     * @param callback 变更处理函数
     * @returns 解绑函数
     */
    public onChange(callback: ControlChangeCallback<string>): () => void {
        this.changeCallbacks.add(callback);
        return () => {
            this.changeCallbacks.delete(callback);
        };
    }

    /**
     * 设置组件禁用状态。
     *
     * @param disabled 是否禁用
     */
    public setDisabled(disabled: boolean): void {
        this.isDisabled = disabled;
        this.element.classList.toggle('is-disabled', disabled);
        for (const btn of this.buttons.values()) {
            btn.disabled = disabled;
            btn.classList.toggle('is-disabled', disabled);
        }
    }

    /**
     * 释放事件监听与 DOM 关联。
     */
    public dispose(): void {
        this.changeCallbacks.clear();
        for (const [btn, listener] of this.clickListeners.entries()) {
            btn.removeEventListener('click', listener);
        }
        this.clickListeners.clear();
        this.buttons.clear();
        this.element.remove();
    }
}
