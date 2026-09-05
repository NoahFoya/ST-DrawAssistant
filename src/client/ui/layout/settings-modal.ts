/**
 * @module ui/layout/settings-modal
 * @description 主设置弹窗控制器 (SettingsModal)
 *
 * 核心职责：
 * 1. 负责主设置界面的 DOM 结构组装（顶栏 Header、侧边栏 Sidebar、内容区 ContentArea、底栏 Footer）；
 * 2. 调度多选项卡（Tab）的动态注册渲染、激活切换与生命周期受管销毁（IDisposable）；
 * 3. 协调顶置未保存修改通知条（UnsavedFloatingNotice）与操作拦截确认机制；
 * 4. 绑定全局主题样式分发（ThemeService）与运行监控遥测（TelemetryService）。
 */

import {
    ConfigStore,
    IDisposable,
    DisposableStore
} from '../../core';
import { AdapterRegistry } from '../../domain/drivers/adapter-registry';
import { IModalService } from './modal-service';
import { IUIRegistry } from '../foundation/ui-registry';
import { ThemeService } from '../foundation/theme-service';
import { TelemetryService } from '../foundation/telemetry-service';
import { FeedbackService } from '../feedback/feedback';
import { createUnsavedFloatingNotice } from './unsaved-floating-notice';
import { OverlayHost } from '../foundation/overlay-host';
import { createVersionCapsule } from '../controls/version-capsule';

/** 后端专属配置 Tab 标识集合 */
export const BACKEND_TAB_IDS = new Set<string>(['comfyui', 'sdwebui', 'novelai', 'cloud']);

/**
 * 主设置弹窗初始化依赖配置项
 */
export interface SettingsModalOptions {
    /** 选项卡插槽注册中心 */
    uiRegistry: IUIRegistry;
    /** 全局模态弹窗堆栈管理服务 */
    modalService: IModalService;
    /** 全局响应式配置存储 */
    store: ConfigStore;
    /** 生图引擎适配器注册中心 (可选，供系统诊断面板检测连通性) */
    adapters?: AdapterRegistry;
    /** 插件发布版本号 (可选) */
    version?: string;
}

/**
 * 主设置面板弹窗控制器
 */
export class SettingsModal implements IDisposable {
    private readonly _uiRegistry: IUIRegistry;
    private readonly _modalService: IModalService;
    private readonly _store: ConfigStore;
    private readonly _adapters?: AdapterRegistry;
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
        this._adapters = options.adapters;
    }

    /**
     * 打开主设置弹窗
     *
     * @param initialTabId 初始默认激活的选项卡标识（缺省为通用设置 'general'）
     */
    public open(initialTabId?: string): void {
        if (this._modalHandle || typeof document === 'undefined') return;

        // 1. 构建全屏模态背景遮罩
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.id = 'da-main-modal-backdrop';

        // 2. 构建主设置面板容器
        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-main-modal-inner';
        dialog.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 3. 组装顶栏 (Header)
        const header = this.renderHeaderBar();
        dialog.appendChild(header);

        // 4. 组装主体容器 (Body: Sidebar + ContentArea)
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

        // 5. 组装底栏 (Footer)
        const footer = this.renderFooterBar();
        dialog.appendChild(footer);

        backdrop.appendChild(dialog);

        // 6. 挂载独立顶置未保存修改通知条
        const floatingNotice = createUnsavedFloatingNotice();
        backdrop.appendChild(floatingNotice.element);

        // 7. 挂载统一浮层宿主容器并注入当前激活主题配色
        OverlayHost.getInstance().mount(backdrop);
        ThemeService.applyCurrentThemeToNode(backdrop);

        // 8. 动态渲染侧边栏 Tab 列表
        const refreshTabs = () => {
            sidebar.innerHTML = '';
            const allTabs = this._uiRegistry.getTabs();
            const activeProvider = (this._store.get('activeProvider') || 'comfyui').toLowerCase();

            allTabs.forEach((tab) => {
                // 若为后端专有 Tab，仅展示当前激活的生图后端
                if (BACKEND_TAB_IDS.has(tab.id.toLowerCase()) && tab.id.toLowerCase() !== activeProvider) {
                    return;
                }

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

                // 若当前 Tab 存在未保存草稿，渲染红点标识
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

        // 9. 绑定未保存状态变更订阅
        const unsavedUnsub = FeedbackService.unsavedStateManager.subscribeStateChange(() => {
            refreshTabs();
        });

        // 10. 绑定生图引擎切换订阅：自动更新侧边栏并切换专属配置面板
        const providerSub = this._store.subscribeKey('activeProvider', (newProvider) => {
            refreshTabs();
            const currentProvider = String(newProvider || '').toLowerCase();
            if (BACKEND_TAB_IDS.has(this._activeTabId.toLowerCase()) && this._activeTabId.toLowerCase() !== currentProvider) {
                void this.switchTab(currentProvider || 'general', contentArea);
            }
        });

        // 11. 绑定主题变更订阅
        const themeSub = this._store.subscribeKey('themePreset', () => {
            ThemeService.applyCurrentThemeToNode(backdrop);
        });

        // 12. 激活初始 Tab 面板
        this._activeTabId = initialTabId || 'general';
        void this.switchTab(this._activeTabId, contentArea);

        // 13. 启动后台遥测监控
        TelemetryService.start(footer, this._store, this._adapters);

        // 14. 点击背景遮罩关闭面板
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                void this.close();
            }
        });

        // 15. 键盘 Esc 快捷关闭监听
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._modalHandle) {
                if (!document.querySelector('.da-dialog-panel') && !document.querySelector('.da-cropper-backdrop')) {
                    void this.close();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);

        // 16. 委托给模态弹窗堆栈服务管理，并注册关闭时的级联资源释放逻辑
        this._modalHandle = this._modalService.open(backdrop, {
            closeOnBackdrop: false,
            closeOnEscape: false,
            onClose: () => {
                if (typeof window !== 'undefined') {
                    window.removeEventListener('keydown', onKeyDown);
                }
                unsavedUnsub();
                providerSub.dispose();
                themeSub.dispose();
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

    /**
     * 构建弹窗顶栏组件 (Header Bar)
     */
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
                void this.switchTab('about');
            }
        });
        this._disposables.add(versionCapsule);

        headerLeft.appendChild(appName);
        headerLeft.appendChild(versionCapsule);

        const headerRight = document.createElement('div');
        headerRight.className = 'da-header-right';

        // 快捷主题切换胶囊下拉框
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
                const optDark = document.createElement('option');
                optDark.value = 'dark';
                optDark.textContent = '深色夜间';
                const optLight = document.createElement('option');
                optLight.value = 'light';
                optLight.textContent = '明亮日间';
                quickThemeSelect.appendChild(optDark);
                quickThemeSelect.appendChild(optLight);
            } else {
                themes.forEach((t) => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.name;
                    quickThemeSelect.appendChild(opt);
                });
            }
            quickThemeSelect.value = this._store.get('themePreset') || 'dark';
        };

        populateThemeOptions();

        quickThemeSelect.onchange = () => {
            const val = quickThemeSelect.value;
            this._store.set('themePreset', val);
            if (typeof document !== 'undefined') {
                ThemeService.applyCurrentThemeToNode(document.documentElement);
            }
        };

        this._disposables.add(
            this._store.subscribeKey('themePreset', (val) => {
                const targetVal = val || 'dark';
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

        // 关闭按钮
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

    /**
     * 构建弹窗底栏组件 (Footer Bar)
     */
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
     */
    public async switchTab(tabId: string, container?: HTMLElement): Promise<boolean> {
        const targetContainer = container || this._contentAreaEl || (typeof document !== 'undefined' ? (document.getElementById('da-modal-content-area') as HTMLElement) : null);
        if (!targetContainer) return false;

        // 1. 校验未保存修改
        if (tabId !== this._activeTabId) {
            const decision = await FeedbackService.unsavedStateManager.checkUnsavedBeforeAction('切换选项卡');
            if (decision === 'cancel') {
                return false;
            }
        }

        // 2. 释放旧 Tab 实例与浮层气泡
        this._currentTabDisposable?.dispose();
        this._currentTabDisposable = undefined;
        OverlayHost.getInstance().dismissAll();

        // 3. 重置容器内容与滚动条位置
        targetContainer.innerHTML = '';
        targetContainer.scrollTop = 0;
        this._activeTabId = tabId;

        // 4. 同步侧边栏激活状态类名与无障碍属性
        if (this._sidebarEl) {
            this._sidebarEl.querySelectorAll('.da-sidebar-item').forEach((btn) => {
                const isCurrent = btn.id === `da-tab-btn-${tabId}`;
                btn.classList.toggle('da-sidebar-item--active', isCurrent);
                btn.setAttribute('aria-selected', String(isCurrent));
            });
        }

        // 5. 获取并渲染新 Tab 视图
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

    /**
     * 关闭设置面板（包含未保存草稿确认拦截）
     */
    public async close(): Promise<boolean> {
        const decision = await FeedbackService.unsavedStateManager.checkUnsavedBeforeAction('关闭设置面板');
        if (decision === 'cancel') {
            return false;
        }
        this._modalHandle?.dispose();
        return true;
    }

    /**
     * 释放设置面板持有的所有全局订阅与后台服务
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        TelemetryService.stop();
        this._disposables.dispose();
        this._modalHandle?.dispose();
    }
}
