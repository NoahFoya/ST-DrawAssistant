/**
 * 悬浮球控制器 (FABContainer)
 * 渲染屏幕边缘可拖拽悬浮球，提供快速打开主面板与任务状态动画指示
 */

import { IDisposable, toDisposable, DisposableStore, CoreEventMap } from '../../types';
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

/**
 * 校验悬浮球坐标是否合法
 * 过滤 null/undefined、NaN 以及小于 15px 的左上角异常贴边脏数据
 */
export function isValidFabPosition(pos: any): pos is { top: number; left: number } {
    if (!pos || typeof pos !== 'object') return false;
    if (typeof pos.top !== 'number' || typeof pos.left !== 'number') return false;
    if (isNaN(pos.top) || isNaN(pos.left)) return false;
    if (pos.top < 15 && pos.left < 15) return false;
    return true;
}

export interface FABContainerOptions {
    store: SettingsStore;
    settingsModal: SettingsModal;
    events?: TypedEventBus<CoreEventMap>;
}

export class FABContainer implements IDisposable {
    private readonly _store: SettingsStore;
    private readonly _settingsModal: SettingsModal;
    private readonly _events?: TypedEventBus<CoreEventMap>;
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

        // 监听本地悬浮球位置重置事件
        const onResetPos = () => this.restorePosition();
        if (typeof window !== 'undefined') {
            window.addEventListener('da:reset_fab_position', onResetPos);
            this._disposables.add(toDisposable(() => window.removeEventListener('da:reset_fab_position', onResetPos)));
        }

        // 监听屏幕窗口尺寸变化，防止手机旋转或窗口缩放导致悬浮球出界
        if (typeof window !== 'undefined') {
            const onResize = () => this.clampToViewport();
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

        let pos: { top: number; left: number } | null = null;
        // 优先从 SettingsStore 扩展配置中读取
        const storePos = this._store.get('fabPosition');
        if (isValidFabPosition(storePos)) {
            pos = storePos;
        } else if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const stored = localStorage.getItem('da_fab_position');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (isValidFabPosition(parsed)) {
                        pos = parsed;
                    } else {
                        // 清除本地遗留的左上角脏坐标
                        localStorage.removeItem('da_fab_position');
                    }
                }
            } catch {
                pos = null;
            }
        }

        if (pos) {
            this._fabElement.style.top = `${pos.top}px`;
            this._fabElement.style.left = `${pos.left}px`;
            this._fabElement.style.right = 'auto';
            this._fabElement.style.bottom = 'auto';
            // 待布局完全回流后再执行安全视口边界约束，杜绝未就绪时被挤压到 0
            if (typeof window !== 'undefined') {
                window.requestAnimationFrame(() => this.clampToViewport());
            }
        } else {
            // 无自定义有效坐标时清除行内样式，直接生效 CSS 默认的安全右下角停靠
            this._fabElement.style.top = '';
            this._fabElement.style.left = '';
            this._fabElement.style.right = '';
            this._fabElement.style.bottom = '';
        }
    }

    private clampToViewport(): void {
        if (!this._fabElement || typeof window === 'undefined') return;
        // 未应用行内 top/left（即正在使用 CSS 默认停靠）时不执行绝对像素约束
        if (!this._fabElement.style.top && !this._fabElement.style.left) return;
        if (window.innerWidth <= 100 || window.innerHeight <= 100) return;

        const rect = this._fabElement.getBoundingClientRect();
        const fabW = this._fabElement.offsetWidth || 48;
        const fabH = this._fabElement.offsetHeight || 48;
        const maxX = Math.max(0, window.innerWidth - fabW);
        const maxY = Math.max(0, window.innerHeight - fabH);

        const clampedX = Math.max(10, Math.min(rect.left, maxX - 10));
        const clampedY = Math.max(10, Math.min(rect.top, maxY - 10));

        this._fabElement.style.left = `${clampedX}px`;
        this._fabElement.style.top = `${clampedY}px`;
        this._fabElement.style.right = 'auto';
        this._fabElement.style.bottom = 'auto';
    }

    /**
     * 启用悬浮球拖拽交互
     * 统一绑定鼠标与触摸事件，通过 3px 位移死区严格区分单点点击与拖拽移动；
     * 拖拽时将坐标约束在视口边界内，并在释放后持久化坐标到 SettingsStore 与 localStorage。
     */
    private enableDrag(el: HTMLElement): void {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let origLeft = 0;
        let origTop = 0;

        const startDrag = (clientX: number, clientY: number) => {
            isDragging = false;
            // 每次按下时重置拖拽标记，待超过阈值后再判定为真正拖拽
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
                const pos = {
                    top: Math.round(rect.top),
                    left: Math.round(rect.left)
                };

                // 仅当坐标属于合法区域时持久化，防止异常写入 0, 0 死锁
                if (isValidFabPosition(pos)) {
                    this._store.set('fabPosition', pos);
                    if (typeof window !== 'undefined' && window.localStorage) {
                        try {
                            localStorage.setItem('da_fab_position', JSON.stringify(pos));
                        } catch {
                            // 忽略配额或隐身模式限制
                        }
                    }
                }

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
