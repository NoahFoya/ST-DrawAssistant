/**
 * @module ui/components/controls
 * @description 扩展统一基础 UI 控件与渲染部件库 (Consolidated Controls)
 *
 * 核心职责：
 * - 表单行基础控件 (createFieldRow)
 * - 样式与类名 100% 对齐 styles/main.css (.da-section-card, .da-section-header, .da-section-desc, .da-toggle, .da-slider, .da-help-btn)
 * - 控件构建工厂 (ControlFactory 与 IControlFactory)
 */

export interface FormItemOptions<T> {
    label: string;
    description?: string;
    value: T;
    onChange: (newValue: T) => void;
    disabled?: boolean;
    helpTooltip?: string;
}

export interface FieldRowOptions {
    label: string;
    description?: string;
    helpTooltip?: string;
    headerAction?: HTMLElement | HTMLElement[];
    isBlock?: boolean;
    type?: 'text' | 'number' | 'password' | 'checkbox' | 'select' | 'textarea' | 'range' | string;
    value?: string | number | boolean;
    placeholder?: string;
    options?: Array<{ label: string; value: string | number }>;
    min?: number;
    max?: number;
    step?: number;
    control?: HTMLElement | HTMLElement[];
    className?: string;
    onChange?: (value: any) => void;
    [key: string]: any;
}

export type FieldRowResult = HTMLDivElement & {
    element: HTMLElement;
    input: HTMLElement;
    setValue: (val: string | number | boolean) => void;
};

/** 全局独占活动的帮助说明气泡清理函数 */
let activeHelpBubbleCleanup: (() => void) | null = null;

/**
 * 创建标准的设置项表单行节点
 */
export function createFieldRow(options: FieldRowOptions): HTMLElement {
    const row = document.createElement('div');
    const blockClass = options.isBlock ? 'da-field-row--block' : '';
    row.className = `da-field-row ${blockClass} ${options.className ?? ''}`.trim();

    const labelContainer = document.createElement('div');
    labelContainer.className = 'da-field-label';

    const labelHeader = document.createElement('div');
    labelHeader.style.display = 'flex';
    labelHeader.style.alignItems = 'center';
    labelHeader.style.gap = '6px';
    if (options.headerAction) {
        labelHeader.style.justifyContent = 'space-between';
        labelHeader.style.width = '100%';
    }

    const labelLeftGroup = document.createElement('div');
    labelLeftGroup.style.display = 'flex';
    labelLeftGroup.style.alignItems = 'center';
    labelLeftGroup.style.gap = '6px';

    const labelText = document.createElement('span');
    labelText.className = 'da-label-text';
    labelText.textContent = options.label;
    labelLeftGroup.appendChild(labelText);

    if (options.helpTooltip) {
        const helpBtn = document.createElement('button');
        helpBtn.className = 'da-help-btn';
        helpBtn.title = '点击查看字段详细说明';
        helpBtn.innerHTML = '?';

        let bubbleEl: HTMLElement | null = null;
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            if (activeHelpBubbleCleanup) {
                const wasSelf = bubbleEl !== null;
                activeHelpBubbleCleanup();
                if (wasSelf) return;
            }

            bubbleEl = document.createElement('div');
            bubbleEl.className = 'da-field-help-bubble';
            bubbleEl.innerHTML = `
                <div style="font-weight:600; color:var(--da-accent-color); margin-bottom:4px; font-size:0.88em;">说明</div>
                <div>${options.helpTooltip}</div>
            `;
            document.body.appendChild(bubbleEl);

            const rect = helpBtn.getBoundingClientRect();
            bubbleEl.style.top = `${rect.bottom + 6}px`;
            bubbleEl.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;

            const dismiss = () => {
                if (bubbleEl) {
                    bubbleEl.remove();
                    bubbleEl = null;
                }
                if (activeHelpBubbleCleanup === dismiss) {
                    activeHelpBubbleCleanup = null;
                }
                window.removeEventListener('pointerdown', onPointerDown, true);
            };

            const onPointerDown = (evt: Event) => {
                const target = evt.target as Node | null;
                if (bubbleEl && target && !bubbleEl.contains(target) && !helpBtn.contains(target)) {
                    dismiss();
                }
            };

            activeHelpBubbleCleanup = dismiss;
            setTimeout(() => {
                if (bubbleEl) {
                    window.addEventListener('pointerdown', onPointerDown, true);
                }
            }, 10);
        });

        labelLeftGroup.appendChild(helpBtn);
    }

    labelHeader.appendChild(labelLeftGroup);
    if (options.headerAction) {
        if (Array.isArray(options.headerAction)) {
            options.headerAction.forEach((item) => {
                if (item instanceof HTMLElement) labelHeader.appendChild(item);
            });
        } else if (options.headerAction instanceof HTMLElement) {
            labelHeader.appendChild(options.headerAction);
        }
    }
    labelContainer.appendChild(labelHeader);

    if (options.description) {
        const desc = document.createElement('div');
        desc.className = 'da-label-desc';
        desc.textContent = options.description;
        labelContainer.appendChild(desc);
    }
    row.appendChild(labelContainer);

    const controlContainer = document.createElement('div');
    controlContainer.className = 'da-field-control';

    let inputEl: HTMLElement;

    if (options.control) {
        if (Array.isArray(options.control)) {
            options.control.forEach((ctrl) => {
                if (ctrl instanceof HTMLElement) controlContainer.appendChild(ctrl);
            });
            inputEl = (options.control[0] as HTMLElement) || controlContainer;
        } else {
            inputEl = options.control;
            controlContainer.appendChild(inputEl);
        }
    } else if (options.type === 'select') {
        const select = document.createElement('select');
        select.className = 'da-select da-control-fixed-180';
        (options.options || []).forEach((opt) => {
            const op = document.createElement('option');
            op.value = String(opt.value);
            op.textContent = opt.label;
            if (String(opt.value) === String(options.value)) {
                op.selected = true;
            }
            select.appendChild(op);
        });
        select.addEventListener('change', () => {
            if (options.onChange) options.onChange(select.value);
        });
        inputEl = select;
    } else if (options.type === 'checkbox') {
        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'da-toggle';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(options.value);
        const slider = document.createElement('span');
        slider.className = 'da-slider';
        toggleLabel.appendChild(checkbox);
        toggleLabel.appendChild(slider);

        checkbox.addEventListener('change', () => {
            if (options.onChange) options.onChange(checkbox.checked);
        });
        inputEl = checkbox;
        controlContainer.appendChild(toggleLabel);
    } else if (options.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.className = 'da-textarea';
        textarea.value = String(options.value || '');
        if (options.placeholder) textarea.placeholder = options.placeholder;
        textarea.addEventListener('input', () => {
            if (options.onChange) options.onChange(textarea.value);
        });
        inputEl = textarea;
    } else if (options.type === 'range') {
        const sliderContainer = document.createElement('div');
        sliderContainer.style.display = 'flex';
        sliderContainer.style.alignItems = 'center';
        sliderContainer.style.gap = '8px';
        sliderContainer.style.width = '100%';

        const rangeInput = document.createElement('input');
        rangeInput.type = 'range';
        rangeInput.className = 'da-range-input';
        rangeInput.style.flex = '1';
        if (options.min !== undefined) rangeInput.min = String(options.min);
        if (options.max !== undefined) rangeInput.max = String(options.max);
        if (options.step !== undefined) rangeInput.step = String(options.step);
        rangeInput.value = String(options.value ?? options.min ?? 0);

        const valBadge = document.createElement('span');
        valBadge.className = 'da-range-val-badge';
        valBadge.style.minWidth = '42px';
        valBadge.style.textAlign = 'right';
        valBadge.style.fontSize = '0.85em';
        valBadge.style.color = 'var(--da-text-secondary)';
        valBadge.textContent = rangeInput.value;

        rangeInput.addEventListener('input', () => {
            valBadge.textContent = rangeInput.value;
            if (options.onChange) options.onChange(Number(rangeInput.value));
        });

        sliderContainer.appendChild(rangeInput);
        sliderContainer.appendChild(valBadge);
        inputEl = rangeInput;
        controlContainer.appendChild(sliderContainer);
    } else {
        const input = document.createElement('input');
        input.type = options.type || 'text';
        input.className = 'da-input da-control-fixed-180';
        if (options.value !== undefined) input.value = String(options.value);
        if (options.placeholder) input.placeholder = options.placeholder;
        if (options.min !== undefined) input.min = String(options.min);
        if (options.max !== undefined) input.max = String(options.max);
        if (options.step !== undefined) input.step = String(options.step);

        input.addEventListener('change', () => {
            if (options.onChange) {
                const val = options.type === 'number' ? Number(input.value) : input.value;
                options.onChange(val);
            }
        });
        inputEl = input;
    }

    if (!options.control && options.type !== 'checkbox' && options.type !== 'range') {
        controlContainer.appendChild(inputEl);
    }
    row.appendChild(controlContainer);

    const setValue = (val: string | number | boolean) => {
        if (options.type === 'checkbox') {
            (inputEl as HTMLInputElement).checked = Boolean(val);
        } else if (options.type === 'select') {
            (inputEl as HTMLSelectElement).value = String(val);
        } else if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
            inputEl.value = String(val);
        }
    };

    const res = row as FieldRowResult;
    res.element = row;
    res.input = inputEl;
    res.setValue = setValue;

    return res;
}

export interface IControlFactory {
    createSwitch(options: FormItemOptions<boolean>): HTMLElement;
    createToggle(options: FormItemOptions<boolean>): HTMLElement;
    createSlider(options: FormItemOptions<number> & { min: number; max: number; step: number }): HTMLElement;
    createSelect<V extends string>(options: FormItemOptions<V> & { items: Array<{ value: V; label: string }> }): HTMLElement;
    createInput(options: FormItemOptions<string> & { placeholder?: string; type?: string }): HTMLElement;
    createCard(title: string, contentBuilder: (body: HTMLElement) => void, desc?: string): HTMLElement;
}

/**
 * 标准原子控件工厂实现
 */
export class ControlFactory implements IControlFactory {
    public createSwitch(options: FormItemOptions<boolean>): HTMLElement {
        return createFieldRow({
            label: options.label,
            description: options.description,
            helpTooltip: options.helpTooltip,
            type: 'checkbox',
            value: options.value,
            onChange: options.onChange
        });
    }

    public createToggle(options: FormItemOptions<boolean>): HTMLElement {
        return this.createSwitch(options);
    }

    public createSlider(
        options: FormItemOptions<number> & { min: number; max: number; step: number }
    ): HTMLElement {
        return createFieldRow({
            label: options.label,
            description: options.description,
            helpTooltip: options.helpTooltip,
            type: 'range',
            min: options.min,
            max: options.max,
            step: options.step,
            value: options.value,
            onChange: options.onChange
        });
    }

    public createSelect<V extends string>(
        options: FormItemOptions<V> & { items: Array<{ value: V; label: string }> }
    ): HTMLElement {
        return createFieldRow({
            label: options.label,
            description: options.description,
            helpTooltip: options.helpTooltip,
            type: 'select',
            options: options.items,
            value: options.value,
            onChange: options.onChange
        });
    }

    public createInput(options: FormItemOptions<string> & { placeholder?: string; type?: string }): HTMLElement {
        return createFieldRow({
            label: options.label,
            description: options.description,
            helpTooltip: options.helpTooltip,
            type: options.type || 'text',
            placeholder: options.placeholder,
            value: options.value,
            onChange: options.onChange
        });
    }

    public createCard(title: string, contentBuilder: (body: HTMLElement) => void, desc?: string): HTMLElement {
        const card = document.createElement('div');
        card.className = 'da-section-card';

        const header = document.createElement('div');
        header.className = 'da-section-header';
        header.innerHTML = `
            <span class="da-section-title">${title}</span>
            ${desc ? `<span class="da-section-desc">${desc}</span>` : ''}
        `;
        card.appendChild(header);

        const body = document.createElement('div');
        body.className = 'da-section-body';
        contentBuilder(body);
        card.appendChild(body);

        return card;
    }
}

/**
 * 渲染 IndexedDB 存储容量与配额占比指示条
 */
export function renderStorageBar(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-storage-bar';
    container.style.marginTop = '10px';
    container.style.padding = '12px';
    container.style.borderRadius = '8px';
    container.style.background = 'var(--da-bg-secondary, rgba(255,255,255,0.03))';

    const label = document.createElement('div');
    label.style.fontSize = '0.85em';
    label.style.color = 'var(--da-text-secondary)';
    label.style.marginBottom = '6px';
    label.textContent = '本地 IndexedDB 存储使用率估算...';
    container.appendChild(label);

    const track = document.createElement('div');
    track.style.width = '100%';
    track.style.height = '6px';
    track.style.borderRadius = '3px';
    track.style.background = 'var(--da-bg-hover, rgba(255, 255, 255, 0.08))';
    track.style.overflow = 'hidden';

    const fill = document.createElement('div');
    fill.style.width = '0%';
    fill.style.height = '100%';
    fill.style.background = 'var(--da-accent-color, #0a84ff)';
    fill.style.transition = 'width 0.3s ease';
    track.appendChild(fill);
    container.appendChild(track);

    if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then((est) => {
            const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
            const quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
            const pct = est.quota ? (((est.usage || 0) / est.quota) * 100).toFixed(1) : '0';

            label.textContent = `已用空间: ${usedMB} MB / 额度约 ${quotaMB} MB (${pct}%)`;
            fill.style.width = `${pct}%`;
        }).catch(() => {
            label.textContent = '无法获取浏览器 Storage 估算信息';
        });
    }

    return container;
}

export const defaultControlFactory = new ControlFactory();
export * from './preset-toolbar';
