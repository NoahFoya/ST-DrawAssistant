/**
 * ST-DrawAssistant 按钮原子控件。
 *
 * @remarks
 * 基于原生 HTMLButtonElement 实现，遵循 .da-btn 样式体系。
 * 具备语义化变体、加载中状态管理与事件生命周期销毁。
 */

import type { ButtonComponent, ButtonOptions } from './types';

export function createButton(options: ButtonOptions = {}): ButtonComponent {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('da-btn');

    // 1. 应用语义化变体与尺寸修饰
    if (options.variant && options.variant !== 'default') {
        button.classList.add(`da-btn--${options.variant}`);
    }
    if (options.size === 'sm') {
        button.classList.add('da-btn--sm');
    }
    if (options.className) {
        button.classList.add(...options.className.split(' ').filter(Boolean));
    }
    if (options.title) {
        button.title = options.title;
    }
    if (options.disabled) {
        button.disabled = true;
    }

    // 2. 渲染图标与文本
    const renderContent = (text?: string, iconSvg?: string) => {
        button.innerHTML = '';
        if (iconSvg) {
            const iconSpan = document.createElement('span');
            iconSpan.classList.add('da-btn__icon');
            iconSpan.innerHTML = iconSvg;
            button.appendChild(iconSpan);
        }
        if (text) {
            const textSpan = document.createElement('span');
            textSpan.classList.add('da-btn__text');
            textSpan.textContent = text;
            button.appendChild(textSpan);
        }
    };

    renderContent(options.text, options.iconSvg);

    // 3. 绑定点击事件监听
    let clickHandler: ((e: MouseEvent) => void) | null = null;
    if (options.onClick) {
        clickHandler = (e: MouseEvent) => {
            if (button.disabled || button.classList.contains('is-loading')) return;
            options.onClick!(e);
        };
        button.addEventListener('click', clickHandler);
    }

    return {
        get element() {
            return button;
        },
        getValue(): void {
            // 按钮无取值
        },
        setValue(): void {
            // 按钮无设值
        },
        setDisabled(disabled: boolean): void {
            button.disabled = disabled;
        },
        setText(text: string): void {
            renderContent(text, options.iconSvg);
        },
        setLoading(loading: boolean): void {
            button.classList.toggle('is-loading', loading);
            button.disabled = loading;
        },
        dispose(): void {
            if (clickHandler) {
                button.removeEventListener('click', clickHandler);
                clickHandler = null;
            }
        },
    };
}
