/**
 * 现代化下拉选择器组件
 * 居中排版、内嵌箭头、支持动态选项组重载与脏状态联动。
 */

import type { BaseControlOptions, IControlHandle, SelectOptionItem } from '@types';

export interface SelectOptions extends BaseControlOptions {
    value?: string;
    defaultValue?: string;
    options: SelectOptionItem[];
    onChange?: (val: string) => void;
}

export interface SelectHandle extends IControlHandle<string> {
    readonly selectElement: HTMLSelectElement;
    setOptions(options: SelectOptionItem[], selectValue?: string): void;
    getSelectedIndex(): number;
}

export function createSelect(options: SelectOptions): SelectHandle {
    const select = document.createElement('select');
    select.className = 'da-select';

    if (options.id) select.id = options.id;
    if (options.name) select.name = options.name;
    if (options.disabled) select.disabled = true;
    if (options.ariaLabel) select.setAttribute('aria-label', options.ariaLabel);

    const renderOptions = (items: SelectOptionItem[], targetVal?: string) => {
        select.innerHTML = '';
        const groups: Record<string, HTMLOptGroupElement> = {};

        for (const item of items) {
            const opt = document.createElement('option');
            opt.value = item.value;
            opt.textContent = item.label;
            if (item.disabled) opt.disabled = true;

            if (item.group) {
                if (!groups[item.group]) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = item.group;
                    select.appendChild(optgroup);
                    groups[item.group] = optgroup;
                }
                groups[item.group].appendChild(opt);
            } else {
                select.appendChild(opt);
            }
        }

        const activeVal = targetVal ?? options.value ?? options.defaultValue;
        if (activeVal !== undefined) {
            select.value = activeVal;
        }
    };

    renderOptions(options.options, options.value ?? options.defaultValue);

    const onChange = () => {
        options.onChange?.(select.value);
    };
    select.addEventListener('change', onChange);

    return {
        element: select,
        selectElement: select,
        getValue(): string {
            return select.value;
        },
        setValue(val: string): void {
            select.value = val;
        },
        setOptions(items: SelectOptionItem[], selectValue?: string): void {
            renderOptions(items, selectValue);
        },
        getSelectedIndex(): number {
            return select.selectedIndex;
        },
        setDisabled(disabled: boolean): void {
            select.disabled = disabled;
        },
        setDirty(isDirty: boolean): void {
            select.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            select.classList.toggle('is-invalid', hasError);
            if (message) select.title = message;
        },
        dispose(): void {
            select.removeEventListener('change', onChange);
        }
    };
}
