/**
 * @module ui/containers/fab-container
 * @description 屏幕右下角悬浮快捷按钮控制器 (FABContainer - 支持拖拽、显隐联动与一键呼出设置面板)
 */

import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { SettingsModal } from './settings-modal';

/**
 * 悬浮快捷球初始化参数选项
 */
export interface FABContainerOptions {
    /** 全局响应式状态配置中心 */
    store: ObservableStore<DrawAssistantSettings>;
    /** 主设置面板控制器实例 */
    settingsModal: SettingsModal;
}

export class FABContainer implements IDisposable {
    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _settingsModal: SettingsModal;
    private _fabElement?: HTMLElement;
    private _sub?: IDisposable;
    private _isDisposed = false;

    constructor(options: FABContainerOptions) {
        this._store = options.store;
        this._settingsModal = options.settingsModal;

        this.init();
    }

    private init(): void {
        this.renderFAB();
        this._sub = this._store.subscribeKey('fabEnabled', () => {
            this.renderFAB();
        });
    }

    private renderFAB(): void {
        if (typeof document === 'undefined') return;

        if (this._fabElement) {
            this._fabElement.remove();
            this._fabElement = undefined;
        }

        const isEnabled = this._store.get('fabEnabled') !== false;
        if (!isEnabled) return;

        const fab = document.createElement('div');
        fab.className = 'da-fab-container st-da-root';
        fab.style.position = 'fixed';
        fab.style.bottom = '80px';
        fab.style.right = '24px';
        fab.style.zIndex = '99999';
        fab.style.width = '48px';
        fab.style.height = '48px';
        fab.style.borderRadius = '50%';
        fab.style.background = 'var(--da-accent-color)';
        fab.style.color = 'var(--da-text-on-accent, #000)';
        fab.style.display = 'flex';
        fab.style.justifyContent = 'center';
        fab.style.alignItems = 'center';
        fab.style.cursor = 'pointer';
        fab.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
        fab.style.fontSize = '20px';
        fab.innerHTML = '🎨';
        fab.title = '绘画助手快捷面板';

        let isDragging = false;
        let startX = 0;
        let startY = 0;

        fab.onmousedown = (e) => {
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;

            const onMouseMove = (moveEvent: MouseEvent) => {
                if (Math.abs(moveEvent.clientX - startX) > 4 || Math.abs(moveEvent.clientY - startY) > 4) {
                    isDragging = true;
                }
                if (isDragging) {
                    fab.style.left = `${moveEvent.clientX - 24}px`;
                    fab.style.top = `${moveEvent.clientY - 24}px`;
                    fab.style.right = 'auto';
                    fab.style.bottom = 'auto';
                }
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        fab.onclick = () => {
            if (!isDragging) {
                this._settingsModal.open();
            }
        };

        document.body.appendChild(fab);
        this._fabElement = fab;
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._sub?.dispose();
        this._fabElement?.remove();
    }
}
