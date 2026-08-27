/**
 * @module ui/layout/settings-modal
 * @description 主设置弹窗控制器 (SettingsModal)
 */

import { IUIRegistry } from '../../core/registry/ui-registry';
import { IModalService } from '../feedback/modal-service';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, createDefaultSettings, hydrateSettingsFromPresets } from '../../core/state/store-types';
import type { IDriverRegistry } from '../../core/registry/driver-registry';
import { IDisposable, DisposableStore } from '../../core/foundation/disposable';
import {
    VERSION,
    DEFAULT_THEME_DATA,
    CORE_TAB_IDS,
    PROVIDERS
} from '../../core/constants';
import { ThemeService } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { TelemetryService } from '../foundation/telemetry-service';
import { createUnsavedFloatingNotice } from './unsaved-floating-notice';
import { OverlayHost } from '../foundation/overlay-host';

export interface SettingsModalOptions {
    uiRegistry: IUIRegistry;
    modalService: IModalService;
    store: ObservableStore<DrawAssistantSettings>;
    drivers?: IDriverRegistry;
    version?: string;
}

export class SettingsModal implements IDisposable {
    private readonly _uiRegistry: IUIRegistry;
    private readonly _modalService: IModalService;
    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _drivers?: IDriverRegistry;
    private readonly _version: string;
    private readonly _disposables = new DisposableStore();

    private _modalHandle?: IDisposable;
    private _activeTabId = 'general';
    private _sidebarEl?: HTMLElement;
    private _currentTabDisposable?: IDisposable;
    private _isDisposed = false;

    constructor(options: SettingsModalOptions) {
        this._uiRegistry = options.uiRegistry;
        this._modalService = options.modalService;
        this._store = options.store;
        this._drivers = options.drivers;
        this._version = options.version || VERSION;
    }

    public open(initialTabId?: string): void {
        if (this._modalHandle) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.id = 'da-main-modal-backdrop';

        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-main-modal-inner';
        dialog.addEventListener('click', (e) => {
            e.stopPropagation();
            const menuDropdown = dialog.querySelector('.da-modal-dropdown-menu') as HTMLElement | null;
            const actionsBtn = dialog.querySelector('.da-header-right .da-icon-btn') as HTMLElement | null;
            if (menuDropdown && menuDropdown.style.display !== 'none') {
                if (actionsBtn && !actionsBtn.contains(e.target as Node) && !menuDropdown.contains(e.target as Node)) {
                    menuDropdown.style.display = 'none';
                }
            }
        });

        // 1. 顶栏
        const header = this.renderHeaderBar();
        dialog.appendChild(header);

        // 2. 主体容器
        const bodyContainer = document.createElement('div');
        bodyContainer.className = 'da-modal-body';

        const sidebar = document.createElement('div');
        sidebar.className = 'da-sidebar-tabs';
        this._sidebarEl = sidebar;

        const contentArea = document.createElement('div');
        contentArea.id = 'da-modal-content-area';
        contentArea.className = 'da-modal-content';

        bodyContainer.appendChild(sidebar);
        bodyContainer.appendChild(contentArea);
        dialog.appendChild(bodyContainer);

        // 3. 底栏
        const footer = this.renderFooterBar();
        dialog.appendChild(footer);

        backdrop.appendChild(dialog);

        // 4. 挂载独立顶置未保存浮动通知条
        const floatingNotice = createUnsavedFloatingNotice();
        backdrop.appendChild(floatingNotice.element);

        // 5. 挂载统一浮层宿主
        OverlayHost.getInstance().mount(backdrop);

        // 动态装配 Sidebar Tabs
        const refreshTabs = () => {
            sidebar.innerHTML = '';
            const allTabs = this._uiRegistry.getTabs();
            const provider = this._store.get('provider') || PROVIDERS.COMFYUI;
            const extState = this._store.get('extensions') || {};

            allTabs.forEach((tab) => {
                if (tab.id === CORE_TAB_IDS.COMFYUI && provider !== PROVIDERS.COMFYUI) return;
                if (tab.id === CORE_TAB_IDS.SDWEBUI && provider !== PROVIDERS.SDWEBUI) return;
                if (tab.id === CORE_TAB_IDS.OPENAI && provider !== PROVIDERS.OPENAI) return;
                if (tab.id === CORE_TAB_IDS.NOVELAI && provider !== PROVIDERS.NOVELAI) return;

                if (tab.id === 'character-manager' && extState['character-manager']?.enabled === false) return;

                const itemBtn = document.createElement('button');
                itemBtn.className = `da-tab-item da-sidebar-item ${tab.id === this._activeTabId ? 'active da-sidebar-item--active' : ''}`;
                itemBtn.setAttribute('role', 'tab');
                itemBtn.setAttribute('aria-selected', String(tab.id === this._activeTabId));
                itemBtn.id = `da-tab-btn-${tab.id}`;

                const icon = document.createElement('span');
                icon.className = 'da-tab-icon';
                icon.textContent = tab.icon || '';
                itemBtn.appendChild(icon);

                const label = document.createElement('span');
                label.className = 'da-tab-label';
                label.textContent = tab.title;
                itemBtn.appendChild(label);

                const isTabDirty = FeedbackService.unsavedStateManager.getDirtyProviders().some((p) => p.tabId === tab.id);
                if (isTabDirty) {
                    const dirtyDot = document.createElement('span');
                    dirtyDot.className = 'da-tab-dirty-dot';
                    dirtyDot.title = '此面板有尚未落盘的更改';
                    itemBtn.appendChild(dirtyDot);
                }

                itemBtn.addEventListener('click', () => {
                    void this.switchTab(tab.id, contentArea);
                });

                sidebar.appendChild(itemBtn);
            });
        };

        refreshTabs();

        const unsavedUnsub = FeedbackService.unsavedStateManager.subscribeStateChange(() => {
            refreshTabs();
        });

        const providerSub = this._store.subscribeKey('provider', (newProvider) => {
            refreshTabs();
            const providerTabIds: string[] = [CORE_TAB_IDS.COMFYUI, CORE_TAB_IDS.SDWEBUI, CORE_TAB_IDS.OPENAI, CORE_TAB_IDS.NOVELAI];
            if (providerTabIds.includes(this._activeTabId) && this._activeTabId !== newProvider) {
                void this.switchTab(newProvider || CORE_TAB_IDS.GENERAL, contentArea);
            }
        });

        const extensionsSub = this._store.subscribeKey('extensions', (exts) => {
            refreshTabs();
            if (this._activeTabId === 'character-manager' && exts?.['character-manager']?.enabled === false) {
                void this.switchTab(CORE_TAB_IDS.GENERAL, contentArea);
            }
        });

        this._activeTabId = initialTabId || CORE_TAB_IDS.GENERAL;
        void this.switchTab(this._activeTabId, contentArea);

        TelemetryService.start(footer, this._store, this._drivers);

        backdrop.addEventListener('click', () => void this.close());

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._modalHandle) {
                if (!document.querySelector('.da-dialog-panel') && !document.querySelector('.da-cropper-backdrop')) {
                    void this.close();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);

        backdrop.dataset.showHelp = String(this._store.get('showHelp') !== false);
        const showHelpSub = this._store.subscribeKey('showHelp', (val) => {
            backdrop.dataset.showHelp = String(val !== false);
        });

        this._modalHandle = this._modalService.open(backdrop, {
            onClose: () => {
                window.removeEventListener('keydown', onKeyDown);
                unsavedUnsub();
                providerSub.dispose();
                extensionsSub.dispose();
                showHelpSub.dispose();
                floatingNotice.dispose();
                OverlayHost.getInstance().dispose();
                TelemetryService.stop();
                this._currentTabDisposable?.dispose();
                this._currentTabDisposable = undefined;
                this._sidebarEl = undefined;
                this._modalHandle = undefined;
            }
        });
    }

    private renderHeaderBar(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'da-header-bar';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'da-header-left';

        const appName = document.createElement('span');
        appName.className = 'da-header-title';
        appName.innerHTML = '✨ Starlight DrawAssistant';

        const versionBadge = document.createElement('span');
        versionBadge.className = 'da-header-version-badge';
        versionBadge.textContent = `V${this._version}`;

        headerLeft.appendChild(appName);
        headerLeft.appendChild(versionBadge);

        const headerRight = document.createElement('div');
        headerRight.className = 'da-header-right';

        const quickThemeSelect = document.createElement('select');
        quickThemeSelect.id = 'da-quick-theme-select';
        quickThemeSelect.className = 'da-select da-quick-theme-select';
        quickThemeSelect.title = '快速切换界面主题';

        const populateThemeOptions = () => {
            const themes = this._store.get('customThemes') || [];
            quickThemeSelect.innerHTML = '';
            if (themes.length === 0) {
                const opt = document.createElement('option');
                opt.value = 'luminous-obsidian';
                opt.textContent = '流光黑曜';
                quickThemeSelect.appendChild(opt);
            } else {
                themes.forEach((t) => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.name;
                    quickThemeSelect.appendChild(opt);
                });
            }
            quickThemeSelect.value = this._store.get('themePreset') || themes[0]?.id || 'luminous-obsidian';
        };

        populateThemeOptions();

        quickThemeSelect.onchange = () => {
            const val = quickThemeSelect.value;
            this._store.set('themePreset', val);
            const customThemes = this._store.get('customThemes') || [];
            const found = customThemes.find((t) => t.id === val);
            if (found?.data) {
                ThemeService.applyThemeVariables(found.data);
            }
        };

        this._disposables.add(
            this._store.subscribeKey('themePreset', (val) => {
                const targetVal = val || 'luminous-obsidian';
                if (quickThemeSelect.value !== targetVal) {
                    quickThemeSelect.value = targetVal;
                }
            })
        );
        this._disposables.add(
            this._store.subscribeKey('customThemes', () => {
                populateThemeOptions();
            })
        );

        const actionsBtn = document.createElement('button');
        actionsBtn.className = 'da-icon-btn';
        actionsBtn.title = '全局设置与帮助菜单';
        actionsBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';

        const menuDropdown = document.createElement('div');
        menuDropdown.className = 'da-modal-dropdown-menu';
        menuDropdown.style.display = 'none';

        const createMenuItem = (iconHtml: string, text: string, onClick: () => void) => {
            const item = document.createElement('div');
            item.className = 'da-modal-dropdown-item';
            item.innerHTML = `${iconHtml} <span>${text}</span>`;
            item.onclick = (e) => {
                e.stopPropagation();
                menuDropdown.style.display = 'none';
                onClick();
            };
            return item;
        };

        menuDropdown.appendChild(createMenuItem('<i class="fa-solid fa-circle-question"></i>', '使用帮助与版本日志', () => {
            const contentArea = document.getElementById('da-modal-content-area');
            if (contentArea) {
                void this.switchTab(CORE_TAB_IDS.ABOUT, contentArea);
            }
        }));

        menuDropdown.appendChild(createMenuItem('<i class="fa-solid fa-download"></i>', '导出全量设置 JSON', () => {
            const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this._store.getState(), null, 2));
            const dl = document.createElement('a');
            dl.setAttribute('href', dataStr);
            dl.setAttribute('download', `st-drawassistant-settings-v${this._version}.json`);
            dl.click();
        }));

        menuDropdown.appendChild(createMenuItem('<i class="fa-solid fa-upload"></i>', '导入全量设置 JSON', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.onchange = () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const parsed = JSON.parse(ev.target?.result as string);
                        this._store.update(parsed);
                        FeedbackService.toastSuccess('全量设置已成功恢复导入！');
                    } catch {
                        FeedbackService.toastError('配置文件格式错误，导入失败');
                    }
                };
                reader.readAsText(file);
            };
            fileInput.click();
        }));

        menuDropdown.appendChild(createMenuItem('<i class="fa-solid fa-rotate-left"></i>', '重置全量扩展设置', async () => {
            const confirmed = await FeedbackService.confirm({
                title: '重置全量设置确认',
                message: '确定要将 ST-DrawAssistant 的全量配置恢复为出厂示范配置吗？此操作将重置所有生图参数、主题配色与工作流映射。',
                confirmText: '确认重置',
                isDangerous: true
            });
            if (confirmed) {
                const defaults = createDefaultSettings();
                this._store.reset(defaults);
                ThemeService.applyThemeVariables(defaults.customThemes?.[0]?.data || DEFAULT_THEME_DATA);
                await hydrateSettingsFromPresets(this._store, true);
                FeedbackService.toastSuccess('全量设置已成功恢复为出厂示范配置！');
                const contentArea = document.getElementById('da-modal-content-area');
                if (contentArea) {
                    void this.switchTab(this._activeTabId, contentArea);
                }
            }
        }));

        actionsBtn.onclick = (e) => {
            e.stopPropagation();
            menuDropdown.style.display = menuDropdown.style.display === 'block' ? 'none' : 'block';
        };

        document.addEventListener('click', () => {
            menuDropdown.style.display = 'none';
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'da-close-red-dot';
        closeBtn.title = '关闭设置面板';
        closeBtn.onclick = () => void this.close();

        headerRight.appendChild(quickThemeSelect);
        headerRight.appendChild(actionsBtn);
        headerRight.appendChild(menuDropdown);
        headerRight.appendChild(closeBtn);

        header.appendChild(headerLeft);
        header.appendChild(headerRight);
        return header;
    }

    private renderFooterBar(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'da-footer-bar';
        footer.innerHTML = `
            <div class="da-status-item" id="da-server-status-container" title="点击重新检测连接">
                <span class="da-status-dot da-status-checking" id="da-server-status-dot"></span>
                <span class="da-status-info" id="da-server-status-text">检测服务器连接中...</span>
            </div>
            <div class="da-status-item da-memory-info" id="da-memory-status-container">
                <span class="da-status-info" id="da-memory-status-text">JS Heap: 0.0 MB</span>
            </div>
        `;

        const serverStatusContainer = footer.querySelector('#da-server-status-container');
        serverStatusContainer?.addEventListener('click', () => {
            void TelemetryService.probeServer();
        });

        return footer;
    }

    public async switchTab(tabId: string, container: HTMLElement): Promise<boolean> {
        if (tabId !== this._activeTabId) {
            const decision = await FeedbackService.unsavedStateManager.checkUnsavedBeforeAction('切换选项卡');
            if (decision === 'cancel') {
                return false;
            }
        }

        this._currentTabDisposable?.dispose();
        this._currentTabDisposable = undefined;

        container.innerHTML = '';
        this._activeTabId = tabId;

        if (this._sidebarEl) {
            this._sidebarEl.querySelectorAll('.da-tab-item').forEach((btn) => {
                const isCurrent = btn.id === `da-tab-btn-${tabId}`;
                btn.classList.toggle('active', isCurrent);
                btn.setAttribute('aria-selected', String(isCurrent));
            });
        }

        const tab = this._uiRegistry.getTab(tabId);

        if (!tab) {
            const placeholder = document.createElement('div');
            placeholder.className = 'da-section-card da-tab-placeholder';
            placeholder.textContent = `Tab [${tabId}] 暂未挂载`;
            container.appendChild(placeholder);
            return true;
        }

        const pane = document.createElement('div');
        pane.className = 'da-tab-pane';
        const res = tab.render(pane);
        container.appendChild(pane);

        if (res && typeof res.dispose === 'function') {
            this._currentTabDisposable = res;
        }
        return true;
    }

    public async close(): Promise<boolean> {
        const decision = await FeedbackService.unsavedStateManager.checkUnsavedBeforeAction('关闭设置面板');
        if (decision === 'cancel') {
            return false;
        }
        this._modalHandle?.dispose();
        return true;
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        TelemetryService.stop();
        this._disposables.dispose();
        this._modalHandle?.dispose();
    }
}
