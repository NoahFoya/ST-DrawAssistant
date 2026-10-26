/**
 * 通用多变体按钮组件 (Button)。
 *
 * @remarks
 * 支持 Primary / Secondary / Danger / Ghost / Icon 等变体；
 * 内置 Loading 加载旋转动画与异步防重复点击锁定。
 */

import type { UIComponent } from '../types';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOptions {
    /** 按钮文本内容 */
    label?: string;
    /** 视觉变体风格，默认 'secondary' */
    variant?: ButtonVariant;
    /** 尺寸规格，默认 'md' */
    size?: ButtonSize;
    /** 图标 HTML 字符串（如内联 SVG） */
    icon?: string;
    /** 图标对齐方位，默认 'left' */
    iconPosition?: 'left' | 'right';
    /** 初始是否禁用，默认 false */
    disabled?: boolean;
    /** 初始是否处于加载中状态，默认 false */
    loading?: boolean;
    /** 加载中的替代提示文字 */
    loadingText?: string;
    /** 悬停提示文字 (title) */
    tooltip?: string;
    /** 附加 CSS 类名 */
    className?: string;
    /** 点击事件回调 */
    onClick?: (event: MouseEvent) => void | Promise<void>;
}

export class Button implements UIComponent {
    public readonly element: HTMLButtonElement;
    private readonly labelElement: HTMLSpanElement;
    private readonly iconElement: HTMLSpanElement;
    private readonly spinnerElement: HTMLSpanElement;

    private isLoadingState = false;
    private isDisabledState = false;
    private originalLabel = '';
    private readonly clickListener?: (event: MouseEvent) => void;

    constructor(options: ButtonOptions = {}) {
        this.element = document.createElement('button');
        this.element.type = 'button';
        this.originalLabel = options.label ?? '';

        // 1. 设置样式类
        const variant = options.variant ?? 'secondary';
        const size = options.size ?? 'md';
        this.element.classList.add('da-btn', `da-btn--${variant}`, `da-btn--${size}`);
        if (options.className) {
            this.element.classList.add(options.className);
        }
        if (options.tooltip) {
            this.element.title = options.tooltip;
        }

        // 2. 组装内联元素：Spinner、Icon、Label
        this.spinnerElement = document.createElement('span');
        this.spinnerElement.classList.add('da-btn__spinner');
        this.spinnerElement.style.display = 'none';
        this.element.appendChild(this.spinnerElement);

        this.iconElement = document.createElement('span');
        this.iconElement.classList.add('da-btn__icon');
        if (options.icon) {
            this.iconElement.innerHTML = options.icon;
        } else {
            this.iconElement.style.display = 'none';
        }

        this.labelElement = document.createElement('span');
        this.labelElement.classList.add('da-btn__label');
        this.labelElement.textContent = this.originalLabel;
        if (!this.originalLabel) {
            this.labelElement.style.display = 'none';
        }

        if (options.iconPosition === 'right') {
            this.element.appendChild(this.labelElement);
            this.element.appendChild(this.iconElement);
        } else {
            this.element.appendChild(this.iconElement);
            this.element.appendChild(this.labelElement);
        }

        // 3. 初始状态
        if (options.disabled) {
            this.setDisabled(true);
        }
        if (options.loading) {
            this.setLoading(true, options.loadingText);
        }

        // 4. 事件监听与异步锁定防护
        if (options.onClick) {
            const userHandler = options.onClick;
            this.clickListener = async (event: MouseEvent) => {
                if (this.isDisabledState || this.isLoadingState) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                const result = userHandler(event);
                if (result instanceof Promise) {
                    this.setLoading(true);
                    try {
                        await result;
                    } finally {
                        this.setLoading(false);
                    }
                }
            };
            this.element.addEventListener('click', this.clickListener);
        }
    }

    /**
     * 设置按钮加载中旋转状态。
     */
    public setLoading(loading: boolean, loadingText?: string): void {
        this.isLoadingState = loading;
        if (loading) {
            this.element.classList.add('da-btn--loading');
            this.spinnerElement.style.display = '';
            this.iconElement.style.display = 'none';
            if (loadingText) {
                this.labelElement.textContent = loadingText;
                this.labelElement.style.display = '';
            }
        } else {
            this.element.classList.remove('da-btn--loading');
            this.spinnerElement.style.display = 'none';
            if (this.iconElement.innerHTML) {
                this.iconElement.style.display = '';
            }
            this.labelElement.textContent = this.originalLabel;
            if (!this.originalLabel) {
                this.labelElement.style.display = 'none';
            }
        }
        this.element.disabled = this.isDisabledState || this.isLoadingState;
    }

    /**
     * 设置按钮禁用状态。
     */
    public setDisabled(disabled: boolean): void {
        this.isDisabledState = disabled;
        this.element.disabled = disabled || this.isLoadingState;
        if (disabled) {
            this.element.classList.add('da-btn--disabled');
        } else {
            this.element.classList.remove('da-btn--disabled');
        }
    }

    /**
     * 设置按钮显示文本。
     */
    public setLabel(label: string): void {
        this.originalLabel = label;
        if (!this.isLoadingState) {
            this.labelElement.textContent = label;
            this.labelElement.style.display = label ? '' : 'none';
        }
    }

    /**
     * 设置按钮图标。
     */
    public setIcon(iconHtml?: string): void {
        if (iconHtml) {
            this.iconElement.innerHTML = iconHtml;
            if (!this.isLoadingState) {
                this.iconElement.style.display = '';
            }
        } else {
            this.iconElement.innerHTML = '';
            this.iconElement.style.display = 'none';
        }
    }

    /**
     * 动态更新按钮视觉变体。
     */
    public setVariant(variant: ButtonVariant): void {
        this.element.classList.remove(
            'da-btn--primary',
            'da-btn--secondary',
            'da-btn--danger',
            'da-btn--ghost',
            'da-btn--icon'
        );
        this.element.classList.add(`da-btn--${variant}`);
    }

    /**
     * 控制按钮显示/隐藏。
     */
    public setVisible(visible: boolean): void {
        this.element.style.display = visible ? '' : 'none';
    }

    /**
     * 释放事件监听与 DOM 引用。
     */
    public dispose(): void {
        if (this.clickListener) {
            this.element.removeEventListener('click', this.clickListener);
        }
        this.element.parentElement?.removeChild(this.element);
    }
}
