/**
 * ST-DrawAssistant 单行文本与数字输入框原子控件。
 *
 * @remarks
 * 基于原生 HTMLInputElement，遵循 .da-input 阶梯宽度与居中对齐规范。
 * 支持未保存状态、校验失败状态与事件注销。
 */

import type { TextInputComponent, TextInputOptions } from './types';

export function createTextInput(options: TextInputOptions = {}): TextInputComponent {
    const input = document.createElement('input');
    input.type = options.type || 'text';
    input.classList.add('da-input');

    // 1. 变体与阶梯宽度修饰
    if (options.variant && options.variant !== 'default') {
        input.classList.add(`da-input--${options.variant}`);
    }
    if (options.className) {
        input.classList.add(...options.className.split(' ').filter(Boolean));
    }
    if (options.placeholder) {
        input.placeholder = options.placeholder;
    }
    if (options.value !== undefined) {
        input.value = String(options.value);
    }
    if (options.readOnly) {
        input.readOnly = true;
    }
    if (options.disabled) {
        input.disabled = true;
    }
    if (options.min !== undefined) {
        input.min = String(options.min);
    }
    if (options.max !== undefined) {
        input.max = String(options.max);
    }
    if (options.step !== undefined) {
        input.step = String(options.step);
    }
    if (options.maxLength !== undefined) {
        input.maxLength = options.maxLength;
    }

    // 2. 事件监听与解绑句柄
    let changeHandler: ((e: Event) => void) | null = null;
    let inputHandler: ((e: Event) => void) | null = null;

    if (options.onChange) {
        changeHandler = () => {
            options.onChange!(input.value);
        };
        input.addEventListener('change', changeHandler);
    }

    if (options.onInput) {
        inputHandler = () => {
            options.onInput!(input.value);
        };
        input.addEventListener('input', inputHandler);
    }

    return {
        get element() {
            return input;
        },
        getValue(): string {
            return input.value;
        },
        setValue(value: string, triggerChange = false): void {
            input.value = value ?? '';
            if (triggerChange && changeHandler) {
                changeHandler(new Event('change'));
            }
        },
        setDisabled(disabled: boolean): void {
            input.disabled = disabled;
        },
        markDirty(dirty: boolean): void {
            input.classList.toggle('is-dirty', dirty);
        },
        markInvalid(invalid: boolean, message?: string): void {
            input.classList.toggle('is-invalid', invalid);
            if (invalid && message) {
                input.title = message;
            } else if (!invalid) {
                input.removeAttribute('title');
            }
        },
        dispose(): void {
            if (changeHandler) {
                input.removeEventListener('change', changeHandler);
                changeHandler = null;
            }
            if (inputHandler) {
                input.removeEventListener('input', inputHandler);
                inputHandler = null;
            }
        },
    };
}
