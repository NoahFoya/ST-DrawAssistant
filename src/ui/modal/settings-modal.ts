/**
 * 设置模态外壳组件 (SettingsModal)。
 *
 * @remarks
 * 负责主设置面板的布局渲染、选项卡切换与生命周期管理：
 * 1. 顶栏：标题、版本号、使用引导帮助按钮、主题切换与关闭按钮；
 * 2. 侧边栏：插件设置、各生图服务选项卡及扩展功能导航；
 * 3. 内容区：按需加载并缓存各选项卡视图；
 * 4. 底栏：当前生效生图服务的连通性状态与延迟检测。
 */

import type { Disposable, UIComponent, SettingsView } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { themeService } from '../theme/theme-service';
import { providerRegistry } from '../../provider/registry';
import { ICONS, renderIcon } from '../components/icons';
import { tooltipService } from '../feedback/tooltip-service';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import {
    logConnectionFailure,
    showConnectionDiagnosticsModal,
} from '../feedback/error-feedback';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { logger } from '../../util/logger';
import { updateService } from '../../pipeline/update-service';
import { AssetSyncCoordinator } from '../../pipeline/asset-sync-coordinator';
import { EXTENSION_TITLE, EXTENSION_VERSION } from '../../config/constants';
import { isCompactMobileViewport, viewportService } from '../layout/viewport';
import {
    openOnboardingGuideModal,
    type GuideSectionId,
    type OnboardingGuideModal,
    type OnboardingGuideModalOptions,
} from './onboarding-guide-modal';
import { openChangelogModal } from './changelog-modal';
import type { ProviderHealthResult, ProviderStoredConfig, ProviderType } from '@types';

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
        heading.className = 'da-tab-placeholder__title';
        heading.textContent = title;

        const desc = document.createElement('p');
        desc.className = 'da-tab-placeholder__desc';
        desc.textContent = description;

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
    { id: 'gemini', name: 'Google Gemini' },
    { id: 'grok', name: 'xAI Grok' },
];

/** 侧边栏非服务普通选项卡定义 */
interface NormalTabDefinition {
    id: string;
    title: string;
    isDivider?: boolean;
    disabled?: boolean;
}

const NORMAL_TABS: NormalTabDefinition[] = [
    { id: 'general', title: '插件设置' },
    { id: 'prompts', title: '提示词' },
    { id: 'materials', title: '素材管理' },
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
    private sidebarElement: HTMLElement | null = null;
    private mobileSubHostElement: HTMLElement | null = null;
    private providerSubAnchor: Comment | null = null;
    private contentAreaElement: HTMLElement | null = null;
    private statusDotElement: HTMLElement | null = null;
    private statusTextElement: HTMLElement | null = null;
    private providerTitleTextElement: HTMLElement | null = null;
    private providerDrawerToggle: HTMLButtonElement | null = null;
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
    private updateAbortController: AbortController | null = null;
    private assetSyncAbortController: AbortController | null = null;

    // 全局事件解绑函数与更新状态徽标
    private unlistenSettings: (() => void) | null = null;
    private unlistenUpdate: (() => void) | null = null;
    private unlistenHealthUpdate: (() => void) | null = null;
    private unlistenViewport: (() => void) | null = null;
    private removeOverlayEntry: (() => void) | null = null;
    private removeBackdropDismiss: (() => void) | null = null;
    private versionBadgeElement: HTMLElement | null = null;
    private activeGuideModal: OnboardingGuideModal | null = null;
    private activeChangelogModal: Disposable | null = null;
    private isPromptingClose = false;
    private isPromptingSwitch = false;
    private lastHealthErrorDetails: {
        providerType: ProviderType;
        url: string;
        message: string;
    } | null = null;

    constructor(private readonly options: SettingsModalOptions = {}) {
        if (options.defaultTab) {
            this.activeTabId = options.defaultTab;
        }

        // 监听版本更新状态变更，同步顶栏版本胶囊提示
        this.unlistenUpdate = eventBus.on('update:status-changed', (state) => {
            this.syncVersionBadgeState(Boolean(state.hasUpdate));
        });

        // 监听连接卡片连通性检测与配置变更，保持底栏状态同步
        this.unlistenHealthUpdate = eventBus.on('provider:health-updated', (payload) => {
            if (!this.isOpenState || payload.providerType !== this.getActiveProviderType()) {
                return;
            }
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
            this.applyHealthStatus(payload.providerType, payload.result, { logFailure: false });
            this.scheduleNextHealthCheck();
        });

        // 监听配置中心变更，响应活跃提供方与主题同步
        this.unlistenSettings = eventBus.on('settings:updated', (data) => {
            if (data.key === 'activeProvider' || data.keys?.includes('activeProvider')) {
                this.updateProviderLabels();
                const newActive = this.getActiveProviderType();
                this.assetSyncAbortController?.abort();
                this.assetSyncAbortController = new AbortController();
                void AssetSyncCoordinator.syncProviderAssets(newActive, {
                    isManual: false,
                    silentIfNoChange: true,
                    signal: this.assetSyncAbortController.signal,
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
                    if (typeof (view as SettingsView).discardUnsavedChanges === 'function') {
                        (view as SettingsView).discardUnsavedChanges?.();
                    }
                    if (tabId !== this.activeTabId) {
                        view.dispose?.();
                        this.viewsCache.delete(tabId);
                    } else if (this.isOpenState && 'activate' in view && typeof view.activate === 'function') {
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
                void this.switchTab(tabId);
            }
            return;
        }

        this.isOpenState = true;
        tooltipService.mount();
        this.buildDOM();

        const parent = this.options.parent ?? (typeof document !== 'undefined' ? document.body : null);
        if (parent && this.backdropElement) {
            parent.appendChild(this.backdropElement);
        }

        // 注册全局浮层栈 Escape 响应
        this.bindKeyboardEvents();

        // 注册页面可见性监听（失焦冻结轮询，切回前台唤醒；仅针对支持周期轮询的本地后端）
        if (typeof document !== 'undefined') {
            this.onVisibilityChangeHandler = () => {
                if (
                    document.visibilityState === 'visible' &&
                    this.isOpenState &&
                    this.shouldPollActiveProviderHealth()
                ) {
                    void this.checkActiveProviderHealth();
                } else if (document.visibilityState === 'hidden' && this.healthTimer !== null) {
                    clearTimeout(this.healthTimer);
                    this.healthTimer = null;
                }
            };
            document.addEventListener('visibilitychange', this.onVisibilityChangeHandler);
        }

        // 判断是否存在尚未阅读的版本升级说明（存在时不与页面首次引导叠加弹窗）
        const shouldShowChangelog = updateService.hasPendingChangelogNotice();

        // 切换至目标选项卡
        const targetTab = tabId || this.activeTabId || this.options.defaultTab || 'general';
        void this.switchTab(targetTab, {
            suppressGuide: shouldShowChangelog,
            skipUnsavedCheck: true,
        });

        // 启动底栏连通性检测（重置连续失败计数器）
        this.consecutiveHealthFailures = 0;
        void this.checkActiveProviderHealth();

        // 打开设置面板时自动静默检查一次更新（绑定弹窗生命周期中止信号，受冷却时间保护）
        this.updateAbortController?.abort();
        this.updateAbortController = new AbortController();
        void updateService.checkUpdate({
            force: false,
            signal: this.updateAbortController.signal,
        });

        this.options.onOpen?.();

        if (shouldShowChangelog) {
            this.openChangelogPopup();
        }
    }

    /**
     * 交互式关闭入口：若存在未保存的草稿修改，弹窗询问保存、放弃或继续编辑。
     */
    public async requestClose(): Promise<void> {
        if (!this.isOpenState || this.isPromptingClose || this.isPromptingSwitch) {
            return;
        }

        const dirtyViews: Array<{ tabId: string; title: string; view: SettingsView }> = [];
        for (const [tabId, view] of this.viewsCache.entries()) {
            const sv = view as SettingsView;
            if (typeof sv.hasUnsavedChanges === 'function' && sv.hasUnsavedChanges()) {
                dirtyViews.push({
                    tabId,
                    title: sv.title || this.getTabTitle(tabId),
                    view: sv,
                });
            }
        }

        if (dirtyViews.length === 0) {
            this.close();
            return;
        }

        this.isPromptingClose = true;
        try {
            const tabNames = dirtyViews.map((item) => `「${item.title}」`).join('、');
            const choice = await ConfirmDialog.choose({
                title: '存在未保存修改',
                message: `${tabNames}存在未保存的预设修改，是否在关闭前保存？`,
                primaryText: '保存并关闭',
                secondaryText: '放弃修改',
                cancelText: '继续编辑',
                isSecondaryDanger: true,
            });

            if (!this.isOpenState || choice === 'cancel') {
                return;
            }

            if (choice === 'primary') {
                for (const item of dirtyViews) {
                    if (typeof item.view.saveUnsavedChanges === 'function') {
                        const ok = await item.view.saveUnsavedChanges();
                        if (!this.isOpenState) {
                            return;
                        }
                        if (ok === false) {
                            if (this.activeTabId !== item.tabId) {
                                void this.switchTab(item.tabId, { skipUnsavedCheck: true });
                            }
                            return;
                        }
                    }
                }
                this.close();
                return;
            }

            if (choice === 'secondary') {
                for (const item of dirtyViews) {
                    item.view.discardUnsavedChanges?.();
                }
                this.close();
            }
        } finally {
            this.isPromptingClose = false;
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
        this.closeChangelogPopup();
        ConfirmDialog.dispose();
        tooltipService.hide();
        this.isOpenState = false;
        this.isPromptingClose = false;
        this.isPromptingSwitch = false;

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
        if (this.updateAbortController !== null) {
            this.updateAbortController.abort();
            this.updateAbortController = null;
        }
        if (this.assetSyncAbortController !== null) {
            this.assetSyncAbortController.abort();
            this.assetSyncAbortController = null;
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
     * 切换至指定选项卡；若当前激活页存在未保存修改则先弹窗询问保存或放弃。
     *
     * @param tabId 目标选项卡 ID
     * @param options 切换控制项（无脏改或 skipUnsavedCheck 时在首个 await 前同步完成 DOM 切换）
     * @returns 是否已完成切换
     */
    public async switchTab(
        tabId: string,
        options?: {
            readonly suppressGuide?: boolean;
            readonly skipUnsavedCheck?: boolean;
        }
    ): Promise<boolean> {
        tooltipService.hide();
        // 若点击的是生图服务主条目，则重定向至当前生效的具体服务
        const resolvedTabId =
            tabId === 'provider-main' ? this.getActiveProviderType() : tabId;

        // 重复点击当前已激活且已挂载的页签时保持幂等
        if (this.activeView && resolvedTabId === this.activeTabId) {
            this.updateSidebarHighlight(resolvedTabId);
            return true;
        }

        if (!options?.skipUnsavedCheck) {
            if (this.isPromptingSwitch || this.isPromptingClose) {
                return false;
            }

            const currentView = this.activeView as SettingsView | null;
            const currentTabId = this.activeTabId;
            if (
                currentView &&
                typeof currentView.hasUnsavedChanges === 'function' &&
                currentView.hasUnsavedChanges()
            ) {
                const wasOpenBeforeAwait = this.isOpenState;
                const currentTitle = currentView.title || this.getTabTitle(currentTabId);
                this.isPromptingSwitch = true;
                try {
                    const choice = await ConfirmDialog.choose({
                        title: '存在未保存修改',
                        message: `「${currentTitle}」存在未保存的修改，是否在切换前保存？`,
                        primaryText: '保存并切换',
                        secondaryText: '放弃修改',
                        cancelText: '继续编辑',
                        isSecondaryDanger: true,
                    });

                    if (
                        (wasOpenBeforeAwait && !this.isOpenState) ||
                        this.activeView !== currentView ||
                        this.activeTabId !== currentTabId
                    ) {
                        return false;
                    }

                    if (choice === 'cancel') {
                        return false;
                    }

                    if (choice === 'primary') {
                        if (typeof currentView.saveUnsavedChanges === 'function') {
                            const ok = await currentView.saveUnsavedChanges();
                            if ((wasOpenBeforeAwait && !this.isOpenState) || ok === false) {
                                return false;
                            }
                        }
                    } else if (choice === 'secondary') {
                        currentView.discardUnsavedChanges?.();
                    }
                } finally {
                    this.isPromptingSwitch = false;
                }
            }
        }

        this.performTabTransition(resolvedTabId, options);
        return true;
    }

    /** 执行实际的选项卡 DOM 切换、视图生命周期触发与侧栏高亮 */
    private performTabTransition(
        resolvedTabId: string,
        options?: { readonly suppressGuide?: boolean }
    ): void {
        // 若切换到收纳在服务抽屉中的非当前生效生图服务，自动展开抽屉以高亮对应子项；
        // 在紧凑移动端切换至非生图服务选项卡时则收起二级胶囊栏，释放内容区视高
        const isProviderTab = PROVIDER_DEFINITIONS.some((p) => p.id === resolvedTabId);
        if (isProviderTab && resolvedTabId !== this.getActiveProviderType()) {
            this.toggleProviderExpanded(true);
        } else if (!isProviderTab && isCompactMobileViewport() && this.isServiceExpanded) {
            this.toggleProviderExpanded(false);
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

        // 首次进入对应页面时自动弹出所属部分的新手引导
        if (!options?.suppressGuide) {
            this.checkAndTriggerContextualGuide(resolvedTabId);
        }
    }

    /**
     * 展开或收起生图服务列表。
     *
     * @param force 指定展开状态，缺省为切换
     */
    public toggleProviderExpanded(force?: boolean): void {
        this.isServiceExpanded = typeof force === 'boolean' ? force : !this.isServiceExpanded;

        this.sidebarItems
            .get('provider-main')
            ?.classList.toggle('is-expanded', this.isServiceExpanded);
        if (this.providerDrawerToggle) {
            this.providerDrawerToggle.classList.toggle('is-expanded', this.isServiceExpanded);
            this.providerDrawerToggle.setAttribute(
                'aria-expanded',
                this.isServiceExpanded ? 'true' : 'false'
            );
        }

        this.syncProviderSubItemsPlacement();
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
     * 判断当前激活引擎是否需要启动后台周期健康轮询。
     * 依据 Provider 实例的 `supportsHealthPolling` 能力标记判定（默认为 true，云端 HTTP 服务设为 false）。
     */
    private shouldPollActiveProviderHealth(): boolean {
        const provider = providerRegistry.getProvider(this.getActiveProviderType());
        return provider?.supportsHealthPolling !== false;
    }

    /**
     * 调度下一次底栏服务健康检查。
     *
     * @remarks
     * 1. 若当前激活服务的 `supportsHealthPolling === false`，不启动后台周期轮询；
     * 2. 页面可见性感知：当浏览器标签页处于后台隐藏状态时，冻结轮询，切回前台时唤醒；
     * 3. 连续失败动态退避：正常在线时维持 15 秒轮询；初次失败延长至 30 秒；持续失败延长至 60 秒；
     *    连续失败达 4 次后挂起自动轮询，避免在离线状态下向宿主中继终端产生持续报错噪音；
     * 4. 用户交互即时唤醒：用户切换选项卡、变更激活服务或修改服务地址时重置计数器并立即唤醒。
     *
     * @param delayMs 可选的指定延迟毫秒数
     */
    private scheduleNextHealthCheck(delayMs?: number): void {
        if (!this.isOpenState || !this.shouldPollActiveProviderHealth()) return;

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

    private resolveProviderServerUrl(providerType: ProviderType): string {
        const provider = providerRegistry.getProvider(providerType);
        if (typeof provider?.getServerUrl === 'function') {
            return provider.getServerUrl();
        }
        return settingsStore.getProviderConfig<ProviderStoredConfig>(providerType)?.serverUrl ?? '';
    }

    /**
     * 统一应用并渲染底栏生图服务健康状态。
     */
    private applyHealthStatus(
        providerType: ProviderType,
        result: ProviderHealthResult | null,
        options?: { logFailure?: boolean; rawError?: unknown }
    ): void {
        if (!this.statusDotElement || !this.statusTextElement) {
            return;
        }
        const providerName = this.getProviderDisplayName(providerType);
        const statusContainer = this.statusDotElement.parentElement;

        if (result === null) {
            this.consecutiveHealthFailures = 0;
            this.lastHealthErrorDetails = null;
            this.statusDotElement.className = 'da-status-dot da-status-idle';
            this.statusTextElement.textContent = `${providerName}: 待检测`;
            this.statusTextElement.title = '点击检测服务连接';
            statusContainer?.setAttribute('title', '点击检测服务连接');
            return;
        }

        if (result.status === 'ok') {
            this.consecutiveHealthFailures = 0;
            this.lastHealthErrorDetails = null;
            this.statusDotElement.className = 'da-status-dot da-status-ok';
            const latencyStr = typeof result.latencyMs === 'number' ? ` (${result.latencyMs}ms)` : '';
            this.statusTextElement.textContent = `${providerName}: 在线${latencyStr}`;
            const tip = `${providerName} 响应正常${latencyStr}`;
            this.statusTextElement.title = tip;
            statusContainer?.setAttribute('title', tip);
            return;
        }

        const serverUrl = this.resolveProviderServerUrl(providerType);
        if (result.suggestedUrl) {
            this.consecutiveHealthFailures++;
            const msg = result.message || `检测到可用地址: ${result.suggestedUrl}`;
            this.lastHealthErrorDetails = { providerType, url: serverUrl, message: msg };
            this.statusDotElement.className = 'da-status-dot da-status-warn';
            this.statusTextElement.textContent = `${providerName}: 地址需补全`;
            const tip = '点击查看建议地址与排查指引';
            this.statusTextElement.title = tip;
            statusContainer?.setAttribute('title', tip);
            return;
        }

        this.consecutiveHealthFailures++;
        const rawMsg = result.message || '网络连接异常';
        if (options?.logFailure !== false) {
            logConnectionFailure({
                scope: 'SettingsModal',
                providerType,
                url: serverUrl,
                message: rawMsg,
                rawError: options?.rawError,
            });
        }
        this.lastHealthErrorDetails = { providerType, url: serverUrl, message: rawMsg };
        this.statusDotElement.className = 'da-status-dot da-status-error';
        this.statusTextElement.textContent = `${providerName}: 连接失败`;
        const tip = '点击查看排查指引与重新检测';
        this.statusTextElement.title = tip;
        statusContainer?.setAttribute('title', tip);
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
        const currentController = new AbortController();
        this.abortController = currentController;

        const activeProvider = this.getActiveProviderType();
        const providerName = this.getProviderDisplayName(activeProvider);

        this.lastHealthErrorDetails = null;
        this.statusDotElement.className = 'da-status-dot da-status-checking';
        this.statusTextElement.textContent = `${providerName}: 检测中...`;
        this.statusDotElement.parentElement?.setAttribute('title', '正在检测服务连接...');

        try {
            const provider = providerRegistry.getProvider(activeProvider);
            if (!provider || typeof provider.checkHealth !== 'function') {
                this.statusDotElement.className = 'da-status-dot da-status-warn';
                this.statusTextElement.textContent = `${providerName}: 未注册`;
                return;
            }

            const result = await provider.checkHealth(currentController.signal);
            if (
                currentController.signal.aborted ||
                this.abortController !== currentController ||
                !this.isOpenState ||
                !this.statusDotElement ||
                !this.statusTextElement
            ) {
                return;
            }

            this.applyHealthStatus(activeProvider, result, { logFailure: true });
        } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === 'AbortError';
            if (
                isAbort ||
                currentController.signal.aborted ||
                this.abortController !== currentController ||
                !this.isOpenState ||
                !this.statusDotElement ||
                !this.statusTextElement
            ) {
                return;
            }
            const msg = err instanceof Error ? err.message : String(err || '网络异常');
            this.applyHealthStatus(
                activeProvider,
                { status: 'error', message: msg },
                { logFailure: true, rawError: err }
            );
        } finally {
            if (
                this.isOpenState &&
                this.abortController === currentController &&
                !currentController.signal.aborted
            ) {
                this.scheduleNextHealthCheck();
            }
        }
    }

    /**
     * 释放弹窗占用的资源、定时器与事件监听。
     */
    public dispose(): void {
        this.close();
        this.lastHealthErrorDetails = null;

        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }

        if (this.unlistenUpdate) {
            this.unlistenUpdate();
            this.unlistenUpdate = null;
        }
        if (this.unlistenHealthUpdate) {
            this.unlistenHealthUpdate();
            this.unlistenHealthUpdate = null;
        }
        if (this.unlistenViewport) {
            this.unlistenViewport();
            this.unlistenViewport = null;
        }
        this.versionBadgeElement = null;

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
        if (this.removeBackdropDismiss) {
            this.removeBackdropDismiss();
            this.removeBackdropDismiss = null;
        }
        if (this.backdropElement) {
            this.backdropElement.remove();
            this.backdropElement = null;
        }
        this.modalElement = null;
        this.sidebarElement = null;
        this.mobileSubHostElement = null;
        this.providerSubAnchor = null;
        this.contentAreaElement = null;
        this.statusDotElement = null;
        this.statusTextElement = null;
        this.providerTitleTextElement = null;
        this.providerDrawerToggle = null;
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

        // 1. 全屏毛玻璃遮罩层 (.da-modal-backdrop--fullscreen)
        this.backdropElement = document.createElement('div');
        this.backdropElement.className = 'da-modal-backdrop da-modal-backdrop--fullscreen st-da-root da-settings-modal-backdrop';

        this.removeBackdropDismiss?.();
        this.removeBackdropDismiss = bindBackdropDismiss(this.backdropElement, () => {
            void this.requestClose();
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

        this.unlistenViewport?.();
        this.unlistenViewport = viewportService.subscribe(() => {
            this.syncProviderSubItemsPlacement();
        });
        this.syncProviderSubItemsPlacement();
    }

    /** 同步顶栏版本徽标文案与更新可用态 */
    private syncVersionBadgeState(hasUpdate: boolean): void {
        if (!this.versionBadgeElement) return;
        this.versionBadgeElement.textContent = hasUpdate
            ? `v${EXTENSION_VERSION} · 可更新`
            : `v${EXTENSION_VERSION}`;
        this.versionBadgeElement.classList.toggle('da-header-badge--has-update', hasUpdate);
        this.versionBadgeElement.setAttribute(
            'title',
            hasUpdate
                ? '检测到新版本，点击前往「关于」查看并更新'
                : '点击查看关于与诊断信息'
        );
    }

    private buildHeaderBar(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'da-header-bar';

        // 1. 左侧标题与版本徽标
        const left = document.createElement('div');
        left.className = 'da-header-left';

        const title = document.createElement('h2');
        title.className = 'da-header-title';
        const brandPrefix = 'ST-DrawAssistant ';
        if (EXTENSION_TITLE.startsWith(brandPrefix)) {
            const prefixSpan = document.createElement('span');
            prefixSpan.className = 'da-header-title__prefix';
            prefixSpan.textContent = brandPrefix;
            const mainSpan = document.createElement('span');
            mainSpan.className = 'da-header-title__main';
            mainSpan.textContent = EXTENSION_TITLE.slice(brandPrefix.length);
            title.appendChild(prefixSpan);
            title.appendChild(mainSpan);
        } else {
            title.textContent = EXTENSION_TITLE;
        }

        const versionBadge = document.createElement('span');
        versionBadge.className = 'da-badge da-header-badge';
        versionBadge.setAttribute('role', 'button');
        versionBadge.setAttribute('tabindex', '0');
        this.versionBadgeElement = versionBadge;
        this.syncVersionBadgeState(Boolean(updateService.getState().hasUpdate));

        const onVersionClick = () => {
            void this.switchTab('about');
        };
        versionBadge.addEventListener('click', onVersionClick);
        versionBadge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onVersionClick();
            }
        });

        left.appendChild(title);
        left.appendChild(versionBadge);

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

        themeSelect.addEventListener('change', async () => {
            const newTheme = themeSelect.value;
            const prevTheme = themeService.getActiveThemeId();
            if (this.isPromptingClose || this.isPromptingSwitch) {
                themeSelect.value = prevTheme;
                return;
            }
            const themeView = this.viewsCache.get('theme') as SettingsView | undefined;
            if (themeView?.hasUnsavedChanges?.()) {
                this.isPromptingSwitch = true;
                try {
                    const confirmed = await ConfirmDialog.confirm({
                        title: '存在未保存的主题修改',
                        message: '「主题设置」中有未保存的修改。快捷切换主题将放弃这些修改，是否继续？',
                        confirmText: '放弃并切换',
                        cancelText: '取消',
                        isDanger: true,
                    });
                    if (!this.isOpenState) {
                        return;
                    }
                    if (!confirmed) {
                        themeSelect.value = prevTheme;
                        return;
                    }
                    themeView.discardUnsavedChanges?.();
                } finally {
                    this.isPromptingSwitch = false;
                }
            }
            settingsStore.set('activeThemePresetId', newTheme);
            themeService.applyCurrentTheme();
            if (this.activeView === themeView) {
                themeView?.activate?.();
            }
        });

        themeSelectorWrap.appendChild(themeSelect);

        const helpBtn = document.createElement('button');
        helpBtn.className = 'da-modal-help-btn';
        helpBtn.type = 'button';
        helpBtn.setAttribute('aria-label', '打开使用引导');
        helpBtn.setAttribute('title', '查看功能说明与使用引导');
        helpBtn.innerHTML = renderIcon('help', 15);
        helpBtn.addEventListener('click', () => {
            this.openOnboardingGuide();
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'da-modal-close-btn';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', '关闭设置面板');
        closeBtn.innerHTML = renderIcon('close', 16);
        closeBtn.addEventListener('click', () => {
            void this.requestClose();
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

        // 左侧导航侧边栏 (桌面端 190px；移动端折叠为顶部横向胶囊条)
        const sidebar = this.buildSidebarTabs();

        // 移动端生图服务二级胶囊宿主，仅在紧凑竖屏且服务抽屉展开时显隐
        this.mobileSubHostElement = document.createElement('div');
        this.mobileSubHostElement.className = 'da-sidebar-mobile-sub-host';

        // 右侧内容滚动主区
        this.contentAreaElement = document.createElement('div');
        this.contentAreaElement.className = 'da-modal-content';

        body.appendChild(sidebar);
        body.appendChild(this.mobileSubHostElement);
        body.appendChild(this.contentAreaElement);
        return body;
    }

    private buildSidebarTabs(): HTMLElement {
        const sidebar = document.createElement('nav');
        sidebar.className = 'da-sidebar-tabs';
        sidebar.setAttribute('aria-label', '设置选项卡导航');
        this.sidebarElement = sidebar;

        this.sidebarItems.clear();

        // 1. 插件设置项（置顶主要设置）
        const generalItem = this.createSidebarItem('general', '插件设置');
        sidebar.appendChild(generalItem);

        // 2. 生图服务主条目 + 抽屉下拉触发按钮（单行分体触发：名称切换生效服务页，箭头展开/收起服务抽屉）
        const providerMainItem = document.createElement('div');
        providerMainItem.className = 'da-sidebar-item da-sidebar-provider-item';
        providerMainItem.setAttribute('data-tab-id', 'provider-main');
        providerMainItem.classList.toggle('is-expanded', this.isServiceExpanded);

        const providerMainBtn = document.createElement('button');
        providerMainBtn.className = 'da-sidebar-provider-trigger';
        providerMainBtn.type = 'button';
        providerMainBtn.addEventListener('click', () => {
            void this.switchTab('provider-main');
        });

        this.providerTitleTextElement = document.createElement('span');
        this.providerTitleTextElement.className = 'da-sidebar-item__label';
        this.updateProviderTitleText();
        providerMainBtn.appendChild(this.providerTitleTextElement);

        const drawerToggle = document.createElement('button');
        drawerToggle.className = 'da-sidebar-drawer-toggle';
        drawerToggle.type = 'button';
        drawerToggle.setAttribute('aria-expanded', this.isServiceExpanded ? 'true' : 'false');
        drawerToggle.classList.toggle('is-expanded', this.isServiceExpanded);
        drawerToggle.setAttribute('aria-label', '展开或收起生图服务抽屉');

        const mobileBars = document.createElement('span');
        mobileBars.className = 'da-sidebar-drawer-toggle__bars';
        mobileBars.setAttribute('aria-hidden', 'true');

        const chevron = document.createElement('span');
        chevron.className = 'da-sidebar-drawer-toggle__chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.innerHTML = ICONS.chevronDown;

        drawerToggle.appendChild(mobileBars);
        drawerToggle.appendChild(chevron);
        drawerToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleProviderExpanded();
        });

        providerMainItem.appendChild(providerMainBtn);
        providerMainItem.appendChild(drawerToggle);
        providerMainItem.addEventListener('click', (e) => {
            const target = e.target as Node | null;
            if (target && (drawerToggle.contains(target) || providerMainBtn.contains(target))) {
                return;
            }
            void this.switchTab('provider-main');
        });

        this.providerDrawerToggle = drawerToggle;
        sidebar.appendChild(providerMainItem);
        this.sidebarItems.set('provider-main', providerMainItem);

        // 3. 其余生图服务子项抽屉容器（桌面端置于下方缩进列表；移动端挂入第二行横向胶囊宿主）
        this.providerSubAnchor = document.createComment('da-provider-sub-anchor');
        sidebar.appendChild(this.providerSubAnchor);

        this.providerSubItemsContainer = document.createElement('div');
        this.providerSubItemsContainer.className = 'da-sidebar-sub-items';

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
                void this.switchTab(tabId);
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
            if (this.lastHealthErrorDetails) {
                const details = this.lastHealthErrorDetails;
                void showConnectionDiagnosticsModal({
                    providerType: details.providerType,
                    url: details.url,
                    message: details.message,
                    onRetry: () => {
                        void this.checkActiveProviderHealth();
                    },
                });
                return;
            }
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

    private syncProviderSubItemsPlacement(): void {
        if (!this.providerSubItemsContainer) {
            return;
        }

        const isMobile =
            typeof window !== 'undefined' && isCompactMobileViewport();

        this.providerSubItemsContainer.classList.toggle('is-expanded', this.isServiceExpanded);

        if (isMobile && this.mobileSubHostElement) {
            if (this.providerSubItemsContainer.parentElement !== this.mobileSubHostElement) {
                this.mobileSubHostElement.appendChild(this.providerSubItemsContainer);
            }
            this.mobileSubHostElement.classList.toggle('is-visible', this.isServiceExpanded);
            return;
        }

        if (this.sidebarElement) {
            if (this.providerSubAnchor && this.providerSubAnchor.parentNode === this.sidebarElement) {
                if (this.providerSubItemsContainer.parentNode !== this.sidebarElement) {
                    this.sidebarElement.insertBefore(
                        this.providerSubItemsContainer,
                        this.providerSubAnchor.nextSibling
                    );
                }
            } else if (this.providerSubItemsContainer.parentNode !== this.sidebarElement) {
                this.sidebarElement.appendChild(this.providerSubItemsContainer);
            }
        }
        this.mobileSubHostElement?.classList.remove('is-visible');
    }

    private updateSidebarHighlight(activeId: string): void {
        const activeProvider = this.getActiveProviderType();
        let activeFocusEl: HTMLElement | null = null;

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
                if (id === activeId || !activeFocusEl) {
                    activeFocusEl = el;
                }
            } else {
                el.classList.remove('da-sidebar-item--active');
            }
        }

        if (
            activeFocusEl &&
            typeof window !== 'undefined' &&
            isCompactMobileViewport()
        ) {
            activeFocusEl.scrollIntoView?.({
                inline: 'center',
                block: 'nearest',
                behavior: 'smooth',
            });
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
        const wrapper = select.parentElement;
        const availableThemes = themeService.getAvailableThemes();
        const activeThemeId = ((settingsStore.get('activeThemePresetId') as string) || '').trim();
        const isDangling = Boolean(
            activeThemeId && !availableThemes.some((item) => item.id === activeThemeId)
        );

        select.innerHTML = '';
        if (availableThemes.length === 0) {
            const opt = document.createElement('option');
            if (isDangling) {
                opt.value = activeThemeId;
                opt.textContent = activeThemeId;
            } else {
                opt.value = '';
                opt.textContent = '暂无可用主题';
                opt.disabled = true;
            }
            select.appendChild(opt);
            select.disabled = true;
            select.value = isDangling ? activeThemeId : '';
        } else {
            select.disabled = false;
            if (isDangling) {
                const missingOpt = document.createElement('option');
                missingOpt.value = activeThemeId;
                missingOpt.textContent = activeThemeId;
                select.appendChild(missingOpt);
            }
            for (const item of availableThemes) {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.name;
                select.appendChild(opt);
            }
            select.value = activeThemeId || availableThemes[0].id;
        }

        wrapper?.classList.toggle('is-invalid', isDangling);
        select.classList.toggle('is-invalid', isDangling);
        select.title = isDangling
            ? `当前主题预设不存在或已失效 (ID: ${activeThemeId})`
            : '快捷切换界面主题';
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
        for (const prov of PROVIDER_DEFINITIONS) {
            this.sidebarItems.delete(prov.id);
        }
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
                void this.switchTab(prov.id);
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
        this.removeOverlayEntry = overlayStack.push(
            'settings-modal',
            () => {
                if (this.isOpenState) {
                    void this.requestClose();
                }
            },
            () => this.close()
        );
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
     * 按当前所在选项卡推导出所属新手引导定位参数。
     */
    private resolveGuideContextForTab(tabId: string): {
        readonly section: GuideSectionId;
        readonly provider: ProviderType;
    } {
        if (PROVIDER_DEFINITIONS.some((p) => p.id === tabId)) {
            return { section: 'provider', provider: tabId as ProviderType };
        }
        if (tabId === 'prompts' || tabId === 'materials') {
            return { section: 'prompts', provider: this.getActiveProviderType() };
        }
        return { section: 'plugin', provider: this.getActiveProviderType() };
    }

    /**
     * 首次进入指定页面（插件设置 / 各自服务端 / 提示词或素材管理）时自动触发对应部分的新手引导。
     */
    private checkAndTriggerContextualGuide(resolvedTabId: string): void {
        if (
            !this.isOpenState ||
            !Boolean(settingsStore.get('isInitialized')) ||
            this.activeGuideModal ||
            this.activeChangelogModal
        ) {
            return;
        }

        const uiCfg = settingsStore.get('ui');
        const seenGuides = uiCfg?.seenGuides ?? {};

        if (resolvedTabId === 'general') {
            if (Boolean(seenGuides.plugin)) {
                return;
            }
            settingsStore.set('ui', {
                ...uiCfg,
                seenGuides: {
                    ...seenGuides,
                    plugin: true,
                },
            });
            updateService.markChangelogAsSeen();
            this.openOnboardingGuide({
                section: 'plugin',
                provider: this.getActiveProviderType(),
            });
            return;
        }

        if (resolvedTabId === 'prompts' || resolvedTabId === 'materials') {
            if (Boolean(seenGuides.prompts)) {
                return;
            }
            settingsStore.set('ui', {
                ...uiCfg,
                seenGuides: {
                    ...seenGuides,
                    prompts: true,
                },
            });
            this.openOnboardingGuide({
                section: 'prompts',
                provider: this.getActiveProviderType(),
            });
            return;
        }

        if (PROVIDER_DEFINITIONS.some((p) => p.id === resolvedTabId)) {
            const prov = resolvedTabId as ProviderType;
            if (Boolean(seenGuides.providers?.[prov])) {
                return;
            }
            settingsStore.set('ui', {
                ...uiCfg,
                seenGuides: {
                    ...seenGuides,
                    providers: {
                        ...(seenGuides.providers ?? {}),
                        [prov]: true,
                    },
                },
            });
            this.openOnboardingGuide({
                section: 'provider',
                provider: prov,
            });
        }
    }

    /**
     * 打开或重开分场景使用引导弹窗（幂等防重复堆叠；默认按当前所在页自动定位对应部分）。
     */
    public openOnboardingGuide(
        overrideOptions?: Pick<OnboardingGuideModalOptions, 'section' | 'provider'>
    ): void {
        if (this.activeGuideModal) {
            return;
        }
        const resolved = this.resolveGuideContextForTab(this.activeTabId);
        this.activeGuideModal = openOnboardingGuideModal({
            section: overrideOptions?.section ?? resolved.section,
            provider: overrideOptions?.provider ?? resolved.provider,
            onClose: () => {
                this.activeGuideModal = null;
            },
            onNavigateTarget: (targetTabId) => {
                void this.switchTab(targetTabId);
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

    /** 打开未读版本更新说明弹窗（幂等防重复堆叠） */
    private openChangelogPopup(): void {
        if (this.activeChangelogModal) {
            return;
        }
        this.activeChangelogModal = openChangelogModal({
            onClose: () => {
                this.activeChangelogModal = null;
            },
            onNavigateToPresetManager: () => {
                void (async () => {
                    const switched = await this.switchTab('about');
                    if (switched && this.isOpenState) {
                        requestAnimationFrame(() => {
                            document
                                .getElementById('da-about-static-presets')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        });
                    }
                })();
            },
        });
    }

    private closeChangelogPopup(): void {
        if (this.activeChangelogModal) {
            const modal = this.activeChangelogModal;
            this.activeChangelogModal = null;
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
