/**
 * ST-DrawAssistant 通用折叠卡片基类。
 *
 * @remarks
 * 封装 .da-card 结构规范，提供可折叠头部交互、子控件收集
 * 与级联销毁生命周期支持。
 */

import type { BaseComponent } from '../components/types';
import type { CardComponent, CardOptions } from './types';

export class CardBase implements CardComponent {
    public readonly element: HTMLDivElement;
    public readonly bodyElement: HTMLDivElement;

    private readonly children: BaseComponent[] = [];
    private headerClickHandler: (() => void) | null = null;
    private _collapsed = false;

    constructor(private readonly options: CardOptions) {
        // 1. 根卡片容器
        this.element = document.createElement('div');
        this.element.classList.add('da-card');
        if (options.className) {
            this.element.classList.add(...options.className.split(' ').filter(Boolean));
        }

        // 2. 卡片头部
        const header = document.createElement('div');
        header.classList.add('da-card__header');

        const titleBox = document.createElement('div');
        titleBox.classList.add('da-label-box');

        if (options.iconSvg) {
            const iconSpan = document.createElement('span');
            iconSpan.classList.add('da-card__icon');
            iconSpan.innerHTML = options.iconSvg;
            titleBox.appendChild(iconSpan);
        }

        const titleSpan = document.createElement('span');
        titleSpan.classList.add('da-card__title');
        titleSpan.textContent = options.title;
        titleBox.appendChild(titleSpan);

        if (options.badge) {
            const badgeSpan = document.createElement('span');
            badgeSpan.classList.add('da-section-group__badge');
            badgeSpan.textContent = options.badge;
            titleBox.appendChild(badgeSpan);
        }

        header.appendChild(titleBox);

        // 3. 卡片主体
        this.bodyElement = document.createElement('div');
        this.bodyElement.classList.add('da-card__body');

        // 4. 折叠交互绑定
        const isCollapsible = options.collapsible !== false;
        if (isCollapsible) {
            header.classList.add('da-card__header--collapsible');
            this.headerClickHandler = () => {
                this.setCollapsed(!this._collapsed);
            };
            header.addEventListener('click', this.headerClickHandler);
        }

        this.element.appendChild(header);
        this.element.appendChild(this.bodyElement);

        if (options.collapsed) {
            this.setCollapsed(true);
        }
    }

    /** 注册需要随卡片一同销毁的子控件 */
    protected registerChild<T extends BaseComponent>(child: T): T {
        this.children.push(child);
        return child;
    }

    public getValue(): void {
        // 卡片容器无取值
    }

    public setValue(): void {
        // 卡片容器无设值
    }

    public setDisabled(disabled: boolean): void {
        this.element.classList.toggle('is-disabled', disabled);
        for (const child of this.children) {
            child.setDisabled(disabled);
        }
    }

    public setCollapsed(collapsed: boolean): void {
        this._collapsed = collapsed;
        this.element.classList.toggle('da-card--collapsed', collapsed);
        this.bodyElement.hidden = collapsed;
        this.options.onFoldToggle?.(collapsed);
    }

    public isCollapsed(): boolean {
        return this._collapsed;
    }

    public dispose(): void {
        if (this.headerClickHandler) {
            const header = this.element.querySelector('.da-card__header');
            if (header) {
                header.removeEventListener('click', this.headerClickHandler);
            }
            this.headerClickHandler = null;
        }

        for (const child of this.children) {
            child.dispose();
        }
        this.children.length = 0;
    }
}
