import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoreContext, createCoreContext } from '../../../src/client/core/context';

describe('CoreContext (基础设施服务容器)', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern = {
            getContext: () => ({
                eventSource: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
                event_types: { CHAT_CHANGED: 'CHAT_CHANGED' },
                extensionSettings: {},
                saveSettingsDebounced: vi.fn(),
                saveChatDebounced: vi.fn()
            })
        };
    });

    it('createCoreContext 应正确实例化并关联底层核心服务', () => {
        const context = createCoreContext();

        expect(context.host).toBeDefined();
        expect(context.events).toBeDefined();
        expect(context.store).toBeDefined();
        expect(context.storage).toBeDefined();
        expect(context.network).toBeDefined();

        context.dispose();
    });

    it('dispose 应安全执行并清理内部所有受管服务', () => {
        const context = new CoreContext();
        const customDisposable = { dispose: vi.fn() };

        context.addDisposable(customDisposable);
        context.dispose();

        expect(customDisposable.dispose).toHaveBeenCalledTimes(1);
    });

    it('当监听到宿主 chat:changed 时应主动调用 storage.revokeAllUrls 并派发总线事件', () => {
        let chatListener: ((chatId: string) => void) | undefined;
        (globalThis as any).SillyTavern.getContext = () => ({
            eventSource: {
                on: vi.fn((event, handler) => {
                    if (event === 'CHAT_CHANGED') {
                        chatListener = handler;
                    }
                }),
                off: vi.fn(),
                emit: vi.fn()
            },
            event_types: { CHAT_CHANGED: 'CHAT_CHANGED' },
            extensionSettings: {},
            saveSettingsDebounced: vi.fn(),
            saveChatDebounced: vi.fn()
        });

        const context = new CoreContext();
        const revokeSpy = vi.spyOn(context.storage, 'revokeAllUrls');
        const busSpy = vi.fn();
        context.events.on('chat:changed', busSpy);

        expect(chatListener).toBeDefined();
        chatListener!('chat-456');

        expect(revokeSpy).toHaveBeenCalledTimes(1);
        expect(busSpy).toHaveBeenCalledWith({ chatId: 'chat-456' });

        context.dispose();
    });
});
