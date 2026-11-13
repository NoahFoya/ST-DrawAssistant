/**
 * 设置模态外壳组件 (SettingsModal)。
 *
 * @remarks
 * 负责主设置面板的布局渲染、选项卡切换与生命周期管理：
 * 1. 顶栏：标题、版本号、主题切换与关闭按钮；
 * 2. 侧边栏：常规设置、各生图服务选项卡及扩展功能导航；
 * 3. 内容区：按需加载并缓存各选项卡视图；
 * 4. 底栏：当前生效生图服务的连通性状态与延迟检测。
 */

import type { Disposable, UIComponent, SettingsView } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { themeService } from '../theme/theme-service';
import { providerRegistry } from '../../provider/registry';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { logger } from '../../util/logger';
import { updateService } from '../../pipeline/update-service';
import { AssetSyncCoordinator } from '../../pipeline/asset-sync-coordinator';
import { EXTENSION_TITLE, EXTENSION_VERSION } from '../../config/constants';
import { openOnboardingGuideModal, type OnboardingGuideModal } from './onboarding-guide-modal';
import type { ProviderType } from '@types';

/**
 * 未注册选项卡的占位空视图。
 *
 * @remarks
 * 当传入未注册的 tabId 时显示占位提示，避免页面渲染中断并保持统一生命周期接口。
 */
class PlaceholderTabView implements SettingsView {
    public readonly element: HTMLElement;

    constructor(
        public readonly id: string,
        public readonly title: string,
        description = '模块装配就绪'
    ) {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane';

        const inner = document.createElement('div');
        inner.className = 'da-tab-placeholder';

        const heading = document.createElement('h3');
        heading.textContent = title;
        heading.style.margin = '0 0 8px 0';
        heading.style.fontSize = '16px';
        heading.style.fontWeight = '600';

        const desc = document.createElement('p');
        desc.textContent = description;
        desc.style.margin = '0';
        desc.style.fontSize = '13px';
        desc.style.opacity = '0.75';

        inner.appendChild(heading);
        inner.appendChild(desc);
        this.element.appendChild(inner);
    }

    public activate(): void {
        // 空态视图无额外数据恢复动作
    }

    public deactivate(): void {
        // 空态视图无额外草稿持久化动作
    }

    public dispose(): void {
        this.element.remove();
    }
}

/** 主设置模态外壳配置项 */
export interface SettingsModalOptions {
    /** 宿主挂载容器，默认挂载至 document.body */
    parent?: HTMLElement;
    /** 初始默认激活的选项卡 ID，缺省为 'general' */
    defaultTab?: string;
    /** 模态外壳打开回调 */
    onOpen?: () => void;
    /** 模态外壳关闭回调 */
    onClose?: () => void;
}

/** 生图服务提供方定义 */
interface ProviderItemDefinition {
    id: ProviderType;
    name: string;
}

const PROVIDER_DEFINITIONS: ProviderItemDefinition[] = [
    { id: 'comfyui', name: 'ComfyUI' },
    { id: 'sdwebui', name: 'SD-WebUI' },
    { id: 'novelai', name: 'NovelAI' },
    { id: 'openai', name: 'OpenAI 兼容' },
];

/** 侧边栏非服务普通选项卡定义 */
interface NormalTabDefinition {
    id: string;
    title: string;
    isDivider?: boolean;
    disabled?: boolean;
}

const NORMAL_TABS: NormalTabDefinition[] = [
    { id: 'general', title: '常规设置' },
    { id: 'prompts', title: '提示词' },
    { id: 'materials', title: '素材库' },
    { id: 'lexicon', title: '词库' },
    { id: 'divider-1', title: '', isDivider: true },
    { id: 'gallery', title: '本地图库' },
    { id: 'theme', title: '主题设置' },
    { id: 'fab', title: '悬浮球' },
    { id: 'divider-2', title: '', isDivider: true },
    { id: 'logs', title: '日志与统计' },
    { id: 'about', title: '关于' },
];

export type TabView = SettingsView | UIComponent;

export class SettingsModal implements Disposable {
    private isOpenState = false;
    private activeTabId = 'general';
    private isServiceExpanded = false;

    // DOM 元素引用
    private backdropElement: HTMLElement | null = null;
    private modalElement: HTMLElement | null = null;
    private contentAreaElement: HTMLElement | null = null;
    private statusDotElement: HTMLElement | null = null;
    private statusTextElement: HTMLElement | null = null;
    private providerTitleTextElement: HTMLElement | null = null;
    private providerExpandTrigger: HTMLElement | null = null;
    private providerSubItemsContainer: HTMLElement | null = null;
    private quickThemeSelectElement: HTMLSelectElement | null = null;

    // 视图实例与选项卡映射
    private readonly sidebarItems = new Map<string, HTMLElement>();
    private readonly viewsCache = new Map<string, TabView>();
    private readonly registeredViewFactories = new Map<string, () => TabView>();
    private activeView: TabView | null = null;

    // 状态检测定时器、连续失败计数与中止控制器
    private healthTimer: ReturnType<typeof setTimeout> | null = null;
    private consecutiveHealthFailures = 0;
    private onVisibilityChangeHandler: (() => void) | null = null;
    private abortController: AbortController | null = null;

    // 全局事件解绑函数与更新指示器
    private unlistenSettings: (() => void) | null = null;
    private unlistenUpdate: (() => void) | null = null;
    private removeOverlayEntry: (() => void) | null = null;
    private updateDotElement: HTMLElement | null = null;
    private activeGuideModal: OnboardingGuideModal | null = null;

    constructor(private readonly options: SettingsModalOptions = {}) {
        if (options.defaultTab) {
            this.activeTabId = options.defaultTab;
        }

        // 监听版本更新状态变更，同步顶栏提示红点
        this.unlistenUpdate = eventBus.on('update:status-changed', (state) => {
            if (this.updateDotElement) {
                this.updateDotElement.classList.toggle(
                    'da-update-indicator-dot--active',
                    Boolean(state.hasUpdate)
                );
            }
        });

        // 监听配置中心变更，响应活跃提供方与主题同步
        this.unlistenSettings = eventBus.on('settings:updated', (data) => {
            if (data.key === 'activeProvider' || data.keys?.includes('activeProvider')) {
                this.updateProviderLabels();
                const newActive = this.getActiveProviderType();
                void AssetSyncCoordinator.syncProviderAssets(newActive, {
                    isManual: false,
                    silentIfNoChange: true,
                });
                if (this.isOpenState) {
                    this.consecutiveHealthFailures = 0;
                    void this.checkActiveProviderHealth();
                }
            }
            if (
                data.key === 'activeThemePresetId' ||
                data.key?.startsWith('presets.themes') ||
                data.keys?.includes('activeThemePresetId') ||
                data.keys?.includes('presets')
            ) {
                this.refreshThemeSelector();
            }
            if (data.isReset) {
                for (const [tabId, view] of this.viewsCache.entries()) {
                    if (tabId !== this.activeTabId) {
                        view.dispose?.();
                        this.viewsCache.delete(tabId);
                    } else if ('activate' in view && typeof view.activate === 'function') {
                        view.activate();
                    }
                }
            }
        });
    }

    /**
     * 注册指定选项卡的专属视图工厂函数。
     *
     * @param tabId 选项卡标识
     * @param factory 视图创建函数
     */
    public registerViewFactory(tabId: string, factory: () => TabView): void {
        this.registeredViewFactories.set(tabId, factory);
    }

    /**
     * 打开主设置弹窗。
     *
     * @param tabId 可选的目标选项卡标识
     */
    public open(tabId?: string): void {
        if (this.isOpenState) {
            if (tabId && tabId !== this.activeTabId) {
                this.switchTab(tabId);
            }
            return;
        }

        this.isOpenState = true;
        this.buildDOM();

        const parent = this.options.parent ?? (typeof document !== 'undefined' ? document.body : null);
        if (parent && this.backdropElement) {
            parent.appendChild(this.backdropElement);
        }

        // 注册全局浮层栈 Escape 响应
        this.bindKeyboardEvents();

        // 注册页面可见性监听（失焦冻结轮询，切回前台唤醒）
        if (typeof document !== 'undefined') {
            this.onVisibilityChangeHandler = () => {
                if (document.visibilityState === 'visible' && this.isOpenState) {
                    void this.checkActiveProviderHealth();
                } else if (document.visibilityState === 'hidden' && this.healthTimer !== null) {
                    clearTimeout(this.healthTimer);
                    this.healthTimer = null;
                }
            };
            document.addEventListener('visibilitychange', this.onVisibilityChangeHandler);
        }

        // 切换至目标选项卡
        const targetTab = tabId || this.activeTabId || this.options.defaultTab || 'general';
        this.switchTab(targetTab);

        // 启动底栏连通性检测（重置连续失败计数器）
        this.consecutiveHealthFailures = 0;
        void this.checkActiveProviderHealth();

        this.options.onOpen?.();

        // 首次安装初始化完成后首次打开设置面板时，自动弹出使用引导并记录状态
        if (Boolean(settingsStore.get('isInitialized')) && !settingsStore.get('hasSeenGuide')) {
            settingsStore.set('hasSeenGuide', true);
            this.openOnboardingGuide();
        }
    }

    /**
     * 关闭主设置弹窗。
     */
    public close(): void {
        if (!this.isOpenState) {
            return;
        }

        this.closeOnboardingGuide();
        this.isOpenState = false;

        // 停用当前激活视图
        this.safeDeactivate(this.activeView);

        // 停止健康检测定时器与进行中的网络请求
        if (this.healthTimer !== null) {
            clearTimeout(this.healthTimer);
            this.healthTimer = null;
        }
        if (this.onVisibilityChangeHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.onVisibilityChangeHandler);
            this.onVisibilityChangeHandler = null;
        }
        if (this.abortController !== null) {
            this.abortController.abort();
            this.abortController = null;
        }

        // 注销全局浮层栈 Escape 响应
        this.unbindKeyboardEvents();

        // 从 DOM 节点树中移出弹窗外壳
        if (this.backdropElement && this.backdropElement.parentElement) {
            this.backdropElement.parentElement.removeChild(this.backdropElement);
        }

        this.options.onClose?.();
    }

    /**
     * 查询弹窗当前是否处于打开状态。
     */
    public isOpen(): boolean {
        return this.isOpenState;
    }

    /**
     * 获取当前激活的选项卡 ID。
     */
    public getActiveTabId(): string {
        return this.activeTabId;
    }

    /**
     * 获取当前生效的生图服务类型。
     */
    public getActiveProviderType(): ProviderType {
        return (settingsStore.get('activeProvider') as ProviderType) || 'comfyui';
    }

    /**
     * 切换至指定选项卡。
     *
     * @param tabId 目标选项卡 ID
     */
    public switchTab(tabId: string): void {
        // 若点击的是生图服务主条目，则重定向至当前生效的具体服务
        const resolvedTabId =
            tabId === 'provider-main' ? this.getActiveProviderType() : tabId;

        // 切换至任意生图引擎时自动展开分组，确保兄弟引擎子项立即可见
        const isProviderTab = PROVIDER_DEFINITIONS.some((p) => p.id === resolvedTabId);
        if (isProviderTab) {
            this.toggleProviderExpanded(true);
        }

        // 停用先前视图
        this.safeDeactivate(this.activeView);

        this.activeTabId = resolvedTabId;

        // 获取或惰性创建视图实例
        let targetView = this.viewsCache.get(resolvedTabId);
        if (!targetView) {
            const factory = this.registeredViewFactories.get(resolvedTabId);
            if (factory) {
                targetView = factory();
            } else {
                targetView = new PlaceholderTabView(resolvedTabId, this.getTabTitle(resolvedTabId));
            }
            this.viewsCache.set(resolvedTabId, targetView);
        }

        this.activeView = targetView;

        // 挂载至主内容滚动区域
        if (this.contentAreaElement) {
            this.contentAreaElement.innerHTML = '';
            this.contentAreaElement.appendChild(targetView.element);
            this.contentAreaElement.scrollTop = 0;
        }

        // 触发视图激活回调
        this.safeActivate(targetView);

        // 更新侧边栏高亮状态
        this.updateSidebarHighlight(resolvedTabId);
    }

    /**
     * 展开或收起生图服务列表。
     *
     * @param force 指定展开状态，缺省为切换
     */
    public toggleProviderExpanded(force?: boolean): void {
        this.isServiceExpanded = typeof force === 'boolean' ? force : !this.isServiceExpanded;

        if (this.providerExpandTrigger) {
            if (this.isServiceExpanded) {
                this.providerExpandTrigger.classList.add('is-expanded');
                this.providerExpandTrigger.setAttribute('aria-expanded', 'true');
            } else {
                this.providerExpandTrigger.classList.remove('is-expanded');
                this.providerExpandTrigger.setAttribute('aria-expanded', 'false');
            }
        }

        if (this.providerSubItemsContainer) {
            this.providerSubItemsContainer.style.display = this.isServiceExpanded ? 'flex' : 'none';
        }
    }

    /**
     * 获取生图服务子列表当前是否展开。
     */
    public isProviderExpanded(): boolean {
        return this.isServiceExpanded;
    }

    /**
     * 获取指定已缓存的选项卡视图实例。
     */
    public getView(tabId: string): UIComponent | undefined {
        return this.viewsCache.get(tabId);
    }

    /**
     * 获取模态弹窗外层遮罩元素。
     */
    public getBackdropElement(): HTMLElement | null {
        return this.backdropElement;
    }

    /**
     * 获取模态弹窗视窗骨架元素。
     */
    public getModalElement(): HTMLElement | null {
        return this.modalElement;
    }

    /**
     * 调度下一次底栏服务健康检查。
     *
     * @remarks
     * 1. 页面可见性感知：当浏览器标签页处于后台隐藏状态时，冻结轮询，切回前台时唤醒；
     * 2. 连续失败动态退避：正常在线时维持 15 秒轮询；初次失败延长至 30 秒；持续失败延长至 60 秒；
     *    连续失败达 4 次后挂起自动轮询，避免在离线状态下向宿主中继终端产生持续报错噪音；
     * 3. 用户交互即时唤醒：用户切换选项卡、变更激活服务或修改服务地址时重置计数器并立即唤醒。
     *
     * @param delayMs 可选的指定延迟毫秒数
     */
    private scheduleNextHealthCheck(delayMs?: number): void {
        if (!this.isOpenState) return;

        if (this.healthTimer !== null) {
            clearTimeout(this.healthTimer);
            this.healthTimer = null;
        }

        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            return;
        }

        let interval = delayMs;
        if (interval === undefined) {
            if (this.consecutiveHealthFailures === 0) {
                interval = 15000;
            } else if (this.consecutiveHealthFailures < 2) {
                interval = 30000;
            } else if (this.consecutiveHealthFailures < 4) {
                interval = 60000;
            } else {
                return;
            }
        }

        this.healthTimer = setTimeout(() => {
            this.healthTimer = null;
            void this.checkActiveProviderHealth();
        }, interval);
    }

    /**
     * 执行当前生效生图服务的健康状态检测与往返耗时测试。
     */
    public async checkActiveProviderHealth(): Promise<void> {
        if (!this.statusDotElement || !this.statusTextElement) {
            return;
        }

        // 中止可能未决的检测请求
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();

        const activeProvider = this.getActiveProviderType();
        const providerName = this.getProviderDisplayName(activeProvider);

        this.statusDotElement.className = 'da-status-dot da-status-checking';
        this.statusTextElement.textContent = `${providerName}: 检测中...`;

        try {
            const provider = providerRegistry.getProvider(activeProvider);
            if (!provider || typeof provider.checkHealth !== 'function') {
                this.statusDotElement.className = 'da-status-dot da-status-warn';
                this.statusTextElement.textContent = `${providerName}: 未注册`;
                return;
            }

            const result = await provider.checkHealth(this.abortController.signal);
            if (!this.isOpenState || !this.statusDotElement || !this.statusTextElement) {
                return;
            }

            if (result.status === 'ok') {
                this.consecutiveHealthFailures = 0;
                this.statusDotElement.className = 'da-status-dot da-status-ok';
                const latencyStr = typeof result.latencyMs === 'number' ? ` (${result.latencyMs}ms)` : '';
                this.statusTextElement.textContent = `${providerName}: 在线${latencyStr}`;
                this.statusTextElement.title = `${providerName} 响应正常${latencyStr}`;
            } else {
                this.consecutiveHealthFailures++;
                this.statusDotElement.className = 'da-status-dot da-status-error';
                this.statusTextElement.textContent = `${providerName}: 连接失败`;
                this.statusTextElement.title = result.message
                    ? `${providerName}: ${result.message}`
                    : `${providerName}: 连接失败`;
            }
        } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === 'AbortError';
            if (isAbort || !this.isOpenState || !this.statusDotElement || !this.statusTextElement) {
                return;
            }
            this.consecutiveHealthFailures++;
            logger.warn(`生图服务 [${activeProvider}] 健康检测异常:`, err);
            this.statusDotElement.className = 'da-status-dot da-status-error';
            this.statusTextElement.textContent = `${providerName}: 连接异常`;
            this.statusTextElement.title = `${providerName}: ${String(err)}`;
        } finally {
            if (this.isOpenState) {
                this.scheduleNextHealthCheck();
            }
        }
    }

    /**
     * 释放弹窗占用的资源、定时器与事件监听。
     */
    public dispose(): void {
        this.close();

        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }

        if (this.unlistenUpdate) {
            this.unlistenUpdate();
            this.unlistenUpdate = null;
        }
        this.updateDotElement = null;

        // 释放已缓存的 Tab 视图实例
        for (const [tabId, view] of this.viewsCache.entries()) {
            try {
                view.dispose?.();
            } catch (err) {
                logger.error(`选项卡视图 [${tabId}] 释放资源失败:`, err);
            }
        }
        this.viewsCache.clear();
        this.registeredViewFactories.clear();

        // 移除 DOM 引用
        if (this.backdropElement) {
            this.backdropElement.remove();
            this.backdropElement = null;
        }
        this.modalElement = null;
        this.contentAreaElement = null;
        this.statusDotElement = null;
        this.statusTextElement = null;
        this.providerTitleTextElement = null;
        this.providerExpandTrigger = null;
        this.providerSubItemsContainer = null;
        this.quickThemeSelectElement = null;
        this.sidebarItems.clear();
        this.activeView = null;
    }

    // DOM 构造与交互装配私有方法

    private buildDOM(): void {
        if (this.backdropElement && this.modalElement) {
            return;
        }

        // 1. 全屏毛玻璃遮罩层 (.da-modal-backdrop)
        this.backdropElement = document.createElement('div');
        this.backdropElement.className = 'da-modal-backdrop da-settings-modal-backdrop';

        // 点击遮罩空白区关闭
        this.backdropElement.addEventListener('click', (e) => {
            if (e.target === this.backdropElement) {
                this.close();
            }
        });

        // 滚轮事件隔离，避免背景页面联动滚动
        this.backdropElement.addEventListener('wheel', (e) => {
            e.stopPropagation();
        }, { passive: true });

        // 2. 弹窗主体视窗骨架 (.st-da-root.da-main-modal-inner)
        this.modalElement = document.createElement('div');
        this.modalElement.className = 'st-da-root da-main-modal-inner';
        this.modalElement.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 3. 构建三段式布局
        const header = this.buildHeaderBar();
        const body = this.buildModalBody();
        const footer = this.buildFooterBar();

        this.modalElement.appendChild(header);
        this.modalElement.appendChild(body);
        this.modalElement.appendChild(footer);
        this.backdropElement.appendChild(this.modalElement);
    }

    private buildHeaderBar(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'da-header-bar';

        // 1. 左侧标题与版本徽标
        const left = document.createElement('div');
        left.className = 'da-header-left';

        const title = document.createElement('h2');
        title.className = 'da-header-title';
        title.textContent = EXTENSION_TITLE;

        const badgeWrapper = document.createElement('div');
        badgeWrapper.className = 'da-header-badge-wrapper';

        const versionBadge = document.createElement('span');
        versionBadge.className = 'da-badge da-header-badge';
        versionBadge.textContent = `v${EXTENSION_VERSION}`;
        versionBadge.setAttribute('role', 'button');
        versionBadge.setAttribute('tabindex', '0');
        versionBadge.setAttribute('title', '点击查看关于与诊断信息');

        const updateDot = document.createElement('span');
        updateDot.className = 'da-update-indicator-dot';
        const isUpdateAvailable = Boolean(updateService.getState().hasUpdate);
        updateDot.classList.toggle('da-update-indicator-dot--active', isUpdateAvailable);
        this.updateDotElement = updateDot;

        badgeWrapper.appendChild(versionBadge);
        badgeWrapper.appendChild(updateDot);

        const onVersionClick = () => {
            this.switchTab('about');
        };
        versionBadge.addEventListener('click', onVersionClick);
        versionBadge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onVersionClick();
            }
        });

        left.appendChild(title);
        left.appendChild(badgeWrapper);

        // 2. 右侧快捷换肤下拉与关闭按钮
        const right = document.createElement('div');
        right.className = 'da-header-right';

        const themeSelectorWrap = document.createElement('div');
        themeSelectorWrap.className = 'da-quick-theme-selector';

        const themeSelect = document.createElement('select');
        themeSelect.className = 'da-quick-theme-select';
        themeSelect.setAttribute('aria-label', '快捷切换界面主题');
        this.quickThemeSelectElement = themeSelect;

        this.refreshThemeSelector();

        themeSelect.addEventListener('change', () => {
            const newTheme = themeSelect.value;
            settingsStore.set('activeThemePresetId', newTheme);
            themeService.applyCurrentTheme();
        });

        themeSelectorWrap.appendChild(themeSelect);

        const helpBtn = document.createElement('button');
        helpBtn.className = 'da-modal-help-btn';
        helpBtn.type = 'button';
        helpBtn.setAttribute('aria-label', '打开使用引导');
        helpBtn.setAttribute('title', '查看功能说明与使用引导');
        helpBtn.innerHTML = renderIcon('helpCircle', 16);
        helpBtn.addEventListener('click', () => {
            this.openOnboardingGuide();
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'da-modal-close-btn';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', '关闭设置面板');
        closeBtn.innerHTML = renderIcon('close', 16);
        closeBtn.addEventListener('click', () => {
            this.close();
        });

        right.appendChild(themeSelectorWrap);
        right.appendChild(helpBtn);
        right.appendChild(closeBtn);

        header.appendChild(left);
        header.appendChild(right);
        return header;
    }

    private buildModalBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'da-modal-body';

        // 左侧导航侧边栏 (190px)
        const sidebar = this.buildSidebarTabs();

        // 右侧内容滚动主区
        this.contentAreaElement = document.createElement('div');
        this.contentAreaElement.className = 'da-modal-content';

        body.appendChild(sidebar);
        body.appendChild(this.contentAreaElement);
        return body;
    }

    private buildSidebarTabs(): HTMLElement {
        const sidebar = document.createElement('nav');
        sidebar.className = 'da-sidebar-tabs';
        sidebar.setAttribute('aria-label', '设置选项卡导航');

        this.sidebarItems.clear();

        // 1. 常规设置项（置顶主要设置）
        const generalItem = this.createSidebarItem('general', '常规设置');
        sidebar.appendChild(generalItem);

        // 2. 生图服务主条目（直接展示当前生效引擎）
        const providerMainItem = document.createElement('button');
        providerMainItem.className = 'da-sidebar-item';
        providerMainItem.type = 'button';
        providerMainItem.setAttribute('data-tab-id', 'provider-main');

        this.providerTitleTextElement = document.createElement('span');
        this.providerTitleTextElement.className = 'da-sidebar-item__label';
        this.updateProviderTitleText();

        this.providerExpandTrigger = document.createElement('span');
        this.providerExpandTrigger.className = 'da-sidebar-item__expand-trigger';
        this.providerExpandTrigger.textContent = '▾';
        this.providerExpandTrigger.setAttribute('role', 'button');
        this.providerExpandTrigger.setAttribute('tabindex', '0');
        this.providerExpandTrigger.setAttribute('aria-label', '展开或收起其他生图引擎');
        this.providerExpandTrigger.setAttribute('aria-expanded', this.isServiceExpanded ? 'true' : 'false');
        this.providerExpandTrigger.setAttribute('title', '展开/收起更多生图引擎');
        this.providerExpandTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleProviderExpanded();
        });
        this.providerExpandTrigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.toggleProviderExpanded();
            }
        });

        providerMainItem.appendChild(this.providerTitleTextElement);
        providerMainItem.appendChild(this.providerExpandTrigger);

        // 单击：若已处于当前引擎视图则切换折叠，否则切换至该引擎并自动展开兄弟引擎
        providerMainItem.addEventListener('click', () => {
            const activeType = this.getActiveProviderType();
            if (this.activeTabId === activeType) {
                this.toggleProviderExpanded();
            } else {
                this.switchTab('provider-main');
            }
        });
        providerMainItem.addEventListener('dblclick', () => {
            this.toggleProviderExpanded();
        });

        sidebar.appendChild(providerMainItem);
        this.sidebarItems.set('provider-main', providerMainItem);

        // 3. 其余 3 大引擎子项容器（默认按需收拢）
        this.providerSubItemsContainer = document.createElement('div');
        this.providerSubItemsContainer.className = 'da-sidebar-sub-items';
        this.providerSubItemsContainer.style.display = this.isServiceExpanded ? 'flex' : 'none';

        this.rebuildProviderSubItems();
        sidebar.appendChild(this.providerSubItemsContainer);

        // 4. 其余选项卡与细线分割（按开发者内部规划顺序呈现，不向用户展示冗余分组标题）
        for (const item of NORMAL_TABS) {
            if (item.id === 'general') {
                continue;
            }
            if (item.isDivider) {
                const divider = document.createElement('div');
                divider.className = 'da-sidebar-divider';
                sidebar.appendChild(divider);
                continue;
            }

            const navItem = this.createSidebarItem(
                item.id,
                item.title,
                item.disabled
            );
            sidebar.appendChild(navItem);
        }

        return sidebar;
    }

    private createSidebarItem(
        tabId: string,
        title: string,
        disabled?: boolean
    ): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'da-sidebar-item';
        btn.type = 'button';
        btn.setAttribute('data-tab-id', tabId);

        if (disabled) {
            btn.classList.add('da-sidebar-item--disabled');
            btn.setAttribute('aria-disabled', 'true');
            btn.title = '功能规划中';
        }

        const label = document.createElement('span');
        label.className = 'da-sidebar-item__label';
        label.textContent = title;
        btn.appendChild(label);

        if (!disabled) {
            btn.addEventListener('click', () => {
                this.switchTab(tabId);
            });
        }

        this.sidebarItems.set(tabId, btn);
        return btn;
    }

    private buildFooterBar(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'da-footer-bar';

        // 专注核心连通状态（去除普通用户非必要的 JS Heap 内存指标）
        const serverStatusContainer = document.createElement('div');
        serverStatusContainer.className = 'da-status-item';
        serverStatusContainer.id = 'da-server-status-container';
        serverStatusContainer.setAttribute('role', 'button');
        serverStatusContainer.setAttribute('tabindex', '0');
        serverStatusContainer.setAttribute('title', '点击重新检测服务连接');

        this.statusDotElement = document.createElement('span');
        this.statusDotElement.className = 'da-status-dot da-status-idle';

        this.statusTextElement = document.createElement('span');
        this.statusTextElement.className = 'da-server-status-text';
        this.statusTextElement.textContent = '就绪';

        serverStatusContainer.appendChild(this.statusDotElement);
        serverStatusContainer.appendChild(this.statusTextElement);

        const onProbeClick = () => {
            void this.checkActiveProviderHealth();
        };
        serverStatusContainer.addEventListener('click', onProbeClick);
        serverStatusContainer.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onProbeClick();
            }
        });

        footer.appendChild(serverStatusContainer);
        return footer;
    }

    private updateSidebarHighlight(activeId: string): void {
        const activeProvider = this.getActiveProviderType();

        for (const [id, el] of this.sidebarItems) {
            let shouldBeActive = false;
            if (id === activeId) {
                shouldBeActive = true;
            } else if (id === 'provider-main' && activeId === activeProvider) {
                // 当正在查看当前全局生效的提供方时，主条目保持高亮关联
                shouldBeActive = true;
            }

            if (shouldBeActive) {
                el.classList.add('da-sidebar-item--active');
            } else {
                el.classList.remove('da-sidebar-item--active');
            }
        }
    }

    /**
     * 响应式刷新顶栏快捷换肤下拉框选项与当前选中态。
     */
    private refreshThemeSelector(): void {
        if (!this.quickThemeSelectElement) {
            return;
        }

        const select = this.quickThemeSelectElement;
        const availableThemes = themeService.getAvailableThemes();
        const activeThemeId = themeService.getActiveThemeId();

        select.innerHTML = '';
        for (const item of availableThemes) {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.name;
            select.appendChild(opt);
        }
        select.value = activeThemeId;
    }

    private updateProviderLabels(): void {
        this.updateProviderTitleText();
        this.rebuildProviderSubItems();
    }

    private updateProviderTitleText(): void {
        if (!this.providerTitleTextElement) {
            return;
        }
        const activeType = this.getActiveProviderType();
        const activeName = this.getProviderDisplayName(activeType);
        this.providerTitleTextElement.textContent = activeName;
    }

    private rebuildProviderSubItems(): void {
        if (!this.providerSubItemsContainer) {
            return;
        }
        this.providerSubItemsContainer.innerHTML = '';
        const activeType = this.getActiveProviderType();

        for (const prov of PROVIDER_DEFINITIONS) {
            if (prov.id === activeType) {
                continue;
            }
            const subItem = document.createElement('button');
            subItem.className = 'da-sidebar-item da-sidebar-sub-item';
            subItem.type = 'button';
            subItem.setAttribute('data-tab-id', prov.id);

            const subLabel = document.createElement('span');
            subLabel.className = 'da-sidebar-item__label';
            subLabel.textContent = prov.name;
            subItem.appendChild(subLabel);

            subItem.addEventListener('click', () => {
                this.switchTab(prov.id);
            });

            this.providerSubItemsContainer.appendChild(subItem);
            this.sidebarItems.set(prov.id, subItem);
        }

        this.updateSidebarHighlight(this.activeTabId);
    }

    /**
     * 注册当前弹窗至全局浮层栈，栈顶时响应 Escape 键关闭。
     */
    private bindKeyboardEvents(): void {
        this.unbindKeyboardEvents();
        this.removeOverlayEntry = overlayStack.push('settings-modal', () => {
            if (this.isOpenState) {
                this.close();
            }
        });
    }

    /**
     * 从全局浮层栈注销当前弹窗的 Escape 响应。
     */
    private unbindKeyboardEvents(): void {
        if (this.removeOverlayEntry) {
            this.removeOverlayEntry();
            this.removeOverlayEntry = null;
        }
    }

    /**
     * 打开或重开初次使用引导弹窗（幂等防重复堆叠）。
     */
    public openOnboardingGuide(): void {
        if (this.activeGuideModal) {
            return;
        }
        this.activeGuideModal = openOnboardingGuideModal({
            onClose: () => {
                this.activeGuideModal = null;
            },
        });
    }

    private closeOnboardingGuide(): void {
        if (this.activeGuideModal) {
            const modal = this.activeGuideModal;
            this.activeGuideModal = null;
            modal.dispose();
        }
    }

    private getTabTitle(tabId: string): string {
        const prov = PROVIDER_DEFINITIONS.find((p) => p.id === tabId);
        if (prov) {
            return `${prov.name} 设置`;
        }
        const norm = NORMAL_TABS.find((t) => t.id === tabId);
        if (norm) {
            return norm.title;
        }
        return tabId;
    }

    private getProviderDisplayName(type: ProviderType): string {
        const found = PROVIDER_DEFINITIONS.find((p) => p.id === type);
        return found ? found.name : type;
    }

    private safeActivate(view: TabView | null): void {
        if (!view) {
            return;
        }
        if ('activate' in view && typeof (view as SettingsView).activate === 'function') {
            (view as SettingsView).activate();
        }
    }

    private safeDeactivate(view: TabView | null): void {
        if (!view) {
            return;
        }
        if ('deactivate' in view && typeof (view as SettingsView).deactivate === 'function') {
            (view as SettingsView).deactivate();
        }
    }
}
