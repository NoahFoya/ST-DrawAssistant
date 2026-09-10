/**
 * 主设置弹窗控制器 (SettingsModal)
 * 负责主设置界面的 DOM 结构组装（顶栏、侧边栏、内容区与底栏），
 * 协调选项卡的渲染、切换与销毁清理，并监听配置变更同步界面提示。
 */

import { IDisposable, DisposableStore } from '../../types';
import { SettingsStore } from '../../state';
import { DriverRegistry } from '../../services/drivers';
import { IModalService } from './modal-service';
import { IUIRegistry, ThemeService, TelemetryService, OverlayHost } from '../foundation';
import { createVersionBadge } from '../components';
import { createUnsavedFloatingNotice } from './unsaved-floating-notice';
import { FeedbackService } from '../feedback/feedback';

/** 侧边栏内置标准 SVG 矢量图标字典 (Feather 图标规范) */
export const TAB_SVG_ICONS: Record<string, string> = {
    general: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    comfyui: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>`,
    sdwebui: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>`,
    cloud: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>`,
    openai: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>`,
    novelai: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path><line x1="16" y1="8" x2="2" y2="22"></line><line x1="17.5" y1="15" x2="9" y2="15"></line></svg>`,
    theme: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z"></path></svg>`,
    fab: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line></svg>`,
    logs: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    gallery: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
    about: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
};

export const DEFAULT_TAB_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;

/** 后端专属配置 Tab 标识集合 */
export const BACKEND_TAB_IDS = new Set<string>(['comfyui', 'sdwebui', 'novelai', 'openai']);

/**
 * 主设置弹窗初始化依赖配置项
 */
export interface SettingsModalOptions {
    /** 选项卡插槽注册表 */
    uiRegistry: IUIRegistry;
    /** 弹窗宿主服务 */
    modalService: IModalService;
    /** 插件设置存储 */
    store: SettingsStore;
    /** 生图引擎驱动注册中心 (可选，用于底栏活动驱动连接状态与心跳探测) */
    drivers?: DriverRegistry;
    /** 插件发布版本号 (可选) */
    version?: string;
}

/**
 * 主设置面板弹窗控制器
 */
export class SettingsModal implements IDisposable {
    private readonly _uiRegistry: IUIRegistry;
    private readonly _modalService: IModalService;
    private readonly _store: SettingsStore;
    private readonly _drivers?: DriverRegistry;
    private readonly _disposables = new DisposableStore();

    private _modalHandle?: IDisposable;
    private _activeTabId = 'general';
    private _isEnginesExpanded = false;
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

    /**
     * 打开主设置弹窗
     *
     * @param initialTabId 初始默认激活的选项卡标识（缺省为通用设置 'general'）
     */
    public open(initialTabId?: string): void {
        if (this._modalHandle || typeof document === 'undefined') return;

        // 背景遮罩容器
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.id = 'da-main-modal-backdrop';
        backdrop.setAttribute('data-da-show-help', String(this._store.get('showHelp') !== false));

        // 主设置面板对话框
        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-main-modal-inner';
        dialog.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 组装顶栏
        const header = this.renderHeaderBar();
        dialog.appendChild(header);

        // 挂载未保存修改提醒条
        const floatingNotice = createUnsavedFloatingNotice();
        dialog.appendChild(floatingNotice.element);

        // 主体双栏容器
        const bodyContainer = document.createElement('div');
        bodyContainer.className = 'da-modal-body';

        const sidebar = document.createElement('div');
        sidebar.className = 'da-sidebar-tabs';
        sidebar.setAttribute('role', 'tablist');
        this._sidebarEl = sidebar;

        const contentArea = document.createElement('div');
        contentArea.className = 'da-modal-content';
        contentArea.id = 'da-modal-content-area';
        contentArea.setAttribute('role', 'tabpanel');
        this._contentAreaEl = contentArea;

        bodyContainer.appendChild(sidebar);
        bodyContainer.appendChild(contentArea);
        dialog.appendChild(bodyContainer);

        // 组装底栏
        const footer = this.renderFooterBar();
        dialog.appendChild(footer);

        backdrop.appendChild(dialog);

        // 挂载浮层宿主容器并同步当前主题
        OverlayHost.getInstance().mount(backdrop);
        // 初始化渲染侧边栏
        this.refreshSidebarTabs();

        // 订阅未保存状态变更以实时刷新侧边栏红点
        const unsavedUnsub = FeedbackService.unsavedStateManager.subscribeStateChange(() => {
            this.refreshSidebarTabs();
        });

        // 监听生图引擎切换：自动同步刷新侧边栏指示徽标
        const providerSub = this._store.subscribeKey('activeProvider', () => {
            this.refreshSidebarTabs();
        });

        // 监听主题与辅助提示显隐变更
        const themeSub = this._store.subscribeKey('themePreset', () => {
            ThemeService.applyCurrentThemeToNode(backdrop);
        });
        const helpSub = this._store.subscribeKey('showHelp', (val) => {
            backdrop.setAttribute('data-da-show-help', String(val !== false));
        });

        // 激活初始面板
        this._activeTabId = initialTabId || 'general';
        void this.switchTab(this._activeTabId, contentArea);

        // 启动后台遥测
        TelemetryService.start(footer, this._store, this._drivers);

        // 遮罩点击关闭处理
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                void this.close();
            }
        });

        // Escape 快捷键监听：顶层无对话框时关闭主弹窗
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._modalHandle) {
                if (!document.querySelector('.da-dialog-panel') && !document.querySelector('.da-cropper-backdrop')) {
                    void this.close();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);

        // 注册至弹窗服务，并在弹窗关闭时释放相关资源
        this._modalHandle = this._modalService.open(backdrop, {
            closeOnBackdrop: false,
            closeOnEscape: false,
            onClose: () => {
                if (typeof window !== 'undefined') {
                    window.removeEventListener('keydown', onKeyDown);
                }
                unsavedUnsub();
                floatingNotice.dispose();
                providerSub.dispose();
                themeSub.dispose();
                helpSub.dispose();
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
        appName.innerHTML = `<span class="da-header-icon"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span> Starlight DrawAssistant`;

        const versionBadge = createVersionBadge({
            onClick: () => {
                void this.switchTab('about');
            }
        });
        this._disposables.add(versionBadge);

        headerLeft.appendChild(appName);
        headerLeft.appendChild(versionBadge);

        const headerRight = document.createElement('div');
        headerRight.className = 'da-header-right';

        // 快捷主题切换下拉框
        const quickThemeSelector = document.createElement('div');
        quickThemeSelector.className = 'da-quick-theme-selector';
        quickThemeSelector.title = '快速切换界面主题配色';

        const quickThemeSelect = document.createElement('select');
        quickThemeSelect.id = 'da-quick-theme-select';
        quickThemeSelect.className = 'da-quick-theme-select';
        quickThemeSelect.title = '快速切换界面主题配色';

        const populateThemeOptions = () => {
            const registered = ThemeService.getRegisteredThemes();
            quickThemeSelect.innerHTML = '';
            if (registered.length === 0) {
                const optDark = document.createElement('option');
                optDark.value = 'dark';
                optDark.textContent = '深色夜间';
                const optLight = document.createElement('option');
                optLight.value = 'light';
                optLight.textContent = '明亮日间';
                quickThemeSelect.appendChild(optDark);
                quickThemeSelect.appendChild(optLight);
            } else {
                registered.forEach((t) => {
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

        quickThemeSelector.appendChild(quickThemeSelect);

        // 关闭按钮 (SVG 矢量图标)
        const closeBtn = document.createElement('button');
        closeBtn.className = 'da-btn da-icon-btn da-modal-close-btn';
        closeBtn.title = '关闭设置面板 (Esc)';
        closeBtn.setAttribute('aria-label', '关闭设置面板');
        closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        closeBtn.onclick = () => {
            void this.close();
        };

        headerRight.appendChild(quickThemeSelector);
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
     * 动态渲染与刷新侧边栏导航选项卡列表
     * 生图引擎平权列出；收拢态下仅展示代表引擎，展开态下列出全部平级引擎。
     * 支持双击或微型指示器切换展开/收拢；点击任意引擎纯粹切换查看，不强改默认引擎。
     */
    private refreshSidebarTabs(): void {
        if (!this._sidebarEl) return;
        this._sidebarEl.innerHTML = '';
        const allTabs = this._uiRegistry.getTabs();
        const activeProvider = (this._store.get('activeProvider') || 'comfyui').toLowerCase();
        const dirtyProviders = FeedbackService.unsavedStateManager.getDirtyProviders();

        // 确定收拢态下代表展示的引擎 Tab：
        // 若当前选中的 Tab 正是某个生图引擎，展示该当前引擎；否则展示全局默认引擎 activeProvider
        const currentTabLower = this._activeTabId.toLowerCase();
        const representativeEngineId = BACKEND_TAB_IDS.has(currentTabLower)
            ? currentTabLower
            : activeProvider;

        allTabs.forEach((tab) => {
            const tabIdLower = tab.id.toLowerCase();
            const isEngineTab = BACKEND_TAB_IDS.has(tabIdLower);
            const isTabDirty = dirtyProviders.some((p) => p.tabId === tab.id);

            // 当引擎列表处于收拢态时，只渲染代表当前视角的单个引擎 Tab
            if (isEngineTab && !this._isEnginesExpanded && tabIdLower !== representativeEngineId) {
                return;
            }

            // 在系统设置与工具区之前插入语义分割线
            if (tabIdLower === 'theme') {
                const divider = document.createElement('div');
                divider.className = 'da-sidebar-divider';
                this._sidebarEl!.appendChild(divider);
            }

            const isActive = tab.id === this._activeTabId;
            const itemBtn = document.createElement('button');
            itemBtn.className = `da-sidebar-item ${isActive ? 'da-sidebar-item--active' : ''}`;
            itemBtn.setAttribute('role', 'tab');
            itemBtn.setAttribute('aria-selected', String(isActive));
            itemBtn.id = `da-tab-btn-${tab.id}`;

            const icon = document.createElement('span');
            icon.className = 'da-sidebar-item__icon';
            if (tab.icon && tab.icon.includes('<svg')) {
                icon.innerHTML = tab.icon;
            } else {
                const svgContent = TAB_SVG_ICONS[tabIdLower] || DEFAULT_TAB_SVG;
                icon.innerHTML = svgContent;
            }
            itemBtn.appendChild(icon);

            const label = document.createElement('span');
            label.className = 'da-sidebar-item__label';
            label.textContent = tab.title;
            itemBtn.appendChild(label);

            // 未保存修改指示圆点
            if (isTabDirty) {
                const dirtyDot = document.createElement('span');
                dirtyDot.className = 'da-sidebar-item__dirty-dot';
                dirtyDot.title = '此面板有未保存的修改';
                itemBtn.appendChild(dirtyDot);
            }

            // 生图引擎选项卡的收拢/展开控制
            if (isEngineTab) {
                // 展开/收拢指示器：
                // 收拢态下展示在代表引擎右侧；展开态下展示在当前选中（或代表）引擎右侧
                const shouldShowTrigger = !this._isEnginesExpanded
                    ? tabIdLower === representativeEngineId
                    : isActive;

                if (shouldShowTrigger) {
                    const trigger = document.createElement('span');
                    trigger.className = `da-sidebar-item__expand-trigger ${this._isEnginesExpanded ? 'is-expanded' : ''}`;
                    trigger.title = this._isEnginesExpanded ? '收起其他生图引擎' : '展开更多生图引擎';
                    trigger.setAttribute('aria-label', trigger.title);
                    trigger.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

                    trigger.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._isEnginesExpanded = !this._isEnginesExpanded;
                        this.refreshSidebarTabs();
                    });
                    itemBtn.appendChild(trigger);
                }
            }

            // 单击事件：未激活时切换视图；已激活的当前引擎 Tab 再次点击直接切换折叠/展开
            itemBtn.addEventListener('click', () => {
                if (isEngineTab && isActive) {
                    this._isEnginesExpanded = !this._isEnginesExpanded;
                    this.refreshSidebarTabs();
                } else {
                    void this.switchTab(tab.id);
                }
            });

            this._sidebarEl!.appendChild(itemBtn);
        });
    }

    /**
     * 切换主弹窗的内容选项卡 (Tab)
     */
    public async switchTab(tabId: string, container?: HTMLElement): Promise<boolean> {
        const targetContainer = container || this._contentAreaEl || (typeof document !== 'undefined' ? (document.getElementById('da-modal-content-area') as HTMLElement) : null);
        if (!targetContainer) return false;

        // 若切换至不同选项卡，先行校验未保存草稿与修改
        if (tabId !== this._activeTabId) {
            const decision = await FeedbackService.unsavedStateManager.checkUnsavedBeforeAction('切换选项卡');
            if (decision === 'cancel') {
                return false;
            }
        }

        // 释放旧选项卡实例并清理浮层
        this._currentTabDisposable?.dispose();
        this._currentTabDisposable = undefined;
        OverlayHost.getInstance().dismissAll();

        // 重置容器内容与滚动条
        targetContainer.innerHTML = '';
        targetContainer.scrollTop = 0;
        this._activeTabId = tabId;

        // 同步刷新侧边栏全部 DOM 状态与选中高亮
        this.refreshSidebarTabs();

        // 渲染目标选项卡视图
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
     * 关闭设置面板
     */
    public async close(): Promise<boolean> {
        const decision = await FeedbackService.unsavedStateManager.checkUnsavedBeforeAction('关闭设置');
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
