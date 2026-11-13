/**
 * 悬浮操作球组件 (FloatingActionButton)。
 *
 * @remarks
 * 提供快捷打开设置面板的常驻入口：
 * 1. 拖拽停靠：支持鼠标与触控拖拽，停留在用户设定位置并进行越界保护；
 * 2. 位置记忆：记录坐标并在页面加载时恢复，支持位置重置；
 * 3. 外观样式：支持调整透明度、预设图标与自定义图片；
 * 4. 状态徽标：支持呈现未读/完成状态徽标。
 */

import type { UIComponent, Disposable } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { FAB_BUILTIN_ICONS } from '../views/fab-tab';

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

    private currentRatioX: number | null = null;
    private currentRatioY: number | null = null;
    private resizeRafId: number | null = null;

    private readonly onPointerDownBound: (e: PointerEvent) => void;
    private readonly onClickBound: (e: MouseEvent) => void;
    private readonly onPointerMoveBound: (e: PointerEvent) => void;
    private readonly onPointerUpBound: (e: PointerEvent) => void;
    private readonly onResetPositionBound: () => void;
    private readonly onSettingsUpdatedBound: () => void;
    private readonly onWindowResizeBound: () => void;

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
        this.onWindowResizeBound = this.onWindowResize.bind(this);

        this.bindEvents();
        this.restoreSavedPosition();
        this.syncFromSettings();
    }

    private bindEvents(): void {
        this.element.addEventListener?.('pointerdown', this.onPointerDownBound);
        this.element.addEventListener?.('click', this.onClickBound);

        // 监听位置重置与配置更新事件
        eventBus.on('ui:reset-fab-position', this.onResetPositionBound);
        eventBus.on('settings:updated', this.onSettingsUpdatedBound);

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.onWindowResizeBound);
        }
    }

    private onPointerDown(e: PointerEvent): void {
        if (e.button !== 0) return; // 仅响应鼠标左键或触控

        this.isDragging = true;
        this.hasMoved = false;
        this.startPointerX = e.clientX;
        this.startPointerY = e.clientY;

        const rect = this.element.getBoundingClientRect();
        this.startElemX = rect.left;
        this.startElemY = rect.top;
        this.cachedElemWidth = this.element.offsetWidth || 48;
        this.cachedElemHeight = this.element.offsetHeight || 48;

        this.element.classList.add('is-dragging');

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

        if (typeof window === 'undefined') return;

        const maxLeft = Math.max(0, window.innerWidth - this.cachedElemWidth);
        const maxTop = Math.max(0, window.innerHeight - this.cachedElemHeight);

        const newLeft = Math.min(Math.max(0, this.startElemX + dx), maxLeft);
        const newTop = Math.min(Math.max(0, this.startElemY + dy), maxTop);

        this.element.style.left = `${newLeft}px`;
        this.element.style.top = `${newTop}px`;
        this.element.style.right = 'auto';
        this.element.style.bottom = 'auto';
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
        if (typeof window === 'undefined') return;

        const width = this.element.offsetWidth || this.cachedElemWidth || 48;
        const height = this.element.offsetHeight || this.cachedElemHeight || 48;
        const maxLeft = Math.max(0, window.innerWidth - width);
        const maxTop = Math.max(0, window.innerHeight - height);

        const clampedRatioX = Math.min(Math.max(0, ratioX), 1);
        const clampedRatioY = Math.min(Math.max(0, ratioY), 1);

        const left = Math.round(clampedRatioX * maxLeft);
        const top = Math.round(clampedRatioY * maxTop);

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.element.style.right = 'auto';
        this.element.style.bottom = 'auto';
    }

    private clampAndSavePosition(): void {
        if (typeof window === 'undefined') return;

        const width = this.element.offsetWidth || this.cachedElemWidth || 48;
        const height = this.element.offsetHeight || this.cachedElemHeight || 48;

        const maxLeft = Math.max(0, window.innerWidth - width);
        const maxTop = Math.max(0, window.innerHeight - height);

        let left = parseInt(this.element.style.left, 10) || 0;
        let top = parseInt(this.element.style.top, 10) || 0;

        left = Math.min(Math.max(0, left), maxLeft);
        top = Math.min(Math.max(0, top), maxTop);

        const ratioX = maxLeft > 0 ? left / maxLeft : 1;
        const ratioY = maxTop > 0 ? top / maxTop : 1;

        this.currentRatioX = ratioX;
        this.currentRatioY = ratioY;

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.element.style.right = 'auto';
        this.element.style.bottom = 'auto';

        try {
            const pos: FabPositionState = { ratioX, ratioY };
            localStorage.setItem(STORAGE_KEY_POSITION, JSON.stringify(pos));
        } catch {
            // 忽略存储写入限制
        }
    }

    private restoreSavedPosition(): void {
        if (typeof window === 'undefined') return;

        try {
            const raw = localStorage.getItem(STORAGE_KEY_POSITION);
            if (raw) {
                const pos = JSON.parse(raw);
                // 标准相对比例模型
                if (typeof pos.ratioX === 'number' && typeof pos.ratioY === 'number') {
                    this.currentRatioX = Math.min(Math.max(0, pos.ratioX), 1);
                    this.currentRatioY = Math.min(Math.max(0, pos.ratioY), 1);
                    this.applyRatioPosition(this.currentRatioX, this.currentRatioY);
                    return;
                }
            }
        } catch {
            // 恢复基准停靠位置
        }

        // 右下角基准位置停靠
        this.resetPosition(false);
    }

    /**
     * 重置悬浮球停靠位置至右下角基准位置。
     *
     * @param clearStorage 是否同时清除 localStorage 记录，默认为 true
     */
    public resetPosition(clearStorage = true): void {
        this.currentRatioX = null;
        this.currentRatioY = null;
        this.element.style.left = 'auto';
        this.element.style.top = 'auto';
        this.element.style.right = '24px';
        this.element.style.bottom = '80px';

        if (clearStorage && typeof localStorage !== 'undefined') {
            try {
                localStorage.removeItem(STORAGE_KEY_POSITION);
            } catch {
                // 忽略异常
            }
        }
    }

    private onWindowResize(): void {
        if (this.currentRatioX === null || this.currentRatioY === null) {
            return;
        }
        if (this.resizeRafId !== null) return;
        if (typeof window === 'undefined') return;

        this.resizeRafId = window.requestAnimationFrame(() => {
            this.resizeRafId = null;
            if (this.currentRatioX !== null && this.currentRatioY !== null) {
                this.applyRatioPosition(this.currentRatioX, this.currentRatioY);
            }
        });
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
            window.removeEventListener('resize', this.onWindowResizeBound);
        }

        if (this.resizeRafId !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = null;
        }

        if (this.clickSuppressionTimer !== null) {
            clearTimeout(this.clickSuppressionTimer);
            this.clickSuppressionTimer = null;
        }

        this.element.parentElement?.removeChild(this.element);
    }
}
