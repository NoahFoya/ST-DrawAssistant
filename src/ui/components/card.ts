/**
 * 通用卡片容器组件 (Card)。
 *
 * @remarks
 * 为所有业务卡片提供统一的视觉与布局外壳：
 * 1. 头部标题区：主标题与副标题辅助说明；
 * 2. 头部右上角操作区与状态徽标区；
 * 3. 折叠/展开过渡动画与收起态隐藏；
 * 4. 主体内容容器。
 */

import type { UIComponent } from '../types';

export interface CardOptions {
    /** 卡片主标题 */
    title: string;
    /** 卡片副标题辅助说明 */
    subtitle?: string;
}

export class Card implements UIComponent {
    public readonly element: HTMLElement;
    private readonly headerElement: HTMLElement;
    private readonly titleElement: HTMLElement;
    private readonly subtitleElement: HTMLElement;
    private readonly badgesContainer: HTMLElement;
    private readonly actionsContainer: HTMLElement;
    private readonly bodyElement: HTMLElement;

    constructor(options: CardOptions) {
        // 1. 创建根卡片 DOM
        this.element = document.createElement('div');
        this.element.classList.add('da-card');

        // 2. 组装头部
        this.headerElement = document.createElement('div');
        this.headerElement.classList.add('da-card__header');

        const headerLeft = document.createElement('div');
        headerLeft.classList.add('da-card__header-left');

        const titleGroup = document.createElement('div');
        titleGroup.classList.add('da-card__title-group');

        this.titleElement = document.createElement('h3');
        this.titleElement.classList.add('da-card__title');
        this.titleElement.textContent = options.title;
        titleGroup.appendChild(this.titleElement);

        this.subtitleElement = document.createElement('p');
        this.subtitleElement.classList.add('da-card__subtitle');
        if (options.subtitle) {
            this.subtitleElement.textContent = options.subtitle;
        } else {
            this.subtitleElement.style.display = 'none';
        }
        titleGroup.appendChild(this.subtitleElement);
        headerLeft.appendChild(titleGroup);
        this.headerElement.appendChild(headerLeft);

        // 3. 组装头部右侧（徽标与操作区）
        const headerRight = document.createElement('div');
        headerRight.classList.add('da-card__header-right');

        this.badgesContainer = document.createElement('div');
        this.badgesContainer.classList.add('da-card__badges');
        headerRight.appendChild(this.badgesContainer);

        this.actionsContainer = document.createElement('div');
        this.actionsContainer.classList.add('da-card__actions');
        headerRight.appendChild(this.actionsContainer);

        this.headerElement.appendChild(headerRight);
        this.element.appendChild(this.headerElement);

        // 4. 组装主体内容容器
        this.bodyElement = document.createElement('div');
        this.bodyElement.classList.add('da-card__body');
        this.element.appendChild(this.bodyElement);
    }

    /**
     * 设置头部右上角操作区内容。
     */
    public setHeaderActions(elements: HTMLElement[] | HTMLElement): void {
        this.actionsContainer.innerHTML = '';
        const items = Array.isArray(elements) ? elements : [elements];
        for (const item of items) {
            this.actionsContainer.appendChild(item);
        }
    }

    /**
     * 设置状态徽标区内容。
     */
    public setBadges(badges: HTMLElement[] | HTMLElement): void {
        this.badgesContainer.innerHTML = '';
        const items = Array.isArray(badges) ? badges : [badges];
        for (const badge of items) {
            this.badgesContainer.appendChild(badge);
        }
    }

    /**
     * 向主体内容容器追加子节点。
     */
    public appendContent(elements: HTMLElement[] | HTMLElement): void {
        const items = Array.isArray(elements) ? elements : [elements];
        for (const item of items) {
            this.bodyElement.appendChild(item);
        }
    }

    /**
     * 清空主体内容容器。
     */
    public clearContent(): void {
        this.bodyElement.innerHTML = '';
    }

    /**
     * 获取主体内容容器 DOM 元素。
     */
    public getBodyElement(): HTMLElement {
        return this.bodyElement;
    }


    /**
     * 动态更新主标题。
     */
    public setTitle(title: string): void {
        this.titleElement.textContent = title;
    }

    /**
     * 动态更新副标题说明。
     */
    public setSubtitle(subtitle?: string): void {
        if (subtitle) {
            this.subtitleElement.textContent = subtitle;
            this.subtitleElement.style.display = '';
        } else {
            this.subtitleElement.textContent = '';
            this.subtitleElement.style.display = 'none';
        }
    }

    /**
     * 释放事件监听与 DOM 引用。
     */
    public dispose(): void {
        this.clearContent();
        this.badgesContainer.innerHTML = '';
        this.actionsContainer.innerHTML = '';
        this.element.parentElement?.removeChild(this.element);
    }
}
