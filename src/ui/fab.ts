/**
 * @module ui/fab
 * @description FAB (Floating Action Button) 快捷悬浮球组件
 *
 * 职责：
 * - 页面悬浮球挂载与视口边界守护
 * - 自动记忆最后拖拽位置 (Position Persistence)，防止超出视口
 * - 拖拽/放开即时保存配置，支持样式与图标动态实时更新
 * - 订阅 DA_EVENTS.SETTINGS_CHANGED 实现设置变更后样式自动同步（响应式）
 */


import { EXTENSION_DISPLAY_NAME } from '../core/constants';
import { patchSettings } from '../state/app-store';
import { settingsStore } from '../state/app-store';
import { globalEventBus, DA_EVENTS } from '../core/event-bus';
import { logger } from '../core/logger';
import { escapeHtmlAttr } from '../utils/html';

// ─── 预设 SVG 矢量 Icon 库 ───────────────────────────────────────────────────

export interface FabPresetIcon {
    name: string;
    svg: string;
}

export const FAB_PRESET_ICONS: Record<string, FabPresetIcon> = {
    palette: {
        name: '艺术调色盘',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.21-1.79 4-4 4h-1.5c-.83 0-1.5.67-1.5 1.5 0 .39.15.74.39 1.01l.4.45c.4.45.61 1.05.61 1.66 0 1.29-1.04 2.38-2.4 2.38z"/><circle cx="7.5" cy="7.5" r=".75" fill="currentColor"/><circle cx="12" cy="6" r=".75" fill="currentColor"/><circle cx="16.5" cy="7.5" r=".75" fill="currentColor"/><circle cx="6" cy="12" r=".75" fill="currentColor"/></svg>`,
    },
    sparkles: {
        name: '闪烁灵感',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg>`,
    },
    wand: {
        name: '魔法棒',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4-2 2 4 4 2-2a2 2 0 0 0 0-2.83l-1.17-1.17a2 2 0 0 0-2.83 0z"/><path d="M13 6 3 16v4h4L17 10"/><path d="M9 13 4 18"/><path d="m19 13 2 2"/><path d="m14 18 2 2"/></svg>`,
    },
    image: {
        name: '艺术画框',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    },
    brush: {
        name: '绘图画笔',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>`,
    },
};

/** 悬浮面板展开状态下的简洁关闭 SVG Icon */
export const FAB_CLOSE_ICON_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/** 安全获取预设 SVG 字符串 */
export function getPresetSvg(key?: string): string {
    const defaultKey = 'palette';
    const targetKey = key && FAB_PRESET_ICONS[key] ? key : defaultKey;
    return FAB_PRESET_ICONS[targetKey]?.svg || FAB_PRESET_ICONS[defaultKey].svg;
}

let fabElement: HTMLElement | null = null;
let isPanelOpen = false;
let toggleCallback: ((open: boolean) => void) | null = null;
let justDragged = false;

/**
 * 初始化并挂载 FAB 悬浮球
 */
export function initFAB(onToggleClick?: (open: boolean) => void): HTMLElement {
    if (fabElement) return fabElement;

    // 幂等防护：避免 DOM 中已存在同名节点时重复创建
    const existing = document.getElementById('da-fab-button');
    if (existing) {
        fabElement = existing;
        return fabElement;
    }

    if (onToggleClick) {
        toggleCallback = onToggleClick;
    }

    fabElement = document.createElement('div');
    fabElement.id = 'da-fab-button';
    fabElement.className = 'da-fab-btn';
    fabElement.title = `${EXTENSION_DISPLAY_NAME} 快捷面板 (点击展开/收起)`;
    fabElement.innerHTML = `
        <span class="da-fab-icon">${getPresetSvg()}</span>
        <span class="da-fab-badge" style="display: none;"></span>
    `;

    // 绑定点击事件（带拖拽防误触判定）
    fabElement.addEventListener('click', (e) => {
        e.stopPropagation();
        if (justDragged) {
            justDragged = false;
            return;
        }
        toggleFABPanelState();
    });

    // 先挂载到 DOM，确保 getBoundingClientRect() 计算准确
    document.body.appendChild(fabElement);

    // 渲染悬浮球样式与不透明度
    applyFABStylesFromSettings();

    // 恢复记忆的拖拽位置（带边界校验）
    restoreFABPosition();

    // 开启拖拽能力 (带边界守护 + 自动保存)
    enableDrag(fabElement);

    // 视口改变时防止位置脱离窗体
    window.addEventListener('resize', () => {
        clampFABPositionToViewport();
    });

    // 订阅 settingsStore，设置变更时自动刷新悬浮球样式
    globalEventBus.on(DA_EVENTS.SETTINGS_CHANGED, () => {
        applyFABStylesFromSettings();
    });

    logger.info('FAB 快捷悬浮球挂载成功');

    return fabElement;
}

/**
 * 从最新配置同步刷新悬浮球的渲染外观 (供悬浮窗设置 Tab 实时更新)
 * 涵盖：显隐状态、不透明度材质与 Icon Emoji
 */
export function applyFABStylesFromSettings(): void {
    if (!fabElement) return;
    // 使用 Store 快照，零开销读取，不再触发 extension_settings 解析
    const settings = settingsStore.getState();

    // 1. 显隐
    fabElement.style.display = (settings.fabVisible ?? true) ? 'flex' : 'none';

    // 2. 不透明度
    fabElement.style.opacity = String(settings.fabOpacity ?? 0.9);

    // 3. 图标更新
    const iconEl = fabElement.querySelector('.da-fab-icon');
    if (iconEl && !isPanelOpen) {
        const defaultSvgEscaped = escapeHtmlAttr(getPresetSvg(settings.fabIcon));
        if (settings.fabCustomIcon) {
            iconEl.innerHTML = `<img src="${settings.fabCustomIcon}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" onerror="this.outerHTML='${defaultSvgEscaped}'" />`;
        } else {
            iconEl.innerHTML = getPresetSvg(settings.fabIcon);
        }
    }
}

/**
 * 将悬浮球重置定位到屏幕右下角默认位置，并即时保存
 */
export function resetFABPosition(): void {
    if (!fabElement) return;
    fabElement.style.left = 'auto';
    fabElement.style.top = 'auto';
    fabElement.style.right = '24px';
    fabElement.style.bottom = '24px';

    const rect = fabElement.getBoundingClientRect();
    patchSettings({ fabPosition: { x: Math.round(rect.left), y: Math.round(rect.top) } });
}

/**
 * 切换主模态面板的展开/关闭状态，并联动更新悬浮球按键图标
 *
 * @param forceState 强制指定展开状态 (true 展开, false 收起)
 */
export function toggleFABPanelState(forceState?: boolean): void {
    isPanelOpen = forceState !== undefined ? forceState : !isPanelOpen;

    if (fabElement) {
        const settings = settingsStore.getState();
        const iconEl = fabElement.querySelector('.da-fab-icon');
        if (isPanelOpen) {
            fabElement.classList.add('da-fab-btn--active');
            if (iconEl) iconEl.innerHTML = FAB_CLOSE_ICON_SVG;
        } else {
            fabElement.classList.remove('da-fab-btn--active');
            if (iconEl) {
                const defaultSvgEscaped = escapeHtmlAttr(getPresetSvg(settings.fabIcon));
                if (settings.fabCustomIcon) {
                    iconEl.innerHTML = `<img src="${settings.fabCustomIcon}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" onerror="this.outerHTML='${defaultSvgEscaped}'" />`;
                } else {
                    iconEl.innerHTML = getPresetSvg(settings.fabIcon);
                }
            }
        }
    }

    if (toggleCallback) {
        toggleCallback(isPanelOpen);
    }
}

/** 恢复保存的位置（带视口防护） */
function restoreFABPosition(): void {
    if (!fabElement) return;
    const settings = settingsStore.getState();
    const pos = settings.fabPosition;

    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        fabElement.style.left = `${pos.x}px`;
        fabElement.style.top = `${pos.y}px`;
        fabElement.style.right = 'auto';
        fabElement.style.bottom = 'auto';

        requestAnimationFrame(() => {
            clampFABPositionToViewport();
        });
    }
}

/** 视口边界守护（防止脱离窗体范围，精确计算剔除滚动条宽度） */
function clampFABPositionToViewport(): void {
    if (!fabElement) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;

    // 防护：若页面布局尚未就绪 (vw/vh <= 100)，暂不强制裁切，避免将有效位置误篡改为 (10, 10)
    if (vw <= 100 || vh <= 100) return;

    const rect = fabElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // 边界钳制 Clamp
    const safeLeft = Math.max(10, Math.min(rect.left, vw - rect.width - 10));
    const safeTop = Math.max(10, Math.min(rect.top, vh - rect.height - 10));

    fabElement.style.left = `${safeLeft}px`;
    fabElement.style.top = `${safeTop}px`;
    fabElement.style.right = 'auto';
    fabElement.style.bottom = 'auto';
}

/** 拖拽处理 (包含鼠标 Mouse 与触控 Touch 拖拽结束自动保存定位) */
function enableDrag(el: HTMLElement): void {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let hasMoved = false;

    const saveFABPosition = () => {
        const finalRect = el.getBoundingClientRect();
        const newPos = {
            x: Math.round(finalRect.left),
            y: Math.round(finalRect.top),
        };
        patchSettings({ fabPosition: newPos });
    };

    const handleStart = (clientX: number, clientY: number) => {
        isDragging = true;
        hasMoved = false;
        justDragged = false;
        startX = clientX;
        startY = clientY;

        const rect = el.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        el.style.transition = 'none';
    };

    const handleMove = (clientX: number, clientY: number) => {
        if (!isDragging) return;
        const rect = el.getBoundingClientRect();
        const dx = clientX - startX;
        const dy = clientY - startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved = true;
        }

        const rawLeft = initialLeft + dx;
        const rawTop = initialTop + dy;

        const vw = document.documentElement.clientWidth || window.innerWidth;
        const vh = document.documentElement.clientHeight || window.innerHeight;
        const safeLeft = Math.max(0, Math.min(rawLeft, vw - rect.width));
        const safeTop = Math.max(0, Math.min(rawTop, vh - rect.height));

        el.style.left = `${safeLeft}px`;
        el.style.top = `${safeTop}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    };

    const handleEnd = (e: Event) => {
        if (!isDragging) return;
        isDragging = false;
        el.style.transition = '';

        if (hasMoved) {
            justDragged = true;
            e.stopPropagation();
            saveFABPosition();
        }
    };

    // 鼠标 Mouse 事件
    el.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        handleStart(e.clientX, e.clientY);

        const onMouseMove = (moveEvent: MouseEvent) => handleMove(moveEvent.clientX, moveEvent.clientY);
        const onMouseUp = (upEvent: MouseEvent) => {
            handleEnd(upEvent);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // 触控 Touch 事件
    el.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);

        const onTouchMove = (moveEvent: TouchEvent) => {
            if (moveEvent.touches.length === 1) {
                if (isDragging && hasMoved && moveEvent.cancelable) {
                    moveEvent.preventDefault();
                }
                handleMove(moveEvent.touches[0].clientX, moveEvent.touches[0].clientY);
            }
        };
        const onTouchEnd = (endEvent: TouchEvent) => {
            handleEnd(endEvent);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    });
}
