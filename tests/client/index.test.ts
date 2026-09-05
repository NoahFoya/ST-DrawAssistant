/**
 * @module tests/client/index.test
 * @description 客户端总装集成与启动生命周期测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    bootstrap,
    dispose,
    getActiveCoreContext,
    getActiveDomainContext,
    getActiveUIContext
} from '../../src/client/index';

describe('Client Integration & Bootstrap Lifecycle', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        (window as any).SillyTavern = {
            getContext: () => ({
                chat: [],
                chatId: 'test_chat_001',
                eventSource: {
                    on: vi.fn(),
                    off: vi.fn(),
                    emit: vi.fn()
                },
                event_types: {
                    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
                    USER_MESSAGE_RENDERED: 'user_message_rendered',
                    MESSAGE_SWIPED: 'message_swiped',
                    MESSAGE_UPDATED: 'message_updated',
                    MESSAGE_DELETED: 'message_deleted',
                    CHAT_CHANGED: 'chat_changed'
                },
                extensionSettings: {},
                saveChatDebounced: vi.fn(),
                saveSettingsDebounced: vi.fn()
            })
        };
    });

    afterEach(() => {
        dispose();
        document.body.innerHTML = '';
    });

    it('bootstrap 应该完整初始化 Core, Domain 与 UI 容器并暴露上下文句柄', async () => {
        const { core, domain, ui } = await bootstrap();

        expect(core).toBeDefined();
        expect(domain).toBeDefined();
        expect(ui).toBeDefined();

        expect(getActiveCoreContext()).toBe(core);
        expect(getActiveDomainContext()).toBe(domain);
        expect(getActiveUIContext()).toBe(ui);

        // 验证 UI 注册中心内置 Tab
        expect(ui.uiRegistry.getRegisteredTabs().length).toBe(10);

        // 验证悬浮球已挂载
        expect(document.querySelector('.da-fab-btn')).not.toBeNull();
    });

    it('重复调用 bootstrap 应该返回既有实例而不重复初始化', async () => {
        const first = await bootstrap();
        const second = await bootstrap();

        expect(second.core).toBe(first.core);
        expect(second.domain).toBe(first.domain);
        expect(second.ui).toBe(first.ui);
    });

    it('dispose 应该完整清理 UI, Domain 与 Core 资源并将上下文置空', async () => {
        await bootstrap();
        expect(getActiveUIContext()).not.toBeNull();

        dispose();

        expect(getActiveUIContext()).toBeNull();
        expect(getActiveDomainContext()).toBeNull();
        expect(getActiveCoreContext()).toBeNull();

        // 验证悬浮球 DOM 已被清理
        expect(document.querySelector('.da-fab-btn')).toBeNull();
    });
});
