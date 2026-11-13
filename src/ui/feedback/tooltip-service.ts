/**
 * 全局视口感知浮动提示气泡服务 (TooltipService)。
 *
 * @remarks
 * 以 document.body 为挂载点（position: fixed）渲染 [data-tooltip] 释义气泡，
 * 避免被卡片或滚动容器的 overflow: hidden 裁剪，并在上下、左右边缘不足时自动翻转与限位。
 * 同时兼容桌面端鼠标悬停、键盘聚焦以及移动端触控点击切换与点选外部关闭。
 */

import type { Disposable } from '../types';
import { computeAnchoredPosition, getViewportRect, viewportService } from '../layout/viewport';

type TooltipTriggerMode = 'hover' | 'focus' | 'pinned';

const VIEWPORT_MARGIN = 10;
const TRIGGER_GAP = 8;
const SYNTHETIC_MOUSE_GUARD_MS = 500;

export class TooltipService implements Disposable {
    private mounted = false;
    private bubbleEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private activeAnchor: HTMLElement | null = null;
    private activeMode: TooltipTriggerMode | null = null;
    private lastTouchTime = 0;
    private unbindViewport: (() => void) | null = null;

    private readonly onTouchStartBound = (): void => {
        this.lastTouchTime = Date.now();
    };

    private readonly onMouseOverBound = (e: MouseEvent): void => {
        if (Date.now() - this.lastTouchTime < SYNTHETIC_MOUSE_GUARD_MS) {
            return;
        }
        const anchor = this.findAnchor(e.target);
        if (!anchor) {
            return;
        }
        // 已通过点击固定的气泡，在鼠标移入同一触发器时不降级状态
        if (this.activeAnchor === anchor && this.activeMode === 'pinned') {
            return;
        }
        this.showForAnchor(anchor, 'hover');
    };

    private readonly onMouseOutBound = (e: MouseEvent): void => {
        if (!this.activeAnchor || this.activeMode !== 'hover') {
            return;
        }
        const anchor = this.findAnchor(e.target);
        if (!anchor || anchor !== this.activeAnchor) {
            return;
        }
        const related = e.relatedTarget as Node | null;
        if (related && anchor.contains(related)) {
            return;
        }
        this.hide();
    };

    private readonly onFocusInBound = (e: FocusEvent): void => {
        const anchor = this.findAnchor(e.target);
        if (!anchor) {
            return;
        }
        if (this.activeAnchor === anchor && this.activeMode === 'pinned') {
            return;
        }
        this.showForAnchor(anchor, 'focus');
    };

    private readonly onFocusOutBound = (e: FocusEvent): void => {
        if (!this.activeAnchor || this.activeMode !== 'focus') {
            return;
        }
        const anchor = this.findAnchor(e.target);
        if (!anchor || anchor !== this.activeAnchor) {
            return;
        }
        const related = e.relatedTarget as Node | null;
        if (related && anchor.contains(related)) {
            return;
        }
        this.hide();
    };

    private readonly onClickBound = (e: MouseEvent): void => {
        const target = e.target as Node | null;
        if (this.bubbleEl && target && this.bubbleEl.contains(target)) {
            return;
        }

        const anchor = this.findAnchor(e.target);
        if (anchor) {
            e.preventDefault();
            e.stopPropagation();
            if (this.activeAnchor === anchor && this.activeMode === 'pinned') {
                this.hide();
            } else {
                this.showForAnchor(anchor, 'pinned');
            }
            return;
        }

        if (this.activeAnchor) {
            this.hide();
        }
    };

    private readonly onKeyDownBound = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && this.activeAnchor) {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
            return;
        }

        if (e.key === 'Enter' || e.key === ' ') {
            const anchor = this.findAnchor(e.target);
            if (anchor) {
                e.preventDefault();
                e.stopPropagation();
                if (this.activeAnchor === anchor && this.activeMode === 'pinned') {
                    this.hide();
                } else {
                    this.showForAnchor(anchor, 'pinned');
                }
            }
        }
    };

    private readonly onViewportChangeBound = (): void => {
        if (!this.activeAnchor) {
            return;
        }
        if (!this.activeAnchor.isConnected) {
            this.hide();
            return;
        }
        this.reposition();
    };

    /**
     * 挂载全局事件委托监听（幂等）。
     */
    public mount(): void {
        if (this.mounted || typeof document === 'undefined') {
            return;
        }
        this.mounted = true;

        document.addEventListener('touchstart', this.onTouchStartBound, { passive: true, capture: true });
        document.addEventListener('mouseover', this.onMouseOverBound, true);
        document.addEventListener('mouseout', this.onMouseOutBound, true);
        document.addEventListener('focusin', this.onFocusInBound, true);
        document.addEventListener('focusout', this.onFocusOutBound, true);
        document.addEventListener('click', this.onClickBound, true);
        document.addEventListener('keydown', this.onKeyDownBound, true);
        window.addEventListener('scroll', this.onViewportChangeBound, { capture: true, passive: true });
        this.unbindViewport = viewportService.subscribe(this.onViewportChangeBound);
    }

    /**
     * 展示指定触发元素的提示气泡。
     */
    public showForAnchor(anchor: HTMLElement, mode: TooltipTriggerMode = 'pinned'): void {
        if (typeof document === 'undefined' || !document.body) {
            return;
        }
        const text = anchor.getAttribute('data-tooltip')?.trim();
        if (!text) {
            this.hide();
            return;
        }

        this.ensureBubbleDOM();
        if (!this.bubbleEl || !this.bodyEl) {
            return;
        }

        if (this.activeAnchor && this.activeAnchor !== anchor) {
            this.activeAnchor.classList.remove('is-tooltip-open');
        }

        this.activeAnchor = anchor;
        this.activeMode = mode;
        this.activeAnchor.classList.add('is-tooltip-open');
        this.bodyEl.textContent = text;

        if (!this.bubbleEl.isConnected) {
            document.body.appendChild(this.bubbleEl);
        }
        this.bubbleEl.style.display = 'block';
        this.reposition();
    }

    /**
     * 重新计算当前提示气泡相对于锚点与动态可视视口的相对坐标。
     */
    public reposition(): void {
        if (!this.bubbleEl || !this.activeAnchor || typeof window === 'undefined') {
            return;
        }

        const anchorRect = this.activeAnchor.getBoundingClientRect();
        if (anchorRect.width === 0 && anchorRect.height === 0) {
            this.hide();
            return;
        }

        const vp = getViewportRect();

        // 先隐藏视觉呈现以测量自然宽高，避免测量期间闪烁
        this.bubbleEl.style.visibility = 'hidden';
        this.bubbleEl.style.left = '0px';
        this.bubbleEl.style.top = '0px';
        this.bubbleEl.classList.remove('da-help-bubble--top', 'da-help-bubble--centered-mobile');

        const isNarrow = vp.isNarrowMobile;
        this.bubbleEl.classList.toggle('da-help-bubble--centered-mobile', isNarrow);

        const bubbleRect = this.bubbleEl.getBoundingClientRect();
        const bubbleWidth = bubbleRect.width || 260;
        const bubbleHeight = bubbleRect.height || 64;

        const pos = computeAnchoredPosition({
            anchorRect,
            floatingWidth: bubbleWidth,
            floatingHeight: bubbleHeight,
            preferredPlacement: 'bottom',
            align: 'start',
            gap: TRIGGER_GAP,
            margin: VIEWPORT_MARGIN,
            viewport: vp,
        });

        // 窄屏竖屏下横向按视口居中展示，避免靠边问号触发器挤压气泡阅读宽度
        const finalLeft = isNarrow
            ? Math.round(vp.left + Math.max(VIEWPORT_MARGIN, (vp.width - Math.min(bubbleWidth, pos.maxWidth)) / 2))
            : pos.left;

        this.bubbleEl.classList.toggle('da-help-bubble--top', pos.placement === 'top');
        this.bubbleEl.style.left = `${finalLeft}px`;
        this.bubbleEl.style.top = `${pos.top}px`;
        this.bubbleEl.style.maxWidth = `${pos.maxWidth}px`;
        this.bubbleEl.style.maxHeight = `${Math.min(340, pos.maxHeight)}px`;
        this.bubbleEl.style.visibility = 'visible';
    }

    /**
     * 隐藏当前展示的提示气泡。
     */
    public hide(): void {
        if (this.activeAnchor) {
            this.activeAnchor.classList.remove('is-tooltip-open');
            this.activeAnchor = null;
        }
        this.activeMode = null;
        if (this.bubbleEl) {
            this.bubbleEl.style.display = 'none';
            this.bubbleEl.style.visibility = 'hidden';
        }
    }

    /**
     * 获取当前是否正在展示提示气泡。
     */
    public isOpen(): boolean {
        return Boolean(this.activeAnchor && this.bubbleEl && this.bubbleEl.style.display !== 'none');
    }

    /**
     * 获取底层气泡元素（用于诊断或单元测试）。
     */
    public getBubbleElement(): HTMLElement | null {
        return this.bubbleEl;
    }

    /**
     * 卸载全局监听与气泡 DOM 节点。
     */
    public dispose(): void {
        this.hide();
        if (this.mounted && typeof document !== 'undefined') {
            document.removeEventListener('touchstart', this.onTouchStartBound, true);
            document.removeEventListener('mouseover', this.onMouseOverBound, true);
            document.removeEventListener('mouseout', this.onMouseOutBound, true);
            document.removeEventListener('focusin', this.onFocusInBound, true);
            document.removeEventListener('focusout', this.onFocusOutBound, true);
            document.removeEventListener('click', this.onClickBound, true);
            document.removeEventListener('keydown', this.onKeyDownBound, true);
        }
        if (this.mounted && typeof window !== 'undefined') {
            window.removeEventListener('scroll', this.onViewportChangeBound, true);
        }
        if (this.unbindViewport) {
            this.unbindViewport();
            this.unbindViewport = null;
        }
        this.mounted = false;

        if (this.bubbleEl) {
            this.bubbleEl.remove();
            this.bubbleEl = null;
        }
        this.bodyEl = null;
    }

    private findAnchor(target: EventTarget | null): HTMLElement | null {
        if (!target || typeof (target as HTMLElement).closest !== 'function') {
            return null;
        }
        const el = (target as HTMLElement).closest<HTMLElement>('[data-tooltip]');
        if (!el || !el.getAttribute('data-tooltip')?.trim()) {
            return null;
        }
        return el;
    }

    private ensureBubbleDOM(): void {
        if (this.bubbleEl && this.bodyEl) {
            return;
        }
        const bubble = document.createElement('div');
        bubble.className = 'st-da-root da-help-bubble da-tooltip-bubble';
        bubble.setAttribute('role', 'tooltip');
        bubble.style.display = 'none';

        const body = document.createElement('div');
        body.className = 'da-help-bubble-body';
        bubble.appendChild(body);

        this.bubbleEl = bubble;
        this.bodyEl = body;
    }
}

export const tooltipService = new TooltipService();
