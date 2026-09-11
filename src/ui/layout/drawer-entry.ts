/**
 * SillyTavern 原生扩展设置抽屉入口控制器
 * 负责在酒馆左侧或右侧扩展抽屉中注入本插件快捷配置入口
 */

import { IDisposable } from '../../types';
import { HostClient } from '../../host';
import { SettingsStore } from '../../state/settings-store';
import { SettingsModal } from './settings-modal';
import { Logger } from '../../utils';

export interface DrawerEntryOptions {
    host: HostClient;
    store: SettingsStore;
    settingsModal: SettingsModal;
}

/**
 * 宿主扩展设置抽屉入口控制器
 * 在 SillyTavern 原生扩展抽屉中挂载插件专属设置卡片，
 * 绑定悬浮球开关与主设置面板快捷唤起，并在销毁时注销注入的 DOM 节点与事件监听。
 */
export class DrawerEntryController implements IDisposable {
    private readonly _host: HostClient;
    private readonly _store: SettingsStore;
    private readonly _settingsModal: SettingsModal;
    private readonly _logger = new Logger('DrawerEntry');
    private _subFab?: IDisposable;
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

        const html = await this._host.renderTemplate('settings');
        if (this._isDisposed) return;

        if (!html) {
            this._logger.warn('宿主未能渲染 settings 模板，请检查 settings.html 是否存在');
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'da-drawer-entry-root';
        wrapper.innerHTML = html;
        drawerContainer.appendChild(wrapper);

        const fabCheckbox = wrapper.querySelector<HTMLInputElement>('#da-drawer-toggle-fab');
        if (fabCheckbox) {
            fabCheckbox.checked = this._store.get('fabVisible') !== false;
            fabCheckbox.addEventListener('change', () => {
                this._store.set('fabVisible', fabCheckbox.checked);
            });
        }

        const openBtn = wrapper.querySelector<HTMLButtonElement>('#da-open-main-modal-btn');
        if (openBtn) {
            openBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this._settingsModal.open();
            });
        }

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

        this._subFab?.dispose();

        if (typeof document !== 'undefined') {
            document.getElementById('da-drawer-entry-root')?.remove();
        }
    }
}
