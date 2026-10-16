/**
 * 标准表单行包装组件 (FormField)。
 *
 * @remarks
 * 为受控原子控件提供一致的 38px 标准表单行外壳：
 * 1. 标题与必填星号指示；
 * 2. 悬浮帮助提示问号图标 (Tooltip)；
 * 3. 字段级脏状态指示黄点；
 * 4. 弹性右侧控件操作区与预设阶梯宽度。
 */

import type { UIComponent } from '../types';

export type FormFieldControlWidth = 'auto' | 'w-80' | 'w-120' | 'w-240' | 'w-toggle';

export interface FormFieldOptions {
    /** 表单字段标签文本 */
    label: string;
    /** 是否必填字段，默认 false */
    required?: boolean;
    /** 悬停帮助提示文字 */
    tooltip?: string;
    /** 内部挂载的受控控件组件或原生元素 */
    control: UIComponent | HTMLElement;
    /** 右侧控件操作区宽度预设，默认 'auto' */
    width?: FormFieldControlWidth;
    /** 附加类名 */
    className?: string;
}

export class FormField implements UIComponent {
    public readonly element: HTMLElement;
    private readonly labelElement: HTMLLabelElement;
    private readonly requiredMark?: HTMLSpanElement;
    private readonly tooltipIcon?: HTMLSpanElement;
    private readonly dirtyDot: HTMLSpanElement;
    private readonly controlContainer: HTMLElement;

    private activeControl: UIComponent | HTMLElement;

    constructor(options: FormFieldOptions) {
        this.activeControl = options.control;

        // 1. 创建 38px 表单行根容器
        this.element = document.createElement('div');
        this.element.classList.add('da-form-row');
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 左侧标签组
        const labelGroup = document.createElement('div');
        labelGroup.classList.add('da-field-label-group');

        if (options.required) {
            this.requiredMark = document.createElement('span');
            this.requiredMark.classList.add('da-field-required');
            this.requiredMark.textContent = '*';
            labelGroup.appendChild(this.requiredMark);
        }

        this.labelElement = document.createElement('label');
        this.labelElement.classList.add('da-field-label');
        this.labelElement.textContent = options.label;
        labelGroup.appendChild(this.labelElement);

        if (options.tooltip) {
            this.tooltipIcon = document.createElement('span');
            this.tooltipIcon.classList.add('da-help-icon');
            this.tooltipIcon.title = options.tooltip;
            this.tooltipIcon.setAttribute('data-tooltip', options.tooltip);
            this.tooltipIcon.textContent = '?';
            labelGroup.appendChild(this.tooltipIcon);
        }

        this.element.appendChild(labelGroup);

        // 3. 中间脏状态黄点指示器
        this.dirtyDot = document.createElement('span');
        this.dirtyDot.classList.add('da-field-dirty-dot');
        this.dirtyDot.title = '此项配置已修改但尚未保存';
        this.dirtyDot.style.display = 'none';
        this.element.appendChild(this.dirtyDot);

        // 4. 右侧控件操作区
        this.controlContainer = document.createElement('div');
        this.controlContainer.classList.add('da-form-row__control');
        const width = options.width ?? 'auto';
        if (width !== 'auto') {
            this.controlContainer.classList.add(`da-slot--${width}`);
        }

        const controlDom = 'element' in this.activeControl ? this.activeControl.element : this.activeControl;
        this.controlContainer.appendChild(controlDom);
        this.element.appendChild(this.controlContainer);
    }

    public setLabel(label: string): void {
        this.labelElement.textContent = label;
    }

    public setDirty(isDirty: boolean): void {
        this.dirtyDot.style.display = isDirty ? 'inline-block' : 'none';
        if (isDirty) {
            this.element.classList.add('da-form-row--dirty');
        } else {
            this.element.classList.remove('da-form-row--dirty');
        }
    }

    public setTooltip(tooltip?: string): void {
        if (this.tooltipIcon) {
            if (tooltip) {
                this.tooltipIcon.title = tooltip;
                this.tooltipIcon.setAttribute('data-tooltip', tooltip);
                this.tooltipIcon.style.display = '';
            } else {
                this.tooltipIcon.removeAttribute('data-tooltip');
                this.tooltipIcon.style.display = 'none';
            }
        }
    }

    public setControl(control: UIComponent | HTMLElement): void {
        if ('dispose' in this.activeControl && typeof this.activeControl.dispose === 'function') {
            this.activeControl.dispose();
        }
        this.controlContainer.innerHTML = '';
        this.activeControl = control;
        const dom = 'element' in control ? control.element : control;
        this.controlContainer.appendChild(dom);
    }

    public dispose(): void {
        if ('dispose' in this.activeControl && typeof this.activeControl.dispose === 'function') {
            this.activeControl.dispose();
        }
        this.controlContainer.innerHTML = '';
        this.element.parentElement?.removeChild(this.element);
    }
}
