/**
 * 悬浮操作球组件 (FloatingActionButton)。
 *
 * @remarks
 * 提供快捷打开设置面板的常驻入口：
 * 1. 相对比例定位：统一通过 CSS 自定义属性 `--da-fab-rx / --da-fab-ry`（归一化区间 0~1）
 *    结合 `ViewportService` 实时动态视口及安全区实现跨端自适应停靠；
 * 2. 拖拽与越界隔离：支持鼠标与触控拖拽，在有效安全活动区间内同步映射比例，避开移动端宿主顶栏与底栏；
 * 3. 外观样式与绘图动效：支持透明度、预设图标、自定义图片与可配置的绘图中状态动效（星光环绕 / 流光环绕 / 呼吸脉冲 / 波纹扩散 / 禁用）。
 */

import type { UIComponent, Disposable } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { browserStorage } from '../../util/storage-port';
import { FAB_BUILTIN_ICONS } from '../views/fab-tab';
import { getViewportRect } from '../layout/viewport';
import { FabQuickPanel } from './fab-quick-panel';

export { FAB_BUILTIN_ICONS };

export type FabAnimationType = 'starlight' | 'orbit-ring' | 'aurora-pulse' | 'ripple' | 'none';

const VALID_FAB_ANIMATIONS: ReadonlySet<string> = new Set<FabAnimationType>([
    'starlight',
    'orbit-ring',
    'aurora-pulse',
    'ripple',
    'none',
]);

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
const DOUBLE_CLICK_THRESHOLD_MS = 280;

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(0, value), 1);
}

export class FloatingActionButton implements UIComponent, Disposable {
    public readonly element: HTMLElement;
    public readonly quickPanel: FabQuickPanel;
    private readonly iconContainer: HTMLElement;
    private readonly clickHandler?: () => void;

    private isDragging = false;
    private hasMoved = false;
    private suppressNextClick = false;
    private startPointerX = 0;
    private startPointerY = 0;
    private startElemX = 0;
    private startElemY = 0;
    private cachedElemWidth = 48;
    private cachedElemHeight = 48;
    private lastClickTimestamp = 0;
    private clickSuppressionTimer: ReturnType<typeof setTimeout> | null = null;
    private snapTimer: ReturnType<typeof setTimeout> | null = null;
    private pulseTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly activeTaskIds = new Set<string>();

    private currentRatioX: number = DEFAULT_FAB_RATIO.ratioX;
    private currentRatioY: number = DEFAULT_FAB_RATIO.ratioY;

    private readonly onPointerDownBound: (e: PointerEvent) => void;
    private readonly onClickBound: (e: MouseEvent) => void;
    private readonly onDblClickBound: (e: MouseEvent) => void;
    private readonly onPointerMoveBound: (e: PointerEvent) => void;
    private readonly onPointerUpBound: (e: PointerEvent) => void;
    private readonly onResetPositionBound: () => void;
    private readonly onSettingsUpdatedBound: () => void;
    private unlistenTaskStatus: (() => void) | null = null;

    public constructor(options: FloatingActionButtonOptions = {}) {
        this.element = typeof document !== 'undefined'
            ? document.createElement('div')
            : ({} as HTMLElement);

        this.element.id = 'da-fab-button';
        if (this.element.classList) {
            this.element.classList.add('da-fab-btn', 'da-fab-entry');
        }

        // 1. 内部图标容器与星光拖尾装饰层
        this.iconContainer = document.createElement('div');
        this.iconContainer.className = 'da-fab-icon';

        if (typeof document !== 'undefined') {
            const effectsLayer = document.createElement('span');
            effectsLayer.className = 'da-fab-effects';
            effectsLayer.setAttribute('aria-hidden', 'true');
            const orbit = document.createElement('span');
            orbit.className = 'da-fab-orbit';
            for (let i = 1; i <= 4; i += 1) {
                const star = document.createElement('span');
                star.className = `da-fab-star da-fab-star--${i}`;
                orbit.appendChild(star);
            }
            effectsLayer.appendChild(orbit);
            this.element.appendChild(effectsLayer);
        }

        this.element.appendChild(this.iconContainer);

        this.clickHandler = options.onClick;

        // 2. 初始化快捷设置浮层面板
        this.quickPanel = new FabQuickPanel({
            anchorElement: this.element,
            onOpenMainSettings: () => this.openMainSettings(),
        });

        // 3. 绑定事件处理器引用
        this.onPointerDownBound = this.onPointerDown.bind(this);
        this.onClickBound = this.onClick.bind(this);
        this.onDblClickBound = this.onDblClick.bind(this);
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
        this.element.addEventListener?.('dblclick', this.onDblClickBound);

        // 监听位置重置、配置更新及后台任务状态变更事件
        eventBus.on('ui:reset-fab-position', this.onResetPositionBound);
        eventBus.on('settings:updated', this.onSettingsUpdatedBound);
        this.unlistenTaskStatus = eventBus.on('task:status', (payload) => {
            if (!payload?.taskId) return;
            if (payload.status === 'pending' || payload.status === 'generating') {
                this.activeTaskIds.add(payload.taskId);
            } else {
                this.activeTaskIds.delete(payload.taskId);
            }
            this.element.classList?.toggle('is-busy', this.activeTaskIds.size > 0);
        });
    }

    private isQuickPanelEnabled(): boolean {
        return Boolean(settingsStore.get('ui')?.fab?.quickPanelEnabled);
    }

    private openMainSettings(): void {
        this.quickPanel.close();
        this.clickHandler?.();
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
        this.suppressNextClick = false;
        if (this.clickSuppressionTimer !== null) {
            clearTimeout(this.clickSuppressionTimer);
            this.clickSuppressionTimer = null;
        }
        if (this.snapTimer !== null) {
            clearTimeout(this.snapTimer);
            this.snapTimer = null;
        }
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
        if (this.quickPanel.isOpen()) {
            this.quickPanel.positionPanel();
        }
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
            this.hasMoved = false;
            this.suppressNextClick = true;
            this.clampAndSavePosition();
            if (this.quickPanel.isOpen()) {
                this.quickPanel.positionPanel();
            }
            if (this.clickSuppressionTimer !== null) {
                clearTimeout(this.clickSuppressionTimer);
            }
            this.clickSuppressionTimer = setTimeout(() => {
                this.suppressNextClick = false;
                this.clickSuppressionTimer = null;
            }, 0);
        }
    }

    private triggerClickPulse(): void {
        if (!this.element.classList) return;
        if (this.pulseTimer !== null) {
            clearTimeout(this.pulseTimer);
            this.pulseTimer = null;
        }
        this.element.classList.remove('is-pulsing');
        void this.element.offsetWidth;
        this.element.classList.add('is-pulsing');
        this.pulseTimer = setTimeout(() => {
            this.element.classList?.remove('is-pulsing');
            this.pulseTimer = null;
        }, 520);
    }

    private onClick(e: MouseEvent): void {
        if (this.suppressNextClick) {
            this.suppressNextClick = false;
            if (this.clickSuppressionTimer !== null) {
                clearTimeout(this.clickSuppressionTimer);
                this.clickSuppressionTimer = null;
            }
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        this.triggerClickPulse();

        if (!this.isQuickPanelEnabled()) {
            this.openMainSettings();
            return;
        }

        const now = Date.now();
        if (now - this.lastClickTimestamp <= DOUBLE_CLICK_THRESHOLD_MS) {
            this.lastClickTimestamp = 0;
            this.openMainSettings();
            return;
        }
        this.lastClickTimestamp = now;

        this.quickPanel.toggle();
    }

    private onDblClick(e: MouseEvent): void {
        e.preventDefault();
        e.stopPropagation();
        this.lastClickTimestamp = 0;
        this.openMainSettings();
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
        const pos: FabPositionState = {
            ratioX: this.currentRatioX,
            ratioY: this.currentRatioY,
        };
        browserStorage.setJson(STORAGE_KEY_POSITION, pos);
    }

    private restoreSavedPosition(): void {
        const pos = browserStorage.getJson<Partial<FabPositionState>>(STORAGE_KEY_POSITION);
        if (pos && typeof pos.ratioX === 'number' && typeof pos.ratioY === 'number') {
            this.applyRatioPosition(pos.ratioX, pos.ratioY);
            return;
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
        if (clearStorage && this.element.classList) {
            if (this.snapTimer !== null) {
                clearTimeout(this.snapTimer);
                this.snapTimer = null;
            }
            this.element.classList.add('is-snapping');
            this.snapTimer = setTimeout(() => {
                this.element.classList?.remove('is-snapping');
                this.snapTimer = null;
            }, 300);
        }

        this.applyRatioPosition(DEFAULT_FAB_RATIO.ratioX, DEFAULT_FAB_RATIO.ratioY);

        if (clearStorage) {
            browserStorage.removeItem(STORAGE_KEY_POSITION);
        }
    }

    /**
     * 从 settingsStore 同步显隐、透明度、图标与绘图动效设置。
     */
    public syncFromSettings(): void {
        const fab = settingsStore.get('ui')?.fab;
        if (!fab) return;

        // 1. 显隐控制
        const isVisible = fab.visible ?? true;
        this.element.style.display = isVisible ? 'flex' : 'none';
        if (!isVisible || !fab.quickPanelEnabled) {
            this.quickPanel.close();
        }

        // 2. 透明度控制 (0.2 ~ 1.0)
        const opacity = fab.opacity ?? 0.95;
        this.element.style.opacity = String(opacity);

        // 3. 绘图中动效类型
        const rawEffect = fab.animationType as string | undefined;
        const effectType: FabAnimationType =
            rawEffect && VALID_FAB_ANIMATIONS.has(rawEffect)
                ? (rawEffect as FabAnimationType)
                : 'starlight';
        this.element.setAttribute?.('data-fab-effect', effectType);

        // 4. 图标渲染
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
     * 释放悬浮球 DOM 引用与事件监听。
     */
    public dispose(): void {
        this.element.removeEventListener?.('pointerdown', this.onPointerDownBound);
        this.element.removeEventListener?.('click', this.onClickBound);
        this.element.removeEventListener?.('dblclick', this.onDblClickBound);

        eventBus.off('ui:reset-fab-position', this.onResetPositionBound);
        eventBus.off('settings:updated', this.onSettingsUpdatedBound);
        if (this.unlistenTaskStatus) {
            this.unlistenTaskStatus();
            this.unlistenTaskStatus = null;
        }
        this.activeTaskIds.clear();

        if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', this.onPointerMoveBound);
            window.removeEventListener('pointerup', this.onPointerUpBound);
            window.removeEventListener('pointercancel', this.onPointerUpBound);
        }

        if (this.clickSuppressionTimer !== null) {
            clearTimeout(this.clickSuppressionTimer);
            this.clickSuppressionTimer = null;
        }
        if (this.snapTimer !== null) {
            clearTimeout(this.snapTimer);
            this.snapTimer = null;
        }
        if (this.pulseTimer !== null) {
            clearTimeout(this.pulseTimer);
            this.pulseTimer = null;
        }
        this.quickPanel.dispose();

        this.element.parentElement?.removeChild(this.element);
    }
}
