/**
 * ST-DrawAssistant 设置面板模态弹窗主控。
 *
 * @remarks
 * 封装全屏遮罩、960×740 桌面端视窗骨架、头部栏、侧边栏 Tab 路由与底部状态栏。
 * 默认集成提供方、绘图、提示词、常规、主题与备份六大配置卡片。
 */

import type { SettingsModalComponent } from './types';
import { TabManager } from './tab-manager';
import {
    GeneralCard,
    PromptCard,
    DrawingCard,
    ProviderCard,
    ThemeCard,
    BackupCard,
} from '../cards';
import { createButton } from '../components/button';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';

export class SettingsModal implements SettingsModalComponent {
    public readonly element: HTMLDivElement;
    public readonly modalInner: HTMLDivElement;

    private readonly tabManager: TabManager;
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    private backdropClickHandler: ((e: MouseEvent) => void) | null = null;
    private statusDot: HTMLSpanElement | null = null;
    private statusText: HTMLSpanElement | null = null;
    private _isOpen = false;

    constructor() {
        // 1. 全屏毛玻璃遮罩
        this.element = document.createElement('div');
        this.element.classList.add('da-modal-backdrop');
        this.element.hidden = true;

        // 2. 弹窗骨架外壳
        this.modalInner = document.createElement('div');
        this.modalInner.classList.add('st-da-root', 'da-main-modal-inner');
        this.element.appendChild(this.modalInner);

        // 3. 顶部栏
        const headerBar = this.buildHeader();
        this.modalInner.appendChild(headerBar);

        // 4. 主体分栏区 (Tab 路由)
        const modalBody = document.createElement('div');
        modalBody.classList.add('da-modal-body');

        this.tabManager = new TabManager();
        modalBody.appendChild(this.tabManager.sidebarElement);
        modalBody.appendChild(this.tabManager.contentElement);
        this.modalInner.appendChild(modalBody);

        // 5. 底部状态栏
        const footerBar = this.buildFooter();
        this.modalInner.appendChild(footerBar);

        // 6. 注册六大功能配置卡片
        this.setupDefaultTabs();

        // 7. 绑定键盘 Escape 与遮罩点击关闭事件
        this.bindEvents();
    }

    private buildHeader(): HTMLElement {
        const header = document.createElement('div');
        header.classList.add('da-header-bar');

        const left = document.createElement('div');
        left.classList.add('da-header-left');

        const title = document.createElement('h2');
        title.classList.add('da-header-title');
        title.textContent = 'ST-DrawAssistant 绘画助手';
        left.appendChild(title);

        const right = document.createElement('div');
        right.classList.add('da-header-right');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.classList.add('da-modal-close-btn');
        closeBtn.title = '关闭设置面板 (Esc)';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => {
            this.close();
        });
        right.appendChild(closeBtn);

        header.appendChild(left);
        header.appendChild(right);
        return header;
    }

    private buildFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.classList.add('da-footer-bar');

        const statusItem = document.createElement('div');
        statusItem.classList.add('da-status-item');

        this.statusDot = document.createElement('span');
        this.statusDot.classList.add('da-status-dot', 'is-ok');

        this.statusText = document.createElement('span');
        this.statusText.classList.add('da-server-status-text');
        this.statusText.textContent = '就绪';

        statusItem.appendChild(this.statusDot);
        statusItem.appendChild(this.statusText);
        footer.appendChild(statusItem);

        const rightActions = document.createElement('div');
        rightActions.classList.add('da-row--center-y');

        const doneBtn = createButton({
            text: '完成',
            variant: 'primary',
            size: 'sm',
            onClick: () => {
                this.close();
            },
        });
        rightActions.appendChild(doneBtn.element);
        footer.appendChild(rightActions);

        return footer;
    }

    private setupDefaultTabs(): void {
        // 第一组：生图核心链路
        this.tabManager.addTab({
            id: 'provider',
            title: '生图后端服务',
            render: () => new ProviderCard(),
        });

        this.tabManager.addTab({
            id: 'drawing',
            title: '绘图参数预设',
            render: () => new DrawingCard(),
        });

        this.tabManager.addTab({
            id: 'prompt',
            title: '提示词与 LoRA',
            render: () => new PromptCard(),
        });

        // 侧边栏视觉分隔线
        this.tabManager.addDivider();

        // 第二组：系统常规与运维
        this.tabManager.addTab({
            id: 'general',
            title: '常规与运行设置',
            render: () => new GeneralCard(),
        });

        this.tabManager.addTab({
            id: 'theme',
            title: '外观主题风格',
            render: () => new ThemeCard(),
        });

        this.tabManager.addTab({
            id: 'backup',
            title: '配置备份与重置',
            render: () => new BackupCard(),
        });
    }

    private bindEvents(): void {
        this.backdropClickHandler = (e: MouseEvent) => {
            if (e.target === this.element) {
                this.close();
            }
        };
        this.element.addEventListener('click', this.backdropClickHandler);

        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', this.keydownHandler);
    }

    private updateStatusDisplay(): void {
        const activeProvider = settingsStore.getSettings().activeProvider;
        const provider = providerRegistry.getProvider(activeProvider);
        if (this.statusText) {
            this.statusText.textContent = `当前引擎: ${activeProvider} (${provider ? '已注册' : '未注册'})`;
        }
    }

    public open(tabId?: string): void {
        if (!this.element.parentElement && typeof document !== 'undefined' && document.body) {
            document.body.appendChild(this.element);
        }

        this.updateStatusDisplay();

        if (tabId) {
            this.tabManager.setActiveTab(tabId);
        }

        this.element.hidden = false;
        this._isOpen = true;
    }

    public close(): void {
        this.element.hidden = true;
        this._isOpen = false;
    }

    public isOpen(): boolean {
        return this._isOpen;
    }

    public setActiveTab(tabId: string): void {
        this.tabManager.setActiveTab(tabId);
    }

    public setDisabled(disabled: boolean): void {
        this.modalInner.classList.toggle('is-disabled', disabled);
    }

    public dispose(): void {
        this.close();

        if (this.backdropClickHandler) {
            this.element.removeEventListener('click', this.backdropClickHandler);
            this.backdropClickHandler = null;
        }

        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }

        this.tabManager.dispose();

        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }
}
