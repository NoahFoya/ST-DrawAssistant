/**
 * 文本与数值输入控件族 (TextInput, PasswordInput, NumberInput, Textarea)
 *
 * 功能：
 * 1. 提供单行文本输入框 (createTextInput)，支持一键清空与回车确认；
 * 2. 提供密码/密钥输入框 (createPasswordInput)，支持眼睛图标显隐明文切换；
 * 3. 提供数值步进微调框 (createNumberInput)，集成增减箭头、滚轮调节与长按连续加速；
 * 4. 提供多行文本域 (createTextarea)，用于提示词与脚本配置。
 *
 * Tips：
 * 1. NumberInput 支持浮点精度消除与 min/max 范围钳制，聚焦时滚轮微调，失焦时允许页面原生滚动；
 * 2. 所有控件统一实现 IControlHandle 接口，支持 setDirty 与 setError 状态联动。
 */

import type { BaseControlOptions, IControlHandle } from '@types';
import { createIconElement } from './icons';

// 1. 单行文本输入框 TextInput

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

// 2. 密码/密钥输入框 PasswordInput

export interface PasswordInputOptions extends BaseControlOptions {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    onChange?: (val: string) => void;
    onEnter?: (val: string) => void;
}

export interface PasswordInputHandle extends IControlHandle<string> {
    readonly inputElement: HTMLInputElement;
    readonly eyeButtonElement: HTMLButtonElement;
    isRevealed(): boolean;
    toggleReveal(revealed?: boolean): boolean;
    focus(): void;
    select(): void;
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
    eyeBtn.setAttribute('aria-label', '显示密码明文');
    eyeBtn.appendChild(createIconElement('eye', 13));

    const applyRevealState = (revealed: boolean) => {
        isRevealed = revealed;
        input.type = isRevealed ? 'text' : 'password';
        eyeBtn.innerHTML = '';
        eyeBtn.appendChild(createIconElement(isRevealed ? 'eye-off' : 'eye', 13));
        eyeBtn.setAttribute('aria-label', isRevealed ? '隐藏密码' : '显示密码明文');
    };

    eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyRevealState(!isRevealed);
    });

    const onInput = () => {
        options.onChange?.(input.value);
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            options.onEnter?.(input.value);
        }
    };

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);

    wrapper.appendChild(input);
    wrapper.appendChild(eyeBtn);

    return {
        element: wrapper,
        inputElement: input,
        eyeButtonElement: eyeBtn,
        isRevealed(): boolean {
            return isRevealed;
        },
        toggleReveal(revealed?: boolean): boolean {
            const next = revealed !== undefined ? revealed : !isRevealed;
            applyRevealState(next);
            return isRevealed;
        },
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

// 3. 居中数字微调输入框 NumberInput

export interface NumberInputOptions extends BaseControlOptions {
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    /** 内嵌右侧单位后缀徽标 (如 'px', '%', '步') */
    unit?: string;
    variant?: 'normal' | 'short' | 'small';
    /** 是否封装连续步进调节按钮族 [ - ] 与 [ + ]，默认为 true */
    showStepper?: boolean;
    onChange?: (val: number) => void;
}

export interface NumberInputHandle extends IControlHandle<number> {
    readonly inputElement: HTMLInputElement;
    readonly stepperElement?: HTMLElement;
    stepUp(multiplier?: number): void;
    stepDown(multiplier?: number): void;
    focus(): void;
    select(): void;
}

export function createNumberInput(options: NumberInputOptions): NumberInputHandle {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    const step = options.step ?? 1;
    const showStepper = options.showStepper !== false;

    const clamp = (val: number) => Math.min(max, Math.max(min, val));

    // 计算浮点精度位数，消除 0.1 + 0.2 导致的浮点数溢出
    const getPrecision = (num: number): number => {
        const s = num.toString();
        const dot = s.indexOf('.');
        return dot >= 0 ? s.length - dot - 1 : 0;
    };
    const stepPrecision = getPrecision(step);

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

    let unitWrapper: HTMLElement | null = null;
    if (options.unit) {
        unitWrapper = document.createElement('div');
        unitWrapper.className = 'da-input-unit-wrapper';

        input.classList.add('da-input--has-unit');
        const unitBadge = document.createElement('span');
        unitBadge.className = 'da-input-unit-badge';
        unitBadge.textContent = options.unit;

        unitWrapper.appendChild(input);
        unitWrapper.appendChild(unitBadge);
    }

    const commitValue = (val: number) => {
        const clamped = clamp(val);
        input.value = String(clamped);
        options.onChange?.(clamped);
    };

    const stepBy = (delta: number) => {
        let current = parseFloat(input.value);
        if (isNaN(current)) {
            current = options.defaultValue ?? (isFinite(min) ? min : 0);
        }
        const precision = Math.max(stepPrecision, getPrecision(current));
        const next = parseFloat((current + delta).toFixed(precision));
        commitValue(next);
    };

    const commitFromText = () => {
        let num = parseFloat(input.value);
        if (isNaN(num)) {
            num = options.defaultValue ?? (isFinite(min) ? min : 0);
        }
        commitValue(num);
    };

    const onChange = () => {
        commitFromText();
    };

    const onBlur = () => {
        commitFromText();
    };

    // 键盘方向键微调与 Enter 确认
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            stepBy(step);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            stepBy(-step);
        } else if (e.key === 'Enter') {
            input.blur();
        }
    };

    // 鼠标滚轮在输入框聚焦状态下微调步进；失焦时保留原生页面滚动防误触
    const onWheel = (e: WheelEvent) => {
        if (document.activeElement === input) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? step : -step;
            stepBy(delta);
        }
    };

    input.addEventListener('change', onChange);
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('wheel', onWheel, { passive: false });

    // 步进按钮连续长按加速定时器管理
    let longPressTimer: number | null = null;
    let repeatTimer: number | null = null;

    const clearTimers = () => {
        if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (repeatTimer !== null) {
            window.clearInterval(repeatTimer);
            repeatTimer = null;
        }
    };

    let stepperWrapper: HTMLElement | null = null;
    let downBtn: HTMLButtonElement | null = null;
    let upBtn: HTMLButtonElement | null = null;

    if (showStepper) {
        stepperWrapper = document.createElement('div');
        stepperWrapper.className = 'da-number-stepper';
        if (options.unit) {
            stepperWrapper.classList.add('da-slot--w-120');
        } else {
            stepperWrapper.classList.add('da-slot--w-80');
        }
        if (options.className) stepperWrapper.classList.add(options.className);

        const bindStepperBtn = (btn: HTMLButtonElement, delta: number) => {
            let handledInPointer = false;

            const startPress = (e: Event) => {
                e.preventDefault();
                if (btn.disabled || input.disabled) return;
                handledInPointer = true;
                stepBy(delta);
                clearTimers();
                longPressTimer = window.setTimeout(() => {
                    repeatTimer = window.setInterval(() => {
                        stepBy(delta);
                    }, 60);
                }, 300);
            };

            const endPress = () => {
                clearTimers();
                window.setTimeout(() => {
                    handledInPointer = false;
                }, 50);
            };

            btn.addEventListener('mousedown', startPress);
            btn.addEventListener('mouseup', endPress);
            btn.addEventListener('mouseleave', endPress);
            btn.addEventListener('touchstart', startPress, { passive: false });
            btn.addEventListener('touchend', endPress);
            btn.addEventListener('touchcancel', endPress);
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!handledInPointer && !btn.disabled && !input.disabled) {
                    stepBy(delta);
                }
            });
        };

        const arrowsContainer = document.createElement('div');
        arrowsContainer.className = 'da-stepper-arrows';

        upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'da-stepper-arrow da-stepper-arrow--up da-stepper-btn da-stepper-btn--up';
        upBtn.setAttribute('aria-label', '增加');
        upBtn.appendChild(createIconElement('chevron-up', 10));
        bindStepperBtn(upBtn, step);

        downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'da-stepper-arrow da-stepper-arrow--down da-stepper-btn da-stepper-btn--down';
        downBtn.setAttribute('aria-label', '减少');
        downBtn.appendChild(createIconElement('chevron-down', 10));
        bindStepperBtn(downBtn, -step);

        arrowsContainer.appendChild(upBtn);
        arrowsContainer.appendChild(downBtn);

        stepperWrapper.appendChild(unitWrapper ?? input);
        stepperWrapper.appendChild(arrowsContainer);
    }

    const rootElement: HTMLElement = stepperWrapper ?? unitWrapper ?? input;

    return {
        element: rootElement,
        inputElement: input,
        stepperElement: stepperWrapper ?? undefined,
        getValue(): number {
            return parseFloat(input.value) || 0;
        },
        setValue(val: number): void {
            input.value = String(clamp(val));
        },
        stepUp(multiplier = 1): void {
            stepBy(step * multiplier);
        },
        stepDown(multiplier = 1): void {
            stepBy(-step * multiplier);
        },
        setDisabled(disabled: boolean): void {
            input.disabled = disabled;
            if (downBtn) downBtn.disabled = disabled;
            if (upBtn) upBtn.disabled = disabled;
            if (stepperWrapper) stepperWrapper.classList.toggle('is-disabled', disabled);
        },
        setDirty(isDirty: boolean): void {
            rootElement.classList.toggle('is-dirty', isDirty);
            input.classList.toggle('is-dirty', isDirty);
            if (stepperWrapper) stepperWrapper.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            rootElement.classList.toggle('is-invalid', hasError);
            input.classList.toggle('is-invalid', hasError);
            if (stepperWrapper) stepperWrapper.classList.toggle('is-invalid', hasError);
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
            clearTimers();
            input.removeEventListener('change', onChange);
            input.removeEventListener('blur', onBlur);
            input.removeEventListener('keydown', onKeyDown);
            input.removeEventListener('wheel', onWheel);
        }
    };
}

// 4. 多行文本输入域 Textarea

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
