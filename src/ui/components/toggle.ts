/**
 * 拟物滑动开关组件 (Toggle Switch)
 * 基于原生 Checkbox 改造，保留完整无障碍支持与键盘 Space 键切换能力。
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
            if (message) label.title = message;
        },
        dispose(): void {
            input.removeEventListener('change', onChange);
        }
    };
}
