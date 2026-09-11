/**
 * 悬浮球控制器 (FABContainer)
 * 渲染屏幕边缘可拖拽悬浮球，提供快速打开主面板的轻量常驻入口
 */

import { IDisposable, toDisposable, DisposableStore, CoreEventMap, FabDockPosition } from '../../types';
import { TypedEventBus } from '../../utils';
import { SettingsStore } from '../../state';
import { SettingsModal } from './settings-modal';
import { ThemeService } from '../foundation/theme-service';

export interface FabPresetIcon {
    name: string;
    emoji: string;
    svg: string;
}

export const FAB_PRESET_ICONS: Record<string, FabPresetIcon> = {
    palette: {
        name: '调色盘',
        emoji: '🎨',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.21-1.79 4-4 4h-1.5c-.83 0-1.5.67-1.5 1.5 0 .39.15.74.39 1.01l.4.45c.4.45.61 1.05.61 1.66 0 1.29-1.04 2.38-2.4 2.38z"/><circle cx="7.5" cy="7.5" r=".75" fill="currentColor"/><circle cx="12" cy="6" r=".75" fill="currentColor"/><circle cx="16.5" cy="7.5" r=".75" fill="currentColor"/><circle cx="6" cy="12" r=".75" fill="currentColor"/></svg>`,
    },
    sparkles: {
        name: '星芒',
        emoji: '✨',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg>`,
    },
    wand: {
        name: '魔法棒',
        emoji: '🪄',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4-2 2 4 4 2-2a2 2 0 0 0 0-2.83l-1.17-1.17a2 2 0 0 0-2.83 0z"/><path d="M13 6 3 16v4h4L17 10"/><path d="M9 13 4 18"/><path d="m19 13 2 2"/><path d="m14 18 2 2"/></svg>`,
    },
    image: {
        name: '画框',
        emoji: '🖼️',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    },
    brush: {
        name: '画笔',
        emoji: '🖌️',
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>`,
    },
};

export function getPresetSvg(key?: string): string {
    const defaultKey = 'palette';
    const targetKey = key && FAB_PRESET_ICONS[key] ? key : defaultKey;
    return FAB_PRESET_ICONS[targetKey]?.svg || FAB_PRESET_ICONS[defaultKey].svg;
}

export interface FABContainerOptions {
    store: SettingsStore;
    settingsModal: SettingsModal;
    events?: TypedEventBus<CoreEventMap>;
}

export class FABContainer implements IDisposable {
    private readonly _store: SettingsStore;
    private readonly _settingsModal: SettingsModal;
    private _fabElement?: HTMLElement;
    private readonly _disposables = new DisposableStore();
    private _hasDragged = false;

    constructor(options: FABContainerOptions) {
        this._store = options.store;
        this._settingsModal = options.settingsModal;
        this.init();
    }

    private init(): void {
        this.renderFAB();

        this._disposables.add(
            this._store.subscribeKey('fabVisible', () => this.renderFAB())
        );
        this._disposables.add(
            this._store.subscribeKey('fabOpacity', () => this.applyStyles())
        );
        this._disposables.add(
            this._store.subscribeKey('fabPresetIcon', () => this.applyStyles())
        );
        this._disposables.add(
            this._store.subscribeKey('fabCustomIcon', () => this.applyStyles())
        );
        this._disposables.add(
            this._store.subscribeKey('fabPosition', (pos) => this.applyPosition(pos as FabDockPosition | undefined, true))
        );
        this._disposables.add(
            this._store.subscribeKey('fabAutoSnap', () => {
                this.applyPosition(undefined, true);
            })
        );

        // 监听悬浮球位置重置事件，执行平滑复位归位
        const onResetPos = () => this.applyPosition(undefined, true);
        if (typeof window !== 'undefined') {
            window.addEventListener('da:reset_fab_position', onResetPos);
            this._disposables.add(toDisposable(() => window.removeEventListener('da:reset_fab_position', onResetPos)));
        }

        // 监听屏幕窗口尺寸变化，自动限制坐标在可视区域内
        if (typeof window !== 'undefined') {
            const onResize = () => this.applyPosition();
            window.addEventListener('resize', onResize);
            this._disposables.add(toDisposable(() => window.removeEventListener('resize', onResize)));
        }

        this._disposables.add(
            this._store.subscribeKey('themePreset', () => {
                if (this._fabElement) {
                    ThemeService.applyCurrentThemeToNode(this._fabElement);
                }
            })
        );
    }

    private renderFAB(): void {
        if (typeof document === 'undefined') return;

        if (this._fabElement) {
            this._fabElement.remove();
            this._fabElement = undefined;
        }

        const existingFab = document.getElementById('da-fab-button');
        if (existingFab) {
            existingFab.remove();
        }

        const isVisible = this._store.get('fabVisible') !== false;
        if (!isVisible) return;

        const fab = document.createElement('div');
        fab.id = 'da-fab-button';
        fab.className = 'da-fab-btn st-da-root';
        fab.title = '绘画助手快捷面板 (点击展开)';

        fab.innerHTML = `
            <span class="da-fab-icon"></span>
            <span class="da-fab-badge da-hidden"></span>
        `;
        ThemeService.applyCurrentThemeToNode(fab);

        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._hasDragged) {
                this._hasDragged = false;
                return;
            }
            this._settingsModal.open();
        });

        document.body.appendChild(fab);
        this._fabElement = fab;

        this.applyStyles();
        // 挂载后立即同步计算初次坐标，并在下一帧取得真实尺寸后复核
        this.applyPosition();
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => this.applyPosition());
        }
        this.enableDrag(fab);
    }

    private applyStyles(): void {
        if (!this._fabElement) return;

        const opacity = this._store.get('fabOpacity') ?? 0.95;
        this._fabElement.style.opacity = String(opacity);

        const iconSlot = this._fabElement.querySelector<HTMLElement>('.da-fab-icon');
        if (!iconSlot) return;

        const customIcon = this._store.get('fabCustomIcon');
        const presetIcon = this._store.get('fabPresetIcon');

        if (customIcon) {
            iconSlot.innerHTML = `<img src="${customIcon}" alt="FAB Icon" />`;
        } else {
            iconSlot.innerHTML = getPresetSvg(presetIcon);
        }
    }

    /**
     * 计算当前视口下悬浮球的目标停靠坐标
     * 优先遵循自由比例模型 (xRatio, yRatio)，兼容侧边吸附模型 (dockSide, topRatio) 与绝对像素坐标
     */
    public computeCoordinates(pos?: FabDockPosition | { top: number; left: number }): { top: number; left: number } {
        const winW = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1200;
        const winH = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800;
        const fabW = this._fabElement?.offsetWidth || 48;
        const fabH = this._fabElement?.offsetHeight || 48;

        const maxAvailableW = Math.max(0, winW - fabW);
        const maxAvailableH = Math.max(0, winH - fabH);

        // 内部调用时若未传入显式配置，从 Store 读取
        if (!pos) {
            pos = this._store.get('fabPosition');
        }

        // 无任何记忆数据时的默认推荐位置：屏幕右侧避让安全区、垂直 38% 高度处
        if (!pos) {
            const defaultTop = Math.max(20, Math.round(winH * 0.38 - 24));
            const defaultLeft = Math.max(20, winW - 68);
            return { top: defaultTop, left: defaultLeft };
        }

        // 1. 自由停靠比例坐标体系 (xRatio 与 yRatio)
        const dockPos = pos as FabDockPosition;
        if (typeof dockPos.xRatio === 'number' && typeof dockPos.yRatio === 'number') {
            const rawLeft = Math.round(dockPos.xRatio * maxAvailableW);
            const rawTop = Math.round(dockPos.yRatio * maxAvailableH);
            const left = Math.max(8, Math.min(Math.max(8, maxAvailableW - 8), rawLeft));
            const top = Math.max(8, Math.min(Math.max(8, maxAvailableH - 8), rawTop));
            return { top, left };
        }

        // 2. 传统侧边吸附模型兼容 (dockSide 与 topRatio)
        if (dockPos.dockSide) {
            const edgeOffset = dockPos.edgeOffset ?? 12;
            const topRatio = dockPos.topRatio ?? 0.38;
            const isLeft = dockPos.dockSide === 'left';

            const rawTop = Math.round(winH * topRatio);
            const top = Math.max(8, Math.min(maxAvailableH - 8, rawTop));
            const left = isLeft ? edgeOffset : Math.max(edgeOffset, winW - fabW - edgeOffset);
            return { top, left };
        }

        // 3. 历史绝对像素坐标兼容 ({ top, left })
        const absPos = pos as { top?: number; left?: number };
        if (typeof absPos.top === 'number' || typeof absPos.left === 'number') {
            const top = Math.max(8, Math.min(maxAvailableH - 8, absPos.top ?? Math.round(winH * 0.38)));
            const left = Math.max(8, Math.min(maxAvailableW - 8, absPos.left ?? (winW - fabW - 16)));
            return { top, left };
        }

        // 兜底返回默认推荐位置
        return {
            top: Math.max(20, Math.round(winH * 0.38 - 24)),
            left: Math.max(20, winW - 68)
        };
    }

    /**
     * 将悬浮球定位到指定停靠位置（默认读取 Store 中存储的配置）
     */
    public applyPosition(pos?: FabDockPosition | { top: number; left: number }, animated = false): void {
        if (!this._fabElement) return;

        const targetPos = pos !== undefined ? pos : this._store.get('fabPosition');
        const coords = this.computeCoordinates(targetPos);

        if (animated) {
            this._fabElement.style.transition = 'left 0.25s cubic-bezier(0.2, 0.9, 0.3, 1), top 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)';
            setTimeout(() => {
                if (this._fabElement) {
                    this._fabElement.style.transition = '';
                }
            }, 260);
        } else {
            this._fabElement.style.transition = '';
        }

        this._fabElement.style.top = `${coords.top}px`;
        this._fabElement.style.left = `${coords.left}px`;
        this._fabElement.style.right = 'auto';
        this._fabElement.style.bottom = 'auto';
    }

    /**
     * 启用悬浮球拖拽交互（标准 PointerEvent + 自由放置 + 可选贴边吸附）
     */
    private enableDrag(el: HTMLElement): void {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let origLeft = 0;
        let origTop = 0;

        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;

            const rect = el.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;
            el.style.transition = '';

            try {
                el.setPointerCapture(e.pointerId);
            } catch {}
        };

        const onPointerMove = (e: PointerEvent) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // 6px 阈值防手抖与微颤误触发
            if (!isDragging && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
                isDragging = true;
                this._hasDragged = true;
                el.classList.add('is-dragging');
            }

            if (isDragging && typeof window !== 'undefined') {
                const newLeft = origLeft + dx;
                const newTop = origTop + dy;

                const maxX = Math.max(0, window.innerWidth - (el.offsetWidth || 48));
                const maxY = Math.max(0, window.innerHeight - (el.offsetHeight || 48));

                el.style.left = `${Math.max(0, Math.min(newLeft, maxX))}px`;
                el.style.top = `${Math.max(0, Math.min(newTop, maxY))}px`;
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        };

        const onPointerUp = (e: PointerEvent) => {
            try {
                el.releasePointerCapture(e.pointerId);
            } catch {}

            if (isDragging) {
                el.classList.remove('is-dragging');
                isDragging = false;

                const rect = el.getBoundingClientRect();
                const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
                const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
                const fabW = el.offsetWidth || 48;
                const fabH = el.offsetHeight || 48;
                const maxAvailableW = Math.max(1, winW - fabW);
                const maxAvailableH = Math.max(1, winH - fabH);

                const autoSnap = this._store.get('fabAutoSnap') === true;

                if (autoSnap) {
                    // 吸附贴边模式
                    const centerX = rect.left + fabW / 2;
                    const dockSide: 'left' | 'right' = centerX < winW / 2 ? 'left' : 'right';
                    const topRatio = Math.max(0.04, Math.min(0.92, rect.top / maxAvailableH));
                    const dockPos: FabDockPosition = {
                        dockSide,
                        topRatio,
                        edgeOffset: 12,
                        xRatio: dockSide === 'left' ? 0 : 1,
                        yRatio: topRatio
                    };
                    this.applyPosition(dockPos, true);
                    this._store.set('fabPosition', dockPos);
                } else {
                    // 默认自由停靠模式：直接保存当前视口相对比例，下次缩放时按比例自适应
                    const safeLeft = Math.max(8, Math.min(maxAvailableW - 8, rect.left));
                    const safeTop = Math.max(8, Math.min(maxAvailableH - 8, rect.top));
                    const xRatio = Math.max(0, Math.min(1, safeLeft / maxAvailableW));
                    const yRatio = Math.max(0, Math.min(1, safeTop / maxAvailableH));

                    const freePos: FabDockPosition = {
                        xRatio,
                        yRatio,
                        topRatio: yRatio
                    };
                    this.applyPosition(freePos, false);
                    this._store.set('fabPosition', freePos);
                }
            }
        };

        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerUp);
        el.addEventListener('pointercancel', onPointerUp);

        this._disposables.add(
            toDisposable(() => {
                el.removeEventListener('pointerdown', onPointerDown);
                el.removeEventListener('pointermove', onPointerMove);
                el.removeEventListener('pointerup', onPointerUp);
                el.removeEventListener('pointercancel', onPointerUp);
            })
        );
    }

    public dispose(): void {
        this._disposables.dispose();
        if (this._fabElement) {
            this._fabElement.remove();
            this._fabElement = undefined;
        }
    }
}
