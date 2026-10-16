/**
 * 常驻悬浮操作球组件 (FloatingActionButton)。
 *
 * @remarks
 * 提供屏幕常驻的绘图助手快捷交互入口：
 * 1. 拖拽与自由停靠：支持鼠标与触控指针平滑拖拽，释放时停留在用户设定位置并执行屏幕越界保护；
 * 2. 位置持久化与重置：记忆用户拖拽坐标并在刷新后恢复，支持位置重置事件广播；
 * 3. 动态外观与个性化：响应 settingsStore 的显隐、透明度、预设 SVG 或自定义图片图标；
 * 4. 状态指示徽标：支持在右上方呈现计数徽标（出图完成、异常告警等）。
 */

import type { UIComponent } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';

export interface FloatingActionButtonOptions {
    onClick?: () => void;
}

const STORAGE_KEY_POSITION = 'st_da_fab_position';

export const FAB_BUILTIN_ICONS: Record<string, string> = {
    palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`,
    image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    brush: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>`,
};

export class FloatingActionButton implements UIComponent {
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

        // 监听位置重置与配置更新事件
        eventBus.on('ui:reset-fab-position', this.onResetPositionBound);
        eventBus.on('settings:updated', this.onSettingsUpdatedBound);
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

    private clampAndSavePosition(): void {
        if (typeof window === 'undefined') return;

        const width = this.element.offsetWidth || 48;
        const height = this.element.offsetHeight || 48;

        const maxLeft = Math.max(0, window.innerWidth - width);
        const maxTop = Math.max(0, window.innerHeight - height);

        let left = parseInt(this.element.style.left, 10) || 0;
        let top = parseInt(this.element.style.top, 10) || 0;

        left = Math.min(Math.max(0, left), maxLeft);
        top = Math.min(Math.max(0, top), maxTop);

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;

        try {
            const pos = { left, top };
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
                if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                    const width = 48;
                    const height = 48;
                    const maxLeft = Math.max(0, window.innerWidth - width);
                    const maxTop = Math.max(0, window.innerHeight - height);

                    this.element.style.left = `${Math.min(Math.max(0, pos.left), maxLeft)}px`;
                    this.element.style.top = `${Math.min(Math.max(0, pos.top), maxTop)}px`;
                    this.element.style.right = 'auto';
                    this.element.style.bottom = 'auto';
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

    /**
     * 从 settingsStore 同步显隐、透明度与图标设置。
     */
    public syncFromSettings(): void {
        const trigger = settingsStore.get('ui')?.trigger;
        if (!trigger) return;

        // 1. 显隐控制
        const isVisible = trigger.visible ?? true;
        this.element.style.display = isVisible ? 'flex' : 'none';

        // 2. 透明度控制 (0.2 ~ 1.0)
        const opacity = trigger.opacity ?? 0.95;
        this.element.style.opacity = String(opacity);

        // 3. 图标渲染
        const iconKey = trigger.icon || 'palette';
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
