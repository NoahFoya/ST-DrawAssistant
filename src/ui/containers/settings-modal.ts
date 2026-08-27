/**
 * @module ui/containers/settings-modal
 * @description 主设置弹窗控制器 (SettingsModal - 包含导航侧边栏、视图插槽调度、顶部工具栏与底部状态栏)
 */

import { IUIRegistry, TabSlotDescriptor } from '../../core/registry/ui-registry';
import { IModalService } from '../services/modal-service';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable, DisposableStore } from '../../core/foundation/disposable';
import { DEFAULT_COMFYUI_URL, DEFAULT_SDWEBUI_URL } from '../../core/constants';

/**
 * 设置面板初始化参数选项
 */
export interface SettingsModalOptions {
    /** UI 贡献点注册中心 */
    uiRegistry: IUIRegistry;
    /** 全局模态框服务 */
    modalService: IModalService;
    /** 全局响应式状态配置中心 */
    store: ObservableStore<DrawAssistantSettings>;
    /** 插件当前版本号 */
    version?: string;
}

export class SettingsModal implements IDisposable {
    private readonly _uiRegistry: IUIRegistry;
    private readonly _modalService: IModalService;
    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _version: string;
    private readonly _disposables = new DisposableStore();

    private _modalHandle?: IDisposable;
    private _activeTabId = 'general';
    private _currentTabDisposable?: IDisposable;
    private _heartbeatTimer: number | null = null;
    private _memoryTimer: number | null = null;
    private _isDisposed = false;

    constructor(options: SettingsModalOptions) {
        this._uiRegistry = options.uiRegistry;
        this._modalService = options.modalService;
        this._store = options.store;
        this._version = options.version || '0.3.1';
    }

    public open(initialTabId?: string): void {
        if (this._modalHandle) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.id = 'da-main-modal-backdrop';

        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-main-modal-inner';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        // 1. 顶栏 (HeaderBar - 双行布局)
        const header = this.renderHeaderBar();
        dialog.appendChild(header);

        // 2. 主体容器 (Body Container = 左侧 Sidebar + 右侧 Content Area)
        const bodyContainer = document.createElement('div');
        bodyContainer.className = 'da-modal-body';

        const sidebar = document.createElement('div');
        sidebar.className = 'da-sidebar-tabs';

        const contentArea = document.createElement('div');
        contentArea.id = 'da-modal-content-area';
        contentArea.className = 'da-modal-content';
        contentArea.style.position = 'relative';

        // 顶置浮动未保存提示气泡
        const floatingBanner = document.createElement('div');
        floatingBanner.id = 'da-floating-unsaved-banner';
        floatingBanner.className = 'da-floating-unsaved-banner';
        floatingBanner.style.display = 'none';
        contentArea.appendChild(floatingBanner);

        bodyContainer.appendChild(sidebar);
        bodyContainer.appendChild(contentArea);
        dialog.appendChild(bodyContainer);

        // 3. 底栏 (FooterBar - 连通性心跳 + 内存开销监测)
        const footer = this.renderFooterBar();
        dialog.appendChild(footer);

        backdrop.appendChild(dialog);

        // 动态装配 Sidebar Tabs
        const refreshTabs = () => {
            sidebar.innerHTML = '';
            const allTabs = this._uiRegistry.getTabs();
            const provider = this._store.get('provider') || 'comfyui';

            const filteredTabs = allTabs.filter((t) => {
                if (t.id === 'comfyui' && provider !== 'comfyui') return false;
                if (t.id === 'sdwebui' && provider !== 'sdwebui') return false;
                return true;
            });

            // 规范中文标签映射
            const labelMap: Record<string, string> = {
                general: '主要',
                comfyui: 'ComfyUI',
                sdwebui: 'SD-WebUI',
                'character-manager': '角色管理',
                gallery: '图库',
                theme: '主题',
                'fab-settings': '悬浮窗',
                diagnostics: '日志与统计',
                about: '关于'
            };

            filteredTabs.forEach((tab: TabSlotDescriptor) => {
                const itemBtn = document.createElement('button');
                itemBtn.className = `da-sidebar-item ${tab.id === this._activeTabId ? 'da-sidebar-item--active' : ''}`;
                itemBtn.setAttribute('data-tab-id', tab.id);
                const displayLabel = labelMap[tab.id] || tab.title;
                itemBtn.innerHTML = `<span class="da-tab-label">${displayLabel}</span>`;
                itemBtn.onclick = () => {
                    this.switchTab(tab.id, contentArea);
                    refreshTabs();
                };
                sidebar.appendChild(itemBtn);
            });
        };

        refreshTabs();
        this._activeTabId = initialTabId || 'general';
        this.switchTab(this._activeTabId, contentArea);

        // 启动遥测监控
        this.startTelemetry(footer);

        // 点击背景遮罩安全关闭
        backdrop.addEventListener('click', () => this.close());

        // 全局 Esc 快捷键支持
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._modalHandle) {
                this.close();
            }
        };
        window.addEventListener('keydown', onKeyDown);

        this._modalHandle = this._modalService.open(backdrop, {
            onClose: () => {
                window.removeEventListener('keydown', onKeyDown);
                this.stopTelemetry();
                this._currentTabDisposable?.dispose();
                this._modalHandle = undefined;
            }
        });
    }

    private renderHeaderBar(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'da-header-bar';
        header.style.minHeight = '84px';
        header.style.display = 'flex';
        header.style.flexDirection = 'column';
        header.style.justifyContent = 'space-between';
        header.style.padding = '14px 22px 12px 22px';
        header.style.gap = '8px';
        header.style.borderBottom = '1px solid var(--da-border-color)';
        header.style.position = 'relative';

        // ── 行 1: SillyTavern 品牌 + macOS 红色关闭圆点 ──
        const row1 = document.createElement('div');
        row1.className = 'da-header-row da-header-row-1';
        row1.style.display = 'flex';
        row1.style.justifyContent = 'space-between';
        row1.style.alignItems = 'center';
        row1.style.width = '100%';

        const titleSt = document.createElement('span');
        titleSt.style.fontSize = '1.25em';
        titleSt.style.fontWeight = 'bold';
        titleSt.style.color = 'var(--da-text-primary)';
        titleSt.style.letterSpacing = '0.5px';
        titleSt.textContent = 'SillyTavern';
        row1.appendChild(titleSt);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'da-close-red-dot';
        closeBtn.title = '关闭设置面板';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => this.close();
        row1.appendChild(closeBtn);

        // ── 行 2: 扩展名称与版本徽章 + 快速主题切换 + 操作菜单 ──
        const row2 = document.createElement('div');
        row2.className = 'da-header-row da-header-row-2';
        row2.style.display = 'flex';
        row2.style.justifyContent = 'space-between';
        row2.style.alignItems = 'center';
        row2.style.width = '100%';

        const row2Left = document.createElement('div');
        row2Left.style.display = 'flex';
        row2Left.style.alignItems = 'center';
        row2Left.style.gap = '8px';

        const appName = document.createElement('span');
        appName.className = 'da-header-app-name';
        appName.textContent = '✨ Starlight DrawAssistant';

        const versionBadge = document.createElement('span');
        versionBadge.className = 'da-header-version-badge';
        versionBadge.textContent = `V${this._version}`;

        row2Left.appendChild(appName);
        row2Left.appendChild(versionBadge);

        const row2Right = document.createElement('div');
        row2Right.style.display = 'flex';
        row2Right.style.alignItems = 'center';
        row2Right.style.gap = '8px';
        row2Right.style.position = 'relative';

        // 顶栏快速主题切换器
        const quickThemeSelect = document.createElement('select');
        quickThemeSelect.id = 'da-quick-theme-select';
        quickThemeSelect.className = 'da-select da-quick-theme-select';
        quickThemeSelect.style.height = '32px';
        quickThemeSelect.style.fontSize = '0.85em';
        quickThemeSelect.style.minWidth = '110px';

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
            this._store.set('themePreset', quickThemeSelect.value);
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

        // 更多操作三点菜单
        const actionsBtn = document.createElement('button');
        actionsBtn.className = 'da-icon-btn';
        actionsBtn.title = '更多全局设置选项 (备份/恢复/重置)';
        actionsBtn.innerHTML = '⋮';
        actionsBtn.style.height = '32px';
        actionsBtn.style.width = '32px';

        const menuDropdown = document.createElement('div');
        menuDropdown.className = 'da-dropdown-menu';
        menuDropdown.style.display = 'none';
        menuDropdown.style.position = 'absolute';
        menuDropdown.style.top = '38px';
        menuDropdown.style.right = '0';
        menuDropdown.style.zIndex = '1000';

        const createMenuItem = (text: string, onClick: () => void) => {
            const item = document.createElement('div');
            item.className = 'da-dropdown-item';
            item.innerHTML = `<span>${text}</span>`;
            item.onclick = (e) => {
                e.stopPropagation();
                menuDropdown.style.display = 'none';
                onClick();
            };
            return item;
        };

        menuDropdown.appendChild(createMenuItem('📥 导出全量设置 JSON', () => {
            const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this._store.getState(), null, 2));
            const dl = document.createElement('a');
            dl.setAttribute('href', dataStr);
            dl.setAttribute('download', `st-drawassistant-settings-v${this._version}.json`);
            dl.click();
        }));

        menuDropdown.appendChild(createMenuItem('📤 导入全量设置 JSON', () => {
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
                        alert('全量设置已成功恢复导入！');
                    } catch {
                        alert('配置文件格式错误，导入失败');
                    }
                };
                reader.readAsText(file);
            };
            fileInput.click();
        }));

        menuDropdown.appendChild(createMenuItem('🔄 重置全量扩展设置', () => {
            if (confirm('确定要将 ST-DrawAssistant 的全量设置恢复到默认初始配置吗？')) {
                localStorage.removeItem('ST_DRAWASSISTANT_SETTINGS');
                location.reload();
            }
        }));

        actionsBtn.onclick = (e) => {
            e.stopPropagation();
            menuDropdown.style.display = menuDropdown.style.display === 'block' ? 'none' : 'block';
        };

        document.addEventListener('click', () => {
            menuDropdown.style.display = 'none';
        });

        row2Right.appendChild(quickThemeSelect);
        row2Right.appendChild(actionsBtn);
        row2Right.appendChild(menuDropdown);

        row2.appendChild(row2Left);
        row2.appendChild(row2Right);

        header.appendChild(row1);
        header.appendChild(row2);
        return header;
    }

    private renderFooterBar(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'da-footer-bar';
        footer.innerHTML = `
            <div class="da-status-item" id="da-server-status-container">
                <span class="da-status-dot da-status-checking"></span>
                <span class="da-status-info" id="da-server-status-text">检测服务器连接中...</span>
            </div>
            <div class="da-status-item da-memory-info" id="da-memory-status-container">
                <span class="da-status-dot da-status-ok"></span>
                <span class="da-status-info" id="da-memory-status-text">图片库缓存 0 张</span>
            </div>
        `;
        return footer;
    }

    private startTelemetry(footer: HTMLElement): void {
        const checkConn = async () => {
            const statusText = footer.querySelector<HTMLElement>('#da-server-status-text');
            const statusDot = footer.querySelector<HTMLElement>('.da-status-dot');
            if (!statusText || !statusDot) return;

            const provider = this._store.get('provider') || 'comfyui';
            const serverUrl = (this._store.get('serverUrl') || (provider === 'comfyui' ? DEFAULT_COMFYUI_URL : DEFAULT_SDWEBUI_URL)).replace(/\/+$/, '');
            const endpoint = provider === 'comfyui' ? '/system_stats' : '/sdapi/v1/options';
            const label = provider === 'comfyui' ? 'ComfyUI' : 'SD-WebUI';

            const start = performance.now();
            try {
                const res = await fetch(`${serverUrl}${endpoint}`, { signal: AbortSignal.timeout(4000) });
                const latency = Math.round(performance.now() - start);
                if (res.ok || res.status === 401 || res.status === 404) {
                    statusDot.className = 'da-status-dot da-status-ok';
                    statusText.textContent = `${label}: 已连通 (${serverUrl}) | ${latency}ms`;
                } else {
                    statusDot.className = 'da-status-dot da-status-error';
                    statusText.textContent = `${label}: 响应异常 (HTTP ${res.status})`;
                }
            } catch {
                statusDot.className = 'da-status-dot da-status-error';
                statusText.textContent = `${label}: 未连接 (${serverUrl})`;
            }
        };

        const updateMem = () => {
            const memText = footer.querySelector<HTMLElement>('#da-memory-status-text');
            if (!memText) return;
            const perf = window.performance as any;
            if (perf.memory && perf.memory.usedJSHeapSize) {
                const usedMB = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
                memText.textContent = `JS Heap: ${usedMB} MB`;
            } else {
                memText.textContent = `内存状态: 正常 (运行中)`;
            }
        };

        void checkConn();
        updateMem();

        this._heartbeatTimer = window.setInterval(() => void checkConn(), 10000);
        this._memoryTimer = window.setInterval(() => updateMem(), 3000);
    }

    private stopTelemetry(): void {
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        if (this._memoryTimer !== null) {
            clearInterval(this._memoryTimer);
            this._memoryTimer = null;
        }
    }

    public switchTab(tabId: string, container: HTMLElement): void {
        this._currentTabDisposable?.dispose();
        this._currentTabDisposable = undefined;

        // 清空内容区但保留悬浮气泡
        const banner = container.querySelector('#da-floating-unsaved-banner');
        container.innerHTML = '';
        if (banner) container.appendChild(banner);

        this._activeTabId = tabId;

        const tab = this._uiRegistry.getTab(tabId);
        if (!tab) {
            const placeholder = document.createElement('div');
            placeholder.className = 'da-section-card';
            placeholder.style.textAlign = 'center';
            placeholder.style.padding = '40px 20px';
            placeholder.innerHTML = `<div style="color:var(--da-text-secondary);">Tab [${tabId}] 暂未挂载</div>`;
            container.appendChild(placeholder);
            return;
        }

        const pane = document.createElement('div');
        pane.className = 'da-tab-pane';
        const res = tab.render(pane);
        container.appendChild(pane);

        if (res && typeof res.dispose === 'function') {
            this._currentTabDisposable = res;
        }
    }

    public close(): void {
        this._modalHandle?.dispose();
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.stopTelemetry();
        this._disposables.dispose();
        this.close();
    }
}
