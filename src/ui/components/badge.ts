/**
 * 状态与分类徽标组件 (Badge)。
 *
 * @remarks
 * 提供轻量状态指示、分类标签与圆点徽标：
 * 1. 支持 primary / success / warning / danger / info / neutral 等语义变体；
 * 2. 支持状态圆点修饰；
 * 3. 动态受控更新文本与色彩。
 */

import type { UIComponent } from '../types';

export type BadgeVariant = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeOptions {
    /** 徽标文字内容 */
    text: string;
    /** 语义色彩变体，默认 'neutral' */
    variant?: BadgeVariant;
    /** 是否包含前置状态圆点，默认 false */
    dot?: boolean;
    /** 附加类名 */
    className?: string;
}

export class Badge implements UIComponent {
    public readonly element: HTMLElement;
    private readonly textElement: HTMLSpanElement;
    private readonly dotElement?: HTMLSpanElement;
    private currentVariant: BadgeVariant;

    constructor(options: BadgeOptions) {
        this.currentVariant = options.variant ?? 'neutral';

        // 1. 创建徽标外层
        this.element = document.createElement('span');
        this.element.classList.add('da-badge', `da-badge--${this.currentVariant}`);
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 状态圆点
        if (options.dot) {
            this.dotElement = document.createElement('span');
            this.dotElement.classList.add('da-badge__dot');
            this.element.appendChild(this.dotElement);
        }

        // 3. 文本容器
        this.textElement = document.createElement('span');
        this.textElement.classList.add('da-badge__text');
        this.textElement.textContent = options.text;
        this.element.appendChild(this.textElement);
    }

    public setText(text: string): void {
        this.textElement.textContent = text;
    }

    public setVariant(variant: BadgeVariant): void {
        this.element.classList.remove(`da-badge--${this.currentVariant}`);
        this.currentVariant = variant;
        this.element.classList.add(`da-badge--${this.currentVariant}`);
    }

    public setVisible(visible: boolean): void {
        this.element.style.display = visible ? '' : 'none';
    }

    public dispose(): void {
        this.element.parentElement?.removeChild(this.element);
    }
}
