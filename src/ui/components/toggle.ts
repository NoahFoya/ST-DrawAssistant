/**
 * 滑动开关控件 (Toggle)
 *
 * 功能：
 * 1. 基于原生 Checkbox 封装 38px 拟物滑动开关；
 * 2. 保留原生无障碍属性与键盘空格键切换交互能力；
 * 3. 实现 IControlHandle<boolean> 接口，支持脏状态与禁用态样式联动。
 *
 * Tips：
 * 1. 根节点使用 label 标签包裹，点击轨道任意区域均可触发原生状态切换；
 * 2. 状态变更时触发 onChange 回调并传递布尔值。
 */

import type { BaseControlOptions, IControlHandle } from '@types';

export interface ToggleOptions extends BaseControlOptions {
    checked?: boolean;
    value?: boolean;
    defaultChecked?: boolean;
    onChange?: (checked: boolean) => void;
}

export interface ToggleHandle extends IControlHandle<boolean> {
    readonly inputElement: HTMLInputElement;
    focus(): void;
}

export function createToggle(options: ToggleOptions): ToggleHandle {
    const label = document.createElement('label');
    label.className = 'da-toggle';
    if (options.className) label.classList.add(options.className);

    const input = document.createElement('input');
    input.type = 'checkbox';
    if (options.id) input.id = options.id;
    if (options.name) input.name = options.name;
    if (options.disabled) input.disabled = true;
    if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

    input.checked = Boolean(options.checked ?? options.value ?? options.defaultChecked ?? false);

    const track = document.createElement('span');
    track.className = 'da-toggle__track';

    label.appendChild(input);
    label.appendChild(track);

    const onChange = () => {
        options.onChange?.(input.checked);
    };
    input.addEventListener('change', onChange);

    return {
        element: label,
        inputElement: input,
        getValue(): boolean {
            return input.checked;
        },
        setValue(val: boolean): void {
            input.checked = Boolean(val);
        },
        setDisabled(disabled: boolean): void {
            input.disabled = disabled;
            label.classList.toggle('is-disabled', disabled);
        },
        setDirty(isDirty: boolean): void {
            label.classList.toggle('is-dirty', isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            label.classList.toggle('is-invalid', hasError);
            if (message) {
                label.title = message;
            } else if (!hasError) {
                label.title = '';
            }
        },
        focus(): void {
            input.focus();
        },
        dispose(): void {
            input.removeEventListener('change', onChange);
        }
    };
}
