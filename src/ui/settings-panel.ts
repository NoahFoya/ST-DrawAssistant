/**
 * @module ui/settings-panel
 * @description 设置面板 UI 控制器与主模态框调度器
 *
 * 职责：
 * - 渲染带有顶栏、左侧 Tab 导航栏、右侧内容栏、底栏的主模态框
 * - 结合 FAB 悬浮球及顶栏 macOS 风格红点按钮控制显隐
 * - 管理 9 大 Tab 的动态切换与激活 (接入 ThemeTab 和 FABSettingsTab)
 */


import { VERSION } from '../core/constants';
import { loadSettings, updateSettings } from '../settings/manager';
import { DEFAULT_THEME_PROFILES } from '../settings/defaults';
import type { CustomThemeScheme } from '../settings/types';
import { renderGeneralTab } from './tabs/general-tab';
import { renderComfyUITab } from './tabs/comfyui-tab';
import { renderThemeTab, applyPluginTheme } from './tabs/theme-tab';
import { renderFABSettingsTab } from './tabs/fab-settings-tab';
import { renderGalleryTab } from './tabs/gallery-tab';
import { renderCharacterTab } from './tabs/character-tab';
import { renderDiagnosticsTab } from './tabs/diagnostics-tab';
import { renderAboutTab } from './tabs/about-tab';
import { toggleFABPanelState } from './fab';
import { renderFooterBar } from './components/footer-bar';

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
    } else if (provider === 'webui') {
        items.push({ id: 'sd-webui', label: 'SD-WebUI', icon: '' });
    }

    // 角色管理、图库、主题、悬浮窗、日志与统计、关于
    items.push(
        { id: 'character', label: '角色管理', icon: '' },
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

/**
 * 初始化并挂载主面板模态框
 */
export async function renderSettingsPanel(): Promise<void> {
    if (mainModalEl) return;

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
    const sidebar = renderSidebar((tabId) => switchTab(tabId));
    bodyContainer.appendChild(sidebar);

    // 右侧 Content Area
    const contentArea = document.createElement('div');
    contentArea.id = 'da-modal-content-area';
    contentArea.className = 'da-modal-content';
    bodyContainer.appendChild(contentArea);

    modalInner.appendChild(bodyContainer);

    // 3. 底栏 (Footer Bar)
    const footerBar = renderFooterBar();
    modalInner.appendChild(footerBar);

    mainModalEl.appendChild(modalInner);

    // 点击遮罩关闭
    mainModalEl.addEventListener('click', () => {
        toggleFABPanelState(false);
    });

    document.body.appendChild(mainModalEl);

    // 激活默认 Tab
    switchTab(currentActiveTab);

    // 全局 Esc 快捷键支持极速收起主面板
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mainModalEl && mainModalEl.style.display !== 'none') {
            if (!document.querySelector('.da-cropper-backdrop')) {
                toggleFABPanelState(false);
            }
        }
    });

    // 初始化应用上次保存的主题方案
    const { loadSettings } = await import('../settings/manager');
    const settings = loadSettings();
    applyPluginTheme(settings.themePreset || DEFAULT_THEME_PROFILES[0]?.id || '');

    // 绑定 SillyTavern 原生设置菜单中的模板按键与悬浮球开关
    bindNativeSettingsTemplateEvents();
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
            const { updateSettings } = await import('../settings/manager');
            const { applyFABStylesFromSettings } = await import('./fab');
            updateSettings({ enabled: fabToggle.checked });
            applyFABStylesFromSettings();
        };
    }
}

/** 控制主模态框显示/隐藏 */
export function setMainModalVisible(visible: boolean): void {
    if (!mainModalEl) {
        void renderSettingsPanel().then(() => setMainModalVisible(visible));
        return;
    }
    if (visible && !document.body.contains(mainModalEl)) {
        document.body.appendChild(mainModalEl);
    }
    mainModalEl.style.display = visible ? 'flex' : 'none';
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
        toggleFABPanelState(false);
    });

    row1.appendChild(row1Left);
    row1.appendChild(closeBtn);

    // ── 第二行 (Row 2): 左侧 "✨ Starlight DrawAssistant V0.1.0" ｜ 右侧 主题选择器 + 帮助按钮 ──
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
    quickThemeSelect.style.minWidth = '110px';
    quickThemeSelect.style.maxWidth = '140px';
    quickThemeSelect.style.margin = '0';

    quickThemeSelect.addEventListener('change', () => {
        const val = quickThemeSelect.value;
        updateSettings({ themePreset: val });
        applyPluginTheme(val);
    });

    // 初始化装载下拉选项
    setTimeout(() => refreshHeaderThemeSelect(), 0);

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
                switchTab(currentActiveTab);
                showToastSuccess('全局配置导入成功！');
            } else {
                showToastError('配置文件解析失败，请检查 JSON 格式！');
            }
            hiddenFileInput.value = '';
        };
        reader.readAsText(file);
    });

    // 单个 "帮助 ▼" 下拉菜单按钮 (精确 32px 高度对齐)
    const actionsMenuBtn = document.createElement('button');
    actionsMenuBtn.className = 'da-btn secondary';
    actionsMenuBtn.style.height = '32px';
    actionsMenuBtn.style.boxSizing = 'border-box';
    actionsMenuBtn.style.display = 'inline-flex';
    actionsMenuBtn.style.alignItems = 'center';
    actionsMenuBtn.style.fontSize = '0.85em';
    actionsMenuBtn.style.padding = '0 12px';
    actionsMenuBtn.style.margin = '0';
    actionsMenuBtn.style.lineHeight = '1';
    actionsMenuBtn.innerHTML = '帮助 <span style="font-size: 0.8em; margin-left: 2px;">▼</span>';

    // 浮动下拉菜单列表
    const menuDropdown = document.createElement('div');
    menuDropdown.className = 'da-header-actions-dropdown';

    const createMenuItem = (label: string, onClick: () => void, isDanger = false) => {
        const item = document.createElement('div');
        item.className = `da-dropdown-item ${isDanger ? 'da-dropdown-item--danger' : ''}`;
        item.textContent = label;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.style.display = 'none';
            onClick();
        });
        return item;
    };

    // 菜单选项 1：导出
    menuDropdown.appendChild(createMenuItem('导出当前配置', async () => {
        const { exportSettingsJson } = await import('../settings/manager');
        const jsonStr = exportSettingsJson();
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `starlight-drawassistant-config-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }));

    // 菜单选项 2：导入
    menuDropdown.appendChild(createMenuItem('导入配置文件', () => {
        hiddenFileInput.click();
    }));

    // 菜单选项 3：重置
    menuDropdown.appendChild(createMenuItem('重置默认设置', async () => {
        if (!confirm('⚠️ 确定要重置所有扩展配置到初始默认值吗？\n所有自定义提示词、主题方案及节点映射都将被恢复。')) return;
        const { resetSettings, loadSettings } = await import('../settings/manager');
        resetSettings();
        const s = loadSettings();
        applyPluginTheme(s.themePreset || DEFAULT_THEME_PROFILES[0]?.id || '');
        switchTab(currentActiveTab);
        showToastSuccess('扩展配置已成功重置为默认值。');
    }, true));

    // 菜单选项 4：帮助说明文档
    menuDropdown.appendChild(createMenuItem('帮助与说明文档', () => {
        switchTab('about');
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
    sidebarEl.innerHTML = '';
    const items = getActiveTabItems();
    items.forEach(tab => {
        const itemBtn = document.createElement('button');
        itemBtn.className = `da-sidebar-item ${tab.id === currentActiveTab ? 'da-sidebar-item--active' : ''}`;
        itemBtn.setAttribute('data-tab-id', tab.id);
        itemBtn.innerHTML = `<span class="da-tab-label">${tab.label}</span>`;
        itemBtn.addEventListener('click', () => {
            switchTab(tab.id);
        });
        sidebarEl.appendChild(itemBtn);
    });
}

// ─── Tab 动态切换机制 ─────────────────────────────────────────────────────────

function switchTab(tabId: TabId): void {
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

    if (tabId === 'general') {
        contentArea.appendChild(renderGeneralTab());
    } else if (tabId === 'comfyui') {
        contentArea.appendChild(renderComfyUITab());
    } else if (tabId === 'character') {
        contentArea.appendChild(renderCharacterTab());
    } else if (tabId === 'gallery') {
        contentArea.appendChild(renderGalleryTab());
    } else if (tabId === 'theme') {
        contentArea.appendChild(renderThemeTab());
    } else if (tabId === 'fab-settings') {
        contentArea.appendChild(renderFABSettingsTab());
    } else if (tabId === 'diagnostics') {
        contentArea.appendChild(renderDiagnosticsTab());
    } else if (tabId === 'about') {
        contentArea.appendChild(renderAboutTab());
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
                此面板架构与高内聚布局已就绪，将在后续版本扩展支持。
            </p>
        `;
        contentArea.appendChild(placeholder);
    }
}

/** 辅助函数：显示 ST 全局 Toast 成功弹窗 */
function showToastSuccess(message: string): void {
    const win = window as unknown as { toastr?: { success: (msg: string, title?: string) => void } };
    if (win.toastr && typeof win.toastr.success === 'function') {
        win.toastr.success(message, 'Starlight DrawAssistant');
    }
}

/** 辅助函数：显示 ST 全局 Toast 错误弹窗 */
function showToastError(message: string): void {
    const win = window as unknown as { toastr?: { error: (msg: string, title?: string) => void } };
    if (win.toastr && typeof win.toastr.error === 'function') {
        win.toastr.error(message, 'Starlight DrawAssistant');
    }
}

/** 导出函数：一键同步重建顶栏 #da-quick-theme-select 选项并保持选中状态 */
export function refreshHeaderThemeSelect(): void {
    const select = document.querySelector<HTMLSelectElement>('#da-quick-theme-select');
    if (!select) return;

    const settings = loadSettings();
    const customThemes = settings.customThemes || [];
    const allThemes: CustomThemeScheme[] = [...DEFAULT_THEME_PROFILES];
    customThemes.forEach(ct => {
        if (ct && ct.id && !allThemes.some(t => t.id === ct.id)) {
            allThemes.push(ct);
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
