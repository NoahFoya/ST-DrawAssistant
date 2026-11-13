/**
 * 悬浮操作球组件 (FloatingActionButton)。
 *
 * @remarks
 * 提供快捷打开设置面板的常驻入口：
 * 1. 相对比例定位：废弃固定像素 `left/top/right/bottom` 赋值，统一通过 CSS 自定义属性
 *    `--da-fab-rx / --da-fab-ry`（归一化区间 0~1）结合 `ViewportService` 实时动态视口及安全区实现跨端自适应停靠；
 * 2. 拖拽与越界隔离：支持鼠标与触控拖拽，在有效安全活动区间内同步映射比例，避开移动端宿主顶栏与底栏；
 * 3. 外观样式与徽标：支持透明度、预设图标、自定义图片与完成/未读计数角标。
 */

import type { UIComponent, Disposable } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { FAB_BUILTIN_ICONS } from '../views/fab-tab';
import { getViewportRect } from '../layout/viewport';

export { FAB_BUILTIN_ICONS };

export interface FloatingActionButtonOptions {
    onClick?: () => void;
}

/** 悬浮球相对视口归一化位置模型 (0.0 ~ 1.0) */
export interface FabPositionState {
    readonly ratioX: number;
    readonly ratioY: number;
}

const STORAGE_KEY_POSITION = 'st_draw_assistant_fab_position';
const DEFAULT_FAB_RATIO: FabPositionState = { ratioX: 0.96, ratioY: 0.86 };

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(0, value), 1);
}

export class FloatingActionButton implements UIComponent, Disposable {
    public readonly element: HTMLElement;
    private readonly iconContainer: HTMLElement;
    private readonly badgeElement: HTMLElement;
    private readonly clickHandler?: () => void;

    private isDragging = false;
    private hasMoved = false;
    private startPointerX = 0;
    private startPointerY = 0;
    private startElemX = 0;
    private startElemY = 0;
    private cachedElemWidth = 48;
    private cachedElemHeight = 48;
    private clickSuppressionTimer: ReturnType<typeof setTimeout> | null = null;

    private currentRatioX: number = DEFAULT_FAB_RATIO.ratioX;
    private currentRatioY: number = DEFAULT_FAB_RATIO.ratioY;

    private readonly onPointerDownBound: (e: PointerEvent) => void;
    private readonly onClickBound: (e: MouseEvent) => void;
    private readonly onPointerMoveBound: (e: PointerEvent) => void;
    private readonly onPointerUpBound: (e: PointerEvent) => void;
    private readonly onResetPositionBound: () => void;
    private readonly onSettingsUpdatedBound: () => void;

    public constructor(options: FloatingActionButtonOptions = {}) {
        this.element = typeof document !== 'undefined'
            ? document.createElement('div')
            : ({} as HTMLElement);

        this.element.id = 'da-fab-button';
        if (this.element.classList) {
            this.element.classList.add('da-fab-btn', 'da-fab-entry');
        }

        // 1. 内部图标容器与未读徽标
        this.iconContainer = document.createElement('div');
        this.iconContainer.className = 'da-fab-icon';

        this.badgeElement = document.createElement('span');
        this.badgeElement.className = 'da-fab-badge';
        this.badgeElement.style.display = 'none';

        this.element.appendChild(this.iconContainer);
        this.element.appendChild(this.badgeElement);

        this.clickHandler = options.onClick;

        // 2. 绑定事件处理器引用
        this.onPointerDownBound = this.onPointerDown.bind(this);
        this.onClickBound = this.onClick.bind(this);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerUpBound = this.onPointerUp.bind(this);
        this.onResetPositionBound = this.resetPosition.bind(this);
        this.onSettingsUpdatedBound = this.syncFromSettings.bind(this);

        this.bindEvents();
        this.restoreSavedPosition();
        this.syncFromSettings();
    }

    private bindEvents(): void {
        this.element.addEventListener?.('pointerdown', this.onPointerDownBound);
        this.element.addEventListener?.('click', this.onClickBound);

        // 监听位置重置与配置更新事件（视口缩放由 CSS 变量 --da-fab-rx/ry 联动 --da-vvw/vvh 实时响应）
        eventBus.on('ui:reset-fab-position', this.onResetPositionBound);
        eventBus.on('settings:updated', this.onSettingsUpdatedBound);
    }

    /**
     * 计算当前视口下悬浮球的可拖拽相对安全活动区间（与 fab.css 安全区表达式对称）。
     */
    private getSafeTravelBounds(width: number, height: number) {
        const vp = getViewportRect();
        const safeX = vp.isCompactMobile ? 12 : 16;
        const safeTop = vp.isCompactMobile ? 52 : 16;
        const safeBottom = vp.isCompactMobile ? 76 : 20;

        const minLeft = vp.left + safeX;
        const minTop = vp.top + safeTop;
        const travelX = Math.max(0, vp.width - width - safeX * 2);
        const travelY = Math.max(0, vp.height - height - safeTop - safeBottom);

        return { minLeft, minTop, travelX, travelY };
    }

    private onPointerDown(e: PointerEvent): void {
        if (e.button !== 0) return; // 仅响应鼠标左键或触控

        this.isDragging = true;
        this.hasMoved = false;
        this.startPointerX = e.clientX;
        this.startPointerY = e.clientY;

        this.cachedElemWidth = this.element.offsetWidth || 48;
        this.cachedElemHeight = this.element.offsetHeight || 48;

        const bounds = this.getSafeTravelBounds(this.cachedElemWidth, this.cachedElemHeight);
        const rect = this.element.getBoundingClientRect?.();
        if (rect && (rect.width > 0 || rect.height > 0)) {
            this.startElemX = rect.left;
            this.startElemY = rect.top;
        } else {
            this.startElemX = bounds.minLeft + this.currentRatioX * bounds.travelX;
            this.startElemY = bounds.minTop + this.currentRatioY * bounds.travelY;
        }

        this.element.classList?.add('is-dragging');

        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', this.onPointerMoveBound);
            window.addEventListener('pointerup', this.onPointerUpBound);
            window.addEventListener('pointercancel', this.onPointerUpBound);
        }
    }

    private onPointerMove(e: PointerEvent): void {
        if (!this.isDragging) return;

        const dx = e.clientX - this.startPointerX;
        const dy = e.clientY - this.startPointerY;

        if (Math.hypot(dx, dy) > 4) {
            this.hasMoved = true;
        }

        const bounds = this.getSafeTravelBounds(this.cachedElemWidth, this.cachedElemHeight);
        const nextLeft = Math.min(Math.max(bounds.minLeft, this.startElemX + dx), bounds.minLeft + bounds.travelX);
        const nextTop = Math.min(Math.max(bounds.minTop, this.startElemY + dy), bounds.minTop + bounds.travelY);

        const nextRatioX = bounds.travelX > 0 ? clampUnit((nextLeft - bounds.minLeft) / bounds.travelX) : this.currentRatioX;
        const nextRatioY = bounds.travelY > 0 ? clampUnit((nextTop - bounds.minTop) / bounds.travelY) : this.currentRatioY;

        this.applyRatioPosition(nextRatioX, nextRatioY);
    }

    private onPointerUp(): void {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.element.classList.remove('is-dragging');

        if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', this.onPointerMoveBound);
            window.removeEventListener('pointerup', this.onPointerUpBound);
            window.removeEventListener('pointercancel', this.onPointerUpBound);
        }

        if (this.hasMoved) {
            this.clampAndSavePosition();
            // 延时重置 hasMoved 状态，避免拖拽释放紧随派发的原生 click 事件误触点击回调
            if (this.clickSuppressionTimer !== null) {
                clearTimeout(this.clickSuppressionTimer);
            }
            this.clickSuppressionTimer = setTimeout(() => {
                this.hasMoved = false;
                this.clickSuppressionTimer = null;
            }, 50);
        }
    }

    private onClick(e: MouseEvent): void {
        if (this.hasMoved) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        this.clickHandler?.();
    }

    private applyRatioPosition(ratioX: number, ratioY: number): void {
        this.currentRatioX = clampUnit(ratioX);
        this.currentRatioY = clampUnit(ratioY);

        // 仅写入相对比例 CSS 变量，清除任何遗留像素内联偏移，让样式层响应式表达式完全接管
        this.element.style?.setProperty?.('--da-fab-rx', this.currentRatioX.toFixed(4));
        this.element.style?.setProperty?.('--da-fab-ry', this.currentRatioY.toFixed(4));
        this.element.style?.removeProperty?.('left');
        this.element.style?.removeProperty?.('top');
        this.element.style?.removeProperty?.('right');
        this.element.style?.removeProperty?.('bottom');
    }

    private clampAndSavePosition(): void {
        try {
            const pos: FabPositionState = {
                ratioX: this.currentRatioX,
                ratioY: this.currentRatioY,
            };
            localStorage.setItem(STORAGE_KEY_POSITION, JSON.stringify(pos));
        } catch {
            // 忽略存储写入限制
        }
    }

    private restoreSavedPosition(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_POSITION);
            if (raw) {
                const pos = JSON.parse(raw);
                if (typeof pos.ratioX === 'number' && typeof pos.ratioY === 'number') {
                    this.applyRatioPosition(pos.ratioX, pos.ratioY);
                    return;
                }
            }
        } catch {
            // 恢复基准停靠比例
        }

        // 默认右下角安全相对比例停靠
        this.resetPosition(false);
    }

    /**
     * 重置悬浮球停靠位置至右下角默认相对比例基准。
     *
     * @param clearStorage 是否同时清除 localStorage 记录，默认为 true
     */
    public resetPosition(clearStorage = true): void {
        this.applyRatioPosition(DEFAULT_FAB_RATIO.ratioX, DEFAULT_FAB_RATIO.ratioY);

        if (clearStorage && typeof localStorage !== 'undefined') {
            try {
                localStorage.removeItem(STORAGE_KEY_POSITION);
            } catch {
                // 忽略异常
            }
        }
    }

    /**
     * 从 settingsStore 同步显隐、透明度与图标设置。
     */
    public syncFromSettings(): void {
        const fab = settingsStore.get('ui')?.fab;
        if (!fab) return;

        // 1. 显隐控制
        const isVisible = fab.visible ?? true;
        this.element.style.display = isVisible ? 'flex' : 'none';

        // 2. 透明度控制 (0.2 ~ 1.0)
        const opacity = fab.opacity ?? 0.95;
        this.element.style.opacity = String(opacity);

        // 3. 图标渲染
        const iconKey = fab.icon || 'palette';
        if (iconKey.startsWith('http://') || iconKey.startsWith('https://') || iconKey.startsWith('data:image')) {
            const img = document.createElement('img');
            img.src = iconKey;
            img.alt = 'FAB';
            this.iconContainer.replaceChildren(img);
        } else {
            const svg = FAB_BUILTIN_ICONS[iconKey] ?? FAB_BUILTIN_ICONS.palette;
            this.iconContainer.innerHTML = svg;
        }
    }

    /**
     * 设置未读状态计数徽标。
     *
     * @param count 数量；为 0 或 undefined 时隐藏
     */
    public setBadge(count?: number): void {
        if (!count || count <= 0) {
            this.badgeElement.style.display = 'none';
            this.badgeElement.textContent = '';
        } else {
            this.badgeElement.style.display = 'flex';
            this.badgeElement.textContent = count > 99 ? '99+' : String(count);
        }
    }

    /**
     * 释放悬浮球 DOM 引用与事件监听。
     */
    public dispose(): void {
        this.element.removeEventListener?.('pointerdown', this.onPointerDownBound);
        this.element.removeEventListener?.('click', this.onClickBound);

        eventBus.off('ui:reset-fab-position', this.onResetPositionBound);
        eventBus.off('settings:updated', this.onSettingsUpdatedBound);

        if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', this.onPointerMoveBound);
            window.removeEventListener('pointerup', this.onPointerUpBound);
            window.removeEventListener('pointercancel', this.onPointerUpBound);
        }

        if (this.clickSuppressionTimer !== null) {
            clearTimeout(this.clickSuppressionTimer);
            this.clickSuppressionTimer = null;
        }

        this.element.parentElement?.removeChild(this.element);
    }
}
