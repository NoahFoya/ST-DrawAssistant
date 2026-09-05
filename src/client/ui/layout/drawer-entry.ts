/**
 * @module ui/layout/drawer-entry
 * @description SillyTavern 原生扩展设置抽屉入口控制器 (DrawerEntryController)
 */

import { IDisposable } from '../../core/types';
import { HostClient } from '../../core/host/host-client';
import { ConfigStore } from '../../core/config/config-store';
import { SettingsModal } from './settings-modal';

export interface DrawerEntryOptions {
    host: HostClient;
    store: ConfigStore;
    settingsModal: SettingsModal;
}

/**
 * 宿主扩展设置抽屉入口控制器
 *
 * 职责：
 * 1. 在 SillyTavern 扩展抽屉中挂载插件专属设置入口；
 * 2. 绑定抽屉内悬浮球 (FAB) 显隐开关并响应 Store 状态双向同步；
 * 3. 绑定抽屉内与全局快捷打开设置模态框按钮；
 * 4. 销毁时清理注入的 DOM 节点与全局事件监听。
 */
export class DrawerEntryController implements IDisposable {
    private readonly _host: HostClient;
    private readonly _store: ConfigStore;
    private readonly _settingsModal: SettingsModal;
    private _subFab?: IDisposable;
    private _onDocClickBound?: (e: MouseEvent) => void;
    private _isDisposed = false;

    constructor(options: DrawerEntryOptions) {
        this._host = options.host;
        this._store = options.store;
        this._settingsModal = options.settingsModal;
        void this.mount();
    }

    private async mount(): Promise<void> {
        if (typeof document === 'undefined' || this._isDisposed) return;

        const drawerContainer = this._host.getExtensionDrawerContainer();
        if (!drawerContainer || document.getElementById('da-drawer-entry-root')) return;

        let html = await this._host.renderTemplate('settings');
        if (this._isDisposed) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'da-drawer-entry-root';
        wrapper.className = 'da-drawer-entry st-da-root';

        if (!html) {
            // 回退骨架：支持在无模板环境下或直连加载时完整呈现
            wrapper.innerHTML = `
                <div class="da-drawer-card">
                    <div class="da-drawer-header">
                        <span class="da-drawer-title">✨ 绘画助手 (ST-DrawAssistant)</span>
                    </div>
                    <div class="da-drawer-actions">
                        <label class="da-form-checkbox-label">
                            <input type="checkbox" id="da-drawer-toggle-fab" />
                            <span>显示屏幕悬浮球 (FAB)</span>
                        </label>
                        <button type="button" class="da-btn da-btn--primary" id="da-drawer-open-settings">
                            打开绘图助手设置
                        </button>
                    </div>
                </div>
            `;
        } else {
            wrapper.innerHTML = html;
        }

        drawerContainer.appendChild(wrapper);

        const fabCheckbox = wrapper.querySelector<HTMLInputElement>('#da-drawer-toggle-fab');
        if (fabCheckbox) {
            fabCheckbox.checked = this._store.get('fabVisible') !== false;
            fabCheckbox.addEventListener('change', () => {
                this._store.set('fabVisible', fabCheckbox.checked);
            });
        }

        const openSettingsBtn = wrapper.querySelector<HTMLButtonElement>('#da-drawer-open-settings');
        if (openSettingsBtn) {
            openSettingsBtn.addEventListener('click', () => {
                this._settingsModal.open();
            });
        }

        this._onDocClickBound = (e: MouseEvent) => {
            const target = (e.target as HTMLElement | null)?.closest('#da-open-main-modal-btn');
            if (target) {
                e.preventDefault();
                this._settingsModal.open();
            }
        };
        document.addEventListener('click', this._onDocClickBound);

        this._subFab = this._store.subscribeKey('fabVisible', (val) => {
            const el = document.getElementById('da-drawer-toggle-fab') as HTMLInputElement | null;
            if (el && el.checked !== (val !== false)) {
                el.checked = val !== false;
            }
        });
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;

        if (this._onDocClickBound && typeof document !== 'undefined') {
            document.removeEventListener('click', this._onDocClickBound);
        }
        this._subFab?.dispose();

        if (typeof document !== 'undefined') {
            document.getElementById('da-drawer-entry-root')?.remove();
        }
    }
}
