import { createFieldRow, FieldRowOptions } from './field-row';
import { normalizeHex } from '../foundation';

export type { FieldRowOptions };
export * from './field-row';

/** 下拉选项字典条目结构 */
export interface SelectOptionItem {
    label: string;
    value: string | number;
}

/** Switch 开关表单行配置项 */
export interface ToggleRowOptions {
    label: string;
    description?: string;
    value: boolean;
    helpTooltip?: string;
    headerAction?: HTMLElement;
    onChange: (checked: boolean) => void;
}

export interface ToggleControlHandle extends HTMLElement {
    readonly inputElement: HTMLInputElement;
    getValue: () => boolean;
    setValue: (val: boolean) => void;
    setDisabled: (disabled: boolean) => void;
}

/** 下拉选择表单行配置项 */
export interface SelectRowOptions {
    label: string;
    description?: string;
    value: string | number;
    options: Array<SelectOptionItem | string>;
    helpTooltip?: string;
    headerAction?: HTMLElement;
    fixedWidth?: boolean;
    onChange: (value: string) => void;
}

export interface SelectControlHandle extends HTMLElement {
    readonly inputElement: HTMLSelectElement;
    getValue: () => string;
    setValue: (val: string | number) => void;
    setOptions: (opts: Array<SelectOptionItem | string>, preserveValue?: boolean) => void;
    setDisabled: (disabled: boolean) => void;
    setError: (hasError: boolean, tooltip?: string) => void;
}

/** 数值步进输入表单行配置项 */
export interface NumberRowOptions {
    label: string;
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    helpTooltip?: string;
    description?: string;
    fixedWidth?: boolean;
    headerAction?: HTMLElement;
    onChange?: (val: number) => void;
}

export interface NumberControlHandle extends HTMLElement {
    readonly inputElement: HTMLInputElement;
    getValue: () => number;
    setValue: (val: number) => void;
    setDisabled: (disabled: boolean) => void;
}

/** 文本输入表单行配置项 */
export interface InputRowOptions {
    label: string;
    value?: string | number | boolean;
    defaultValue?: string | number | boolean;
    type?: 'text' | 'number' | 'password' | 'textarea' | string;
    rows?: number;
    placeholder?: string;
    helpTooltip?: string;
    description?: string;
    fixedWidth?: boolean;
    headerAction?: HTMLElement;
    isBlock?: boolean;
    onChange?: (val: string) => void;
}

export interface InputControlHandle extends HTMLElement {
    readonly inputElement: HTMLInputElement | HTMLTextAreaElement;
    getValue: () => string;
    setValue: (val: string | number) => void;
    setDisabled: (disabled: boolean) => void;
}

/** 滑块联动表单行配置项 */
export interface SliderRowOptions {
    label: string;
    description?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    helpTooltip?: string;
    headerAction?: HTMLElement;
    onChange: (value: number) => void;
}

export interface SliderControlHandle extends HTMLElement {
    readonly sliderElement: HTMLInputElement;
    readonly numberInputElement: HTMLInputElement;
    getValue: () => number;
    setValue: (val: number) => void;
    setDisabled: (disabled: boolean) => void;
}

/** 调色盘表单行配置项 */
export interface ColorPickerRowOptions {
    label: string;
    value?: string;
    defaultValue?: string;
    helpTooltip?: string;
    description?: string;
    headerAction?: HTMLElement;
    onChange?: (hexColor: string) => void;
}

export interface ColorPickerControlHandle extends HTMLElement {
    readonly colorInputElement: HTMLInputElement;
    readonly hexInputElement: HTMLInputElement;
    getValue: () => string;
    setValue: (hexColor: string) => void;
    setDisabled: (disabled: boolean) => void;
}

export interface SectionCardOptions {
    title: string;
    description?: string;
    collapsible?: boolean;
    defaultOpen?: boolean;
    headerExtra?: HTMLElement;
    renderBody: (body: HTMLElement) => void;
}

export interface CollapsibleSectionOptions {
    summaryText: string;
    defaultOpen?: boolean;
    renderBody: (body: HTMLElement) => void;
}

// ── 1. Switch 开关 ──
export function createToggleRow(options: ToggleRowOptions): ToggleControlHandle {
    const switchLabel = document.createElement('label');
    switchLabel.className = 'da-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(options.value);

    const slider = document.createElement('span');
    slider.className = 'da-slider';

    checkbox.addEventListener('change', () => {
        options.onChange(checkbox.checked);
    });

    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(slider);

    const fieldRow = createFieldRow({
        label: options.label,
        description: options.description,
        helpTooltip: options.helpTooltip,
        headerAction: options.headerAction,
        control: switchLabel
    });

    const handle = Object.assign(fieldRow, {
        inputElement: checkbox,
        getValue: (): boolean => checkbox.checked,
        setValue: (val: boolean): void => {
            checkbox.checked = val;
        },
        setDisabled: (disabled: boolean): void => {
            checkbox.disabled = disabled;
        }
    });

    return handle as ToggleControlHandle;
}

// ── 2. 下拉选择器 ──
export function createSelectRow(options: SelectRowOptions): SelectControlHandle {
    const select = document.createElement('select');
    select.className = options.fixedWidth === false ? 'da-select' : 'da-select da-control-fixed-180';

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

    select.addEventListener('change', () => {
        options.onChange(select.value);
    });

    const fieldRow = createFieldRow({
        label: options.label,
        description: options.description,
        helpTooltip: options.helpTooltip,
        headerAction: options.headerAction,
        control: select
    });

    const handle = Object.assign(fieldRow, {
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
        }
    });

    return handle as SelectControlHandle;
}

// ── 3. 数值输入 ──
export function createNumberRow(options: NumberRowOptions): NumberControlHandle {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = options.fixedWidth !== false ? 'da-input da-control-fixed-180' : 'da-input';

    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);

    const initialVal = options.value ?? options.defaultValue ?? 0;
    input.value = String(initialVal);

    let controlWrapper: HTMLElement = input;

    if (options.unit) {
        const wrapper = document.createElement('div');
        wrapper.className = options.fixedWidth !== false
            ? 'da-input-unit-wrapper da-control-fixed-180'
            : 'da-input-unit-wrapper';

        input.classList.add('da-input--has-unit');

        const unitBadge = document.createElement('span');
        unitBadge.className = 'da-input-unit-badge';
        unitBadge.textContent = options.unit;

        wrapper.appendChild(input);
        wrapper.appendChild(unitBadge);
        controlWrapper = wrapper;
    }

    input.addEventListener('change', () => {
        const numVal = parseFloat(input.value) || 0;
        options.onChange?.(numVal);
    });

    const fieldRow = createFieldRow({
        label: options.label,
        helpTooltip: options.helpTooltip,
        description: options.description,
        headerAction: options.headerAction,
        control: controlWrapper
    });

    const handle = Object.assign(fieldRow, {
        inputElement: input,
        getValue: (): number => parseFloat(input.value) || 0,
        setValue: (val: number): void => {
            input.value = String(val);
        },
        setDisabled: (disabled: boolean): void => {
            input.disabled = disabled;
        }
    });

    return handle as NumberControlHandle;
}

// ── 4. 文本/多行输入 ──
export function createInputRow(options: InputRowOptions): InputControlHandle {
    const isTextarea = options.type === 'textarea';
    const input = isTextarea ? document.createElement('textarea') : document.createElement('input');

    if (!isTextarea) {
        (input as HTMLInputElement).type = options.type || 'text';
    } else {
        (input as HTMLTextAreaElement).rows = options.rows || 3;
    }

    input.className = isTextarea
        ? 'da-textarea'
        : options.fixedWidth
        ? 'da-input da-control-fixed-180'
        : 'da-input';

    input.placeholder = options.placeholder || '';
    const initialVal = options.value !== undefined ? String(options.value) : (options.defaultValue !== undefined ? String(options.defaultValue) : '');
    input.value = initialVal;

    input.addEventListener('change', () => {
        options.onChange?.(input.value.trim());
    });

    const fieldRow = createFieldRow({
        label: options.label,
        helpTooltip: options.helpTooltip,
        description: options.description,
        headerAction: options.headerAction,
        isBlock: options.isBlock ?? isTextarea,
        control: input
    });

    const handle = Object.assign(fieldRow, {
        inputElement: input,
        getValue: (): string => input.value.trim(),
        setValue: (val: string | number): void => {
            input.value = String(val);
        },
        setDisabled: (disabled: boolean): void => {
            input.disabled = disabled;
        }
    });

    return handle as InputControlHandle;
}

// ── 5. 滑块与数字联动 ──
export function createSliderRow(options: SliderRowOptions): SliderControlHandle {
    const container = document.createElement('div');
    container.className = 'da-slider-number-wrapper da-control-fixed-180';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'da-range-slider';
    slider.min = String(options.min);
    slider.max = String(options.max);
    slider.step = String(options.step || 1);
    slider.value = String(options.value);

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'da-input da-input-num-small';
    numInput.min = String(options.min);
    numInput.max = String(options.max);
    numInput.step = String(options.step || 1);
    numInput.value = String(options.value);

    slider.addEventListener('input', () => {
        const val = Number(slider.value);
        numInput.value = String(val);
        options.onChange(val);
    });

    numInput.addEventListener('change', () => {
        const val = Number(numInput.value);
        slider.value = String(val);
        options.onChange(val);
    });

    container.appendChild(slider);
    container.appendChild(numInput);

    const fieldRow = createFieldRow({
        label: options.label,
        description: options.description,
        control: container,
        headerAction: options.headerAction,
        helpTooltip: options.helpTooltip
    });

    const handle = Object.assign(fieldRow, {
        sliderElement: slider,
        numberInputElement: numInput,
        getValue: (): number => Number(slider.value),
        setValue: (val: number): void => {
            slider.value = String(val);
            numInput.value = String(val);
        },
        setDisabled: (disabled: boolean): void => {
            slider.disabled = disabled;
            numInput.disabled = disabled;
        }
    });

    return handle as SliderControlHandle;
}

// ── 6. 拾色器 ──

export function createColorPickerRow(options: ColorPickerRowOptions): ColorPickerControlHandle {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-color-picker-wrapper da-control-fixed-180';

    const initialVal = normalizeHex(options.value ?? options.defaultValue ?? '#00f2fe') || '#00f2fe';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'da-color-input';
    colorInput.value = initialVal;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'da-input da-input-hex';
    hexInput.value = initialVal;
    hexInput.placeholder = '#000000';
    hexInput.maxLength = 7;

    colorInput.addEventListener('input', () => {
        const val = colorInput.value;
        hexInput.value = val;
        options.onChange?.(val);
    });

    hexInput.addEventListener('change', () => {
        const valid = normalizeHex(hexInput.value);
        if (valid) {
            colorInput.value = valid;
            hexInput.value = valid;
            options.onChange?.(valid);
        } else {
            hexInput.value = colorInput.value;
        }
    });

    wrapper.appendChild(colorInput);
    wrapper.appendChild(hexInput);

    const fieldRow = createFieldRow({
        label: options.label,
        helpTooltip: options.helpTooltip,
        description: options.description,
        headerAction: options.headerAction,
        control: wrapper
    });

    const handle = Object.assign(fieldRow, {
        colorInputElement: colorInput,
        hexInputElement: hexInput,
        getValue: (): string => hexInput.value,
        setValue: (hexColor: string): void => {
            const valid = normalizeHex(hexColor);
            if (valid) {
                colorInput.value = valid;
                hexInput.value = valid;
            }
        },
        setDisabled: (disabled: boolean): void => {
            colorInput.disabled = disabled;
            hexInput.disabled = disabled;
        }
    });

    return handle as ColorPickerControlHandle;
}

// ── 7. 卡片与折叠区块 ──
export function createSectionCard(options: SectionCardOptions): HTMLElement {
    const card = document.createElement('div');
    card.className = 'da-section-card';

    const header = document.createElement('div');
    header.className = 'da-section-header';

    const titleBox = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'da-section-title';
    titleEl.textContent = options.title;
    titleBox.appendChild(titleEl);

    if (options.description) {
        const descEl = document.createElement('div');
        descEl.className = 'da-section-desc';
        descEl.textContent = options.description;
        titleBox.appendChild(descEl);
    }
    header.appendChild(titleBox);

    if (options.headerExtra) {
        header.appendChild(options.headerExtra);
    }

    const body = document.createElement('div');
    body.className = 'da-section-body';
    options.renderBody(body);

    card.appendChild(header);
    card.appendChild(body);
    return card;
}

export function createCollapsibleSection(options: CollapsibleSectionOptions): HTMLElement {
    const details = document.createElement('details');
    details.className = 'da-collapsible-section';
    if (options.defaultOpen) details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'da-collapsible-summary';
    summary.textContent = options.summaryText;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'da-collapsible-body';
    options.renderBody(body);
    details.appendChild(body);

    return details;
}

/**
 * 现代化设置面板 UI 部件统一工厂类 (ControlFactory)
 */
export class ControlFactory {
    public static createSectionCard(options: SectionCardOptions): HTMLElement {
        return createSectionCard(options);
    }

    public createSectionCard(options: SectionCardOptions): HTMLElement {
        return createSectionCard(options);
    }

    public static createCard(
        titleOrOptions: string | SectionCardOptions,
        renderBodyOrDesc?: ((body: HTMLElement) => void) | string,
        descOrExtra?: string | HTMLElement | ((body: HTMLElement) => void),
        extra?: HTMLElement
    ): HTMLElement {
        if (typeof titleOrOptions === 'object') {
            return createSectionCard(titleOrOptions);
        }

        const title = String(titleOrOptions);
        let description: string | undefined;
        let renderBody: (body: HTMLElement) => void = () => {};
        let headerExtra: HTMLElement | undefined;

        if (typeof renderBodyOrDesc === 'function') {
            renderBody = renderBodyOrDesc;
            if (typeof descOrExtra === 'string') description = descOrExtra;
            else if (descOrExtra instanceof HTMLElement) headerExtra = descOrExtra;
            if (extra instanceof HTMLElement) headerExtra = extra;
        } else if (typeof renderBodyOrDesc === 'string') {
            description = renderBodyOrDesc;
            if (typeof descOrExtra === 'function') renderBody = descOrExtra;
            if (extra instanceof HTMLElement) headerExtra = extra;
        }

        return createSectionCard({ title, description, renderBody, headerExtra });
    }

    public createCard(
        titleOrOptions: string | SectionCardOptions,
        renderBodyOrDesc?: ((body: HTMLElement) => void) | string,
        descOrExtra?: string | HTMLElement | ((body: HTMLElement) => void),
        extra?: HTMLElement
    ): HTMLElement {
        return ControlFactory.createCard(titleOrOptions, renderBodyOrDesc, descOrExtra, extra);
    }

    public static createCollapsible(options: CollapsibleSectionOptions): HTMLElement {
        return createCollapsibleSection(options);
    }

    public createCollapsible(options: CollapsibleSectionOptions): HTMLElement {
        return createCollapsibleSection(options);
    }

    public static createToggle(options: ToggleRowOptions): ToggleControlHandle {
        return createToggleRow(options);
    }

    public createToggle(options: ToggleRowOptions): ToggleControlHandle {
        return createToggleRow(options);
    }

    public static createSelect(options: SelectRowOptions): SelectControlHandle {
        return createSelectRow(options);
    }

    public createSelect(options: SelectRowOptions): SelectControlHandle {
        return createSelectRow(options);
    }

    public static createNumber(options: NumberRowOptions): NumberControlHandle {
        return createNumberRow(options);
    }

    public createNumber(options: NumberRowOptions): NumberControlHandle {
        return createNumberRow(options);
    }

    public static createInput(options: InputRowOptions): InputControlHandle {
        return createInputRow(options);
    }

    public createInput(options: InputRowOptions): InputControlHandle {
        return createInputRow(options);
    }

    public static createSlider(options: SliderRowOptions): SliderControlHandle {
        return createSliderRow(options);
    }

    public createSlider(options: SliderRowOptions): SliderControlHandle {
        return createSliderRow(options);
    }

    public static createColorPicker(options: ColorPickerRowOptions): ColorPickerControlHandle {
        return createColorPickerRow(options);
    }

    public createColorPicker(options: ColorPickerRowOptions): ColorPickerControlHandle {
        return createColorPickerRow(options);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 复合控件 (Composite Controls): ConnectionCard & LoraManagerControl
// ─────────────────────────────────────────────────────────────────────────────

import { LoraItem } from '../../core/state/store-types';
export type { LoraItem };

export interface ConnectionCardOptions {
    title: string;
    description: string;
    url?: string;
    currentUrl?: string;
    defaultUrl?: string;
    placeholder?: string;
    onUrlChange: (newUrl: string) => void;
    onTest: (url: string, btn: HTMLButtonElement) => Promise<void>;
}

export function createConnectionCard(options: ConnectionCardOptions): HTMLElement {
    const targetUrl = options.url || options.currentUrl || options.defaultUrl || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'da-input';
    input.value = targetUrl;
    input.placeholder = options.placeholder || 'http://127.0.0.1:...';
    input.style.flex = '1';
    input.addEventListener('change', () => options.onUrlChange(input.value.trim()));

    const testBtn = document.createElement('button');
    testBtn.className = 'da-btn secondary';
    testBtn.textContent = '测试连接';
    testBtn.onclick = () => options.onTest(input.value.trim(), testBtn);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.appendChild(input);
    row.appendChild(testBtn);

    return createSectionCard({
        title: options.title,
        description: options.description,
        renderBody: (body: HTMLElement) => body.appendChild(row)
    });
}

export interface LoraManagerElement extends HTMLElement {
    getLoras: () => LoraItem[];
    setLoras: (loras: LoraItem[]) => void;
    update?: (loras: LoraItem[], cachedLoras?: string[]) => void;
}

export interface LoraManagerOptions {
    loras: LoraItem[];
    cachedLoras: string[];
    showExtraWeights?: boolean;
    onChange: (loras: LoraItem[]) => void;
}

export function createLoraManagerControl(options: LoraManagerOptions): LoraManagerElement {
    const container = document.createElement('div') as unknown as LoraManagerElement;
    container.className = 'da-lora-manager';

    let currentLoras: LoraItem[] = [...(options.loras || [])];
    let cachedList = [...(options.cachedLoras || [])];

    const render = () => {
        container.innerHTML = '';

        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '6px';

        currentLoras.forEach((lora, idx) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '8px';

            const nameSpan = document.createElement('span');
            nameSpan.style.flex = '1';
            nameSpan.style.fontSize = '0.85em';
            nameSpan.textContent = lora.name;

            const weightInput = document.createElement('input');
            weightInput.type = 'number';
            weightInput.className = 'da-input';
            weightInput.style.width = '60px';
            weightInput.step = '0.05';
            weightInput.value = String(lora.weight ?? 1.0);
            weightInput.addEventListener('change', () => {
                lora.weight = Number(weightInput.value);
                options.onChange(currentLoras);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'da-icon-btn danger';
            delBtn.innerHTML = '✕';
            delBtn.title = '移除此 LoRA';
            delBtn.onclick = () => {
                currentLoras.splice(idx, 1);
                render();
                options.onChange(currentLoras);
            };

            item.appendChild(nameSpan);
            item.appendChild(weightInput);
            item.appendChild(delBtn);
            list.appendChild(item);
        });

        const addRow = document.createElement('div');
        addRow.style.display = 'flex';
        addRow.style.gap = '8px';
        addRow.style.marginTop = '8px';

        const select = document.createElement('select');
        select.className = 'da-select';
        select.style.flex = '1';

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '选择要添加的 LoRA...';
        select.appendChild(defaultOpt);

        cachedList.forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'da-btn secondary';
        addBtn.textContent = '添加';
        addBtn.onclick = () => {
            const val = select.value;
            if (val && !currentLoras.some((l) => l.name === val)) {
                currentLoras.push({ name: val, weight: 1.0 });
                render();
                options.onChange(currentLoras);
            }
        };

        addRow.appendChild(select);
        addRow.appendChild(addBtn);

        container.appendChild(list);
        container.appendChild(addRow);
    };

    render();

    container.getLoras = () => currentLoras;
    container.setLoras = (loras: LoraItem[]) => {
        currentLoras = [...loras];
        render();
    };
    container.update = (loras: LoraItem[], newCached?: string[]) => {
        currentLoras = [...loras];
        if (newCached) cachedList = [...newCached];
        render();
    };

    return container;
}

