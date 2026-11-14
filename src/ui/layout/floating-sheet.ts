/**
 * 响应式浮动菜单与移动端底部抽屉门户容器 (FloatingSurface / ActionSheet)。
 *
 * @remarks
 * 1. 脱离父级包含块限制：所有上下文菜单与变量选择列表统一挂载至 `document.body`，避免受设置弹窗内的
 *    `backdrop-filter`、`overflow: hidden` 或局部滚动容器影响导致 `position: fixed` 坐标漂移与裁剪。
 * 2. 双形态自适应：
 *    - 桌面端（`> 640px`）：基于 `ViewportService.computeAnchoredPosition()` 相对触发锚点展开，自动翻转与夹紧；
 *    - 移动端（`<= 640px`）：自动切换为底部 Action Sheet（带半透遮罩、标题栏、大触控行及底边安全区）。
 * 3. 层叠栈联动：接入 `overlayStack` 管理 `Escape` 关闭优先级，防止误关底层主弹窗。
 */

import type { Disposable } from '../types';
import { overlayStack } from '../framework/overlay-stack';
import { computeAnchoredPosition, getViewportRect, viewportService } from './viewport';

export interface FloatingMenuItemOption {
    readonly type?: 'item';
    readonly id?: string;
    readonly label: string;
    readonly icon?: string;
    readonly badgeText?: string;
    readonly description?: string;
    readonly danger?: boolean;
    readonly highlighted?: boolean;
    readonly onSelect: () => void;
}

export interface FloatingMenuDividerOption {
    readonly type: 'divider';
}

export interface FloatingMenuHeaderOption {
    readonly type: 'header';
    readonly label: string;
    readonly highlighted?: boolean;
}

export type FloatingMenuEntry =
    | FloatingMenuItemOption
    | FloatingMenuDividerOption
    | FloatingMenuHeaderOption;

export interface OpenFloatingSurfaceOptions {
    /** 浮层堆栈标识，同一标识再次打开时自动替换旧实例 */
    readonly stackId: string;
    /** 移动端 Action Sheet 顶部提示标题 */
    readonly title: string;
    /** 桌面端锚点矩形（或由点击坐标构造的 1×1 零面积矩形） */
    readonly anchorRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;
    /** 列表内容声明 */
    readonly entries: readonly FloatingMenuEntry[];
    /** 桌面端首选展开方向 */
    readonly preferredPlacement?: 'top' | 'bottom';
    /** 桌面端水平对齐方式 */
    readonly align?: 'start' | 'center' | 'end';
    /** 桌面端参考宽度（单位：px） */
    readonly desktopWidth?: number;
    /** 桌面端参考估算高度（单位：px，用于初始上下空间判定） */
    readonly estimatedHeight?: number;
    /** 附加面板类名，用于细化菜单列表细节 */
    readonly panelClassName?: string;
    /** 关闭后回调 */
    readonly onClose?: () => void;
}

/**
 * 依据指针点击坐标构建无宽高点矩形，供右键菜单作为桌面端相对锚点使用。
 */
export function createPointAnchorRect(clientX: number, clientY: number): DOMRect {
    return {
        x: clientX,
        y: clientY,
        left: clientX,
        right: clientX,
        top: clientY,
        bottom: clientY,
        width: 0,
        height: 0,
        toJSON: () => ({}),
    } as DOMRect;
}

/**
 * 打开响应式浮动菜单：桌面端门户锚点弹出，移动端自动切换为底部 Action Sheet。
 */
export function openFloatingSurface(options: OpenFloatingSurfaceOptions): Disposable {
    if (typeof document === 'undefined' || !document.body) {
        return { dispose: () => undefined };
    }

    let isDisposed = false;
    const viewport = getViewportRect();
    const isMobileSheet = viewport.isCompactMobile;

    const rootContainer = document.createElement('div');
    const panel = document.createElement('div');
    panel.setAttribute('role', 'menu');
    panel.addEventListener('click', (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());

    const disposers: Array<() => void> = [];

    const close = (): void => {
        if (isDisposed) {
            return;
        }
        isDisposed = true;

        overlayStack.remove(options.stackId);

        for (const fn of disposers) {
            try {
                fn();
            } catch {
                // 忽略清理异常
            }
        }
        disposers.length = 0;

        if (rootContainer.parentNode) {
            rootContainer.parentNode.removeChild(rootContainer);
        }

        options.onClose?.();
    };

    // 1. 构建菜单条目列表
    const listEl = document.createElement('div');
    listEl.className = 'da-floating-menu-list';

    for (const entry of options.entries) {
        if (entry.type === 'divider') {
            const divider = document.createElement('div');
            divider.className = 'da-floating-menu-divider';
            listEl.appendChild(divider);
            continue;
        }

        if (entry.type === 'header') {
            const headerEl = document.createElement('div');
            headerEl.className = entry.highlighted
                ? 'da-floating-menu-group-title da-floating-menu-group-title--highlighted'
                : 'da-floating-menu-group-title';
            headerEl.textContent = entry.label;
            listEl.appendChild(headerEl);
            continue;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.className = 'da-floating-menu-item';
        if (entry.danger) {
            btn.classList.add('is-danger');
        }
        if (entry.highlighted) {
            btn.classList.add('is-highlighted');
        }

        if (entry.icon) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'da-floating-menu-item__icon';
            iconSpan.textContent = entry.icon;
            btn.appendChild(iconSpan);
        }

        const mainCol = document.createElement('span');
        mainCol.className = 'da-floating-menu-item__main';

        if (entry.badgeText) {
            const codeSpan = document.createElement('span');
            codeSpan.className = 'da-floating-menu-item__code';
            codeSpan.textContent = entry.badgeText;
            mainCol.appendChild(codeSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'da-floating-menu-item__label';
        labelSpan.textContent = entry.label;
        mainCol.appendChild(labelSpan);

        if (entry.description) {
            const descSpan = document.createElement('span');
            descSpan.className = 'da-floating-menu-item__desc';
            descSpan.textContent = entry.description;
            mainCol.appendChild(descSpan);
        }

        btn.appendChild(mainCol);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const onSelect = entry.onSelect;
            close();
            onSelect();
        });

        listEl.appendChild(btn);
    }

    // 2. 按设备视口形态组装为底部 Action Sheet 或桌面端相对锚点门户
    if (isMobileSheet) {
        rootContainer.className =
            'da-modal-backdrop da-modal-backdrop--sheet da-floating-sheet-backdrop st-da-root';
        panel.className = ['da-floating-sheet', options.panelClassName].filter(Boolean).join(' ');

        const handleBar = document.createElement('div');
        handleBar.className = 'da-floating-sheet__handle';
        panel.appendChild(handleBar);

        const headerRow = document.createElement('div');
        headerRow.className = 'da-floating-sheet__header';

        const titleEl = document.createElement('span');
        titleEl.className = 'da-floating-sheet__title';
        titleEl.textContent = options.title;
        headerRow.appendChild(titleEl);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'da-btn da-btn--ghost da-btn--sm da-floating-sheet__cancel';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => close());
        headerRow.appendChild(cancelBtn);

        panel.appendChild(headerRow);
        panel.appendChild(listEl);
        rootContainer.appendChild(panel);

        rootContainer.addEventListener('click', (e) => {
            if (e.target === rootContainer) {
                close();
            }
        });

        document.body.appendChild(rootContainer);
    } else {
        rootContainer.className = 'da-floating-popover-host st-da-root';
        panel.className = ['da-floating-popover', options.panelClassName].filter(Boolean).join(' ');
        panel.appendChild(listEl);
        rootContainer.appendChild(panel);
        document.body.appendChild(rootContainer);

        const applyDesktopPosition = (): void => {
            if (isDisposed) {
                return;
            }
            const rect = panel.getBoundingClientRect();
            const measuredW = rect.width > 0 ? rect.width : (options.desktopWidth ?? 210);
            const measuredH = rect.height > 0 ? rect.height : (options.estimatedHeight ?? 240);
            const pos = computeAnchoredPosition({
                anchorRect: options.anchorRect,
                floatingWidth: Math.max(measuredW, options.desktopWidth ?? 0),
                floatingHeight: measuredH,
                preferredPlacement: options.preferredPlacement ?? 'bottom',
                align: options.align ?? 'start',
                gap: 6,
                margin: 10,
            });
            panel.style.left = `${pos.left}px`;
            panel.style.top = `${pos.top}px`;
            panel.style.maxWidth = `${pos.maxWidth}px`;
            panel.style.maxHeight = `${pos.maxHeight}px`;
            panel.classList.toggle('da-floating-popover--above', pos.placement === 'top');
        };

        applyDesktopPosition();

        const onOutsidePointerDown = (e: PointerEvent): void => {
            const target = e.target as Node | null;
            if (target && panel.contains(target)) {
                return;
            }
            close();
        };

        // 延迟至下一次事件微任务注册全局点选关闭，避免当前触发点击立刻回关闭
        const timerId = window.setTimeout(() => {
            if (!isDisposed) {
                window.addEventListener('pointerdown', onOutsidePointerDown, true);
            }
        }, 0);

        const unsubscribeViewport = viewportService.subscribe((nextVp) => {
            if (nextVp.isCompactMobile) {
                close();
                return;
            }
            applyDesktopPosition();
        });

        disposers.push(() => {
            window.clearTimeout(timerId);
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            unsubscribeViewport();
        });
    }

    // 3. 压入全局浮层栈接管 Escape，保证关闭顺序严格 LIFO
    const removeStack = overlayStack.push(options.stackId, close);
    disposers.push(removeStack);

    return {
        dispose: close,
    };
}
