/**
 * ST-DrawAssistant 多行长文本域原子控件。
 *
 * @remarks
 * 基于原生 HTMLTextAreaElement，遵循 .da-textarea 样式规范。
 * 支持纵向缩放、修改态提示与事件注销。
 */

import type { SetValueOptions, TextareaComponent, TextareaOptions } from './types';

export function createTextarea(options: TextareaOptions = {}): TextareaComponent {
    const textarea = document.createElement('textarea');
    textarea.classList.add('da-textarea');

    if (options.className) {
        textarea.classList.add(...options.className.split(' ').filter(Boolean));
    }
    if (options.placeholder) {
        textarea.placeholder = options.placeholder;
    }
    if (options.value !== undefined) {
        textarea.value = options.value;
    }
    if (options.rows !== undefined) {
        textarea.rows = options.rows;
    }
    if (options.readOnly) {
        textarea.readOnly = true;
    }
    if (options.disabled) {
        textarea.disabled = true;
    }

    let changeHandler: ((e: Event) => void) | null = null;
    let inputHandler: ((e: Event) => void) | null = null;

    if (options.onChange) {
        changeHandler = () => {
            options.onChange!(textarea.value);
        };
        textarea.addEventListener('change', changeHandler);
    }

    if (options.onInput) {
        inputHandler = () => {
            options.onInput!(textarea.value);
        };
        textarea.addEventListener('input', inputHandler);
    }

    return {
        get element() {
            return textarea;
        },
        getValue(): string {
            return textarea.value;
        },
        setValue(value: string, options?: SetValueOptions): void {
            textarea.value = value ?? '';
            if (options?.triggerChange && changeHandler) {
                changeHandler(new Event('change'));
            }
        },
        setDisabled(disabled: boolean): void {
            textarea.disabled = disabled;
        },
        markDirty(dirty: boolean): void {
            textarea.classList.toggle('is-dirty', dirty);
        },
        setDirty(isDirty: boolean): void {
            this.markDirty(isDirty);
        },
        markInvalid(invalid: boolean, message?: string): void {
            textarea.classList.toggle('is-invalid', invalid);
            if (invalid && message) {
                textarea.title = message;
            } else if (!invalid) {
                textarea.removeAttribute('title');
            }
        },
        dispose(): void {
            if (changeHandler) {
                textarea.removeEventListener('change', changeHandler);
                changeHandler = null;
            }
            if (inputHandler) {
                textarea.removeEventListener('input', inputHandler);
                inputHandler = null;
            }
        },
    };
}
