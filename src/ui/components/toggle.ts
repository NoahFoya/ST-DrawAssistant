/**
 * ST-DrawAssistant 开关切换原子控件。
 *
 * @remarks
 * 保留原生 checkbox 的无障碍访问与键盘 Tab 导航能力，
 * 封装 .da-toggle 与 .da-toggle__track 容器，支持状态联动与修改标记。
 */

import type { SetValueOptions, ToggleComponent, ToggleOptions } from './types';

export function createToggle(options: ToggleOptions = {}): ToggleComponent {
    const label = document.createElement('label');
    label.classList.add('da-toggle');

    if (options.className) {
        label.classList.add(...options.className.split(' ').filter(Boolean));
    }

    const input = document.createElement('input');
    input.type = 'checkbox';
    if (options.checked) {
        input.checked = true;
        label.classList.add('is-checked');
    }
    if (options.disabled) {
        input.disabled = true;
        label.classList.add('is-disabled');
    }

    const track = document.createElement('span');
    track.classList.add('da-toggle__track');

    label.appendChild(input);
    label.appendChild(track);

    let changeHandler: ((e: Event) => void) | null = null;
    changeHandler = () => {
        label.classList.toggle('is-checked', input.checked);
        options.onChange?.(input.checked);
    };
    input.addEventListener('change', changeHandler);

    return {
        get element() {
            return label;
        },
        get inputElement() {
            return input;
        },
        getValue(): boolean {
            return input.checked;
        },
        setValue(checked: boolean, setValOptions?: SetValueOptions): void {
            input.checked = Boolean(checked);
            label.classList.toggle('is-checked', input.checked);
            if (setValOptions?.triggerChange && changeHandler) {
                changeHandler(new Event('change'));
            }
        },
        setDisabled(disabled: boolean): void {
            input.disabled = disabled;
            label.classList.toggle('is-disabled', disabled);
        },
        markDirty(dirty: boolean): void {
            label.classList.toggle('is-dirty', dirty);
        },
        setDirty(isDirty: boolean): void {
            this.markDirty(isDirty);
        },
        dispose(): void {
            if (changeHandler) {
                input.removeEventListener('change', changeHandler);
                changeHandler = null;
            }
        },
    };
}
