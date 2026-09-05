/**
 * @module tests/client/ui/layout.test
 * @description 批次 3: 布局骨架、设置弹窗与宿主挂载控制器测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigStore } from '../../../src/client/core/config/config-store';
import { HostClient } from '../../../src/client/core/host/host-client';
import { EventBus } from '../../../src/client/core/event-bus';
import { CoreEventMap } from '../../../src/client/core/types';
import { UIRegistry } from '../../../src/client/ui/foundation/ui-registry';
import { ModalService } from '../../../src/client/ui/layout/modal-service';
import { SettingsModal } from '../../../src/client/ui/layout/settings-modal';
import { DrawerEntryController } from '../../../src/client/ui/layout/drawer-entry';
import { FABContainer } from '../../../src/client/ui/layout/fab-container';

describe('UI Layout & Host Mounting', () => {
    let store: ConfigStore;
    let uiRegistry: UIRegistry;
    let modalService: ModalService;
    let settingsModal: SettingsModal;
    let host: HostClient;
    let eventBus: EventBus<CoreEventMap>;

    beforeEach(() => {
        document.body.innerHTML = '';
        store = new ConfigStore();
        uiRegistry = new UIRegistry();
        modalService = new ModalService();
        eventBus = new EventBus<CoreEventMap>();
        host = new HostClient({
            getContext: () => ({}),
            eventSource: eventBus
        });

        // 注册两个测试 Tab
        uiRegistry.registerTab({
            id: 'general',
            title: '通用设置',
            icon: '⚙️',
            render: (container) => {
                const el = document.createElement('div');
                el.className = 'test-general-tab';
                el.textContent = 'General Content';
                container.appendChild(el);
            }
        });

        uiRegistry.registerTab({
            id: 'about',
            title: '关于',
            icon: 'ℹ️',
            render: (container) => {
                const el = document.createElement('div');
                el.className = 'test-about-tab';
                el.textContent = 'About Content';
                container.appendChild(el);
            }
        });

        settingsModal = new SettingsModal({
            uiRegistry,
            modalService,
            store
        });
    });

    afterEach(() => {
        settingsModal.dispose();
        modalService.dispose();
        uiRegistry.dispose();
        store.dispose();
        eventBus.dispose();
        document.body.innerHTML = '';
    });

    describe('SettingsModal', () => {
        it('应该能正常打开设置弹窗并渲染顶栏、侧边栏和内容区', () => {
            settingsModal.open();

            const backdrop = document.getElementById('da-main-modal-backdrop');
            expect(backdrop).not.toBeNull();

            const header = backdrop?.querySelector('.da-header-bar');
            expect(header).not.toBeNull();

            const sidebar = backdrop?.querySelector('.da-sidebar-tabs');
            expect(sidebar).not.toBeNull();

            const contentArea = backdrop?.querySelector('#da-modal-content-area');
            expect(contentArea).not.toBeNull();

            // 默认激活 general Tab
            expect(contentArea?.querySelector('.test-general-tab')).not.toBeNull();
        });

        it('能够通过 switchTab 切换选项卡内容', async () => {
            settingsModal.open();

            const ok = await settingsModal.switchTab('about');
            expect(ok).toBe(true);

            const contentArea = document.getElementById('da-modal-content-area');
            expect(contentArea?.querySelector('.test-about-tab')).not.toBeNull();
            expect(contentArea?.querySelector('.test-general-tab')).toBeNull();
        });

        it('关闭弹窗时应清空 backdrop', async () => {
            settingsModal.open();
            expect(document.getElementById('da-main-modal-backdrop')).not.toBeNull();

            const closed = await settingsModal.close();
            expect(closed).toBe(true);
            expect(document.getElementById('da-main-modal-backdrop')).toBeNull();
        });
    });

    describe('DrawerEntryController', () => {
        it('在抽屉挂载点存在时应成功挂载入口卡片并同步悬浮球开关', async () => {
            const drawerDiv = document.createElement('div');
            drawerDiv.id = 'extensions_settings';
            document.body.appendChild(drawerDiv);

            const controller = new DrawerEntryController({
                host,
                store,
                settingsModal
            });

            // 等待异步 mount
            await new Promise((r) => setTimeout(r, 10));

            const root = document.getElementById('da-drawer-entry-root');
            expect(root).not.toBeNull();

            const toggle = root?.querySelector<HTMLInputElement>('#da-drawer-toggle-fab');
            expect(toggle).not.toBeNull();
            expect(toggle?.checked).toBe(true);

            // 更改状态
            toggle!.checked = false;
            toggle!.dispatchEvent(new Event('change'));
            expect(store.get('fabVisible')).toBe(false);

            // 外部 store 变更同步到 input
            store.set('fabVisible', true);
            expect(toggle?.checked).toBe(true);

            controller.dispose();
            expect(document.getElementById('da-drawer-entry-root')).toBeNull();
        });
    });

    describe('FABContainer', () => {
        it('应在页面中渲染悬浮球，并响应显隐切换', () => {
            const fab = new FABContainer({
                store,
                settingsModal,
                events: eventBus
            });

            const fabEl = document.getElementById('da-fab-button');
            expect(fabEl).not.toBeNull();

            store.set('fabVisible', false);
            expect(document.getElementById('da-fab-button')).toBeNull();

            store.set('fabVisible', true);
            expect(document.getElementById('da-fab-button')).not.toBeNull();

            fab.dispose();
            expect(document.getElementById('da-fab-button')).toBeNull();
        });

        it('生图任务入队与完成时应自动更新 is-generating 样式', () => {
            const fab = new FABContainer({
                store,
                settingsModal,
                events: eventBus
            });

            const fabEl = document.getElementById('da-fab-button');
            expect(fabEl?.classList.contains('is-generating')).toBe(false);

            // 派发任务入队
            eventBus.emit('task:queued', {
                taskId: 'task-1',
                request: {
                    taskId: 'task-1',
                    targetEngine: 'comfyui',
                    prompt: 'test prompt',
                    engineOptions: {}
                }
            });

            expect(fabEl?.classList.contains('is-generating')).toBe(true);

            // 派发任务完成
            eventBus.emit('task:completed', {
                taskId: 'task-1',
                result: {
                    taskId: 'task-1',
                    engine: 'comfyui',
                    images: [],
                    durationMs: 100
                }
            });

            expect(fabEl?.classList.contains('is-generating')).toBe(false);

            fab.dispose();
        });
    });
});
