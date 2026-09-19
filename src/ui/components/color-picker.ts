/**
 * ST-DrawAssistant 颜色选择器原子控件。
 *
 * @remarks
 * 原生 input[type="color"] 取色板与十六进制 Hex 文本输入框双向联动。
 * 遵循 .da-color-picker-wrapper 规范，内置正则校验与状态反馈。
 */

import type { ColorPickerComponent, ColorPickerOptions } from './types';

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;

function normalizeHex(hex?: string): string {
    if (!hex) return '#000000';
    let clean = hex.trim();
    if (!clean.startsWith('#')) {
        clean = `#${clean}`;
    }
    if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
        clean = `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
    }
    return HEX_COLOR_REGEX.test(clean) ? clean.toUpperCase() : '#000000';
}

export function createColorPicker(options: ColorPickerOptions = {}): ColorPickerComponent {
    const wrapper = document.createElement('div');
    wrapper.classList.add('da-color-picker-wrapper');

    if (options.className) {
        wrapper.classList.add(...options.className.split(' ').filter(Boolean));
    }
    if (options.disabled) {
        wrapper.classList.add('is-disabled');
    }

    const initialColor = normalizeHex(options.value);

    // 1. 原生圆形色盘
    const nativeInput = document.createElement('input');
    nativeInput.type = 'color';
    nativeInput.classList.add('da-color-picker-native');
    nativeInput.value = initialColor.toLowerCase();
    if (options.disabled) {
        nativeInput.disabled = true;
    }

    // 2. 十六进制文本框
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.classList.add('da-color-hex-input');
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexInput.value = initialColor;
    if (options.disabled) {
        hexInput.disabled = true;
    }

    wrapper.appendChild(nativeInput);
    wrapper.appendChild(hexInput);

    // 3. 事件双向联动
    let nativeInputHandler: ((e: Event) => void) | null = null;
    let hexInputHandler: ((e: Event) => void) | null = null;
    let hexBlurHandler: ((e: Event) => void) | null = null;

    nativeInputHandler = () => {
        const hex = nativeInput.value.toUpperCase();
        hexInput.value = hex;
        hexInput.classList.remove('is-invalid');
        options.onChange?.(hex);
    };
    nativeInput.addEventListener('input', nativeInputHandler);

    hexInputHandler = () => {
        let val = hexInput.value.trim().toUpperCase();
        if (val.length > 0 && !val.startsWith('#')) {
            val = `#${val}`;
        }
        if (HEX_COLOR_REGEX.test(val)) {
            hexInput.classList.remove('is-invalid');
            nativeInput.value = val.toLowerCase();
            options.onChange?.(val);
        } else {
            hexInput.classList.add('is-invalid');
        }
    };
    hexInput.addEventListener('input', hexInputHandler);

    hexBlurHandler = () => {
        let val = hexInput.value.trim().toUpperCase();
        if (val.length > 0 && !val.startsWith('#')) {
            val = `#${val}`;
        }
        if (HEX_COLOR_REGEX.test(val)) {
            hexInput.value = val;
            nativeInput.value = val.toLowerCase();
        } else {
            // 输入不合法时恢复为当前色板颜色
            hexInput.value = nativeInput.value.toUpperCase();
            hexInput.classList.remove('is-invalid');
        }
    };
    hexInput.addEventListener('blur', hexBlurHandler);

    return {
        get element() {
            return wrapper;
        },
        get nativeInput() {
            return nativeInput;
        },
        get hexInput() {
            return hexInput;
        },
        getValue(): string {
            return hexInput.value;
        },
        setValue(value: string, triggerChange = false): void {
            const hex = normalizeHex(value);
            hexInput.value = hex;
            nativeInput.value = hex.toLowerCase();
            hexInput.classList.remove('is-invalid');
            if (triggerChange) {
                options.onChange?.(hex);
            }
        },
        setDisabled(disabled: boolean): void {
            wrapper.classList.toggle('is-disabled', disabled);
            nativeInput.disabled = disabled;
            hexInput.disabled = disabled;
        },
        markDirty(dirty: boolean): void {
            wrapper.classList.toggle('is-dirty', dirty);
            hexInput.classList.toggle('is-dirty', dirty);
        },
        markInvalid(invalid: boolean, message?: string): void {
            hexInput.classList.toggle('is-invalid', invalid);
            if (invalid && message) {
                hexInput.title = message;
            } else if (!invalid) {
                hexInput.removeAttribute('title');
            }
        },
        dispose(): void {
            if (nativeInputHandler) {
                nativeInput.removeEventListener('input', nativeInputHandler);
                nativeInputHandler = null;
            }
            if (hexInputHandler) {
                hexInput.removeEventListener('input', hexInputHandler);
                hexInputHandler = null;
            }
            if (hexBlurHandler) {
                hexInput.removeEventListener('blur', hexBlurHandler);
                hexBlurHandler = null;
            }
        },
    };
}
