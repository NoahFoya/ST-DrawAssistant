/**
 * @module ui/layout/settings-modal
 * @description 主设置弹窗控制器 (SettingsModal)
 */

import {
    IUIRegistry,
    ObservableStore,
    DrawAssistantSettings,
    IDriverRegistry,
    IDisposable,
    DisposableStore,
    CORE_TAB_IDS,
    PROVIDERS
} from '../../core';
import { UpdateService } from '../../domain';
import { IModalService } from './modal-service';
import { ThemeService } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { TelemetryService } from '../foundation/telemetry-service';
import { createUnsavedFloatingNotice } from './unsaved-floating-notice';
import { OverlayHost } from '../foundation/overlay-host';
import { createVersionCapsule } from '../controls/version-capsule';

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
    private readonly _disposables = new DisposableStore();

    private _modalHandle?: IDisposable;
    private _activeTabId = 'general';
    private _sidebarEl?: HTMLElement;
    private _contentAreaEl?: HTMLElement;
    private _currentTabDisposable?: IDisposable;
    private _isDisposed = false;

    constructor(options: SettingsModalOptions) {
        this._uiRegistry = options.uiRegistry;
        this._modalService = options.modalService;
        this._store = options.store;
        this._drivers = options.drivers;
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
        this._contentAreaEl = contentArea;

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

        // 5. 挂载统一浮层宿主并注入当前激活主题
        OverlayHost.getInstance().mount(backdrop);
        ThemeService.applyCurrentThemeToNode(backdrop);

        // 动态渲染侧边栏 Tab 列表
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
                itemBtn.className = `da-sidebar-item ${tab.id === this._activeTabId ? 'da-sidebar-item--active' : ''}`;
                itemBtn.setAttribute('role', 'tab');
                itemBtn.setAttribute('aria-selected', String(tab.id === this._activeTabId));
                itemBtn.id = `da-tab-btn-${tab.id}`;

                const icon = document.createElement('span');
                icon.className = 'da-sidebar-item__icon';
                icon.textContent = tab.icon || '';
                itemBtn.appendChild(icon);

                const label = document.createElement('span');
                label.className = 'da-sidebar-item__label';
                label.textContent = tab.title;
                itemBtn.appendChild(label);

                const isTabDirty = FeedbackService.unsavedStateManager.getDirtyProviders().some((p) => p.tabId === tab.id);
                if (isTabDirty) {
                    const dirtyDot = document.createElement('span');
                    dirtyDot.className = 'da-sidebar-item__dirty-dot';
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

        const themeSub = this._store.subscribeKey('themePreset', () => {
            ThemeService.applyCurrentThemeToNode(backdrop);
        });

        this._activeTabId = initialTabId || CORE_TAB_IDS.GENERAL;
        void this.switchTab(this._activeTabId, contentArea);

        TelemetryService.start(footer, this._store, this._drivers);
        void UpdateService.getInstance().checkUpdate();

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                void this.close();
            }
        });

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
                themeSub.dispose();
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

        const versionCapsule = createVersionCapsule({
            onClick: () => {
                void this.switchTab(CORE_TAB_IDS.ABOUT);
            }
        });
        this._disposables.add(versionCapsule);

        headerLeft.appendChild(appName);
        headerLeft.appendChild(versionCapsule);

        const headerRight = document.createElement('div');
        headerRight.className = 'da-header-right';

        const quickThemeCapsule = document.createElement('div');
        quickThemeCapsule.className = 'da-quick-theme-capsule';
        quickThemeCapsule.title = '快速切换界面主题配色';

        const quickThemeSelect = document.createElement('select');
        quickThemeSelect.id = 'da-quick-theme-select';
        quickThemeSelect.className = 'da-quick-theme-select';
        quickThemeSelect.title = '快速切换界面主题配色';

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

        quickThemeCapsule.appendChild(quickThemeSelect);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'da-btn da-icon-btn da-modal-close-btn';
        closeBtn.title = '关闭设置面板 (Esc)';
        closeBtn.setAttribute('aria-label', '关闭设置面板');
        closeBtn.innerHTML = '✕';
        closeBtn.onclick = () => {
            void this.close();
        };

        headerRight.appendChild(quickThemeCapsule);
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

    /**
     * 切换主弹窗的内容选项卡 (Tab)
     *
     * 处理逻辑：
     * 1. 检查是否存在未保存草稿，必要时拦截并提示用户确认；
     * 2. 清理上一个活动 Tab 的注册句柄 (IDisposable)；
     * 3. 彻底注销可能处于激活状态的帮助说明气泡 (OverlayHost.dismissAll)，防止浮层残留；
     * 4. 同步切换侧边栏高亮类名 (包含 active 与 da-sidebar-item--active)，根治样式残留；
     * 5. 重置内容区域滚动条至顶部 (scrollTop = 0)；
     * 6. 渲染并挂载新 Tab 视图。
     *
     * @param tabId 目标选项卡标识
     * @param container 内容承载区域 DOM 容器
     * @returns 是否成功完成切换
     */
    public async switchTab(tabId: string, container?: HTMLElement): Promise<boolean> {
        const targetContainer = container || this._contentAreaEl || (typeof document !== 'undefined' ? (document.getElementById('da-modal-content-area') as HTMLElement) : null);
        if (!targetContainer) return false;

        if (tabId !== this._activeTabId) {
            const decision = await FeedbackService.unsavedStateManager.checkUnsavedBeforeAction('切换选项卡');
            if (decision === 'cancel') {
                return false;
            }
        }

        // 1. 清理旧 Tab 句柄与全局活动浮层
        this._currentTabDisposable?.dispose();
        this._currentTabDisposable = undefined;
        OverlayHost.getInstance().dismissAll();

        // 2. 重置容器内容与滚动条位置
        targetContainer.innerHTML = '';
        targetContainer.scrollTop = 0;
        this._activeTabId = tabId;

        // 3. 同步侧边栏激活状态类名，杜绝样式残留
        if (this._sidebarEl) {
            this._sidebarEl.querySelectorAll('.da-sidebar-item').forEach((btn) => {
                const isCurrent = btn.id === `da-tab-btn-${tabId}`;
                btn.classList.toggle('da-sidebar-item--active', isCurrent);
                btn.setAttribute('aria-selected', String(isCurrent));
            });
        }

        const tab = this._uiRegistry.getTab(tabId);

        if (!tab) {
            const placeholder = document.createElement('div');
            placeholder.className = 'da-card da-tab-placeholder';
            placeholder.textContent = `Tab [${tabId}] 暂未挂载`;
            targetContainer.appendChild(placeholder);
            return true;
        }

        const res = tab.render(targetContainer);

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
