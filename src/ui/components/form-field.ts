/**
 * ST-DrawAssistant 表单行容器原子控件。
 *
 * @remarks
 * 封装标准 38px .da-form-row 容器，组织标题、悬停提示气泡与右侧对齐插槽。
 * 支持堆叠布局、阶梯宽度修饰与嵌套控件的生命周期联动。
 */

import type { FormFieldComponent, FormFieldOptions, IControlHandle, SetValueOptions, UIComponent } from './types';

export function isUIComponent(control: unknown): control is UIComponent {
    return (
        typeof control === 'object' &&
        control !== null &&
        'element' in control &&
        typeof (control as UIComponent).dispose === 'function'
    );
}

export function isControlHandle(control: unknown): control is IControlHandle<unknown> {
    return (
        isUIComponent(control) &&
        'getValue' in control &&
        typeof (control as IControlHandle).getValue === 'function' &&
        'setValue' in control &&
        typeof (control as IControlHandle).setValue === 'function'
    );
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

    const slot = document.createElement('div');
    slot.classList.add('da-slot--right');
    if (options.slotWidth && options.slotWidth !== 'full') {
        slot.classList.add(`da-slot--w-${options.slotWidth}`);
    }

    const control = options.control;
    const controlNode = isUIComponent(control) ? control.element : control;
    slot.appendChild(controlNode);
    row.appendChild(slot);

    if (options.disabled && isControlHandle(control)) {
        control.setDisabled(true);
    }

    return {
        get element() {
            return row;
        },
        get control() {
            return control;
        },
        getValue(): unknown {
            if (isControlHandle(control)) {
                return control.getValue();
            }
            return undefined;
        },
        setValue(val: unknown, setValOpts?: SetValueOptions): void {
            if (isControlHandle(control)) {
                control.setValue(val, setValOpts);
            }
        },
        setDisabled(disabled: boolean): void {
            row.classList.toggle('is-disabled', disabled);
            if (isControlHandle(control)) {
                control.setDisabled(disabled);
            }
        },
        setVisible(visible: boolean): void {
            row.hidden = !visible;
        },
        dispose(): void {
            if (isUIComponent(control)) {
                control.dispose();
            }
        },
    };
}
