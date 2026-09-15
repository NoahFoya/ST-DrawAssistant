/**
 * 插件主设置模态窗外壳 (ModalShell)
 *
 * 功能：
 * 1. 提供插件主模态窗口整体框架，包含头部导航、分组侧边栏、主内容视窗与状态底栏；
 * 2. 顶栏提供应用标题、版本关于徽标、主题下拉切换与关闭按钮；
 * 3. 底栏左侧提供支持点击重测的生图引擎连通性检测，右侧展示 JS 堆内存实时监控；
 * 4. 管理多选项卡的切换路由、视图挂载与生命周期管理。
 *
 * Tips：
 * 1. 模态窗显隐时严格管理连通性检测定时器与取消控制器，防止后台无效请求；
 * 2. 切换视图面板时触发停用与卸载回调，销毁时解绑全局事件监听与 DOM 节点，避免内存泄露。
 */

import { createElement } from '@util/dom';
import { getIconSvg } from '../components/icons';
import { ThemeService, type ThemeConfig } from '../theme';
import { PresetManager } from '@store/preset';
import { getAdapter } from '@function/adapter';
import type { SettingsStore } from '@store/settings';

import type { TabDefinition, StatusDotState, ModalShellOptions } from '@types';
export type { TabDefinition, StatusDotState, ModalShellOptions };

export class ModalShell {
    private _container: HTMLElement;
    private _innerWindow: HTMLElement;
    private _headerEl: HTMLElement;
    private _sidebarEl: HTMLElement;
    private _contentEl: HTMLElement;
    private _footerEl: HTMLElement;

    private _statusDotEl: HTMLElement;
    private _statusTextEl: HTMLElement;
    private _memoryTextEl: HTMLElement;

    private _tabs = new Map<string, TabDefinition>();
    private _tabButtons = new Map<string, HTMLButtonElement>();
    private _activeTabId: string | null = null;
    private _activePaneEl: HTMLElement | null = null;

    private _isOpen = false;
    private _options: ModalShellOptions;
    private _keyHandler: (e: KeyboardEvent) => void;

    private _probeTimer: number | null = null;
    private _memoryTimer: number | null = null;
    private _probeAbort: AbortController | null = null;
    private _unsubs: (() => void)[] = [];

    constructor(options: ModalShellOptions = {}) {
        this._options = {
            title: 'ST-DrawAssistant 绘画助手设置',
            version: 'v0.2.0',
            ...options
        };

        // 1. 全屏遮罩层
        this._container = createElement('div', {
            className: 'da-modal-backdrop st-da-root'
        });
        this._container.style.display = 'none';

        // 2. 视窗主体骨架
        this._innerWindow = createElement('div', {
            className: 'da-main-modal-inner'
        });
        this._container.appendChild(this._innerWindow);

        // 3. 构建顶部 46px 标题栏
        this._headerEl = this._buildHeader();
        this._innerWindow.appendChild(this._headerEl);

        // 4. 构建主体水平分栏容器 (.da-modal-body)
        const modalBody = createElement('div', { className: 'da-modal-body' });
        this._sidebarEl = createElement('nav', { className: 'da-sidebar-tabs' });
        this._contentEl = createElement('main', { className: 'da-modal-content' });

        modalBody.appendChild(this._sidebarEl);
        modalBody.appendChild(this._contentEl);
        this._innerWindow.appendChild(modalBody);

        // 5. 构建底部 34px 状态栏 (对齐原版：左侧连通探测，右侧内存监控)
        const { footer, dot, text, memText } = this._buildFooter();
        this._footerEl = footer;
        this._statusDotEl = dot;
        this._statusTextEl = text;
        this._memoryTextEl = memText;
        this._innerWindow.appendChild(this._footerEl);

        // 6. 注册外部初始传入的 Tab 列表
        if (options.tabs) {
            for (const tab of options.tabs) {
                this.registerTab(tab);
            }
        }

        // 7. 遮罩点击退出监听 (仅限点击遮罩自身，子元素不触发)
        this._container.addEventListener('click', (e) => {
            if (e.target === this._container) {
                this.close();
            }
        });

        // 8. 键盘 Escape 退出监听
        this._keyHandler = (e: KeyboardEvent) => {
            if (this._isOpen && e.key === 'Escape') {
                this.close();
            }
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', this._keyHandler);
        }

        // 9. 监听生图引擎配置与激活变更
        if (this._options.settingsStore) {
            const store = this._options.settingsStore as SettingsStore;
            const unsubEngine = store.onKeyChange('activeEngine', () => {
                if (this._isOpen) void this._probeServer();
            });
            const unsubEngines = store.onKeyChange('engines', () => {
                if (this._isOpen) void this._probeServer();
            });
            this._unsubs.push(() => unsubEngine.dispose(), () => unsubEngines.dispose());
        }
    }

    /** 构建 46px 顶部标题栏 */
    private _buildHeader(): HTMLElement {
        const header = createElement('header', { className: 'da-header-bar' });

        // 左侧：图标 + 渐变标题 + 可点击跳转关于面板的版本徽标
        const headerLeft = createElement('div', { className: 'da-header-left' });
        const iconSpan = createElement('span', { className: 'da-header-icon' });
        iconSpan.innerHTML = getIconSvg('palette');

        const titleH3 = createElement('h3', {
            className: 'da-header-title',
            textContent: this._options.title || 'ST-DrawAssistant'
        });

        // 版本胶囊徽标：点击快速跳转至关于选项卡 (About)
        const badgeBtn = createElement('button', {
            className: 'da-version-badge',
            textContent: this._options.version || 'v0.2.0',
            attributes: {
                type: 'button',
                title: '点击查看版本与关于信息'
            }
        }) as HTMLButtonElement;
        badgeBtn.style.cursor = 'pointer';
        badgeBtn.style.border = '1px solid rgba(var(--da-accent-rgb), 0.25)';
        badgeBtn.addEventListener('click', () => {
            void this.switchTab('about');
        });

        headerLeft.appendChild(iconSpan);
        headerLeft.appendChild(titleH3);
        headerLeft.appendChild(badgeBtn);

        // 右侧：快捷主题切换胶囊 + 关闭按钮
        const headerRight = createElement('div', { className: 'da-header-right' });

        // 快捷主题切换胶囊 (动态读取 themes.json 与自定义主题预设)
        const quickThemeWrapper = createElement('div', { className: 'da-quick-theme-selector' });
        const quickThemeSelect = createElement('select', { className: 'da-quick-theme-select' }) as HTMLSelectElement;
        quickThemeSelect.id = 'da-quick-theme-select';
        quickThemeSelect.title = '快速切换界面主题配色';

        const populateThemeOptions = () => {
            quickThemeSelect.innerHTML = '';
            let themes: Array<{ id: string; name: string }> = [];

            if (this._options.settingsStore) {
                const store = this._options.settingsStore as SettingsStore;
                const pm = new PresetManager(store);
                themes = pm
                    .list<ThemeConfig>('themes')
                    .filter((t) => t.id !== 'safe-fallback')
                    .map((t) => ({ id: t.id, name: t.name }));
            }

            if (themes.length === 0) {
                const opt = createElement('option', {
                    textContent: '深色夜间'
                }) as HTMLOptionElement;
                opt.value = 'dark';
                quickThemeSelect.appendChild(opt);
            } else {
                for (const t of themes) {
                    const opt = createElement('option', {
                        textContent: t.name
                    }) as HTMLOptionElement;
                    opt.value = t.id;
                    quickThemeSelect.appendChild(opt);
                }
            }

            const curId = this._options.settingsStore
                ? (this._options.settingsStore as SettingsStore).get('themePreset')
                : 'dark';
            quickThemeSelect.value = curId || themes[0]?.id || 'dark';
        };

        populateThemeOptions();

        quickThemeSelect.addEventListener('change', () => {
            const selectedKey = quickThemeSelect.value;
            if (this._options.settingsStore) {
                (this._options.settingsStore as SettingsStore).set('themePreset', selectedKey);
            }
            ThemeService.getInstance().applyPresetById(selectedKey);
        });

        if (this._options.settingsStore) {
            const store = this._options.settingsStore as SettingsStore;
            const unsubPreset = store.onKeyChange('themePreset', (val) => {
                if (quickThemeSelect.value !== val) {
                    quickThemeSelect.value = val;
                }
            });
            const unsubPresets = store.onKeyChange('presets', () => {
                populateThemeOptions();
            });
            this._unsubs.push(() => unsubPreset.dispose(), () => unsubPresets.dispose());
        }

        quickThemeWrapper.appendChild(quickThemeSelect);

        // 关闭按钮
        const closeBtn = createElement('button', {
            className: 'da-modal-close-btn',
            attributes: {
                type: 'button',
                'aria-label': '关闭设置面板 (Esc)',
                title: '关闭设置面板 (Esc)'
            }
        }) as HTMLButtonElement;
        closeBtn.innerHTML = getIconSvg('close');
        closeBtn.addEventListener('click', () => this.close());

        headerRight.appendChild(quickThemeWrapper);
        headerRight.appendChild(closeBtn);

        header.appendChild(headerLeft);
        header.appendChild(headerRight);
        return header;
    }

    /** 构建 34px 底部状态栏 (完全对齐原版布局与功能) */
    private _buildFooter(): {
        footer: HTMLElement;
        dot: HTMLElement;
        text: HTMLElement;
        memText: HTMLElement;
    } {
        const footer = createElement('footer', { className: 'da-footer-bar' });

        // 左侧后端连接状态 (点击可重新触发探测)
        const leftStatus = createElement('div', {
            className: 'da-status-item',
            attributes: {
                id: 'da-server-status-container',
                title: '点击重新检测连接'
            }
        });

        const dot = createElement('span', {
            className: 'da-status-dot da-status-checking',
            attributes: { id: 'da-server-status-dot' }
        });

        const text = createElement('span', {
            className: 'da-status-info da-server-status-text',
            attributes: { id: 'da-server-status-text' },
            textContent: '检测服务器连接中...'
        });

        leftStatus.appendChild(dot);
        leftStatus.appendChild(text);

        leftStatus.addEventListener('click', () => {
            void this._probeServer();
        });

        // 右侧系统内存监控
        const rightInfo = createElement('div', {
            className: 'da-status-item da-memory-info',
            attributes: { id: 'da-memory-status-container' }
        });

        const memText = createElement('span', {
            className: 'da-status-info da-memory-status-text',
            attributes: { id: 'da-memory-status-text' },
            textContent: 'JS Heap: 0.0 MB'
        });
        rightInfo.appendChild(memText);

        footer.appendChild(leftStatus);
        footer.appendChild(rightInfo);

        return { footer, dot, text, memText };
    }

    /**
     * 探测当前激活生图后端的连通性与往返网络延迟
     */
    private async _probeServer(): Promise<void> {
        if (!this._statusTextEl || !this._statusDotEl) return;
        const store = this._options.settingsStore as SettingsStore | undefined;

        if (!store) {
            this._statusDotEl.className = 'da-status-dot da-status-idle';
            this._statusTextEl.textContent = '未配置设置存储';
            return;
        }

        const activeEngine = store.get('activeEngine') || 'comfyui';
        const engines = (store.get('engines') || {}) as Record<string, any>;
        const engineConfig = engines[activeEngine] || {};

        let adapter: any;
        try {
            adapter = getAdapter(activeEngine as any);
        } catch {
            this._statusDotEl.className = 'da-status-dot da-status-error';
            this._statusTextEl.textContent = `未挂载适配器 [${activeEngine}]`;
            return;
        }

        const engineNames: Record<string, string> = {
            comfyui: 'ComfyUI',
            sdwebui: 'SD-WebUI',
            novelai: 'NovelAI',
            openai: 'OpenAI 兼容'
        };
        const engineName = engineNames[activeEngine] || adapter.name || activeEngine;

        const serverUrl =
            engineConfig.serverUrl ||
            (activeEngine === 'novelai'
                ? 'https://image.novelai.net'
                : activeEngine === 'openai'
                  ? 'https://api.openai.com/v1'
                  : activeEngine === 'sdwebui'
                    ? 'http://127.0.0.1:7860'
                    : 'http://127.0.0.1:8188');

        if (adapter.setBaseUrl && serverUrl) {
            adapter.setBaseUrl(serverUrl);
        }
        if (adapter.setApiKey && engineConfig.apiKey) {
            adapter.setApiKey(engineConfig.apiKey);
        }

        if (this._probeAbort) {
            this._probeAbort.abort();
        }
        this._probeAbort = new AbortController();
        const signal = this._probeAbort.signal;

        this._statusDotEl.className = 'da-status-dot da-status-checking';
        this._statusTextEl.textContent = `检测 ${engineName} 连接中...`;

        const startTime = performance.now();
        try {
            let res: any;
            if (activeEngine === 'novelai' && adapter.fetchAssets) {
                res = await adapter.fetchAssets(signal, { apiKey: engineConfig.apiKey });
            } else {
                res = await adapter.checkHealth(signal);
            }
            const latencyMs = res?.latencyMs ?? Math.round(performance.now() - startTime);

            if (res && res.ok) {
                this._statusDotEl.className = 'da-status-dot da-status-ok';
                this._statusTextEl.textContent = `${engineName} 运行正常 (${latencyMs}ms)`;
            } else {
                this._statusDotEl.className = 'da-status-dot da-status-error';
                this._statusTextEl.textContent = `${engineName} (离线或无响应)`;
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            this._statusDotEl.className = 'da-status-dot da-status-error';
            this._statusTextEl.textContent = `${engineName} (通信异常)`;
        }
    }

    /**
     * 刷新 JS Heap 内存占用指标 (基于浏览器 performance.memory 接口)
     */
    private _updateMemory(): void {
        if (!this._memoryTextEl) return;
        const perf = (typeof performance !== 'undefined' ? performance : null) as unknown as {
            memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
        } | null;

        if (perf && perf.memory) {
            const usedMB = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
            const totalMB = (perf.memory.totalJSHeapSize / (1024 * 1024)).toFixed(1);
            this._memoryTextEl.textContent = `JS Heap: ${usedMB} / ${totalMB} MB`;
        } else {
            this._memoryTextEl.textContent = 'JS Heap: 正常';
        }
    }

    /**
     * 启动底部状态栏遥测监控
     */
    private _startTelemetry(): void {
        this._stopTelemetry();
        void this._probeServer();
        this._updateMemory();

        if (typeof window !== 'undefined') {
            this._probeTimer = window.setInterval(() => {
                void this._probeServer();
            }, 15000);

            this._memoryTimer = window.setInterval(() => {
                this._updateMemory();
            }, 3000);
        }
    }

    /**
     * 停止遥测监控并中止未决的连通探测
     */
    private _stopTelemetry(): void {
        if (this._probeTimer !== null) {
            clearInterval(this._probeTimer);
            this._probeTimer = null;
        }
        if (this._memoryTimer !== null) {
            clearInterval(this._memoryTimer);
            this._memoryTimer = null;
        }
        if (this._probeAbort) {
            this._probeAbort.abort();
            this._probeAbort = null;
        }
    }

    /**
     * 注册选项卡
     */
    public registerTab(tab: TabDefinition): void {
        this._tabs.set(tab.id, tab);
        this._rebuildSidebar();
    }

    /** 重建侧边栏导航列表 */
    private _rebuildSidebar(): void {
        this._sidebarEl.innerHTML = '';
        this._tabButtons.clear();

        const engineTabs: TabDefinition[] = [];
        const systemTabs: TabDefinition[] = [];

        for (const tab of this._tabs.values()) {
            if (tab.group === 'engine') {
                engineTabs.push(tab);
            } else {
                systemTabs.push(tab);
            }
        }

        // 1. 渲染引擎驱动选项卡
        for (const tab of engineTabs) {
            const btn = this._createTabButton(tab);
            this._sidebarEl.appendChild(btn);
            this._tabButtons.set(tab.id, btn);
        }

        // 2. 渲染语义分割线
        if (engineTabs.length > 0 && systemTabs.length > 0) {
            const divider = createElement('div', { className: 'da-sidebar-divider' });
            this._sidebarEl.appendChild(divider);
        }

        // 3. 渲染系统管理选项卡
        for (const tab of systemTabs) {
            const btn = this._createTabButton(tab);
            this._sidebarEl.appendChild(btn);
            this._tabButtons.set(tab.id, btn);
        }

        // 若当前有激活的 Tab，则高亮按钮
        if (this._activeTabId && this._tabButtons.has(this._activeTabId)) {
            this._tabButtons.get(this._activeTabId)!.classList.add('da-sidebar-item--active');
        }
    }

    /** 创建单个侧边栏导航条目按钮 */
    private _createTabButton(tab: TabDefinition): HTMLButtonElement {
        const btn = createElement('button', {
            className: 'da-sidebar-item',
            dataset: { tabId: tab.id }
        }) as HTMLButtonElement;

        const iconSpan = createElement('span', { className: 'da-sidebar-item__icon' });
        iconSpan.innerHTML = tab.iconSvg;

        const labelSpan = createElement('span', {
            className: 'da-sidebar-item__label',
            textContent: tab.label
        });

        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);

        btn.addEventListener('click', () => {
            void this.switchTab(tab.id);
        });

        return btn;
    }

    /**
     * 切换当前激活的选项卡
     */
    public async switchTab(tabId: string): Promise<void> {
        if (!this._tabs.has(tabId)) return;
        if (this._activeTabId === tabId && this._activePaneEl) return;

        // 1. 触发前一个 Tab 的停用生命周期
        if (this._activeTabId && this._tabs.has(this._activeTabId)) {
            const prevTab = this._tabs.get(this._activeTabId)!;
            prevTab.onDeactivate?.();
            const prevBtn = this._tabButtons.get(this._activeTabId);
            prevBtn?.classList.remove('da-sidebar-item--active');
        }

        // 2. 更新激活 ID 与按钮高亮
        this._activeTabId = tabId;
        const currentTab = this._tabs.get(tabId)!;
        const currentBtn = this._tabButtons.get(tabId);
        currentBtn?.classList.add('da-sidebar-item--active');

        // 3. 渲染并挂载新内容面板
        this._contentEl.innerHTML = '';
        const rendered = await currentTab.render();
        const pane = createElement('div', { className: 'da-tab-pane' });
        pane.appendChild(rendered);

        this._activePaneEl = pane;
        this._contentEl.appendChild(pane);

        // 4. 重置滚动条至顶部并触发激活生命周期
        this._contentEl.scrollTop = 0;
        currentTab.onActivate?.();
        this._options.onTabChange?.(tabId);
    }

    /**
     * 打开主设置弹窗
     * @param tabId 目标选项卡 ID，若未指定则采用当前或第一个选项卡
     */
    public async open(tabId?: string): Promise<void> {
        this._isOpen = true;
        this._container.style.display = 'flex';

        // 自动挂载至 document.body (若尚未挂载)
        if (typeof document !== 'undefined' && !document.body.contains(this._container)) {
            document.body.appendChild(this._container);
        }

        // 启动底部遥测监控
        this._startTelemetry();

        const targetTab = tabId || this._activeTabId || this._options.initialTabId || this._tabs.keys().next().value;
        if (targetTab) {
            await this.switchTab(targetTab);
        }
    }

    /**
     * 关闭弹窗
     */
    public close(): void {
        if (!this._isOpen) return;
        this._isOpen = false;
        this._container.style.display = 'none';

        // 停止遥测监控
        this._stopTelemetry();

        if (this._activeTabId && this._tabs.has(this._activeTabId)) {
            this._tabs.get(this._activeTabId)!.onDeactivate?.();
        }

        this._options.onClose?.();
    }

    /** 查询弹窗是否正处于打开状态 */
    public isOpen(): boolean {
        return this._isOpen;
    }

    /** 获取当前激活的 Tab ID */
    public getActiveTabId(): string | null {
        return this._activeTabId;
    }

    /**
     * 更新底部状态条信息与指示灯
     */
    public updateStatus(text: string, state: StatusDotState = 'ok'): void {
        this._statusTextEl.textContent = text;
        this._statusDotEl.className = 'da-status-dot';
        switch (state) {
            case 'ok':
                this._statusDotEl.classList.add('da-status-ok');
                break;
            case 'checking':
                this._statusDotEl.classList.add('da-status-checking');
                break;
            case 'error':
                this._statusDotEl.classList.add('da-status-error');
                break;
            case 'warn':
                this._statusDotEl.classList.add('da-status-warn');
                break;
            case 'idle':
            default:
                this._statusDotEl.classList.add('da-status-idle');
                break;
        }
    }

    /** 获取根容器元素 */
    public getElement(): HTMLElement {
        return this._container;
    }

    /**
     * 彻底销毁模态框，释放监听与 DOM 节点
     */
    public dispose(): void {
        this._stopTelemetry();

        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', this._keyHandler);
        }

        for (const unsub of this._unsubs) {
            unsub();
        }
        this._unsubs = [];

        for (const tab of this._tabs.values()) {
            tab.dispose?.();
        }

        this._tabs.clear();
        this._tabButtons.clear();

        if (this._container.parentElement) {
            this._container.parentElement.removeChild(this._container);
        }
    }
}
