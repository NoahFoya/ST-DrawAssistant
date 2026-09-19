/**
 * ST-DrawAssistant 下拉选择器原子控件。
 *
 * @remarks
 * 基于原生 HTMLSelectElement 与 option/optgroup 构建，遵循 .da-select 样式规范。
 * 支持居中排版、选项动态更新与修改态/校验失败高亮。
 */

import type {
    SelectComponent,
    SelectOptionGroup,
    SelectOptionItem,
    SelectOptions,
} from './types';

function isOptionGroup<T extends string>(
    item: SelectOptionItem<T> | SelectOptionGroup<T>
): item is SelectOptionGroup<T> {
    return 'groupLabel' in item && Array.isArray((item as SelectOptionGroup<T>).options);
}

export function createSelect<T extends string = string>(
    options: SelectOptions<T>
): SelectComponent<T> {
    const select = document.createElement('select');
    select.classList.add('da-select');

    if (options.size === 'sm') {
        select.classList.add('da-select--sm');
    }
    if (options.className) {
        select.classList.add(...options.className.split(' ').filter(Boolean));
    }
    if (options.disabled) {
        select.disabled = true;
    }

    const renderOptions = (
        items: (SelectOptionItem<T> | SelectOptionGroup<T>)[],
        currentValue?: T
    ) => {
        select.innerHTML = '';
        for (const item of items) {
            if (isOptionGroup(item)) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = item.groupLabel;
                for (const subItem of item.options) {
                    const opt = document.createElement('option');
                    opt.value = subItem.value;
                    opt.textContent = subItem.label;
                    if (subItem.disabled) opt.disabled = true;
                    if (currentValue !== undefined && subItem.value === currentValue) {
                        opt.selected = true;
                    }
                    optgroup.appendChild(opt);
                }
                select.appendChild(optgroup);
            } else {
                const opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                if (item.disabled) opt.disabled = true;
                if (currentValue !== undefined && item.value === currentValue) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            }
        }
    };

    renderOptions(options.options, options.value);

    let changeHandler: ((e: Event) => void) | null = null;
    if (options.onChange) {
        changeHandler = () => {
            options.onChange!(select.value as T);
        };
        select.addEventListener('change', changeHandler);
    }

    return {
        get element() {
            return select;
        },
        getValue(): T {
            return select.value as T;
        },
        setValue(value: T, triggerChange = false): void {
            select.value = value;
            if (triggerChange && changeHandler) {
                changeHandler(new Event('change'));
            }
        },
        setDisabled(disabled: boolean): void {
            select.disabled = disabled;
        },
        updateOptions(newOptions: (SelectOptionItem<T> | SelectOptionGroup<T>)[]): void {
            const currentVal = select.value as T;
            renderOptions(newOptions, currentVal);
        },
        markDirty(dirty: boolean): void {
            select.classList.toggle('is-dirty', dirty);
        },
        markInvalid(invalid: boolean, message?: string): void {
            select.classList.toggle('is-invalid', invalid);
            if (invalid && message) {
                select.title = message;
            } else if (!invalid) {
                select.removeAttribute('title');
            }
        },
        dispose(): void {
            if (changeHandler) {
                select.removeEventListener('change', changeHandler);
                changeHandler = null;
            }
        },
    };
}
