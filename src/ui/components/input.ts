/**
 * 现代化输入控件基元
 * 包含单行文本框 (带清空按钮)、密码/密钥框 (带显隐切换)、居中数字微调框 (带等宽与内嵌单位) 以及多行提示词文本域。
 */

import { BaseControlOptions, IControlHandle } from './types';
import { createIconElement } from './icons';

// ==================== 1. 单行文本输入框 TextInput ====================

export interface TextInputOptions extends BaseControlOptions {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    readOnly?: boolean;
    showClear?: boolean;
    variant?: 'normal' | 'short' | 'center' | 'search';
    onChange?: (val: string) => void;
    onEnter?: (val: string) => void;
}

export interface TextInputHandle extends IControlHandle<string> {
    readonly inputElement: HTMLInputElement;
    focus(): void;
    select(): void;
}

export function createTextInput(options: TextInputOptions): TextInputHandle {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'da-input';

    if (options.variant === 'short') {
        input.classList.add('da-input--short');
    } else if (options.variant === 'center') {
        input.classList.add('da-input--center');
    } else if (options.variant === 'search') {
        input.classList.add('da-input--search');
    }

    if (options.id) input.id = options.id;
    if (options.name) input.name = options.name;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.readOnly) input.readOnly = true;
    if (options.disabled) input.disabled = true;
    if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

    const initialVal = options.value ?? options.defaultValue ?? '';
    input.value = initialVal;

    let rootElement: HTMLElement = input;
    let clearBtn: HTMLButtonElement | null = null;

    // 清空按钮包装处理
    if (options.showClear) {
        const wrapper = document.createElement('div');
        wrapper.className = 'da-input-suffix-wrapper';

        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'da-input-suffix-btn';
        clearBtn.setAttribute('aria-label', '清空输入');
        clearBtn.appendChild(createIconElement('clear', 12));
        clearBtn.style.display = input.value ? '' : 'none';

        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            input.value = '';
            clearBtn!.style.display = 'none';
            input.focus();
            options.onChange?.('');
        });

        wrapper.appendChild(input);
        wrapper.appendChild(clearBtn);
        rootElement = wrapper;
    }

    const onInput = () => {
        if (clearBtn) {
            clearBtn.style.display = input.value ? '' : 'none';
        }
        options.onChange?.(input.value);
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            options.onEnter?.(input.value);
        }
    };

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);

    return {
        element: rootElement,
        inputElement: input,
        getValue(): string {
            return input.value.trim();
        },
        setValue(val: string): void {
            input.value = val ?? '';
            if (clearBtn) {
                clearBtn.style.display = input.value ? '' : 'none';
            }
        },
        setDisabled(disabled: boolean): void {
            input.disabled = disabled;
            if (clearBtn) {
                (clearBtn as HTMLButtonElement).disabled = disabled;
            }
        },
        setDirty(isDirty: boolean): void {
            rootElement.classList.toggle('is-dirty', isDirty);
            input.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            rootElement.classList.toggle('is-invalid', hasError);
            input.classList.toggle('is-invalid', hasError);
            if (message) {
                input.title = message;
            } else if (!hasError) {
                input.title = '';
            }
        },
        focus(): void {
            input.focus();
        },
        select(): void {
            input.select();
        },
        dispose(): void {
            input.removeEventListener('input', onInput);
            input.removeEventListener('keydown', onKeyDown);
        }
    };
}

// ==================== 2. 密码/密钥输入框 PasswordInput ====================

export interface PasswordInputOptions extends BaseControlOptions {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    onChange?: (val: string) => void;
}

export interface PasswordInputHandle extends IControlHandle<string> {
    readonly inputElement: HTMLInputElement;
}

export function createPasswordInput(options: PasswordInputOptions): PasswordInputHandle {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-input-suffix-wrapper';
    if (options.className) wrapper.classList.add(options.className);

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'da-input';
    if (options.id) input.id = options.id;
    if (options.name) input.name = options.name;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.disabled) input.disabled = true;
    if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

    input.value = options.value ?? options.defaultValue ?? '';

    let isRevealed = false;
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'da-input-suffix-btn';
    eyeBtn.setAttribute('aria-label', '切换密码明文显示');
    eyeBtn.appendChild(createIconElement('eye', 13));

    eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isRevealed = !isRevealed;
        input.type = isRevealed ? 'text' : 'password';
        eyeBtn.innerHTML = '';
        eyeBtn.appendChild(createIconElement(isRevealed ? 'eye-off' : 'eye', 13));
    });

    const onInput = () => {
        options.onChange?.(input.value);
    };
    input.addEventListener('input', onInput);

    wrapper.appendChild(input);
    wrapper.appendChild(eyeBtn);

    return {
        element: wrapper,
        inputElement: input,
        getValue(): string {
            return input.value.trim();
        },
        setValue(val: string): void {
            input.value = val ?? '';
        },
        setDisabled(disabled: boolean): void {
            input.disabled = disabled;
            eyeBtn.disabled = disabled;
        },
        setDirty(isDirty: boolean): void {
            wrapper.classList.toggle('is-dirty', isDirty);
            input.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            wrapper.classList.toggle('is-invalid', hasError);
            input.classList.toggle('is-invalid', hasError);
            if (message) input.title = message;
        },
        dispose(): void {
            input.removeEventListener('input', onInput);
        }
    };
}

// ==================== 3. 居中数字微调输入框 NumberInput ====================

export interface NumberInputOptions extends BaseControlOptions {
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    /** 内嵌右侧单位后缀徽标 (如 'px', '%', '步') */
    unit?: string;
    variant?: 'normal' | 'short' | 'small';
    onChange?: (val: number) => void;
}

export interface NumberInputHandle extends IControlHandle<number> {
    readonly inputElement: HTMLInputElement;
}

export function createNumberInput(options: NumberInputOptions): NumberInputHandle {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    const step = options.step ?? 1;

    const clamp = (val: number) => Math.min(max, Math.max(min, val));

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.className = 'da-input da-input--number';

    if (options.variant === 'short') {
        input.classList.add('da-input--num-short');
    } else if (options.variant === 'small') {
        input.classList.add('da-input-num-small');
    }

    if (options.id) input.id = options.id;
    if (options.name) input.name = options.name;
    if (options.disabled) input.disabled = true;
    if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

    const initialVal = clamp(options.value ?? options.defaultValue ?? 0);
    input.value = String(initialVal);

    let rootElement: HTMLElement = input;

    // 内嵌单位处理
    if (options.unit) {
        const wrapper = document.createElement('div');
        wrapper.className = 'da-input-unit-wrapper';

        input.classList.add('da-input--has-unit');
        const unitBadge = document.createElement('span');
        unitBadge.className = 'da-input-unit-badge';
        unitBadge.textContent = options.unit;

        wrapper.appendChild(input);
        wrapper.appendChild(unitBadge);
        rootElement = wrapper;
    }

    const commitValue = (val: number) => {
        const clamped = clamp(val);
        input.value = String(clamped);
        options.onChange?.(clamped);
    };

    const onChange = () => {
        let num = parseFloat(input.value);
        if (isNaN(num)) {
            num = options.defaultValue ?? min ?? 0;
        }
        commitValue(num);
    };

    // 鼠标滚轮在聚焦状态下微调步进
    const onWheel = (e: WheelEvent) => {
        if (document.activeElement === input) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? step : -step;
            let current = parseFloat(input.value) || 0;
            // 消除浮点数精度误差
            const decimals = (step.toString().split('.')[1] || '').length;
            const next = parseFloat((current + delta).toFixed(decimals));
            commitValue(next);
        }
    };

    input.addEventListener('change', onChange);
    input.addEventListener('wheel', onWheel, { passive: false });

    return {
        element: rootElement,
        inputElement: input,
        getValue(): number {
            return parseFloat(input.value) || 0;
        },
        setValue(val: number): void {
            input.value = String(clamp(val));
        },
        setDisabled(disabled: boolean): void {
            input.disabled = disabled;
        },
        setDirty(isDirty: boolean): void {
            rootElement.classList.toggle('is-dirty', isDirty);
            input.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            rootElement.classList.toggle('is-invalid', hasError);
            input.classList.toggle('is-invalid', hasError);
            if (message) input.title = message;
        },
        dispose(): void {
            input.removeEventListener('change', onChange);
            input.removeEventListener('wheel', onWheel);
        }
    };
}

// ==================== 4. 多行文本输入域 Textarea ====================

export interface TextareaOptions extends BaseControlOptions {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    rows?: number;
    minHeight?: number;
    readOnly?: boolean;
    onChange?: (val: string) => void;
}

export interface TextareaHandle extends IControlHandle<string> {
    readonly textareaElement: HTMLTextAreaElement;
}

export function createTextarea(options: TextareaOptions): TextareaHandle {
    const textarea = document.createElement('textarea');
    textarea.className = 'da-textarea';
    textarea.spellcheck = false;

    if (options.id) textarea.id = options.id;
    if (options.name) textarea.name = options.name;
    if (options.placeholder) textarea.placeholder = options.placeholder;
    if (options.rows) textarea.rows = options.rows;
    if (options.minHeight) textarea.style.minHeight = `${options.minHeight}px`;
    if (options.readOnly) textarea.readOnly = true;
    if (options.disabled) textarea.disabled = true;
    if (options.ariaLabel) textarea.setAttribute('aria-label', options.ariaLabel);

    textarea.value = options.value ?? options.defaultValue ?? '';

    const onInput = () => {
        options.onChange?.(textarea.value);
    };
    textarea.addEventListener('input', onInput);

    return {
        element: textarea,
        textareaElement: textarea,
        getValue(): string {
            return textarea.value.trim();
        },
        setValue(val: string): void {
            textarea.value = val ?? '';
        },
        setDisabled(disabled: boolean): void {
            textarea.disabled = disabled;
        },
        setDirty(isDirty: boolean): void {
            textarea.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            textarea.classList.toggle('is-invalid', hasError);
            if (message) textarea.title = message;
        },
        dispose(): void {
            textarea.removeEventListener('input', onInput);
        }
    };
}
