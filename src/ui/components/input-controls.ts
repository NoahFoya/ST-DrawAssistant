/**
 * 基础表单输入控件库
 * 提供 Toggle, Select, NumberInput, TextInput, Textarea, ColorPicker, Slider, SegmentedControl 等基础控件。
 * 支持值读写、状态设置、事件解绑与 DOM 销毁。
 */

import { IDisposable } from '../../types';
import { FALLBACK_SAFE_THEME, normalizeHex } from '../foundation';

/**
 * 基础控件通用配置项
 */
export interface BaseControlOptions {
    /** 控件 DOM 元素的 id，用于与 <label for="..."> 关联 */
    id?: string;
    /** 表单字段名称 (name 属性) */
    name?: string;
    /** 辅助说明文本 (aria-label 属性) */
    ariaLabel?: string;
    /** 附加的自定义 CSS 类名 */
    className?: string;
}

/**
 * 通用表单控件句柄接口
 */
export interface IControlHandle<T> extends HTMLElement, IDisposable {
    readonly inputElement: HTMLElement;
    getValue(): T;
    setValue(val: T): void;
    setDisabled(disabled: boolean): void;
    setDirty?(isDirty: boolean): void;
    setError?(hasError: boolean, tooltip?: string): void;
}

/**
 * 统一应用通用基础属性至 DOM 节点
 */
function applyBaseAttributes(target: HTMLElement, options: BaseControlOptions): void {
    if (options.id) target.id = options.id;
    if (options.name && 'name' in target) (target as HTMLInputElement).name = options.name;
    if (options.ariaLabel) target.setAttribute('aria-label', options.ariaLabel);
    if (options.className) {
        options.className.split(/\s+/).filter(Boolean).forEach((cls) => target.classList.add(cls));
    }
}

/**
 * 内部状态与生命周期绑定配置
 */
interface ControlStateBindingOptions {
    container: HTMLElement;
    inputElement: HTMLElement;
    extraElements?: HTMLElement[];
    cleanups?: Array<() => void>;
    onDisabled?: (disabled: boolean) => void;
}

/**
 * 统一管理控件的脏值高亮、校验报错、禁用状态与资源释放逻辑。
 * 避免在各个控件内重复编写类名切换和事件解绑代码。
 */
function bindControlStateHandlers(options: ControlStateBindingOptions) {
    const { container, inputElement, extraElements = [], cleanups = [], onDisabled } = options;

    return {
        setDisabled: (disabled: boolean): void => {
            if ('disabled' in inputElement) {
                (inputElement as HTMLInputElement).disabled = disabled;
            }
            container.classList.toggle('is-disabled', disabled);
            onDisabled?.(disabled);
        },
        setDirty: (isDirty: boolean): void => {
            container.classList.toggle('is-dirty', isDirty);
            inputElement.classList.toggle('is-dirty', isDirty);
            extraElements.forEach((el) => el.classList.toggle('is-dirty', isDirty));
        },
        setError: (hasError: boolean, tooltip?: string): void => {
            container.classList.toggle('is-invalid', hasError);
            inputElement.classList.toggle('is-invalid', hasError);
            extraElements.forEach((el) => el.classList.toggle('is-invalid', hasError));

            if (hasError && tooltip) {
                inputElement.title = tooltip;
            } else if (!hasError) {
                inputElement.removeAttribute('title');
            }
        },
        dispose: (): void => {
            cleanups.forEach((cleanup) => cleanup());
            cleanups.length = 0;
            container.remove();
        }
    };
}

// --- 1. Toggle 开关控件 ---

export interface ToggleOptions extends BaseControlOptions {
    value: boolean;
    onChange?: (checked: boolean) => void;
}

export interface ToggleHandle extends IControlHandle<boolean> {
    readonly inputElement: HTMLInputElement;
}

/**
 * 创建布尔切换开关控件 (Toggle)
 * 采用原生复选框隐藏 + 模拟轨道设计，保证原生键盘 Space/Enter 切换可用。
 */
export function createToggle(options: ToggleOptions): ToggleHandle {
    const label = document.createElement('label');
    label.className = 'da-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(options.value);
    applyBaseAttributes(checkbox, options);
    if (options.className) label.classList.add(options.className);

    const track = document.createElement('span');
    track.className = 'da-toggle__track';

    const changeListener = () => {
        options.onChange?.(checkbox.checked);
    };
    checkbox.addEventListener('change', changeListener);

    label.appendChild(checkbox);
    label.appendChild(track);

    const stateHandlers = bindControlStateHandlers({
        container: label,
        inputElement: checkbox,
        cleanups: [() => checkbox.removeEventListener('change', changeListener)]
    });

    const handle: ToggleHandle = Object.assign(label, {
        inputElement: checkbox,
        getValue: (): boolean => checkbox.checked,
        setValue: (val: boolean): void => {
            checkbox.checked = Boolean(val);
        },
        ...stateHandlers
    });

    return handle;
}

// --- 2. Select 下拉选择器控件 ---

export interface SelectOptionItem {
    label: string;
    value: string | number;
    group?: string;
}

export interface SelectOptions extends BaseControlOptions {
    value: string | number;
    options: Array<SelectOptionItem | string>;
    onChange?: (value: string) => void;
}

export interface SelectHandle extends IControlHandle<string> {
    readonly inputElement: HTMLSelectElement;
    setOptions(opts: Array<SelectOptionItem | string>, preserveValue?: boolean): void;
    setError(hasError: boolean, tooltip?: string): void;
    setDirty(isDirty: boolean): void;
}

/**
 * 创建下拉选择框控件
 * 支持动态更新选项列表、optgroup 视觉分组与选中态回退。
 */
export function createSelect(options: SelectOptions): SelectHandle {
    const select = document.createElement('select');
    select.className = 'da-select';
    applyBaseAttributes(select, options);

    const renderOptions = (items: Array<SelectOptionItem | string>, currentSelected?: string | number) => {
        select.innerHTML = '';
        const optGroups = new Map<string, HTMLOptGroupElement>();

        items.forEach((item) => {
            const opt = document.createElement('option');
            let groupName: string | undefined;

            if (typeof item === 'object' && item !== null) {
                opt.value = String(item.value);
                opt.textContent = item.label;
                groupName = item.group;
            } else {
                opt.value = String(item);
                opt.textContent = String(item);
            }

            if (currentSelected !== undefined && String(opt.value) === String(currentSelected)) {
                opt.selected = true;
            }

            if (groupName) {
                let groupElem = optGroups.get(groupName);
                if (!groupElem) {
                    groupElem = document.createElement('optgroup');
                    groupElem.label = groupName;
                    optGroups.set(groupName, groupElem);
                    select.appendChild(groupElem);
                }
                groupElem.appendChild(opt);
            } else {
                select.appendChild(opt);
            }
        });
    };

    renderOptions(options.options, options.value);

    const changeListener = () => {
        options.onChange?.(select.value);
    };
    select.addEventListener('change', changeListener);

    const stateHandlers = bindControlStateHandlers({
        container: select,
        inputElement: select,
        cleanups: [() => select.removeEventListener('change', changeListener)]
    });

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
        ...stateHandlers
    });

    return handle;
}

// --- 3. Number 数值输入控件 ---

export interface NumberInputOptions extends BaseControlOptions {
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

/**
 * 创建数值输入控件
 * 限制数值在 [min, max] 闭区间内，并在包含单位后缀时返回带包裹器的 DOM 结构。
 * 针对酒馆长页面滚动场景：当输入框未聚焦时拦截滚轮事件，避免用户上下滚动弹窗时误改参数。
 */
export function createNumberInput(options: NumberInputOptions): NumberInputHandle {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'da-input da-input--number';
    applyBaseAttributes(input, options);

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
    const extraElements: HTMLElement[] = [];

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
        extraElements.push(wrapper);
    }

    const changeListener = () => {
        const parsed = parseFloat(input.value);
        const clamped = clampValue(parsed);
        input.value = String(clamped);
        options.onChange?.(clamped);
    };
    input.addEventListener('change', changeListener);

    // 未激活聚焦状态下拦截滚轮事件，避免面板纵向滚动时误触改变参数
    const wheelListener = (e: WheelEvent) => {
        if (document.activeElement !== input) {
            e.preventDefault();
        }
    };
    input.addEventListener('wheel', wheelListener, { passive: false });

    const stateHandlers = bindControlStateHandlers({
        container,
        inputElement: input,
        extraElements,
        cleanups: [
            () => input.removeEventListener('change', changeListener),
            () => input.removeEventListener('wheel', wheelListener)
        ]
    });

    const handle: NumberInputHandle = Object.assign(container, {
        inputElement: input,
        getValue: (): number => clampValue(parseFloat(input.value)),
        setValue: (val: number): void => {
            input.value = String(clampValue(val));
        },
        ...stateHandlers
    });

    return handle;
}

// --- 4. TextInput 单行文本输入控件 ---

export interface TextInputOptions extends BaseControlOptions {
    value?: string | number;
    defaultValue?: string | number;
    type?: string;
    placeholder?: string;
    align?: 'left' | 'center';
    variant?: 'short' | 'long';
    /** 是否提供明文/暗文眼睛显隐切换按钮（type 为 password 时默认开启） */
    allowToggleVisibility?: boolean;
    onChange?: (val: string) => void;
}

export interface TextInputHandle extends IControlHandle<string> {
    readonly inputElement: HTMLInputElement;
}

/**
 * 创建单行文本输入控件
 * 支持居中（短文本/标志符）与靠左（长文本/地址）对齐模式，并支持密码输入框显隐切换。
 */
export function createTextInput(options: TextInputOptions): TextInputHandle {
    const input = document.createElement('input');
    const isPasswordType = options.type === 'password';
    input.type = options.type || 'text';

    const alignClass = options.align === 'center' || options.variant === 'short' ? 'da-input--center' : 'da-input--text';
    const variantClass = options.variant === 'short' ? 'da-input--short' : (options.variant === 'long' ? 'da-input-long' : '');
    input.className = `da-input ${alignClass} ${variantClass}`.trim();

    input.placeholder = options.placeholder || '';
    input.value = options.value !== undefined ? String(options.value) : (options.defaultValue !== undefined ? String(options.defaultValue) : '');
    applyBaseAttributes(input, options);

    const changeListener = () => {
        options.onChange?.(input.value.trim());
    };
    input.addEventListener('change', changeListener);

    let container: HTMLElement = input;
    const extraElements: HTMLElement[] = [];
    const cleanups: Array<() => void> = [() => input.removeEventListener('change', changeListener)];

    const shouldAddToggle = options.allowToggleVisibility ?? isPasswordType;
    if (shouldAddToggle) {
        input.type = 'password';
        const wrapper = document.createElement('div');
        wrapper.className = 'da-input-suffix-wrapper';
        input.classList.add('da-input--has-suffix');

        const EYE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'da-input-suffix-btn';
        toggleBtn.innerHTML = EYE_SVG;
        toggleBtn.title = '显示/隐藏内容';
        toggleBtn.setAttribute('aria-label', '显示/隐藏内容');

        const onToggle = (e: MouseEvent) => {
            e.preventDefault();
            if (input.type === 'password') {
                input.type = 'text';
                toggleBtn.innerHTML = EYE_OFF_SVG;
            } else {
                input.type = 'password';
                toggleBtn.innerHTML = EYE_SVG;
            }
            input.focus();
        };
        toggleBtn.addEventListener('click', onToggle);
        cleanups.push(() => toggleBtn.removeEventListener('click', onToggle));

        wrapper.appendChild(input);
        wrapper.appendChild(toggleBtn);
        container = wrapper;
        extraElements.push(wrapper);
    }

    const stateHandlers = bindControlStateHandlers({
        container,
        inputElement: input,
        extraElements,
        cleanups
    });

    const handle: TextInputHandle = Object.assign(container, {
        inputElement: input,
        getValue: (): string => input.value.trim(),
        setValue: (val: string | number): void => {
            input.value = String(val);
        },
        ...stateHandlers
    });

    return handle;
}

// --- 5. Textarea 多行文本域控件 ---

export interface TextareaOptions extends BaseControlOptions {
    value?: string;
    placeholder?: string;
    rows?: number;
    onChange?: (val: string) => void;
}

export interface TextareaHandle extends IControlHandle<string> {
    readonly inputElement: HTMLTextAreaElement;
}

/**
 * 创建多行文本域控件
 * 适用于提示词模板、工作流 JSON 等长文本编辑。
 */
export function createTextarea(options: TextareaOptions): TextareaHandle {
    const textarea = document.createElement('textarea');
    textarea.className = 'da-textarea';
    textarea.rows = options.rows || 3;
    textarea.placeholder = options.placeholder || '';
    textarea.value = options.value || '';
    applyBaseAttributes(textarea, options);

    const changeListener = () => {
        options.onChange?.(textarea.value);
    };
    textarea.addEventListener('input', changeListener);
    textarea.addEventListener('change', changeListener);

    const stateHandlers = bindControlStateHandlers({
        container: textarea,
        inputElement: textarea,
        cleanups: [
            () => textarea.removeEventListener('input', changeListener),
            () => textarea.removeEventListener('change', changeListener)
        ]
    });

    const handle: TextareaHandle = Object.assign(textarea, {
        inputElement: textarea,
        getValue: (): string => textarea.value.trim(),
        setValue: (val: string): void => {
            textarea.value = String(val ?? '');
        },
        ...stateHandlers
    });

    return handle;
}

// --- 6. ColorPicker 颜色选择器控件 ---

export interface ColorPickerOptions extends BaseControlOptions {
    value?: string;
    defaultValue?: string;
    onChange?: (hexColor: string) => void;
}

export interface ColorPickerHandle extends IControlHandle<string> {
    readonly colorInputElement: HTMLInputElement;
    readonly hexInputElement: HTMLInputElement;
}

/**
 * 创建颜色选择控件
 * 组合原生颜色选取框与 16 进制文本框，保持两者输入数值双向同步与格式合法校验。
 */
export function createColorPicker(options: ColorPickerOptions): ColorPickerHandle {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-color-picker-wrapper';
    if (options.className) wrapper.classList.add(options.className);

    const defaultAccent = FALLBACK_SAFE_THEME.accentColor;
    const initialVal = normalizeHex(options.value ?? options.defaultValue ?? defaultAccent) || defaultAccent;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'da-color-picker-native';
    colorInput.value = initialVal;
    if (options.ariaLabel) colorInput.setAttribute('aria-label', options.ariaLabel);

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'da-input da-color-hex-input';
    hexInput.value = initialVal;
    hexInput.spellcheck = false;
    if (options.id) hexInput.id = options.id;
    if (options.name) hexInput.name = options.name;

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

    const stateHandlers = bindControlStateHandlers({
        container: wrapper,
        inputElement: hexInput,
        extraElements: [colorInput],
        onDisabled: (disabled) => {
            colorInput.disabled = disabled;
            hexInput.disabled = disabled;
        },
        cleanups: [
            () => colorInput.removeEventListener('input', colorChangeListener),
            () => hexInput.removeEventListener('change', hexChangeListener)
        ]
    });

    const handle: ColorPickerHandle = Object.assign(wrapper, {
        inputElement: colorInput,
        colorInputElement: colorInput,
        hexInputElement: hexInput,
        getValue: (): string => normalizeHex(hexInput.value) || defaultAccent,
        setValue: (hex: string): void => syncColor(hex),
        ...stateHandlers
    });

    return handle;
}

// --- 7. Slider 组合式数值微调控件 ---

export interface SliderOptions extends BaseControlOptions {
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

/**
 * 创建组合式数值微调控件 Handle
 * 组合原生拖动条与 NumberInput 数字微调框，支持步进微调与数值精准键入。
 */
export function createSlider(options: SliderOptions): SliderHandle {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-slider-wrapper';
    if (options.className) wrapper.classList.add(options.className);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'da-slider-range';
    slider.min = String(options.min);
    slider.max = String(options.max);
    slider.step = String(options.step ?? 1);
    applyBaseAttributes(slider, options);

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
    slider.addEventListener('change', onSliderChange);

    wrapper.appendChild(slider);
    wrapper.appendChild(numberComp);

    const stateHandlers = bindControlStateHandlers({
        container: wrapper,
        inputElement: slider,
        extraElements: [numberComp],
        onDisabled: (disabled) => {
            slider.disabled = disabled;
            numberComp.setDisabled(disabled);
        },
        cleanups: [
            () => {
                slider.removeEventListener('input', onSliderChange);
                slider.removeEventListener('change', onSliderChange);
            },
            () => numberComp.dispose()
        ]
    });

    const handle: SliderHandle = Object.assign(wrapper, {
        inputElement: slider,
        sliderElement: slider,
        numberInputElement: numberComp.inputElement,
        getValue: (): number => parseFloat(slider.value),
        setValue: (val: number): void => {
            slider.value = String(val);
            numberComp.setValue(val);
        },
        ...stateHandlers,
        setDirty: (isDirty: boolean): void => {
            stateHandlers.setDirty(isDirty);
            numberComp.setDirty?.(isDirty);
        },
        setError: (hasError: boolean, tooltip?: string): void => {
            stateHandlers.setError(hasError, tooltip);
            numberComp.setError?.(hasError, tooltip);
        }
    });

    return handle;
}

// --- 8. SegmentedControl 单选下拉切换控件 ---

export interface SegmentedItem {
    label: string;
    value: string;
    icon?: string;
}

export interface SegmentedControlOptions extends BaseControlOptions {
    value: string;
    items: SegmentedItem[];
    onChange?: (value: string) => void;
}

export interface SegmentedControlHandle extends IControlHandle<string> {
    setItems(items: SegmentedItem[]): void;
}

/**
 * 创建单选下拉切换控件 Handle
 * 基于标准 Select 组件包装，提供选项列表动态更新与事件绑定能力。
 */
export function createSegmentedControl(options: SegmentedControlOptions): SegmentedControlHandle {
    const selectOptions: SelectOptionItem[] = options.items.map((item) => ({
        label: item.label,
        value: item.value
    }));

    const selectComp = createSelect({
        id: options.id,
        name: options.name,
        ariaLabel: options.ariaLabel,
        className: options.className,
        value: options.value,
        options: selectOptions,
        onChange: (val) => {
            options.onChange?.(val);
        }
    });

    const handle: SegmentedControlHandle = Object.assign(selectComp, {
        setItems: (items: SegmentedItem[]): void => {
            selectComp.setOptions(items.map((item) => ({ label: item.label, value: item.value })));
        }
    });

    return handle;
}
