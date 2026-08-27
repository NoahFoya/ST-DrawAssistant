/**
 * @module ui/controls/input-controls
 * @description 标准表单输入控件库 (Form Input Controls Library)
 *
 * 职责：
 * 纯状态管理输入控件（Toggle, Select, NumberInput, TextInput, Textarea, ColorPicker, Slider, SegmentedControl）。
 * 遵循自身尺寸内聚、零业务依赖与完整生命周期释放原则。
 */

import { IDisposable, DEFAULT_THEME_DATA } from '../../core';
import { normalizeHex } from '../foundation';

/**
 * 通用表单控件句柄接口
 */
export interface IControlHandle<T> extends HTMLElement, IDisposable {
    readonly inputElement: HTMLElement;
    getValue(): T;
    setValue(val: T): void;
    setDisabled(disabled: boolean): void;
}

// ── 1. Toggle 开关控件 ──────────────────────────────────────────────────────────
export interface ToggleOptions {
    value: boolean;
    onChange?: (checked: boolean) => void;
}

export interface ToggleHandle extends IControlHandle<boolean> {
    readonly inputElement: HTMLInputElement;
}

export function createToggle(options: ToggleOptions): ToggleHandle {
    const label = document.createElement('label');
    label.className = 'da-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(options.value);

    const track = document.createElement('span');
    track.className = 'da-toggle__track';

    const changeListener = () => {
        options.onChange?.(checkbox.checked);
    };
    checkbox.addEventListener('change', changeListener);

    label.appendChild(checkbox);
    label.appendChild(track);

    const handle: ToggleHandle = Object.assign(label, {
        inputElement: checkbox,
        getValue: (): boolean => checkbox.checked,
        setValue: (val: boolean): void => {
            checkbox.checked = Boolean(val);
        },
        setDisabled: (disabled: boolean): void => {
            checkbox.disabled = disabled;
            label.classList.toggle('is-disabled', disabled);
        },
        dispose: (): void => {
            checkbox.removeEventListener('change', changeListener);
            label.remove();
        }
    });

    return handle;
}

// ── 2. Select 下拉选择器控件 ────────────────────────────────────────────────────
export interface SelectOptionItem {
    label: string;
    value: string | number;
}

export interface SelectOptions {
    value: string | number;
    options: Array<SelectOptionItem | string>;
    onChange?: (value: string) => void;
}

export interface SelectHandle extends IControlHandle<string> {
    readonly inputElement: HTMLSelectElement;
    setOptions(opts: Array<SelectOptionItem | string>, preserveValue?: boolean): void;
    setError(hasError: boolean, tooltip?: string): void;
}

export function createSelect(options: SelectOptions): SelectHandle {
    const select = document.createElement('select');
    select.className = 'da-select';

    const renderOptions = (items: Array<SelectOptionItem | string>, currentSelected?: string | number) => {
        select.innerHTML = '';
        items.forEach((item) => {
            const opt = document.createElement('option');
            if (typeof item === 'object' && item !== null) {
                opt.value = String(item.value);
                opt.textContent = item.label;
            } else {
                opt.value = String(item);
                opt.textContent = String(item);
            }
            if (currentSelected !== undefined && String(opt.value) === String(currentSelected)) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
    };

    renderOptions(options.options, options.value);

    const changeListener = () => {
        options.onChange?.(select.value);
    };
    select.addEventListener('change', changeListener);

    const handle: SelectHandle = Object.assign(select, {
        inputElement: select,
        getValue: (): string => select.value,
        setValue: (val: string | number): void => {
            select.value = String(val);
        },
        setOptions: (opts: Array<SelectOptionItem | string>, preserveValue = true): void => {
            const current = preserveValue ? select.value : undefined;
            renderOptions(opts, current);
        },
        setDisabled: (disabled: boolean): void => {
            select.disabled = disabled;
        },
        setError: (hasError: boolean, tooltip?: string): void => {
            if (hasError) {
                select.classList.add('da-select-error');
                if (tooltip) select.title = tooltip;
            } else {
                select.classList.remove('da-select-error');
                select.removeAttribute('title');
            }
        },
        dispose: (): void => {
            select.removeEventListener('change', changeListener);
            select.remove();
        }
    });

    return handle;
}

// ── 3. Number 数值输入控件 ──────────────────────────────────────────────────────
export interface NumberInputOptions {
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    onChange?: (val: number) => void;
}

export interface NumberInputHandle extends IControlHandle<number> {
    readonly inputElement: HTMLInputElement;
}

export function createNumberInput(options: NumberInputOptions): NumberInputHandle {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'da-input';

    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);

    const clampValue = (raw: number): number => {
        let val = Number.isNaN(raw) ? (options.defaultValue ?? 0) : raw;
        if (options.min !== undefined) val = Math.max(options.min, val);
        if (options.max !== undefined) val = Math.min(options.max, val);
        return val;
    };

    const initialVal = clampValue(options.value ?? options.defaultValue ?? 0);
    input.value = String(initialVal);

    let container: HTMLElement = input;

    if (options.unit) {
        const wrapper = document.createElement('div');
        wrapper.className = 'da-input-unit-wrapper';
        input.classList.add('da-input--has-unit');

        const unitBadge = document.createElement('span');
        unitBadge.className = 'da-input-unit-badge';
        unitBadge.textContent = options.unit;

        wrapper.appendChild(input);
        wrapper.appendChild(unitBadge);
        container = wrapper;
    }

    const changeListener = () => {
        const parsed = parseFloat(input.value);
        const clamped = clampValue(parsed);
        input.value = String(clamped);
        options.onChange?.(clamped);
    };
    input.addEventListener('change', changeListener);

    const handle: NumberInputHandle = Object.assign(container, {
        inputElement: input,
        getValue: (): number => clampValue(parseFloat(input.value)),
        setValue: (val: number): void => {
            input.value = String(clampValue(val));
        },
        setDisabled: (disabled: boolean): void => {
            input.disabled = disabled;
        },
        dispose: (): void => {
            input.removeEventListener('change', changeListener);
            container.remove();
        }
    });

    return handle;
}

// ── 4. TextInput 单行文本输入控件 ─────────────────────────────────────────────────
export interface TextInputOptions {
    value?: string | number;
    defaultValue?: string | number;
    type?: string;
    placeholder?: string;
    onChange?: (val: string) => void;
}

export interface TextInputHandle extends IControlHandle<string> {
    readonly inputElement: HTMLInputElement;
}

export function createTextInput(options: TextInputOptions): TextInputHandle {
    const input = document.createElement('input');
    input.type = options.type || 'text';
    input.className = 'da-input';
    input.placeholder = options.placeholder || '';
    input.value = options.value !== undefined ? String(options.value) : (options.defaultValue !== undefined ? String(options.defaultValue) : '');

    const changeListener = () => {
        options.onChange?.(input.value.trim());
    };
    input.addEventListener('change', changeListener);

    const handle: TextInputHandle = Object.assign(input, {
        inputElement: input,
        getValue: (): string => input.value.trim(),
        setValue: (val: string | number): void => {
            input.value = String(val);
        },
        setDisabled: (disabled: boolean): void => {
            input.disabled = disabled;
        },
        dispose: (): void => {
            input.removeEventListener('change', changeListener);
            input.remove();
        }
    });

    return handle;
}

// ── 5. Textarea 多行文本域控件 ───────────────────────────────────────────────────
export interface TextareaOptions {
    value?: string;
    placeholder?: string;
    rows?: number;
    onChange?: (val: string) => void;
}

export interface TextareaHandle extends IControlHandle<string> {
    readonly inputElement: HTMLTextAreaElement;
}

export function createTextarea(options: TextareaOptions): TextareaHandle {
    const textarea = document.createElement('textarea');
    textarea.className = 'da-textarea';
    textarea.rows = options.rows || 3;
    textarea.placeholder = options.placeholder || '';
    textarea.value = options.value || '';

    const changeListener = () => {
        options.onChange?.(textarea.value.trim());
    };
    textarea.addEventListener('change', changeListener);

    const handle: TextareaHandle = Object.assign(textarea, {
        inputElement: textarea,
        getValue: (): string => textarea.value.trim(),
        setValue: (val: string): void => {
            textarea.value = String(val ?? '');
        },
        setDisabled: (disabled: boolean): void => {
            textarea.disabled = disabled;
        },
        dispose: (): void => {
            textarea.removeEventListener('change', changeListener);
            textarea.remove();
        }
    });

    return handle;
}

// ── 6. ColorPicker 颜色选择器控件 ───────────────────────────────────────────────
export interface ColorPickerOptions {
    value?: string;
    defaultValue?: string;
    onChange?: (hexColor: string) => void;
}

export interface ColorPickerHandle extends IControlHandle<string> {
    readonly colorInputElement: HTMLInputElement;
    readonly hexInputElement: HTMLInputElement;
}

export function createColorPicker(options: ColorPickerOptions): ColorPickerHandle {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-color-picker-wrapper';

    const defaultAccent = DEFAULT_THEME_DATA.accentColor;
    const initialVal = normalizeHex(options.value ?? options.defaultValue ?? defaultAccent) || defaultAccent;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'da-color-picker-native';
    colorInput.value = initialVal;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'da-input da-color-hex-input';
    hexInput.value = initialVal;
    hexInput.spellcheck = false;

    const syncColor = (raw: string) => {
        const hex = normalizeHex(raw);
        if (hex) {
            colorInput.value = hex;
            hexInput.value = hex;
            hexInput.classList.remove('is-invalid');
            options.onChange?.(hex);
        } else {
            hexInput.classList.add('is-invalid');
        }
    };

    const colorChangeListener = () => syncColor(colorInput.value);
    const hexChangeListener = () => syncColor(hexInput.value);

    colorInput.addEventListener('input', colorChangeListener);
    hexInput.addEventListener('change', hexChangeListener);

    wrapper.appendChild(colorInput);
    wrapper.appendChild(hexInput);

    const handle: ColorPickerHandle = Object.assign(wrapper, {
        inputElement: colorInput,
        colorInputElement: colorInput,
        hexInputElement: hexInput,
        getValue: (): string => normalizeHex(hexInput.value) || defaultAccent,
        setValue: (hex: string): void => syncColor(hex),
        setDisabled: (disabled: boolean): void => {
            colorInput.disabled = disabled;
            hexInput.disabled = disabled;
        },
        dispose: (): void => {
            colorInput.removeEventListener('input', colorChangeListener);
            hexInput.removeEventListener('change', hexChangeListener);
            wrapper.remove();
        }
    });

    return handle;
}

// ── 7. Slider 滑块数值联动输入控件 ─────────────────────────────────────────────
export interface SliderOptions {
    value?: number;
    defaultValue?: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    onChange?: (val: number) => void;
}

export interface SliderHandle extends IControlHandle<number> {
    readonly sliderElement: HTMLInputElement;
    readonly numberInputElement: HTMLInputElement;
}

export function createSlider(options: SliderOptions): SliderHandle {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-slider-wrapper';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'da-slider-range';
    slider.min = String(options.min);
    slider.max = String(options.max);
    slider.step = String(options.step ?? 1);

    const initialVal = options.value ?? options.defaultValue ?? options.min;
    slider.value = String(initialVal);

    const numberComp = createNumberInput({
        value: initialVal,
        min: options.min,
        max: options.max,
        step: options.step,
        unit: options.unit,
        onChange: (num) => {
            slider.value = String(num);
            options.onChange?.(num);
        }
    });

    const onSliderChange = () => {
        const num = parseFloat(slider.value);
        numberComp.setValue(num);
        options.onChange?.(num);
    };

    slider.addEventListener('input', onSliderChange);

    wrapper.appendChild(slider);
    wrapper.appendChild(numberComp);

    const handle: SliderHandle = Object.assign(wrapper, {
        inputElement: slider,
        sliderElement: slider,
        numberInputElement: numberComp.inputElement,
        getValue: (): number => parseFloat(slider.value),
        setValue: (val: number): void => {
            slider.value = String(val);
            numberComp.setValue(val);
        },
        setDisabled: (disabled: boolean): void => {
            slider.disabled = disabled;
            numberComp.setDisabled(disabled);
        },
        dispose: (): void => {
            slider.removeEventListener('input', onSliderChange);
            numberComp.dispose();
            wrapper.remove();
        }
    });

    return handle;
}

// ── 8. SegmentedControl 分段切换按钮组控件 ───────────────────────────────────────
export interface SegmentedItem {
    label: string;
    value: string;
    icon?: string;
}

export interface SegmentedControlOptions {
    value: string;
    items: SegmentedItem[];
    onChange?: (value: string) => void;
}

export interface SegmentedControlHandle extends IControlHandle<string> {
    setItems(items: SegmentedItem[]): void;
}

export function createSegmentedControl(options: SegmentedControlOptions): SegmentedControlHandle {
    const container = document.createElement('div');
    container.className = 'da-segmented';

    let currentVal = options.value;
    const buttonCleanups: Array<() => void> = [];

    const renderButtons = (items: SegmentedItem[]) => {
        buttonCleanups.forEach((c) => c());
        buttonCleanups.length = 0;
        container.innerHTML = '';

        items.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `da-segmented-item ${item.value === currentVal ? 'is-active' : ''}`;
            btn.textContent = item.label;

            const clickHandler = () => {
                if (currentVal === item.value) return;
                currentVal = item.value;
                container.querySelectorAll<HTMLButtonElement>('.da-segmented-item').forEach((b, idx) => {
                    b.classList.toggle('is-active', items[idx]?.value === currentVal);
                });
                options.onChange?.(currentVal);
            };

            btn.addEventListener('click', clickHandler);
            buttonCleanups.push(() => btn.removeEventListener('click', clickHandler));
            container.appendChild(btn);
        });
    };

    renderButtons(options.items);

    const handle: SegmentedControlHandle = Object.assign(container, {
        inputElement: container,
        getValue: (): string => currentVal,
        setValue: (val: string): void => {
            currentVal = val;
            container.querySelectorAll<HTMLButtonElement>('.da-segmented-item').forEach((b, idx) => {
                b.classList.toggle('is-active', options.items[idx]?.value === currentVal);
            });
        },
        setItems: (items: SegmentedItem[]): void => {
            options.items = items;
            renderButtons(items);
        },
        setDisabled: (disabled: boolean): void => {
            container.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = disabled));
            container.classList.toggle('is-disabled', disabled);
        },
        dispose: (): void => {
            buttonCleanups.forEach((c) => c());
            buttonCleanups.length = 0;
            container.remove();
        }
    });

    return handle;
}

// ─────────────────────────────────────────────────────────────────────────────
// 控件句柄类型别名 (便于调用方导入)
// ─────────────────────────────────────────────────────────────────────────────
export type ToggleControlHandle = ToggleHandle;
export type SelectControlHandle = SelectHandle;
export type NumberControlHandle = NumberInputHandle;
export type InputControlHandle = TextInputHandle;
export type TextareaControlHandle = TextareaHandle;
export type ColorPickerControlHandle = ColorPickerHandle;
export type SliderControlHandle = SliderHandle;

