/**
 * 悬浮球快捷入口组件 (FABContainer)
 *
 * 功能：
 * 1. 提供常驻宿主界面的快捷操作悬浮球，支持全屏自由拖拽定位与边缘自动吸附；
 * 2. 结合位移阈值区分点击打开设置面板与拖拽移动位置操作，防止误触；
 * 3. 响应生图队列运行时状态，提供动画反馈与任务计数角标提示；
 * 4. 负责悬浮球屏幕坐标的记忆与持久化保存。
 *
 * Tips：
 * 1. 拖拽边界需做视口溢出保护，防止悬浮球被拖出屏幕可见区域；
 * 2. 宿主窗口尺寸变化 (resize) 时需自动校正悬浮球坐标，确保其停留在有效视口内。
 */

import { createElement } from '../../util/dom';
import { getIconSvg } from '../components/icons';
import type { SettingsStore } from '../../store/settings';

export interface FabPosition {
    x: number;
    y: number;
}

export interface FabContainerOptions {
    onClick?: () => void;
    settingsStore?: SettingsStore;
    icon?: string;
    opacity?: number;
    autoSnap?: boolean;
    initialPosition?: FabPosition;
    visible?: boolean;
}

export class FabContainer {
    private _element: HTMLElement;
    private _iconWrapper: HTMLElement;
    private _badgeEl: HTMLElement;

    private _settingsStore?: SettingsStore;
    private _onClick?: () => void;
    private _autoSnap: boolean;
    private _opacity: number;
    private _position: FabPosition;

    private _isDragging = false;
    private _hasMoved = false;
    private _startX = 0;
    private _startY = 0;
    private _initialLeft = 0;
    private _initialTop = 0;

    private _pointerDownHandler: (e: PointerEvent) => void;
    private _pointerMoveHandler: (e: PointerEvent) => void;
    private _pointerUpHandler: (e: PointerEvent) => void;
    private _clickHandler: (e: MouseEvent) => void;
    private _pointerHandledClick = false;

    constructor(options: FabContainerOptions = {}) {
        this._onClick = options.onClick;
        this._settingsStore = options.settingsStore;
        this._autoSnap = options.autoSnap ?? false;
        this._opacity = options.opacity ?? 0.95;

        // 1. 初始化坐标位置
        const savedPos = this._settingsStore?.get('ui')?.trigger?.position ?? options.initialPosition;
        this._position = savedPos ? { ...savedPos } : this._getDefaultPosition();

        // 2. 创建主悬浮球 DOM 结构
        this._element = createElement('div', {
            className: 'da-fab-btn st-da-root'
        });
        this._element.id = 'da-fab-button';
        this._element.setAttribute('aria-label', 'ST-DrawAssistant 绘画助手');
        this._element.style.opacity = String(this._opacity);
        this._updatePosition(this._position.x, this._position.y);

        if (options.visible === false) {
            this._element.style.display = 'none';
        }

        // 3. 内部图标容器
        this._iconWrapper = createElement('span', { className: 'da-fab-icon' });
        this.setIcon(options.icon || 'palette');
        this._element.appendChild(this._iconWrapper);

        // 4. 右上角红色角标
        this._badgeEl = createElement('span', { className: 'da-fab-badge' });
        this._badgeEl.style.display = 'none';
        this._element.appendChild(this._badgeEl);

        // 5. 绑定指针拖拽事件 (PointerEvent 统一触控与鼠标)
        this._pointerDownHandler = this._onPointerDown.bind(this);
        this._pointerMoveHandler = this._onPointerMove.bind(this);
        this._pointerUpHandler = this._onPointerUp.bind(this);
        this._clickHandler = (e: MouseEvent) => {
            if (this._hasMoved) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            if (this._pointerHandledClick) {
                return;
            }
            this._onClick?.();
        };

        this._element.addEventListener('pointerdown', this._pointerDownHandler);
        this._element.addEventListener('click', this._clickHandler);

        // 6. 视口大小变化自适应边界保护
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this._onResize);
        }
    }

    private _onResize = (): void => {
        if (typeof window === 'undefined') return;
        const maxX = window.innerWidth - 48;
        const maxY = window.innerHeight - 48;
        if (this._position.x > maxX || this._position.y > maxY) {
            this._position.x = Math.max(4, Math.min(maxX - 4, this._position.x));
            this._position.y = Math.max(4, Math.min(maxY - 4, this._position.y));
            this._updatePosition(this._position.x, this._position.y);
        }
    };

    /** 计算视口右下角默认出生位置 */
    private _getDefaultPosition(): FabPosition {
        if (typeof window === 'undefined') {
            return { x: 300, y: 300 };
        }
        return {
            x: Math.max(10, window.innerWidth - 64),
            y: Math.max(10, window.innerHeight - 120)
        };
    }

    /** 处理指针按下 */
    private _onPointerDown(e: PointerEvent): void {
        if (e.button !== 0) return; // 仅限主按键 (鼠标左键或单指触摸)
        this._isDragging = true;
        this._hasMoved = false;

        this._startX = e.clientX;
        this._startY = e.clientY;

        const rect = this._element.getBoundingClientRect();
        this._initialLeft = rect.left;
        this._initialTop = rect.top;

        this._element.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', this._pointerMoveHandler);
        window.addEventListener('pointerup', this._pointerUpHandler);
        window.addEventListener('pointercancel', this._pointerUpHandler);
    }

    /** 处理指针移动 */
    private _onPointerMove(e: PointerEvent): void {
        if (!this._isDragging) return;

        const dx = e.clientX - this._startX;
        const dy = e.clientY - this._startY;

        // 位移超过 4px 判定为拖拽
        if (!this._hasMoved && Math.hypot(dx, dy) > 4) {
            this._hasMoved = true;
            this._element.classList.add('is-dragging');
        }

        if (this._hasMoved) {
            const rawX = this._initialLeft + dx;
            const rawY = this._initialTop + dy;

            // 视口边界钳制约束
            const maxX = typeof window !== 'undefined' ? window.innerWidth - 48 : 500;
            const maxY = typeof window !== 'undefined' ? window.innerHeight - 48 : 500;

            const clampedX = Math.max(4, Math.min(maxX - 4, rawX));
            const clampedY = Math.max(4, Math.min(maxY - 4, rawY));

            this._position = { x: clampedX, y: clampedY };
            this._updatePosition(clampedX, clampedY);
        }
    }

    /** 处理指针抬起释放 */
    private _onPointerUp(e: PointerEvent): void {
        if (!this._isDragging) return;
        this._isDragging = false;
        this._element.classList.remove('is-dragging');

        try {
            this._element.releasePointerCapture(e.pointerId);
        } catch {
            // 兼容性保护
        }

        window.removeEventListener('pointermove', this._pointerMoveHandler);
        window.removeEventListener('pointerup', this._pointerUpHandler);
        window.removeEventListener('pointercancel', this._pointerUpHandler);

        if (!this._hasMoved) {
            // 位移未超阈值，判定为有效单击
            this._pointerHandledClick = true;
            this._onClick?.();
            setTimeout(() => {
                this._pointerHandledClick = false;
            }, 50);
        } else {
            // 拖拽结束：若启用了自动贴边，计算最邻近屏幕边缘
            if (this._autoSnap && typeof window !== 'undefined') {
                const midX = window.innerWidth / 2;
                const snapX = this._position.x < midX ? 8 : window.innerWidth - 56;
                this._position.x = snapX;
                this._updatePosition(snapX, this._position.y);
            }
            // 持久化保存新坐标
            this._persistPosition();
        }
    }

    /** 应用绝对样式坐标 */
    private _updatePosition(x: number, y: number): void {
        this._element.style.left = `${Math.round(x)}px`;
        this._element.style.top = `${Math.round(y)}px`;
    }

    /** 将当前坐标持久化至 SettingsStore */
    private _persistPosition(): void {
        if (!this._settingsStore) return;
        const currentUi = this._settingsStore.get('ui') ?? {};
        const trigger = currentUi.trigger ?? {
            visible: true,
            opacity: 0.95,
            icon: 'palette',
            autoSnap: false
        };

        this._settingsStore.update({
            ui: {
                ...currentUi,
                trigger: {
                    ...trigger,
                    position: { ...this._position }
                }
            }
        });
    }

    /** 设置悬浮球内部图标 (内置图标标识或网络/Base64图片URL) */
    public setIcon(iconOrUrl: string): void {
        this._iconWrapper.innerHTML = '';
        if (iconOrUrl.startsWith('http://') || iconOrUrl.startsWith('https://') || iconOrUrl.startsWith('data:image/')) {
            const img = document.createElement('img');
            img.src = iconOrUrl;
            img.alt = 'FAB Avatar';
            this._iconWrapper.appendChild(img);
        } else {
            this._iconWrapper.innerHTML = getIconSvg(iconOrUrl || 'palette');
        }
    }

    /** 设置生成中呼吸发光动画 */
    public setGenerating(generating: boolean): void {
        if (generating) {
            this._element.classList.add('is-generating');
        } else {
            this._element.classList.remove('is-generating');
        }
    }

    /** 设置右上角数字角标 (0 或负数时自动隐藏) */
    public setBadge(count: number): void {
        if (count > 0) {
            this._badgeEl.textContent = count > 99 ? '99+' : String(count);
            this._badgeEl.style.display = 'flex';
        } else {
            this._badgeEl.style.display = 'none';
        }
    }

    /** 设置悬浮球不透明度 (0.1 ~ 1.0) */
    public setOpacity(opacity: number): void {
        this._opacity = Math.max(0.1, Math.min(1.0, opacity));
        this._element.style.opacity = String(this._opacity);
    }

    /** 设置是否自动吸附边缘 */
    public setAutoSnap(autoSnap: boolean): void {
        this._autoSnap = autoSnap;
    }

    /** 控制显隐 */
    public setVisible(visible: boolean): void {
        this._element.style.display = visible ? 'flex' : 'none';
    }

    /** 重置位置到视口右下角默认位置 */
    public resetPosition(): void {
        this._position = this._getDefaultPosition();
        this._updatePosition(this._position.x, this._position.y);
        this._persistPosition();
    }

    /** 挂载到指定父容器 (默认 document.body) */
    public mount(parent?: HTMLElement): void {
        const target = parent ?? (typeof document !== 'undefined' ? document.body : null);
        if (target && !target.contains(this._element)) {
            target.appendChild(this._element);
        }
    }

    /** 获取 DOM 元素 */
    public getElement(): HTMLElement {
        return this._element;
    }

    /** 获取当前坐标快照 */
    public getPosition(): Readonly<FabPosition> {
        return this._position;
    }

    /** 销毁组件 */
    public dispose(): void {
        this._element.removeEventListener('pointerdown', this._pointerDownHandler);
        this._element.removeEventListener('click', this._clickHandler);
        if (this._element.parentElement) {
            this._element.parentElement.removeChild(this._element);
        }
    }
}
