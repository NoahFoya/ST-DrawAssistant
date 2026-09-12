/**
 * 现代化按钮控件族
 * 提供标准按钮 (带 Loading 状态与防重复点击)、28px 紧凑图标按钮与按钮组。
 */

import { BaseControlOptions, ButtonSize, ButtonVariant } from './types';
import { createIconElement, IconName } from './icons';

// ==================== 1. 标准通用按钮 Button ====================

export interface ButtonOptions extends BaseControlOptions {
    text: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: IconName;
    loading?: boolean;
    onClick?: (e: MouseEvent) => void;
}

export interface ButtonHandle {
    readonly element: HTMLButtonElement;
    setText(text: string): void;
    setDisabled(disabled: boolean): void;
    setLoading(loading: boolean, loadingText?: string): void;
    dispose(): void;
}

export function createButton(options: ButtonOptions): ButtonHandle {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'da-btn';

    if (options.variant === 'primary') {
        btn.classList.add('da-btn--primary');
    } else if (options.variant === 'danger') {
        btn.classList.add('da-btn--danger');
    } else if (options.variant === 'ghost') {
        btn.classList.add('da-btn--ghost');
    } else {
        btn.classList.add('da-btn--secondary');
    }

    if (options.size === 'sm') {
        btn.classList.add('da-btn--sm');
    }
    if (options.className) btn.classList.add(options.className);
    if (options.id) btn.id = options.id;
    if (options.ariaLabel) btn.setAttribute('aria-label', options.ariaLabel);
    if (options.disabled) btn.disabled = true;

    let normalText = options.text;
    let isLoading = false;

    const renderContent = () => {
        btn.innerHTML = '';
        if (isLoading) {
            btn.appendChild(createIconElement('spinner', 14));
        } else if (options.icon) {
            btn.appendChild(createIconElement(options.icon, 14));
        }

        const span = document.createElement('span');
        span.className = 'da-btn__text';
        span.textContent = normalText;
        btn.appendChild(span);
    };

    renderContent();

    const onClick = (e: MouseEvent) => {
        if (isLoading || btn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        options.onClick?.(e);
    };
    btn.addEventListener('click', onClick);

    return {
        element: btn,
        setText(text: string): void {
            normalText = text;
            renderContent();
        },
        setDisabled(disabled: boolean): void {
            btn.disabled = disabled;
        },
        setLoading(loading: boolean, loadingText?: string): void {
            isLoading = loading;
            btn.disabled = loading;
            btn.classList.toggle('is-loading', loading);
            if (loadingText) {
                normalText = loadingText;
            }
            renderContent();
        },
        dispose(): void {
            btn.removeEventListener('click', onClick);
        }
    };
}

// ==================== 2. 紧凑图标按钮 IconButton ====================

export interface IconButtonOptions extends BaseControlOptions {
    icon: IconName;
    title?: string;
    variant?: 'normal' | 'danger' | 'ghost';
    onClick?: (e: MouseEvent) => void;
}

export interface IconButtonHandle {
    readonly element: HTMLButtonElement;
    setIcon(icon: IconName): void;
    setTitle(title: string): void;
    setDisabled(disabled: boolean): void;
    setDirty(isDirty: boolean): void;
    dispose(): void;
}

export function createIconButton(options: IconButtonOptions): IconButtonHandle {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'da-icon-btn';

    if (options.variant === 'danger') {
        btn.classList.add('da-icon-btn--danger');
    } else if (options.variant === 'ghost') {
        btn.classList.add('da-icon-btn--ghost');
    }
    if (options.className) btn.classList.add(options.className);
    if (options.id) btn.id = options.id;
    if (options.title) btn.title = options.title;
    if (options.ariaLabel || options.title) {
        btn.setAttribute('aria-label', options.ariaLabel || options.title!);
    }
    if (options.disabled) btn.disabled = true;

    btn.appendChild(createIconElement(options.icon, 14));

    const onClick = (e: MouseEvent) => {
        if (btn.disabled) return;
        options.onClick?.(e);
    };
    btn.addEventListener('click', onClick);

    return {
        element: btn,
        setIcon(icon: IconName): void {
            btn.innerHTML = '';
            btn.appendChild(createIconElement(icon, 14));
        },
        setTitle(title: string): void {
            btn.title = title;
            btn.setAttribute('aria-label', title);
        },
        setDisabled(disabled: boolean): void {
            btn.disabled = disabled;
        },
        setDirty(isDirty: boolean): void {
            btn.classList.toggle('is-dirty', isDirty);
        },
        dispose(): void {
            btn.removeEventListener('click', onClick);
        }
    };
}

// ==================== 3. 紧凑按钮组 ButtonGroup ====================

export function createButtonGroup(buttons: (HTMLElement | ButtonHandle | IconButtonHandle)[]): HTMLElement {
    const group = document.createElement('div');
    group.className = 'da-btn-group';

    for (const item of buttons) {
        const el = 'element' in item ? item.element : item;
        group.appendChild(el);
    }

    return group;
}
