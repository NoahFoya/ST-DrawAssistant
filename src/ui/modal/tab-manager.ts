/**
 * ST-DrawAssistant 侧边导航选项卡与面板切换管理器。
 *
 * @remarks
 * 组织左侧 190px 导航按钮与右侧主内容面板的一对一路由显隐，
 * 支持按需挂载与级联注销。
 */

import type { UIComponent } from '../components/types';
import type { TabItemConfig } from './types';

function isUIComponent(item: UIComponent | HTMLElement): item is UIComponent {
    return 'element' in item && typeof (item as UIComponent).dispose === 'function';
}

export class TabManager {
    public readonly sidebarElement: HTMLDivElement;
    public readonly contentElement: HTMLDivElement;

    private readonly tabs: Map<
        string,
        {
            config: TabItemConfig;
            button: HTMLButtonElement;
            pane: HTMLDivElement;
            clickHandler: () => void;
            instance?: UIComponent | HTMLElement;
        }
    > = new Map();

    private activeTabId: string | null = null;

    constructor() {
        this.sidebarElement = document.createElement('div');
        this.sidebarElement.classList.add('da-sidebar-tabs');

        this.contentElement = document.createElement('div');
        this.contentElement.classList.add('da-modal-content');
    }

    /**
     * 注册选项卡
     * @param config 选项卡配置项
     */
    public addTab(config: TabItemConfig): void {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('da-sidebar-item');

        if (config.iconSvg) {
            const iconSpan = document.createElement('span');
            iconSpan.classList.add('da-sidebar-item__icon');
            iconSpan.innerHTML = config.iconSvg;
            button.appendChild(iconSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.classList.add('da-sidebar-item__text');
        textSpan.textContent = config.title;
        button.appendChild(textSpan);

        const pane = document.createElement('div');
        pane.classList.add('da-tab-pane');
        pane.hidden = true;

        const clickHandler = () => {
            this.setActiveTab(config.id);
        };
        button.addEventListener('click', clickHandler);

        this.sidebarElement.appendChild(button);
        this.contentElement.appendChild(pane);

        this.tabs.set(config.id, {
            config,
            button,
            pane,
            clickHandler,
        });

        // 默认激活第一个添加的选项卡
        if (!this.activeTabId) {
            this.setActiveTab(config.id);
        }
    }

    /** 在侧边栏添加视觉分隔线 */
    public addDivider(): void {
        const divider = document.createElement('div');
        divider.classList.add('da-sidebar-divider');
        this.sidebarElement.appendChild(divider);
    }

    /**
     * 激活指定标识符的选项卡
     * @param tabId 目标选项卡标识符
     */
    public setActiveTab(tabId: string): void {
        const target = this.tabs.get(tabId);
        if (!target) return;

        this.activeTabId = tabId;

        // 1. 切换按钮激活态
        for (const [id, item] of this.tabs.entries()) {
            const isActive = id === tabId;
            item.button.classList.toggle('da-sidebar-item--active', isActive);
            item.pane.hidden = !isActive;
        }

        // 2. 按需延迟挂载内容
        if (!target.instance) {
            if (target.config.component) {
                target.instance = target.config.component;
            } else if (target.config.render) {
                target.instance = target.config.render();
            }

            if (target.instance) {
                const node = isUIComponent(target.instance)
                    ? target.instance.element
                    : target.instance;
                target.pane.appendChild(node);
            }
        }
    }

    public getActiveTabId(): string | null {
        return this.activeTabId;
    }

    public dispose(): void {
        for (const item of this.tabs.values()) {
            item.button.removeEventListener('click', item.clickHandler);
            if (item.instance && isUIComponent(item.instance)) {
                item.instance.dispose();
            }
        }
        this.tabs.clear();
        this.sidebarElement.innerHTML = '';
        this.contentElement.innerHTML = '';
        this.activeTabId = null;
    }
}
