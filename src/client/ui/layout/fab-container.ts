/**
 * @module ui/layout/fab-container
 * @description 屏幕悬浮快捷动作按钮控制器 (FABContainer)
 */

import {
    IDisposable,
    DisposableStore,
    ConfigStore,
    EventBus,
    CoreEventMap
} from '../../core';
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
    store: ConfigStore;
    settingsModal: SettingsModal;
    events?: EventBus<CoreEventMap>;
}

export class FABContainer implements IDisposable {
    private readonly _store: ConfigStore;
    private readonly _settingsModal: SettingsModal;
    private readonly _events?: EventBus<CoreEventMap>;
    private _fabElement?: HTMLElement;
    private readonly _disposables = new DisposableStore();
    private _justDragged = false;
    private _activeTaskCount = 0;

    constructor(options: FABContainerOptions) {
        this._store = options.store;
        this._settingsModal = options.settingsModal;
        this._events = options.events;
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
            this._store.subscribeKey('themePreset', () => {
                if (this._fabElement) {
                    ThemeService.applyCurrentThemeToNode(this._fabElement);
                }
            })
        );

        if (this._events) {
            this._disposables.add(
                this._events.on('task:queued', () => {
                    this._activeTaskCount++;
                    this.updateGeneratingState();
                })
            );
            this._disposables.add(
                this._events.on('task:started', () => {
                    this.updateGeneratingState();
                })
            );
            this._disposables.add(
                this._events.on('task:completed', () => {
                    this._activeTaskCount = Math.max(0, this._activeTaskCount - 1);
                    this.updateGeneratingState();
                })
            );
            this._disposables.add(
                this._events.on('task:failed', () => {
                    this._activeTaskCount = Math.max(0, this._activeTaskCount - 1);
                    this.updateGeneratingState();
                })
            );
            this._disposables.add(
                this._events.on('task:cancelled', () => {
                    this._activeTaskCount = Math.max(0, this._activeTaskCount - 1);
                    this.updateGeneratingState();
                })
            );
        }

        if (typeof window !== 'undefined') {
            const onResize = () => this.clampToViewport();
            window.addEventListener('resize', onResize);
            this._disposables.add({ dispose: () => window.removeEventListener('resize', onResize) });
        }
    }

    private updateGeneratingState(): void {
        if (!this._fabElement) return;
        const isGenerating = this._activeTaskCount > 0;
        this._fabElement.classList.toggle('is-generating', isGenerating);
        this._fabElement.title = isGenerating
            ? `正在生成图像中 (${this._activeTaskCount} 个任务)...`
            : '绘画助手快捷面板 (点击展开)';
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
            <span class="da-fab-badge" style="display: none;"></span>
        `;
        ThemeService.applyCurrentThemeToNode(fab);

        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._justDragged) {
                this._justDragged = false;
                return;
            }
            this._settingsModal.open();
        });

        document.body.appendChild(fab);
        this._fabElement = fab;

        this.applyStyles();
        this.restorePosition();
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
            iconSlot.innerHTML = `<img src="${customIcon}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;pointer-events:none;" alt="FAB Icon" />`;
        } else {
            iconSlot.innerHTML = getPresetSvg(presetIcon);
        }
    }

    private restorePosition(): void {
        if (!this._fabElement) return;
        const pos = this._store.get('fabPosition');

        if (pos && typeof pos.top === 'number' && typeof pos.left === 'number') {
            this._fabElement.style.top = `${pos.top}px`;
            this._fabElement.style.left = `${pos.left}px`;
            this._fabElement.style.right = 'auto';
            this._fabElement.style.bottom = 'auto';
            this.clampToViewport();
        } else {
            const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
            const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
            const defaultTop = Math.max(20, Math.round(winH / 2 - 24));
            const defaultLeft = Math.max(20, winW - 68);
            this._fabElement.style.top = `${defaultTop}px`;
            this._fabElement.style.left = `${defaultLeft}px`;
            this._fabElement.style.right = 'auto';
            this._fabElement.style.bottom = 'auto';
        }
    }

    private clampToViewport(): void {
        if (!this._fabElement || typeof window === 'undefined') return;
        const rect = this._fabElement.getBoundingClientRect();
        const maxX = Math.max(0, window.innerWidth - (this._fabElement.offsetWidth || 48));
        const maxY = Math.max(0, window.innerHeight - (this._fabElement.offsetHeight || 48));

        const clampedX = Math.max(0, Math.min(rect.left, maxX));
        const clampedY = Math.max(0, Math.min(rect.top, maxY));

        this._fabElement.style.left = `${clampedX}px`;
        this._fabElement.style.top = `${clampedY}px`;
    }

    private enableDrag(el: HTMLElement): void {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let origLeft = 0;
        let origTop = 0;

        const startDrag = (clientX: number, clientY: number) => {
            isDragging = false;
            this._justDragged = false;
            startX = clientX;
            startY = clientY;

            const rect = el.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;
        };

        const moveDrag = (clientX: number, clientY: number) => {
            const dx = clientX - startX;
            const dy = clientY - startY;

            if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                isDragging = true;
                this._justDragged = true;
                el.classList.add('dragging');
            }

            if (isDragging && typeof window !== 'undefined') {
                const newLeft = origLeft + dx;
                const newTop = origTop + dy;

                const maxX = window.innerWidth - el.offsetWidth;
                const maxY = window.innerHeight - el.offsetHeight;

                el.style.left = `${Math.max(0, Math.min(newLeft, maxX))}px`;
                el.style.top = `${Math.max(0, Math.min(newTop, maxY))}px`;
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        };

        const endDrag = () => {
            if (isDragging) {
                el.classList.remove('dragging');
                const rect = el.getBoundingClientRect();
                this._store.set('fabPosition', {
                    top: Math.round(rect.top),
                    left: Math.round(rect.left)
                });
                setTimeout(() => {
                    this._justDragged = false;
                }, 50);
            }
        };

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            startDrag(e.clientX, e.clientY);

            const onMouseMove = (moveEvt: MouseEvent) => moveDrag(moveEvt.clientX, moveEvt.clientY);
            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                endDrag();
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            startDrag(touch.clientX, touch.clientY);

            const onTouchMove = (moveEvt: TouchEvent) => {
                if (moveEvt.touches.length !== 1) return;
                moveDrag(moveEvt.touches[0].clientX, moveEvt.touches[0].clientY);
            };

            const onTouchEnd = () => {
                window.removeEventListener('touchmove', onTouchMove);
                window.removeEventListener('touchend', onTouchEnd);
                endDrag();
            };

            window.addEventListener('touchmove', onTouchMove, { passive: false });
            window.addEventListener('touchend', onTouchEnd);
        };

        el.addEventListener('mousedown', onMouseDown);
        el.addEventListener('touchstart', onTouchStart, { passive: true });
    }

    public dispose(): void {
        this._disposables.dispose();
        if (this._fabElement) {
            this._fabElement.remove();
            this._fabElement = undefined;
        }
    }
}
