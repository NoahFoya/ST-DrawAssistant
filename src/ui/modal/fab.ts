/**
 * ST-DrawAssistant 常驻悬浮操作球 (Floating Action Button)。
 *
 * @remarks
 * 封装屏幕边缘常驻的圆形操作入口，支持拖拽定位、未读计数徽标
 * 与唤起主设置弹窗。
 */

import type { FabComponent } from './types';

export interface FabOptions {
    /** 点击触发回调 */
    onClick?: () => void;
    /** 初始是否可见 (默认 true) */
    visible?: boolean;
    /** 初始角标计数 (默认 0) */
    badgeCount?: number;
}

export class FloatingActionButton implements FabComponent {
    public readonly element: HTMLDivElement;
    private readonly badgeElement: HTMLSpanElement;
    private pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
    private pointerUpHandler: ((e: PointerEvent) => void) | null = null;

    private isDragging = false;
    private startX = 0;
    private startY = 0;
    private originLeft = 0;
    private originTop = 0;
    private hasMoved = false;

    constructor(private readonly options: FabOptions = {}) {
        this.element = document.createElement('div');
        this.element.classList.add('da-fab-btn');
        this.element.id = 'da-fab-button';
        this.element.title = 'ST-DrawAssistant 绘画助手设置';

        // 默认定位在右下角
        this.element.style.right = '24px';
        this.element.style.bottom = '80px';

        // 1. 悬浮球画笔图标
        const iconSpan = document.createElement('span');
        iconSpan.classList.add('da-fab-icon');
        iconSpan.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                <path d="M2 2l7.586 7.586"></path>
                <circle cx="11" cy="11" r="2"></circle>
            </svg>
        `;
        this.element.appendChild(iconSpan);

        // 2. 右上角徽标
        this.badgeElement = document.createElement('span');
        this.badgeElement.classList.add('da-fab-badge');
        this.badgeElement.hidden = true;
        this.element.appendChild(this.badgeElement);

        if (options.badgeCount && options.badgeCount > 0) {
            this.setBadge(options.badgeCount);
        }

        if (options.visible === false) {
            this.element.hidden = true;
        }

        this.bindEvents();
    }

    private bindEvents(): void {
        this.pointerDownHandler = (e: PointerEvent) => {
            if (e.button !== 0) return;
            this.isDragging = true;
            this.hasMoved = false;
            this.startX = e.clientX;
            this.startY = e.clientY;

            const rect = this.element.getBoundingClientRect();
            this.originLeft = rect.left;
            this.originTop = rect.top;

            // 清除原有定位属性，切换为显式像素坐标
            this.element.style.right = 'auto';
            this.element.style.bottom = 'auto';
            this.element.style.left = `${this.originLeft}px`;
            this.element.style.top = `${this.originTop}px`;

            this.element.classList.add('is-dragging');
            this.element.setPointerCapture(e.pointerId);
        };

        this.pointerMoveHandler = (e: PointerEvent) => {
            if (!this.isDragging) return;
            const deltaX = e.clientX - this.startX;
            const deltaY = e.clientY - this.startY;

            if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
                this.hasMoved = true;
            }

            const newLeft = Math.max(10, Math.min(window.innerWidth - 58, this.originLeft + deltaX));
            const newTop = Math.max(10, Math.min(window.innerHeight - 58, this.originTop + deltaY));

            this.element.style.left = `${newLeft}px`;
            this.element.style.top = `${newTop}px`;
        };

        this.pointerUpHandler = (e: PointerEvent) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.element.classList.remove('is-dragging');

            try {
                this.element.releasePointerCapture(e.pointerId);
            } catch {
                // 忽略释放捕获异常
            }

            // 若非拖拽移动，则判定为有效点击触发
            if (!this.hasMoved) {
                this.options.onClick?.();
            }
        };

        this.element.addEventListener('pointerdown', this.pointerDownHandler);
        this.element.addEventListener('pointermove', this.pointerMoveHandler);
        this.element.addEventListener('pointerup', this.pointerUpHandler);
        this.element.addEventListener('pointercancel', this.pointerUpHandler);
    }

    public setBadge(count: number): void {
        if (count > 0) {
            this.badgeElement.textContent = count > 99 ? '99+' : String(count);
            this.badgeElement.hidden = false;
        } else {
            this.badgeElement.hidden = true;
        }
    }

    public setVisible(visible: boolean): void {
        this.element.hidden = !visible;
    }

    public getValue(): void {
        // FAB 无取值
    }

    public setValue(): void {
        // FAB 无设值
    }

    public setDisabled(disabled: boolean): void {
        this.element.classList.toggle('is-disabled', disabled);
    }

    public dispose(): void {
        if (this.pointerDownHandler) {
            this.element.removeEventListener('pointerdown', this.pointerDownHandler);
            this.element.removeEventListener('pointermove', this.pointerMoveHandler!);
            this.element.removeEventListener('pointerup', this.pointerUpHandler!);
            this.element.removeEventListener('pointercancel', this.pointerUpHandler!);
            this.pointerDownHandler = null;
            this.pointerMoveHandler = null;
            this.pointerUpHandler = null;
        }

        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }
}
