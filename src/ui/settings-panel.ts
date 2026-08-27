/**
 * @module ui/settings-panel
 * @description 设置面板 UI 控制器与主模态框调度器
 *
 * 职责：
 * - 渲染带有顶栏、左侧 Tab 导航栏、右侧内容栏、底栏的主模态框
 * - 结合 FAB 悬浮球及顶栏 macOS 风格红点按钮控制显隐
 * - 管理 10 大 Tab 的动态切换与激活 (general / comfyui / sd-webui / gallery / character / vocabulary / theme / fab-settings / about / diagnostics)
 * - 内聚实现 FooterBar 底栏状态栏 (包含 10s 服务器连通性心跳探针与 3s JS Heap 内存开销监测)
 */

import { VERSION } from '../core/constants';
import { loadSettings } from '../settings/manager';
import { DEFAULT_THEME_PROFILES } from '../settings/defaults';
import type { ThemeData, PresetProfileItem } from '../settings/types';
import { showToastNotice, showToastError } from '../utils/toast';
import { renderGeneralTab } from './tabs/general-tab';
import { renderComfyUITab } from './tabs/comfyui-tab';
import { renderThemeTab, applyPluginTheme } from './tabs/theme-tab';
import { renderFABSettingsTab } from './tabs/fab-settings-tab';
import { renderGalleryTab } from './tabs/gallery-tab';
import { renderCharacterTab } from '../extensions/character-manager';
import { renderDiagnosticsTab } from './tabs/diagnostics-tab';
import { renderAboutTab } from './tabs/about-tab';
import { toggleFABPanelState } from './fab';
import { isExtensionEnabled } from '../core/extension-registry';
import { unsavedStateManager } from './feedback-service';
import { type IDisposable } from '../core/disposable';
import { patchSettings } from '../state/app-store';

export type TabId =
    | 'general'
    | 'comfyui'
    | 'sd-webui'
    | 'gallery'
    | 'character'
    | 'vocabulary'
    | 'theme'
    | 'fab-settings'
    | 'about'
    | 'diagnostics';

interface TabItem {
    id: TabId;
    label: string;
    icon: string;
}

/**
 * 根据当前选择的生图引擎及设置动态生成侧边栏 Tab 列表
 *
 * @returns 包含已激活 Tab 项清单的数组
 */
export function getActiveTabItems(): TabItem[] {
    const settings = loadSettings();
    const provider = settings.provider ?? 'comfyui';

    const items: TabItem[] = [
        { id: 'general', label: '主要', icon: '' },
    ];

    // 根据当前模式显示生图引擎 Tab
    if (provider === 'comfyui') {
        items.push({ id: 'comfyui', label: 'ComfyUI', icon: '' });
    } else if (provider === 'sd-webui') {
        items.push({ id: 'sd-webui', label: 'SD-WebUI', icon: '' });
    }

    // 仅在角色管理扩展启用时显示角色管理 Tab
    if (isExtensionEnabled('character-manager')) {
        items.push({ id: 'character', label: '角色管理', icon: '' });
    }

    // 图库、主题、悬浮窗、日志与统计、关于
    items.push(
        { id: 'gallery', label: '图库', icon: '' },
        { id: 'theme', label: '主题', icon: '' },
        { id: 'fab-settings', label: '悬浮窗', icon: '' },
        { id: 'diagnostics', label: '日志与统计', icon: '' },
        { id: 'about', label: '关于', icon: '' }
    );

    return items;
}

let mainModalEl: HTMLElement | null = null;
let currentActiveTab: TabId = 'general'; // 默认聚焦在主要设置 Tab
/** 当前激活 Tab 的资源袋，切换时自动 dispose 清理订阅 */
let _activeTabBag: IDisposable | null = null;

let footerElement: HTMLElement | null = null;
let heartbeatTimer: number | null = null;
let memoryTimer: number | null = null;
let _heartbeatAbortController: AbortController | null = null;
let _unsavedUnsubscribe: (() => void) | null = null;

/**
 * 启动底部状态栏的心跳连通性检测与 JS Heap 内存轮询
 */
function startTelemetry(): void {
    void checkServerConnection();
    updateMemoryUsage();

    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(() => {
        void checkServerConnection();
    }, 10000);

    if (memoryTimer !== null) clearInterval(memoryTimer);
    memoryTimer = window.setInterval(() => {
        updateMemoryUsage();
    }, 3000);
}

/**
 * 停止底部状态栏轮询（在主面板隐藏/销毁时调用）
 */
export function stopTelemetry(): void {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (memoryTimer !== null) {
        clearInterval(memoryTimer);
        memoryTimer = null;
    }
    if (_heartbeatAbortController) {
        _heartbeatAbortController.abort();
        _heartbeatAbortController = null;
    }
    if (_unsavedUnsubscribe) {
        _unsavedUnsubscribe();
        _unsavedUnsubscribe = null;
    }
}

/**
 * 真实探测后端服务器连通性与响应延迟 (支持 ComfyUI / SD-WebUI / NovelAI 多探针)
 */
async function checkServerConnection(): Promise<void> {
    const statusText = footerElement?.querySelector<HTMLElement>('#da-server-status-text');
    const statusDot = footerElement?.querySelector<HTMLElement>('.da-status-dot');
    if (!statusText || !statusDot) return;

    const settings = loadSettings();
    const serverUrl = settings.serverUrl ? settings.serverUrl.replace(/\/+$/, '') : 'http://127.0.0.1:8188';
    const provider = settings.provider ?? 'comfyui';

    const providerLabelMap: Record<string, string> = {
        comfyui: 'ComfyUI',
        'sd-webui': 'SD-WebUI',
        novelai: 'NovelAI',
    };
    const label = providerLabelMap[provider] ?? provider.toUpperCase();

    const probeEndpointMap: Record<string, string> = {
        comfyui: '/system_stats',
        'sd-webui': '/sdapi/v1/options',
        novelai: '/',
    };
    const endpoint = probeEndpointMap[provider] ?? '/';

    const startTime = performance.now();
    try {
        _heartbeatAbortController?.abort();
        const controller = new AbortController();
        _heartbeatAbortController = controller;
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const resp = await fetch(`${serverUrl}${endpoint}`, {
            method: 'GET',
            headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        _heartbeatAbortController = null;
        const latency = Math.round(performance.now() - startTime);

        if (resp.ok || resp.status === 401 || resp.status === 404) {
            statusDot.className = 'da-status-dot da-status-ok';
            statusText.textContent = `${label}: 已连通 (${serverUrl}) | ${latency}ms`;
        } else {
            statusDot.className = 'da-status-dot da-status-error';
            statusText.textContent = `${label}: 响应异常 (HTTP ${resp.status})`;
        }
    } catch {
        statusDot.className = 'da-status-dot da-status-error';
        statusText.textContent = `${label}: 未连接 (${serverUrl})`;
    }
}

/**
 * 真实监测 JS Heap 内存开销
 */
function updateMemoryUsage(): void {
    const memText = footerElement?.querySelector<HTMLElement>('#da-memory-status-text');
    if (!memText) return;

    const perf = window.performance as unknown as {
        memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
        };
    };

    if (perf.memory && perf.memory.usedJSHeapSize) {
        const usedMB = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
        memText.textContent = `JS Heap: ${usedMB} MB`;
    } else {
        memText.textContent = `内存状态: 正常 (运行中)`;
    }
}

/**
 * 归一化渲染主模态框底栏状态栏区块 (FooterBar Section)
 *
 * @returns 包含连通性心跳与 JS Heap 内存监控的底栏 DOM 节点
 */
function renderFooterBarSection(): HTMLElement {
    if (footerElement) {
        stopTelemetry();
    }

    footerElement = document.createElement('div');
    footerElement.className = 'da-footer-bar';
    footerElement.innerHTML = `
        <div class="da-status-item" id="da-server-status-container">
            <span class="da-status-dot da-status-checking"></span>
            <span class="da-status-info" id="da-server-status-text">检测服务器连接中...</span>
        </div>
        <div class="da-status-item da-memory-info" id="da-memory-status-container">
            <span class="da-status-dot da-status-ok"></span>
            <span class="da-status-info" id="da-memory-status-text">图片库缓存 0 张</span>
        </div>
    `;

    startTelemetry();
    return footerElement;
}

/**
 * 渲染并挂载主组件设置模态框 (包含顶栏、侧边栏 Tab 导航、中央内容区与底部状态栏)
 *
 * @returns 主模态框 DOM 节点
 */
export function renderSettingsPanel(): HTMLElement {
    if (mainModalEl) {
        return mainModalEl;
    }

    // 创建主模态框容器
    mainModalEl = document.createElement('div');
    mainModalEl.id = 'da-main-modal-backdrop';
    mainModalEl.className = 'da-modal-backdrop';
    mainModalEl.style.display = 'none'; // 默认隐藏，由 FAB 控显

    const modalInner = document.createElement('div');
    modalInner.className = 'da-settings-panel da-main-modal-inner';
    modalInner.addEventListener('click', (e) => e.stopPropagation());

    // 1. 顶栏 (Header Bar - 已删除关闭按钮，极简优雅)
    const headerBar = renderHeaderBar();
    modalInner.appendChild(headerBar);

    // 2. 主体容器 (Body Container = 左侧 Sidebar + 右侧 Content Area)
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'da-modal-body';

    // 左侧 Sidebar
    const sidebar = renderSidebar((tabId) => void safeSwitchTab(tabId));
    bodyContainer.appendChild(sidebar);

    // 右侧 Content Area (子界面区域)
    const contentArea = document.createElement('div');
    contentArea.id = 'da-modal-content-area';
    contentArea.className = 'da-modal-content';
    contentArea.style.position = 'relative';

    // 顶置独立的浮动未保存提示气泡 (Floating Viewport Bubble - 悬浮在子界面顶部中央)
    const floatingBanner = document.createElement('div');
    floatingBanner.id = 'da-floating-unsaved-banner';
    floatingBanner.className = 'da-floating-unsaved-banner';
    floatingBanner.style.display = 'none';
    contentArea.appendChild(floatingBanner);

    _unsavedUnsubscribe?.();
    _unsavedUnsubscribe = unsavedStateManager.subscribeStateChange(() => {
        updateFloatingUnsavedBanner();
    });

    bodyContainer.appendChild(contentArea);
    modalInner.appendChild(bodyContainer);

    // 3. 底栏 (Footer Bar Section)
    const footerBar = renderFooterBarSection();
    modalInner.appendChild(footerBar);

    mainModalEl.appendChild(modalInner);

    // 点击遮罩关闭
    mainModalEl.addEventListener('click', () => {
        void safeClosePanel();
    });

    document.body.appendChild(mainModalEl);

    // 激活默认 Tab
    switchTab(currentActiveTab);

    // 全局 Esc 快捷键支持极速收起主面板
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mainModalEl && mainModalEl.style.display !== 'none') {
            if (!document.querySelector('.da-cropper-backdrop') && !document.querySelector('.da-modal-backdrop:not(#da-main-modal-backdrop)')) {
                void safeClosePanel();
            }
        }
    });

    // 初始化应用上次保存的主题方案
    const settings = loadSettings();
    applyPluginTheme(settings.themePreset || DEFAULT_THEME_PROFILES[0]?.id || '');

    // 绑定 SillyTavern 原生设置菜单中的模板按键与悬浮球开关
    bindNativeSettingsTemplateEvents();

    return mainModalEl;
}

/** 绑定 SillyTavern 原生扩展设置菜单模板中的控件事件 */
export function bindNativeSettingsTemplateEvents(): void {
    const openBtn = document.getElementById('da-open-main-modal-btn');
    if (openBtn) {
        openBtn.onclick = () => {
            setMainModalVisible(true);
        };
    }

    const fabToggle = document.getElementById('da-enable-fab-toggle') as HTMLInputElement | null;
    if (fabToggle) {
        const settings = loadSettings();
        fabToggle.checked = settings.enabled ?? true;
        fabToggle.onchange = async () => {
            const { applyFABStylesFromSettings } = await import('./fab');
            patchSettings({ enabled: fabToggle.checked });
            applyFABStylesFromSettings();
        };
    }
}

/**
 * 带未保存检测拦截的优雅切换 Tab
 *
 * @param tabId 目标 Tab 标识符
 */
export async function safeSwitchTab(tabId: TabId): Promise<void> {
    if (currentActiveTab === tabId) return;
    const result = await unsavedStateManager.checkUnsavedBeforeAction('切出页面');
    if (result === 'proceed') {
        switchTab(tabId);
    }
}

/**
 * 带未保存检测拦截的优雅关闭面板
 */
export async function safeClosePanel(): Promise<void> {
    const result = await unsavedStateManager.checkUnsavedBeforeAction('关闭设置面板');
    if (result === 'proceed') {
        toggleFABPanelState(false);
        stopTelemetry();
    }
}

/**
 * 控制主模态框显示/隐藏
 *
 * @param visible 是否可见
 */
export function setMainModalVisible(visible: boolean): void {
    if (!mainModalEl) {
        void renderSettingsPanel();
        if (!mainModalEl) return;
    }
    if (visible && !document.body.contains(mainModalEl)) {
        document.body.appendChild(mainModalEl);
    }
    mainModalEl.style.display = visible ? 'flex' : 'none';
    if (visible) {
        startTelemetry();
    } else {
        stopTelemetry();
    }
}

// ─── 顶栏组件 (包含标题、主题切换、配置导入导出及 macOS 风格红点关闭按钮) ───

function renderHeaderBar(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'da-header-bar';
    header.style.minHeight = '84px';
    header.style.height = 'auto';
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.justifyContent = 'space-between';
    header.style.padding = '14px 22px 12px 22px';
    header.style.gap = '8px';
    header.style.borderBottom = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';
    header.style.position = 'relative';

    // ── 第一行 (Row 1): 左侧 "ST" 标题 ｜ 右上角 macOS 关闭红点 ──
    const row1 = document.createElement('div');
    row1.className = 'da-header-row da-header-row-1';
    row1.style.display = 'flex';
    row1.style.justifyContent = 'space-between';
    row1.style.alignItems = 'center';
    row1.style.width = '100%';

    const row1Left = document.createElement('div');
    row1Left.style.display = 'flex';
    row1Left.style.alignItems = 'center';
    row1Left.style.gap = '8px';

    const titleSt = document.createElement('span');
    titleSt.style.fontSize = '1.25em';
    titleSt.style.fontWeight = 'bold';
    titleSt.style.color = 'var(--da-text-primary)';
    titleSt.style.letterSpacing = '0.5px';
    titleSt.textContent = 'SillyTavern';

    row1Left.appendChild(titleSt);

    // 🔴 红色圆形关闭按钮 (macOS 风格，固定于第一行右上角)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.title = '关闭设置面板';
    closeBtn.style.cursor = 'pointer';
    closeBtn.innerHTML = '';
    closeBtn.addEventListener('click', () => {
        void safeClosePanel();
    });

    row1.appendChild(row1Left);
    row1.appendChild(closeBtn);

    // ── 第二行 (Row 2): 左侧 应用名称与动态版本标识 (V${VERSION}) ｜ 右侧 主题选择器 + 帮助按钮 ──
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

    const appNameSpan = document.createElement('span');
    appNameSpan.className = 'da-header-app-name';
    appNameSpan.textContent = '✨ Starlight DrawAssistant';

    const versionSpan = document.createElement('span');
    versionSpan.className = 'da-header-version-badge';
    versionSpan.textContent = `V${VERSION}`;

    row2Left.appendChild(appNameSpan);
    row2Left.appendChild(versionSpan);

    // 右侧操作组 (在第二行右端，32px 绝对对齐)
    const row2Right = document.createElement('div');
    row2Right.style.display = 'flex';
    row2Right.style.alignItems = 'center';
    row2Right.style.gap = '8px';
    row2Right.style.position = 'relative';

    // 顶栏快速主题切换器 (精确 32px 高度对齐)
    const quickThemeSelect = document.createElement('select');
    quickThemeSelect.id = 'da-quick-theme-select';
    quickThemeSelect.className = 'da-select da-quick-theme-select';
    quickThemeSelect.style.height = '32px';
    quickThemeSelect.style.boxSizing = 'border-box';
    quickThemeSelect.style.display = 'inline-flex';
    quickThemeSelect.style.alignItems = 'center';
    quickThemeSelect.style.fontSize = '0.85em';
    quickThemeSelect.style.minWidth = '100px';
    quickThemeSelect.style.maxWidth = '130px';
    quickThemeSelect.style.margin = '0';

    quickThemeSelect.addEventListener('change', () => {
        const val = quickThemeSelect.value;
        if (val === (loadSettings().themePreset || '')) return; // 同值防重阻断
        patchSettings({ themePreset: val });
        applyPluginTheme(val);
    });

    // 初始化装载下拉选项
    setTimeout(() => {
        refreshHeaderThemeSelect();
    }, 0);

    // 隐秘文件选择器
    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';
    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const content = reader.result as string;
            const { importSettingsJson, loadSettings } = await import('../settings/manager');
            const success = importSettingsJson(content);
            if (success) {
                const s = loadSettings();
                applyPluginTheme(s.themePreset || '');
                refreshHeaderThemeSelect();
                showToastNotice('配置恢复/导入成功！');
            } else {
                showToastError('配置文件格式错误，导入失败');
            }
        };
        reader.readAsText(file, 'UTF-8');
        hiddenFileInput.value = '';
    });

    // 快捷按钮 (三点菜单及导入导出/重置)
    const actionsMenuBtn = document.createElement('button');
    actionsMenuBtn.className = 'da-icon-btn';
    actionsMenuBtn.title = '更多全局设置选项 (备份/恢复/重置)';
    actionsMenuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
    actionsMenuBtn.style.height = '32px';
    actionsMenuBtn.style.width = '32px';

    // 关联的下拉菜单容器
    const menuDropdown = document.createElement('div');
    menuDropdown.className = 'da-dropdown-menu';
    menuDropdown.style.display = 'none';
    menuDropdown.style.position = 'absolute';
    menuDropdown.style.top = '38px';
    menuDropdown.style.right = '0';
    menuDropdown.style.zIndex = '1000';

    const createMenuItem = (iconHtml: string, text: string, onClick: () => void) => {
        const item = document.createElement('div');
        item.className = 'da-dropdown-item';
        item.innerHTML = `${iconHtml} <span>${text}</span>`;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.style.display = 'none';
            onClick();
        });
        return item;
    };

    menuDropdown.appendChild(createMenuItem('<i class="fa-solid fa-download"></i>', '导出全量设置 JSON', async () => {
        const { exportSettingsJson } = await import('../settings/manager');
        exportSettingsJson();
    }));

    menuDropdown.appendChild(createMenuItem('<i class="fa-solid fa-upload"></i>', '导入全量设置 JSON', () => {
        hiddenFileInput.click();
    }));

    menuDropdown.appendChild(createMenuItem('<i class="fa-solid fa-rotate-left"></i>', '重置全量扩展设置', async () => {
        const { FeedbackService } = await import('./feedback-service');
        const confirmed = await FeedbackService.confirm('重置确认', '确定要将 ST-DrawAssistant 的全量设置恢复到默认配置吗？', '重置', true);
        if (confirmed) {
            const { resetSettings } = await import('../settings/manager');
            resetSettings();
            applyPluginTheme('');
            refreshHeaderThemeSelect();
            FeedbackService.toastSuccess('全量扩展设置已恢复默认', '重置成功');
        }
    }));

    // 开关下拉菜单显隐
    actionsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menuDropdown.style.display === 'block';
        menuDropdown.style.display = isOpen ? 'none' : 'block';
    });

    document.addEventListener('click', () => {
        menuDropdown.style.display = 'none';
    });

    row2Right.appendChild(quickThemeSelect);
    row2Right.appendChild(actionsMenuBtn);
    row2Right.appendChild(menuDropdown);
    row2Right.appendChild(hiddenFileInput);

    row2.appendChild(row2Left);
    row2.appendChild(row2Right);

    header.appendChild(row1);
    header.appendChild(row2);

    return header;
}

// ─── 左侧 Sidebar 组件 ────────────────────────────────────────────────────────

function renderSidebar(onTabSelect: (id: TabId) => void): HTMLElement {
    const sidebar = document.createElement('div');
    sidebar.className = 'da-sidebar-tabs';

    const tabItems = getActiveTabItems();

    tabItems.forEach(tab => {
        const itemBtn = document.createElement('button');
        itemBtn.className = 'da-sidebar-item';
        itemBtn.setAttribute('data-tab-id', tab.id);
        itemBtn.innerHTML = `<span class="da-tab-label">${tab.label}</span>`;
        itemBtn.addEventListener('click', () => {
            onTabSelect(tab.id);
        });
        sidebar.appendChild(itemBtn);
    });

    return sidebar;
}

/** 动态刷新侧边栏 Tab 列表 */
export function refreshSidebarTabs(): void {
    const sidebarEl = mainModalEl?.querySelector<HTMLElement>('.da-sidebar-tabs');
    if (!sidebarEl) return;

    const items = getActiveTabItems();

    // 如果当前选中的 tab 已不在活跃列表中，降级切回 general Tab
    if (!items.some(t => t.id === currentActiveTab)) {
        switchTab('general');
        return;
    }

    sidebarEl.innerHTML = '';
    items.forEach(tab => {
        const itemBtn = document.createElement('button');
        itemBtn.className = `da-sidebar-item ${tab.id === currentActiveTab ? 'da-sidebar-item--active' : ''}`;
        itemBtn.setAttribute('data-tab-id', tab.id);
        itemBtn.innerHTML = `<span class="da-tab-label">${tab.label}</span>`;
        itemBtn.addEventListener('click', () => {
            void safeSwitchTab(tab.id);
        });
        sidebarEl.appendChild(itemBtn);
    });
}

// ─── Tab 动态切换机制 ─────────────────────────────────────────────────────────

function switchTab(tabId: TabId): void {
    // 销毁旧 Tab 的 Store 订阅与资源（防内存泄漏）
    _activeTabBag?.dispose();
    _activeTabBag = null;

    currentActiveTab = tabId;

    // 1. 高亮 Sidebar 项
    const sidebarItems = mainModalEl?.querySelectorAll('.da-sidebar-item');
    sidebarItems?.forEach(item => {
        if (item.getAttribute('data-tab-id') === tabId) {
            item.classList.add('da-sidebar-item--active');
        } else {
            item.classList.remove('da-sidebar-item--active');
        }
    });

    // 2. 渲染目标 Tab 内容
    const contentArea = mainModalEl?.querySelector<HTMLElement>('#da-modal-content-area');
    if (!contentArea) return;

    contentArea.innerHTML = '';

    // renderXxxTab() 可选择性地返回 [HTMLElement, IDisposable] 元组，或包含 .dispose 方法的 HTMLElement，纳入生命周期管理
    const mountTab = (result: HTMLElement | [HTMLElement, IDisposable]) => {
        if (Array.isArray(result)) {
            const [el, disposable] = result;
            contentArea.appendChild(el);
            _activeTabBag = disposable;
        } else {
            contentArea.appendChild(result);
            const maybeDisposable = result as HTMLElement & { dispose?: () => void };
            if (typeof maybeDisposable.dispose === 'function') {
                _activeTabBag = { dispose: () => maybeDisposable.dispose?.() };
            }
        }
    };

    if (tabId === 'general') {
        mountTab(renderGeneralTab());
    } else if (tabId === 'comfyui') {
        mountTab(renderComfyUITab());
    } else if (tabId === 'character') {
        mountTab(renderCharacterTab());
    } else if (tabId === 'gallery') {
        mountTab(renderGalleryTab());
    } else if (tabId === 'theme') {
        mountTab(renderThemeTab());
    } else if (tabId === 'fab-settings') {
        mountTab(renderFABSettingsTab());
    } else if (tabId === 'diagnostics') {
        mountTab(renderDiagnosticsTab());
    } else if (tabId === 'about') {
        mountTab(renderAboutTab());
    } else {
        // 占位页（如角色与词库配置，等待后续丰富）
        const placeholder = document.createElement('div');
        placeholder.className = 'da-section-card';
        placeholder.style.textAlign = 'center';
        placeholder.style.padding = '40px 20px';
        const itemInfo = getActiveTabItems().find(t => t.id === tabId);
        placeholder.innerHTML = `
            <h3>${itemInfo?.icon ?? ''} ${itemInfo?.label ?? ''} (功能规划中)</h3>
            <p style="color: var(--da-text-secondary); font-size: 0.85em; margin-top: 10px;">
                此面板选项卡视图容器已就绪，将在后续版本扩展支持。
            </p>
        `;
        contentArea.appendChild(placeholder);
    }
}

/** 导出函数：一键同步重建顶栏 #da-quick-theme-select 选项并保持选中状态 */
export function refreshHeaderThemeSelect(): void {
    const select = document.querySelector<HTMLSelectElement>('#da-quick-theme-select');
    if (!select) return;

    const settings = loadSettings();
    const customThemes = (settings.customThemes as PresetProfileItem<ThemeData>[] | undefined) || [];
    const allThemes: Array<{ id: string; name: string }> = [
        ...DEFAULT_THEME_PROFILES.map(t => ({ id: t.id, name: t.name })),
    ];
    customThemes.forEach(ct => {
        if (ct && ct.id && !allThemes.some(t => t.id === ct.id)) {
            allThemes.push({ id: ct.id, name: ct.name });
        }
    });

    select.innerHTML = '';
    allThemes.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
    });

    select.value = settings.themePreset || allThemes[0]?.id || '';
}

/**
 * 刷新独立置顶悬浮未保存提示栏 (Floating Viewport Banner)
 */
export function updateFloatingUnsavedBanner(): void {
    const bannerEl = document.querySelector<HTMLElement>('#da-floating-unsaved-banner');
    if (!bannerEl) return;

    const dirtyList = unsavedStateManager.getDirtyProviders();
    if (dirtyList.length === 0) {
        bannerEl.style.display = 'none';
        bannerEl.innerHTML = '';
        return;
    }

    const names = dirtyList.map(p => `【${p.tabName}】`).join('与');
    bannerEl.style.display = 'flex';
    bannerEl.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.1em; color:var(--da-status-warning);">⚠️</span>
            <span>检测到 ${names} 存在未保存修改 <span style="opacity:0.75; font-weight:normal; font-size:0.88em;">(仅当前会话生效)</span></span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-left:12px;">
            <button class="da-btn primary" id="da-banner-save-btn" style="padding:3px 12px; font-size:0.82em; border-radius:100px;">保存修改</button>
            <button class="da-btn secondary" id="da-banner-discard-btn" style="padding:3px 12px; font-size:0.82em; border-radius:100px;">放弃改动</button>
        </div>
    `;

    const saveBtn = bannerEl.querySelector('#da-banner-save-btn');
    saveBtn?.addEventListener('click', async () => {
        for (const provider of dirtyList) {
            await provider.saveChanges();
        }
        updateFloatingUnsavedBanner();
    });

    const discardBtn = bannerEl.querySelector('#da-banner-discard-btn');
    discardBtn?.addEventListener('click', () => {
        for (const provider of dirtyList) {
            provider.discardChanges();
        }
        updateFloatingUnsavedBanner();
    });
}
