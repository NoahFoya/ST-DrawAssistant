/**
 * @module src/ui/layout/modal-shell
 * @description 插件主设置模态窗外壳 (ModalShell)
 *
 * 核心功能：
 * 1. 提供插件主模态窗口的整体框架，包含头部导航、分组侧边栏、主内容视窗与状态底栏；
 * 2. 管理多选项卡 (Tabs) 的切换路由、视图挂载与生命周期管理；
 * 3. 支持遮罩层点击、关闭按钮与键盘快捷键退出；
 * 4. 底部实时指示当前生图后端的连通性状态与网络响应延迟。
 *
 * 注意事项：
 * 1. 模态窗弹出与隐藏需维护焦点状态并锁定背景滚动，避免影响宿主正常交互；
 * 2. 切换 Tab 时需妥善管理原视图的清理与新视图的渲染，防止事件监听遗留。
 */

import { createElement } from '../../util/dom';
import { getIconSvg } from '../components/icons';
import { ThemeService, BUILTIN_THEMES } from '../theme';

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

    private _tabs = new Map<string, TabDefinition>();
    private _tabButtons = new Map<string, HTMLButtonElement>();
    private _activeTabId: string | null = null;
    private _activePaneEl: HTMLElement | null = null;

    private _isOpen = false;
    private _options: ModalShellOptions;
    private _keyHandler: (e: KeyboardEvent) => void;

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

        // 5. 构建底部 34px 状态栏
        const { footer, dot, text } = this._buildFooter();
        this._footerEl = footer;
        this._statusDotEl = dot;
        this._statusTextEl = text;
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
    }

    /** 构建 46px 顶部标题栏 */
    private _buildHeader(): HTMLElement {
        const header = createElement('header', { className: 'da-header-bar' });

        // 左侧：图标 + 渐变标题 + 版本徽标
        const headerLeft = createElement('div', { className: 'da-header-left' });
        const iconSpan = createElement('span', { className: 'da-header-icon' });
        iconSpan.innerHTML = getIconSvg('palette');

        const titleH3 = createElement('h3', {
            className: 'da-header-title',
            textContent: this._options.title || 'ST-DrawAssistant'
        });

        const badgeSpan = createElement('span', {
            className: 'da-badge da-badge--info',
            textContent: this._options.version || 'v0.2.0'
        });

        headerLeft.appendChild(iconSpan);
        headerLeft.appendChild(titleH3);
        headerLeft.appendChild(badgeSpan);

        // 右侧：快捷主题切换胶囊 + 关闭按钮
        const headerRight = createElement('div', { className: 'da-header-right' });

        // 快捷主题切换胶囊
        const quickThemeWrapper = createElement('div', { className: 'da-quick-theme-selector' });
        const quickThemeSelect = createElement('select', { className: 'da-quick-theme-select' }) as HTMLSelectElement;

        for (const [key, theme] of Object.entries(BUILTIN_THEMES)) {
            const opt = createElement('option', {
                textContent: theme.name || key
            }) as HTMLOptionElement;
            opt.value = key;
            quickThemeSelect.appendChild(opt);
        }

        quickThemeSelect.addEventListener('change', () => {
            const selectedKey = quickThemeSelect.value;
            const theme = BUILTIN_THEMES[selectedKey];
            if (theme) {
                ThemeService.getInstance().applyTheme(theme);
            }
        });
        quickThemeWrapper.appendChild(quickThemeSelect);

        // 关闭按钮
        const closeBtn = createElement('button', {
            className: 'da-modal-close-btn'
        }) as HTMLButtonElement;
        closeBtn.setAttribute('aria-label', '关闭弹窗');
        closeBtn.innerHTML = getIconSvg('close');
        closeBtn.addEventListener('click', () => this.close());

        headerRight.appendChild(quickThemeWrapper);
        headerRight.appendChild(closeBtn);

        header.appendChild(headerLeft);
        header.appendChild(headerRight);
        return header;
    }

    /** 构建 34px 底部状态栏 */
    private _buildFooter(): { footer: HTMLElement; dot: HTMLElement; text: HTMLElement } {
        const footer = createElement('footer', { className: 'da-footer-bar' });

        // 左侧后端连接状态
        const leftStatus = createElement('div', {
            className: 'da-status-item'
        });
        leftStatus.id = 'da-server-status-container';
        const dot = createElement('span', { className: 'da-status-dot da-status-ok' });
        const text = createElement('span', {
            className: 'da-server-status-text',
            textContent: '绘画服务连接就绪 · 延迟 --ms'
        });
        leftStatus.appendChild(dot);
        leftStatus.appendChild(text);

        // 右侧版权与版本
        const rightInfo = createElement('div', {
            className: 'da-status-item'
        });
        const verText = createElement('span', {
            className: 'da-memory-status-text',
            textContent: `${this._options.version || 'v0.2.0'} · ST-DrawAssistant`
        });
        rightInfo.appendChild(verText);

        footer.appendChild(leftStatus);
        footer.appendChild(rightInfo);

        return { footer, dot, text };
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
            this.switchTab(tab.id);
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
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', this._keyHandler);
        }

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
