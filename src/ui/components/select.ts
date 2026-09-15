/**
 * 下拉选择器控件 (Select)
 *
 * 功能：
 * 1. 提供标准下拉选项渲染，支持扁平选项列表与 optgroup 分组渲染；
 * 2. 支持动态选项重载 (setOptions) 与选中值恢复；
 * 3. 继承 IControlHandle 规范，支持脏状态标记与错误状态高亮。
 *
 * Tips：
 * 1. 选项条目提供 disabled 属性可单独禁用特定选项；
 * 2. 动态重载选项列表时若未指定 selectValue，自动保留或回退至当前激活值。
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
    focus(): void;
}

export function createSelect(options: SelectOptions): SelectHandle {
    const select = document.createElement('select');
    select.className = 'da-select';
    if (options.className) select.classList.add(options.className);

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
            if (message) {
                select.title = message;
            } else if (!hasError) {
                select.title = '';
            }
        },
        focus(): void {
            select.focus();
        },
        dispose(): void {
            select.removeEventListener('change', onChange);
        }
    };
}
