/**
 * 颜色选择器控件 (ColorPicker)
 *
 * 功能：
 * 1. 原生圆形色盘与十六进制 Hex 文本框双向数据联动；
 * 2. 规范化 3 位与 6 位 Hex 颜色代码为标准大写 #RRGGBB 格式；
 * 3. 输入非法颜色代码时提供实时校验与错误状态高亮。
 *
 * Tips：
 * 1. 原生色盘触发 input 事件时自动格式化同步到文本框并触发 onChange；
 * 2. 文本框失去焦点或回车 (change 事件) 时执行正则校验与大写修正。
 */

import type { BaseControlOptions, IControlHandle } from '@types';

export interface ColorPickerOptions extends BaseControlOptions {
    value?: string;
    defaultValue?: string;
    onChange?: (hexColor: string) => void;
}

export interface ColorPickerHandle extends IControlHandle<string> {
    readonly colorInputElement: HTMLInputElement;
    readonly hexInputElement: HTMLInputElement;
    focus(): void;
}

/** 规范化 3位或6位 Hex 颜色为 #RRGGBB 大写格式 */
function normalizeHex(val: string): string | null {
    const cleaned = val.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
        return `#${cleaned.toUpperCase()}`;
    }
    if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
        const r = cleaned[0] + cleaned[0];
        const g = cleaned[1] + cleaned[1];
        const b = cleaned[2] + cleaned[2];
        return `#${r}${g}${b}`.toUpperCase();
    }
    return null;
}

export function createColorPicker(options: ColorPickerOptions): ColorPickerHandle {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-color-picker-wrapper';
    if (options.className) wrapper.classList.add(options.className);

    const defaultColor = '#4F46E5';
    const initialHex = normalizeHex(options.value ?? options.defaultValue ?? defaultColor) || defaultColor;

    // 1. 原生圆形色板
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'da-color-picker-native';
    colorInput.value = initialHex;
    if (options.ariaLabel) colorInput.setAttribute('aria-label', options.ariaLabel);

    // 2. Hex 文本框
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'da-input da-color-hex-input';
    hexInput.value = initialHex;
    hexInput.spellcheck = false;
    hexInput.maxLength = 7;
    if (options.id) hexInput.id = options.id;
    if (options.name) hexInput.name = options.name;

    const syncColor = (raw: string, fromNative = false) => {
        const hex = normalizeHex(raw);
        if (hex) {
            if (!fromNative) {
                colorInput.value = hex;
            }
            hexInput.value = hex;
            wrapper.classList.remove('is-invalid');
            hexInput.classList.remove('is-invalid');
            options.onChange?.(hex);
        } else {
            wrapper.classList.add('is-invalid');
            hexInput.classList.add('is-invalid');
        }
    };

    const onColorInput = () => {
        syncColor(colorInput.value, true);
    };

    const onHexChange = () => {
        syncColor(hexInput.value, false);
    };

    colorInput.addEventListener('input', onColorInput);
    hexInput.addEventListener('change', onHexChange);

    wrapper.appendChild(colorInput);
    wrapper.appendChild(hexInput);

    return {
        element: wrapper,
        colorInputElement: colorInput,
        hexInputElement: hexInput,
        getValue(): string {
            return normalizeHex(hexInput.value) || defaultColor;
        },
        setValue(val: string): void {
            const hex = normalizeHex(val) || defaultColor;
            colorInput.value = hex;
            hexInput.value = hex;
            wrapper.classList.remove('is-invalid');
            hexInput.classList.remove('is-invalid');
        },
        setDisabled(disabled: boolean): void {
            colorInput.disabled = disabled;
            hexInput.disabled = disabled;
            wrapper.classList.toggle('is-disabled', disabled);
        },
        setDirty(isDirty: boolean): void {
            wrapper.classList.toggle('is-dirty', isDirty);
            hexInput.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            wrapper.classList.toggle('is-invalid', hasError);
            hexInput.classList.toggle('is-invalid', hasError);
            if (message) {
                hexInput.title = message;
            } else if (!hasError) {
                hexInput.title = '';
            }
        },
        focus(): void {
            hexInput.focus();
        },
        dispose(): void {
            colorInput.removeEventListener('input', onColorInput);
            hexInput.removeEventListener('change', onHexChange);
        }
    };
}
