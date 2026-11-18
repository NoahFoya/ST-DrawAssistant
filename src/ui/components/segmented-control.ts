/**
 * 分段选择器组件 (SegmentedControl)。
 *
 * @remarks
 * 实现 ControlHandle<string> 接口，渲染胶囊形分段选择器：
 * 1. 结构紧凑，适合 2~4 个高频互斥选项即点即切；
 * 2. 支持受控读写与变更广播；
 * 3. 遵循 WAI-ARIA radiogroup 键盘与无障碍交互规范。
 */

import type { ControlHandle, SetValueOptions, ControlChangeCallback } from '../types';

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

export class SegmentedControl implements ControlHandle<string> {
    public readonly element: HTMLElement;
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private readonly orderedValues: string[] = [];
    private readonly optionDisabledMap = new Map<string, boolean>();
    private readonly changeCallbacks = new Set<ControlChangeCallback<string>>();
    private readonly clickListeners = new Map<HTMLButtonElement, () => void>();
    private readonly keydownHandler: (e: KeyboardEvent) => void;

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
            this.element.classList.add(...options.className.trim().split(/\s+/).filter(Boolean));
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
            this.orderedValues.push(opt.value);
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

            const isOptDisabled = Boolean(opt.disabled);
            this.optionDisabledMap.set(opt.value, isOptDisabled);
            if (isOptDisabled || this.isDisabled) {
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

        this.syncRovingTabIndex();

        this.keydownHandler = (e: KeyboardEvent) => {
            if (this.isDisabled) return;
            const enabledValues = this.orderedValues.filter(
                (v) => !(this.optionDisabledMap.get(v) ?? false)
            );
            if (enabledValues.length === 0) return;

            let targetValue: string | undefined;
            const activeIdx = enabledValues.indexOf(this.currentValue);
            const curIdx = activeIdx >= 0 ? activeIdx : 0;

            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                targetValue = enabledValues[(curIdx + 1) % enabledValues.length];
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                targetValue =
                    enabledValues[(curIdx - 1 + enabledValues.length) % enabledValues.length];
            } else if (e.key === 'Home') {
                targetValue = enabledValues[0];
            } else if (e.key === 'End') {
                targetValue = enabledValues[enabledValues.length - 1];
            } else {
                return;
            }

            e.preventDefault();
            if (targetValue !== undefined) {
                this.setValue(targetValue, { triggerChange: true });
                this.buttons.get(targetValue)?.focus();
            }
        };
        this.element.addEventListener('keydown', this.keydownHandler);
    }

    private syncRovingTabIndex(): void {
        if (this.isDisabled) {
            for (const btn of this.buttons.values()) {
                btn.tabIndex = -1;
            }
            return;
        }
        const activeBtn = this.buttons.get(this.currentValue);
        const hasActiveEnabled =
            activeBtn && !(this.optionDisabledMap.get(this.currentValue) ?? false);
        const fallbackValue = hasActiveEnabled
            ? this.currentValue
            : this.orderedValues.find((v) => !(this.optionDisabledMap.get(v) ?? false));

        for (const [val, btn] of this.buttons.entries()) {
            btn.tabIndex = val === fallbackValue ? 0 : -1;
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
        this.syncRovingTabIndex();

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
        for (const [val, btn] of this.buttons.entries()) {
            const optDisabled = this.optionDisabledMap.get(val) ?? false;
            const effectiveDisabled = disabled || optDisabled;
            btn.disabled = effectiveDisabled;
            btn.classList.toggle('is-disabled', effectiveDisabled);
        }
        this.syncRovingTabIndex();
    }

    /**
     * 释放事件监听与 DOM 关联。
     */
    public dispose(): void {
        this.changeCallbacks.clear();
        this.element.removeEventListener('keydown', this.keydownHandler);
        for (const [btn, listener] of this.clickListeners.entries()) {
            btn.removeEventListener('click', listener);
        }
        this.clickListeners.clear();
        this.buttons.clear();
        this.orderedValues.length = 0;
        this.optionDisabledMap.clear();
        this.element.remove();
    }
}
