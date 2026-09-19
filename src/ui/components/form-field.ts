/**
 * ST-DrawAssistant 表单行容器原子控件。
 *
 * @remarks
 * 封装标准 38px .da-form-row 容器，组织标题、悬停提示气泡与右侧对齐插槽。
 * 支持堆叠布局、阶梯宽度修饰与嵌套控件的生命周期联动。
 */

import type { BaseComponent, FormFieldComponent, FormFieldOptions } from './types';

function isBaseComponent(control: BaseComponent | HTMLElement): control is BaseComponent {
    return 'element' in control && typeof (control as BaseComponent).dispose === 'function';
}

export function createFormField(options: FormFieldOptions): FormFieldComponent {
    const row = document.createElement('div');
    row.classList.add('da-form-row');

    if (options.layout === 'stacked') {
        row.classList.add('da-form-row--stacked');
    }
    if (options.className) {
        row.classList.add(...options.className.split(' ').filter(Boolean));
    }
    if (options.disabled) {
        row.classList.add('is-disabled');
    }

    // 1. 左侧标题与说明区
    const labelGroup = document.createElement('div');
    labelGroup.classList.add('da-field-label-group');

    const titleRow = document.createElement('div');
    titleRow.classList.add('da-field-title-row');

    const titleSpan = document.createElement('span');
    titleSpan.classList.add('da-field-title');
    titleSpan.textContent = options.label;
    titleRow.appendChild(titleSpan);

    if (options.tooltip) {
        const helpIcon = document.createElement('span');
        helpIcon.classList.add('da-help-icon');
        helpIcon.textContent = '?';
        helpIcon.setAttribute('data-tooltip', options.tooltip);
        titleRow.appendChild(helpIcon);
    }
    labelGroup.appendChild(titleRow);

    if (options.description) {
        const descSpan = document.createElement('div');
        descSpan.classList.add('da-field-desc');
        descSpan.textContent = options.description;
        labelGroup.appendChild(descSpan);
    }

    row.appendChild(labelGroup);

    // 2. 右侧操作插槽
    const slot = document.createElement('div');
    slot.classList.add('da-slot--right');
    if (options.slotWidth && options.slotWidth !== 'full') {
        slot.classList.add(`da-slot--w-${options.slotWidth}`);
    }

    const controlNode = isBaseComponent(options.control) ? options.control.element : options.control;
    slot.appendChild(controlNode);
    row.appendChild(slot);

    // 3. 初始可用性同步
    if (options.disabled && isBaseComponent(options.control)) {
        options.control.setDisabled(true);
    }

    return {
        get element() {
            return row;
        },
        get control() {
            return options.control;
        },
        getValue(): unknown {
            if (isBaseComponent(options.control)) {
                return options.control.getValue();
            }
            return undefined;
        },
        setValue(val: unknown, triggerChange = false): void {
            if (isBaseComponent(options.control)) {
                options.control.setValue(val, triggerChange);
            }
        },
        setDisabled(disabled: boolean): void {
            row.classList.toggle('is-disabled', disabled);
            if (isBaseComponent(options.control)) {
                options.control.setDisabled(disabled);
            }
        },
        setVisible(visible: boolean): void {
            row.hidden = !visible;
        },
        dispose(): void {
            if (isBaseComponent(options.control)) {
                options.control.dispose();
            }
        },
    };
}
