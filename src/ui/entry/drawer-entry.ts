/**
 * SillyTavern 宿主抽屉与魔法棒菜单快捷入口 (DrawerEntry)。
 *
 * @remarks
 * 负责查找宿主顶栏扩展设置区（左列 `#extensions_settings`）
 * 与聊天输入框左侧魔法棒扩展菜单（`#extensionsMenu`），挂载插件设置面板唤起入口与快捷开关，
 * 保障用户在隐藏右下角悬浮球（FAB）后仍能随时打开设置面板。
 */

import type { Disposable } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { Switch } from '../components/switch';
import { Toast } from '../feedback/toast';

export interface DrawerEntryOptions {
    onOpenSettings?: () => void;
}

const WAND_ITEM_ID = 'da-wand-menu-item';
const DRAWER_SETTINGS_ID = 'da-drawer-settings';

export class DrawerEntry implements Disposable {
    private isMountedState = false;
    private wandItemEl: HTMLElement | null = null;
    private drawerBlockEl: HTMLElement | null = null;
    private unsubscribeSettings: (() => void) | null = null;
    private enabledSwitch: Switch | null = null;
    private fabSwitch: Switch | null = null;

    constructor(private readonly options: DrawerEntryOptions = {}) {}

    /**
     * 挂载抽屉入口与魔法棒菜单项至宿主容器（具备幂等性，支持多次调用补挂载）。
     */
    public mount(): void {
        this.isMountedState = true;

        if (typeof document === 'undefined') {
            return;
        }

        this.mountWandMenuItem();
        this.mountExtensionsSettingsDrawer();
    }

    /**
     * 在聊天输入框魔法棒菜单 (#extensionsMenu) 中挂载快捷入口。
     */
    private mountWandMenuItem(): void {
        const wandMenu = document.getElementById('extensionsMenu');
        if (!wandMenu) {
            return;
        }

        const existing = document.getElementById(WAND_ITEM_ID);
        if (existing) {
            this.wandItemEl = existing;
            return;
        }

        const item = document.createElement('div');
        item.id = WAND_ITEM_ID;
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.setAttribute('role', 'listitem');
        item.title = '打开 Starlight 绘画助手设置面板';

        const icon = document.createElement('div');
        icon.className = 'fa-solid fa-palette extensionsMenuExtensionButton';
        const label = document.createElement('span');
        label.textContent = 'Starlight 绘画助手';

        item.appendChild(icon);
        item.appendChild(label);

        item.addEventListener('click', () => {
            this.triggerOpen();
        });

        wandMenu.appendChild(item);
        this.wandItemEl = item;
    }

    /**
     * 在顶栏扩展管理面板左列 (#extensions_settings) 中挂载遵循酒馆原生规范的折叠设置卡片。
     */
    private mountExtensionsSettingsDrawer(): void {
        const settingsContainer =
            document.getElementById('extensions_settings') ??
            document.getElementById('extensions_settings2');
        if (!settingsContainer) {
            return;
        }

        const existing = document.getElementById(DRAWER_SETTINGS_ID);
        if (existing) {
            this.drawerBlockEl = existing;
            return;
        }

        const currentSettings = settingsStore.getSettings();

        // 1. 抽屉根容器与作用域包装
        const wrapper = document.createElement('div');
        wrapper.id = DRAWER_SETTINGS_ID;
        wrapper.className = 'da-drawer-settings st-da-root';

        const drawer = document.createElement('div');
        drawer.className = 'inline-drawer';

        // 2. 抽屉顶栏 (完全遵循酒馆原生结构与标题规范)
        const header = document.createElement('div');
        header.className = 'inline-drawer-toggle inline-drawer-header';

        const titleBold = document.createElement('b');
        const titleSpan = document.createElement('span');
        titleSpan.textContent = 'Starlight 绘画助手 (DrawAssistant)';
        titleBold.appendChild(titleSpan);
        header.appendChild(titleBold);

        const chevron = document.createElement('div');
        chevron.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
        header.appendChild(chevron);

        // 3. 抽屉主体内容区 (遵循酒馆原生规范，由宿主 jQuery 全局委托统一管理平滑展开与闭合)
        const content = document.createElement('div');
        content.className = 'inline-drawer-content';
        content.style.display = 'none';

        // 内部纵向排版容器
        const contentInner = document.createElement('div');
        contentInner.className = 'da-drawer-content-inner';

        // 3.1 启用插件开关行
        const enabledSwitch = new Switch({
            value: Boolean(currentSettings.enabled),
            onChange: (checked) => {
                settingsStore.update({ enabled: checked });
            },
        });
        this.enabledSwitch = enabledSwitch;

        const enabledRow = document.createElement('div');
        enabledRow.className = 'da-drawer-toggle-row';
        const enabledInfo = document.createElement('div');
        enabledInfo.className = 'da-drawer-toggle-info';
        const enabledTitle = document.createElement('span');
        enabledTitle.className = 'da-drawer-toggle-title';
        enabledTitle.textContent = '启用绘画助手';
        const enabledDesc = document.createElement('span');
        enabledDesc.className = 'da-drawer-toggle-desc';
        enabledDesc.textContent = '控制扩展核心调度、楼层提取与提示词注入处理流程';
        enabledInfo.appendChild(enabledTitle);
        enabledInfo.appendChild(enabledDesc);
        enabledRow.appendChild(enabledInfo);
        enabledRow.appendChild(enabledSwitch.element);
        enabledRow.onclick = (e) => {
            if (e.target === enabledSwitch.element || enabledSwitch.element.contains(e.target as Node)) {
                return;
            }
            enabledSwitch.setValue(!enabledSwitch.getValue());
        };

        // 3.2 悬浮球显隐开关行
        const fabSwitch = new Switch({
            value: currentSettings.ui?.fab?.visible !== false,
            onChange: (checked) => {
                const latest = settingsStore.getSettings();
                settingsStore.update({
                    ui: {
                        ...latest.ui,
                        fab: {
                            ...latest.ui.fab,
                            visible: checked,
                        },
                    },
                });
            },
        });
        this.fabSwitch = fabSwitch;

        const fabRow = document.createElement('div');
        fabRow.className = 'da-drawer-toggle-row';
        const fabInfo = document.createElement('div');
        fabInfo.className = 'da-drawer-toggle-info';
        const fabTitle = document.createElement('span');
        fabTitle.className = 'da-drawer-toggle-title';
        fabTitle.textContent = '显示常驻悬浮球';
        const fabDesc = document.createElement('span');
        fabDesc.className = 'da-drawer-toggle-desc';
        fabDesc.textContent = '在酒馆主视窗右下角显示快捷唤起入口';
        fabInfo.appendChild(fabTitle);
        fabInfo.appendChild(fabDesc);
        fabRow.appendChild(fabInfo);
        fabRow.appendChild(fabSwitch.element);
        fabRow.onclick = (e) => {
            if (e.target === fabSwitch.element || fabSwitch.element.contains(e.target as Node)) {
                return;
            }
            fabSwitch.setValue(!fabSwitch.getValue());
        };

        // 3.3 主操作按钮 (酒馆原生 .menu_button)
        const openBtn = document.createElement('div');
        openBtn.className = 'menu_button interactable';
        openBtn.innerHTML = '<i class="fa-solid fa-sliders"></i> 打开绘画助手设置面板';
        openBtn.onclick = () => {
            this.triggerOpen();
        };

        // 3.4 辅助操作按钮 (酒馆原生 .menu_button)
        const resetFabBtn = document.createElement('div');
        resetFabBtn.className = 'menu_button interactable da-drawer-sub-btn';
        resetFabBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 复位悬浮球位置';
        resetFabBtn.title = '将悬浮球坐标重置为右下角默认初始位置';
        resetFabBtn.onclick = () => {
            eventBus.emit('ui:reset-fab-position');
            Toast.info('已将悬浮球复位至右下角初始位置');
        };

        contentInner.appendChild(enabledRow);
        contentInner.appendChild(fabRow);
        contentInner.appendChild(openBtn);
        contentInner.appendChild(resetFabBtn);
        content.appendChild(contentInner);

        drawer.appendChild(header);
        drawer.appendChild(content);
        wrapper.appendChild(drawer);
        settingsContainer.appendChild(wrapper);

        this.drawerBlockEl = wrapper;

        // 4. 同步配置更新至抽屉控件
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = eventBus.on('settings:updated', () => {
            const next = settingsStore.getSettings();
            enabledSwitch.setValue(Boolean(next.enabled), { silent: true });
            fabSwitch.setValue(next.ui?.fab?.visible !== false, { silent: true });
        });
    }

    /**
     * 触发打开设置面板。
     */
    public triggerOpen(): void {
        this.options.onOpenSettings?.();
    }

    /**
     * 释放抽屉入口与已挂载的宿主 DOM。
     */
    public dispose(): void {
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;

        if (this.enabledSwitch) {
            this.enabledSwitch.dispose();
            this.enabledSwitch = null;
        }
        if (this.fabSwitch) {
            this.fabSwitch.dispose();
            this.fabSwitch = null;
        }

        if (this.wandItemEl) {
            this.wandItemEl.remove();
            this.wandItemEl = null;
        } else if (typeof document !== 'undefined') {
            document.getElementById(WAND_ITEM_ID)?.remove();
        }

        if (this.drawerBlockEl) {
            this.drawerBlockEl.remove();
            this.drawerBlockEl = null;
        } else if (typeof document !== 'undefined') {
            document.getElementById(DRAWER_SETTINGS_ID)?.remove();
        }

        this.isMountedState = false;
    }

    /**
     * 获取当前挂载状态。
     */
    public isMounted(): boolean {
        return this.isMountedState;
    }
}
