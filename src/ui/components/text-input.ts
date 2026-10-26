/**
 * 受控单行文本输入框组件 (TextInput)。
 *
 * @remarks
 * 实现 IControlHandle<string> 操作句柄：
 * 1. 支持占位提示、只读、禁用态；
 * 2. 支持 clearable 一键清空图标；
 * 3. 支持输入防抖触发 onChange 回调；
 * 4. 具备脏状态与非法输入指示能力。
 */

import type { IControlHandle, SetValueOptions, ControlChangeCallback } from '../types';
import { logger } from '../../util/logger';

export interface TextInputOptions {
    /** 初始文本值 */
    value?: string;
    /** 占位提示文字 */
    placeholder?: string;
    /** 输入类型，默认 'text' */
    type?: 'text' | 'password' | 'url';
    /** 是否只读，默认 false */
    readonly?: boolean;
    /** 是否禁用，默认 false */
    disabled?: boolean;
    /** 是否提供一键清空按钮，默认 false */
    clearable?: boolean;
    /** 防抖毫秒数，默认 0（即时触发） */
    debounceMs?: number;
    /** 前缀图标 HTML */
    prefixIcon?: string;
    /** 附加类名 */
    className?: string;
    /** 值变更回调 */
    onChange?: ControlChangeCallback<string>;
}

export class TextInput implements IControlHandle<string> {
    public readonly element: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly clearBtn?: HTMLElement;

    private currentValue = '';
    private isDirtyState = false;
    private readonly changeCallbacks = new Set<ControlChangeCallback<string>>();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly debounceMs: number;

    private readonly inputListener: () => void;
    private readonly clearListener?: (e: MouseEvent) => void;

    constructor(options: TextInputOptions = {}) {
        this.currentValue = options.value ?? '';
        this.debounceMs = options.debounceMs ?? 0;

        // 1. 创建外层容器
        this.element = document.createElement('div');
        this.element.classList.add('da-input-wrapper');
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 前缀图标
        if (options.prefixIcon) {
            const prefix = document.createElement('span');
            prefix.classList.add('da-input__prefix');
            prefix.innerHTML = options.prefixIcon;
            this.element.appendChild(prefix);
        }

        // 3. 原生输入框
        this.inputElement = document.createElement('input');
        this.inputElement.type = options.type ?? 'text';
        this.inputElement.classList.add('da-input');
        this.inputElement.value = this.currentValue;
        if (options.placeholder) {
            this.inputElement.placeholder = options.placeholder;
        }
        if (options.readonly) {
            this.inputElement.readOnly = true;
        }
        if (options.disabled) {
            this.inputElement.disabled = true;
            this.element.classList.add('da-input-wrapper--disabled');
        }
        this.element.appendChild(this.inputElement);

        // 4. 清空按钮
        if (options.clearable) {
            this.clearBtn = document.createElement('span');
            this.clearBtn.classList.add('da-input__clear');
            this.clearBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
            this.updateClearBtnVisibility();

            this.clearListener = (e: MouseEvent) => {
                e.stopPropagation();
                if (!this.inputElement.disabled && !this.inputElement.readOnly) {
                    this.clear();
                }
            };
            this.clearBtn.addEventListener('click', this.clearListener);
            this.element.appendChild(this.clearBtn);
        }

        // 5. 注册外部初始回调
        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }

        // 6. 输入监听
        this.inputListener = () => {
            const newValue = this.inputElement.value;
            this.currentValue = newValue;
            this.updateClearBtnVisibility();

            if (this.debounceMs > 0) {
                if (this.debounceTimer !== null) {
                    clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = setTimeout(() => {
                    this.debounceTimer = null;
                    this.dispatchChange(this.currentValue);
                }, this.debounceMs);
            } else {
                this.dispatchChange(this.currentValue);
            }
        };
        this.inputElement.addEventListener('input', this.inputListener);
    }

    public getValue(): string {
        return this.currentValue;
    }

    public setValue(value: string, options?: boolean | SetValueOptions): void {
        const nextValue = value ?? '';
        this.currentValue = nextValue;
        this.inputElement.value = nextValue;
        this.updateClearBtnVisibility();

        const shouldTrigger = typeof options === 'boolean'
            ? options
            : Boolean(options?.triggerChange && !options?.silent);

        if (shouldTrigger) {
            this.dispatchChange(nextValue);
        }
    }

    public setDisabled(disabled: boolean): void {
        this.inputElement.disabled = disabled;
        if (disabled) {
            this.element.classList.add('da-input-wrapper--disabled');
        } else {
            this.element.classList.remove('da-input-wrapper--disabled');
        }
    }

    public setDirty(isDirty: boolean): void {
        this.isDirtyState = isDirty;
        if (isDirty) {
            this.element.classList.add('da-input-wrapper--dirty');
        } else {
            this.element.classList.remove('da-input-wrapper--dirty');
        }
    }

    public isDirty(): boolean {
        return this.isDirtyState;
    }

    public onChange(callback: ControlChangeCallback<string>): void {
        this.changeCallbacks.add(callback);
    }

    public setPlaceholder(placeholder: string): void {
        this.inputElement.placeholder = placeholder;
    }

    public clear(): void {
        this.setValue('', { triggerChange: true });
        this.inputElement.focus();
    }

    public focus(): void {
        this.inputElement.focus();
    }

    private updateClearBtnVisibility(): void {
        if (this.clearBtn) {
            this.clearBtn.style.display = this.currentValue ? '' : 'none';
        }
    }

    private dispatchChange(value: string): void {
        for (const cb of this.changeCallbacks) {
            try {
                cb(value);
            } catch (err) {
                logger.error('[TextInput] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
    }

    public dispose(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.inputElement.removeEventListener('input', this.inputListener);
        if (this.clearBtn && this.clearListener) {
            this.clearBtn.removeEventListener('click', this.clearListener);
        }
        this.changeCallbacks.clear();
        this.element.parentElement?.removeChild(this.element);
    }
}
