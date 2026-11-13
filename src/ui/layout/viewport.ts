/**
 * 动态可视视口同步与锚点相对定位基础设施 (ViewportService)。
 *
 * @remarks
 * 1. 动态视口同步：统一监听 `window.visualViewport`（含移动端软键盘弹出、工具栏伸缩、捏合缩放引发的
 *    `offsetTop/offsetLeft/width/height` 偏移）与窗口尺寸变化，向 `:root` 同步 `--da-vvw`、`--da-vvh`、
 *    `--da-vv-top`、`--da-vv-left`、`--da-vv-bottom-inset` CSS 变量，避免各浮层组件重复监听或使用滞后的 `vh`。
 * 2. 统一锚点计算：提供与 DOM 解耦的纯函数 `computeAnchoredPosition()`，在可视视口边界内完成上下自动翻转与
 *    四边夹紧，替代分散在各浮层内的 `window.innerWidth / innerHeight` 像素硬算逻辑。
 */

import type { Disposable } from '../types';

/** 移动端标准断点（与 styles/skin/responsive.css 保持一致） */
export const MOBILE_VIEWPORT_BREAKPOINT = 680;
/** 窄屏竖屏手机断点（与 styles/skin/responsive.css 保持一致） */
export const NARROW_VIEWPORT_BREAKPOINT = 520;
/** 判定软键盘开启的视口高度最小差值阈值（单位：px） */
const KEYBOARD_HEIGHT_THRESHOLD = 120;

/** 当前可视视口快照矩形及设备状态标志 */
export interface ViewportRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly bottomInset: number;
    readonly isKeyboardOpen: boolean;
    readonly isCompactMobile: boolean;
    readonly isNarrowMobile: boolean;
}

/** 锚点相对定位输入参数 */
export interface AnchorPositionOptions {
    readonly anchorRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;
    readonly floatingWidth: number;
    readonly floatingHeight: number;
    readonly preferredPlacement?: 'top' | 'bottom';
    readonly align?: 'start' | 'center' | 'end';
    readonly gap?: number;
    readonly margin?: number;
    readonly viewport?: ViewportRect;
}

/** 锚点相对定位输出结果 */
export interface AnchorPositionResult {
    readonly left: number;
    readonly top: number;
    readonly placement: 'top' | 'bottom';
    readonly maxWidth: number;
    readonly maxHeight: number;
}

export type ViewportListener = (rect: ViewportRect) => void;

/**
 * 读取当前浏览器的有效交互可视区域（优先采用 visualViewport）。
 */
export function getViewportRect(): ViewportRect {
    if (typeof window === 'undefined') {
        return {
            left: 0,
            top: 0,
            width: 1280,
            height: 800,
            bottomInset: 0,
            isKeyboardOpen: false,
            isCompactMobile: false,
            isNarrowMobile: false,
        };
    }

    const layoutW = window.innerWidth || document.documentElement?.clientWidth || 1280;
    const layoutH = window.innerHeight || document.documentElement?.clientHeight || 800;
    const vv = window.visualViewport;

    const left = vv ? vv.offsetLeft : 0;
    const top = vv ? vv.offsetTop : 0;
    const width = vv && vv.width > 0 ? vv.width : layoutW;
    const height = vv && vv.height > 0 ? vv.height : layoutH;
    const bottomInset = vv ? Math.max(0, layoutH - (vv.offsetTop + vv.height)) : 0;

    // 仅当可视高度显著收缩且处于输入焦点或移动端宽度时判定软键盘打开，避免桌面缩放误判
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const hasEditableFocus = Boolean(
        activeEl &&
            (activeEl instanceof HTMLInputElement ||
                activeEl instanceof HTMLTextAreaElement ||
                (activeEl as HTMLElement).isContentEditable)
    );
    const heightDrop = layoutH - height;
    const isKeyboardOpen = heightDrop > KEYBOARD_HEIGHT_THRESHOLD && (hasEditableFocus || width <= 768);

    return {
        left,
        top,
        width,
        height,
        bottomInset,
        isKeyboardOpen,
        isCompactMobile: width <= MOBILE_VIEWPORT_BREAKPOINT,
        isNarrowMobile: width <= NARROW_VIEWPORT_BREAKPOINT,
    };
}

/**
 * 判断当前是否处于紧凑移动端宽度（<= 680px）。
 */
export function isCompactMobileViewport(): boolean {
    return getViewportRect().isCompactMobile;
}

/**
 * 基于锚点矩形与当前可视视口计算防裁剪相对位置，支持空间不足时自动上下翻转。
 */
export function computeAnchoredPosition(options: AnchorPositionOptions): AnchorPositionResult {
    const vp = options.viewport ?? getViewportRect();
    const margin = options.margin ?? 10;
    const gap = options.gap ?? 6;
    const preferred = options.preferredPlacement ?? 'bottom';
    const align = options.align ?? 'start';

    const vpRight = vp.left + vp.width;
    const vpBottom = vp.top + vp.height;

    const spaceBelow = vpBottom - margin - (options.anchorRect.bottom + gap);
    const spaceAbove = options.anchorRect.top - gap - (vp.top + margin);

    const placement: 'top' | 'bottom' =
        preferred === 'top'
            ? spaceAbove >= options.floatingHeight || spaceAbove >= spaceBelow
                ? 'top'
                : 'bottom'
            : spaceBelow >= options.floatingHeight || spaceBelow >= spaceAbove
              ? 'bottom'
              : 'top';

    const availableHeight = Math.max(80, placement === 'bottom' ? spaceBelow : spaceAbove);
    const maxWidth = Math.max(120, vp.width - margin * 2);
    const effectiveWidth = Math.min(options.floatingWidth, maxWidth);
    const effectiveHeight = Math.min(options.floatingHeight, availableHeight);

    let idealLeft = options.anchorRect.left;
    if (align === 'end') {
        idealLeft = options.anchorRect.right - effectiveWidth;
    } else if (align === 'center') {
        idealLeft = options.anchorRect.left + (options.anchorRect.width - effectiveWidth) / 2;
    }

    const minLeft = vp.left + margin;
    const maxLeft = Math.max(minLeft, vpRight - effectiveWidth - margin);
    const left = Math.min(Math.max(minLeft, idealLeft), maxLeft);

    const idealTop =
        placement === 'bottom'
            ? options.anchorRect.bottom + gap
            : options.anchorRect.top - gap - effectiveHeight;

    const minTop = vp.top + margin;
    const maxTop = Math.max(minTop, vpBottom - effectiveHeight - margin);
    const top = Math.min(Math.max(minTop, idealTop), maxTop);

    return {
        left: Math.round(left),
        top: Math.round(top),
        placement,
        maxWidth: Math.floor(maxWidth),
        maxHeight: Math.floor(availableHeight),
    };
}

/**
 * 全局视口状态同步服务。
 */
export class ViewportService implements Disposable {
    private mounted = false;
    private rafId: number | null = null;
    private currentRect: ViewportRect = getViewportRect();
    private readonly listeners = new Set<ViewportListener>();

    private readonly scheduleSyncBound = (): void => {
        if (!this.mounted) {
            return;
        }
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            if (this.rafId !== null) {
                return;
            }
            this.rafId = window.requestAnimationFrame(() => {
                this.rafId = null;
                this.syncNow();
            });
            return;
        }
        this.syncNow();
    };

    /**
     * 挂载视口事件监听并立即同步一次 CSS 变量（幂等）。
     */
    public mount(): void {
        if (this.mounted || typeof window === 'undefined') {
            return;
        }
        this.mounted = true;

        window.addEventListener('resize', this.scheduleSyncBound, { passive: true });
        window.addEventListener('orientationchange', this.scheduleSyncBound, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this.scheduleSyncBound);
            window.visualViewport.addEventListener('scroll', this.scheduleSyncBound);
        }

        // 输入聚焦/失焦可能伴随软键盘高度判定变更，捕获阶段同步刷新一次
        if (typeof document !== 'undefined') {
            document.addEventListener('focusin', this.scheduleSyncBound, true);
            document.addEventListener('focusout', this.scheduleSyncBound, true);
        }

        this.syncNow();
    }

    /**
     * 立即读取可视视口并将 CSS 自定义属性写入文档根节点，同时通知订阅者。
     */
    public syncNow(): ViewportRect {
        const next = getViewportRect();
        this.currentRect = next;

        if (typeof document !== 'undefined' && document.documentElement) {
            const root = document.documentElement;
            root.style.setProperty('--da-vvw', `${Math.round(next.width)}px`);
            root.style.setProperty('--da-vvh', `${Math.round(next.height)}px`);
            root.style.setProperty('--da-vv-top', `${Math.round(next.top)}px`);
            root.style.setProperty('--da-vv-left', `${Math.round(next.left)}px`);
            root.style.setProperty('--da-vv-bottom-inset', `${Math.round(next.bottomInset)}px`);

            if (next.isKeyboardOpen) {
                root.setAttribute('data-da-keyboard', 'open');
            } else {
                root.removeAttribute('data-da-keyboard');
            }
        }

        for (const listener of this.listeners) {
            try {
                listener(next);
            } catch {
                // 隔离单个订阅者回调异常，保障视口广播链完整
            }
        }

        return next;
    }

    /**
     * 获取最近一次同步的可视视口快照。
     */
    public getRect(): ViewportRect {
        return this.currentRect;
    }

    /**
     * 订阅可视视口变化事件，返回注销函数。
     */
    public subscribe(listener: ViewportListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * 注销全部监听器并清理根节点运行时变量。
     */
    public dispose(): void {
        if (this.rafId !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        if (this.mounted && typeof window !== 'undefined') {
            window.removeEventListener('resize', this.scheduleSyncBound);
            window.removeEventListener('orientationchange', this.scheduleSyncBound);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', this.scheduleSyncBound);
                window.visualViewport.removeEventListener('scroll', this.scheduleSyncBound);
            }
        }

        if (this.mounted && typeof document !== 'undefined') {
            document.removeEventListener('focusin', this.scheduleSyncBound, true);
            document.removeEventListener('focusout', this.scheduleSyncBound, true);
        }

        if (typeof document !== 'undefined' && document.documentElement) {
            const root = document.documentElement;
            root.style.removeProperty('--da-vvw');
            root.style.removeProperty('--da-vvh');
            root.style.removeProperty('--da-vv-top');
            root.style.removeProperty('--da-vv-left');
            root.style.removeProperty('--da-vv-bottom-inset');
            root.removeAttribute('data-da-keyboard');
        }

        this.mounted = false;
        this.listeners.clear();
    }
}

export const viewportService = new ViewportService();
