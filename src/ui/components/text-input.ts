/**
 * 受控单行文本输入框组件 (TextInput)。
 *
 * @remarks
 * 实现 ControlHandle<string> 操作句柄：
 * 1. 支持占位提示、只读、禁用态；
 * 2. 支持 clearable 一键清空图标；
 * 3. 支持输入防抖触发 onChange 回调；
 * 4. 具备脏状态与非法输入指示能力。
 */

import type { ControlHandle, SetValueOptions, ControlChangeCallback } from '../types';
import { renderIcon } from './icons';
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
    /** 是否支持密码显隐切换按钮（针对 password 类型有效，默认 true） */
    showPasswordToggle?: boolean;
    /** 防抖毫秒数，默认 0（即时触发） */
    debounceMs?: number;
    /** 前缀图标 HTML */
    prefixIcon?: string;
    /** 附加类名 */
    className?: string;
    /** 值变更回调 */
    onChange?: ControlChangeCallback<string>;
}

export class TextInput implements ControlHandle<string> {
    public readonly element: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly clearBtn?: HTMLButtonElement;
    private readonly passwordToggleBtn?: HTMLButtonElement;
    private isPasswordVisible = false;

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
            this.element.classList.add(...options.className.trim().split(/\s+/).filter(Boolean));
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
            this.element.classList.add('has-clear');
            this.clearBtn = document.createElement('button');
            this.clearBtn.type = 'button';
            this.clearBtn.className = 'da-input__clear';
            this.clearBtn.title = '清空内容';
            this.clearBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

            this.clearBtn.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
            });

            this.clearListener = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this.inputElement.disabled && !this.inputElement.readOnly) {
                    this.clear();
                }
            };
            this.clearBtn.addEventListener('click', this.clearListener);
            this.element.appendChild(this.clearBtn);
        }

        // 5. 密码显隐切换按钮
        const wantsPasswordToggle = options.type === 'password' && options.showPasswordToggle !== false;
        if (wantsPasswordToggle) {
            this.element.classList.add('has-password-toggle');
            this.passwordToggleBtn = document.createElement('button');
            this.passwordToggleBtn.type = 'button';
            this.passwordToggleBtn.className = 'da-input__toggle-password';
            this.passwordToggleBtn.title = '显示明文';
            this.passwordToggleBtn.setAttribute('aria-label', '显示密码');
            this.passwordToggleBtn.innerHTML = renderIcon('eye', 13);

            this.passwordToggleBtn.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
            });

            this.passwordToggleBtn.addEventListener('click', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.isPasswordVisible = !this.isPasswordVisible;
                this.inputElement.type = this.isPasswordVisible ? 'text' : 'password';
                this.passwordToggleBtn!.innerHTML = renderIcon(this.isPasswordVisible ? 'eyeOff' : 'eye', 13);
                this.passwordToggleBtn!.title = this.isPasswordVisible ? '隐藏密码' : '显示明文';
                this.passwordToggleBtn!.setAttribute('aria-label', this.isPasswordVisible ? '隐藏密码' : '显示密码');
            });
            this.element.appendChild(this.passwordToggleBtn);
        }

        this.updateClearBtnVisibility();

        // 6. 注册外部初始回调
        if (options.onChange) {
            this.changeCallbacks.add(options.onChange);
        }

        // 7. 输入监听
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
        const hasContent = Boolean(this.currentValue);
        if (this.clearBtn) {
            this.clearBtn.style.display = hasContent ? 'inline-flex' : 'none';
        }
        this.element.classList.toggle('has-clear-visible', Boolean(this.clearBtn && hasContent));
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
