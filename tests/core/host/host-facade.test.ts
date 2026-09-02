import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HostFacade } from '../../../src/core/host/host-facade';

describe('HostFacade (宿主环境代理)', () => {
    let mockSTContext: any;

    beforeEach(() => {
        mockSTContext = {
            chat: [
                { mes: '你好', extra: {} },
                { mes: '世界', extra: {} }
            ],
            chatId: 'chat-12345',
            characterId: 0,
            characters: [{ name: 'CharacterA', avatar: 'char.png' }],
            eventSource: {
                on: vi.fn(),
                off: vi.fn(),
                emit: vi.fn()
            },
            event_types: {
                CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
                USER_MESSAGE_RENDERED: 'USER_MESSAGE_RENDERED',
                MESSAGE_SWIPED: 'MESSAGE_SWIPED',
                MESSAGE_UPDATED: 'MESSAGE_UPDATED',
                MESSAGE_DELETED: 'MESSAGE_DELETED',
                CHAT_CHANGED: 'CHAT_CHANGED'
            },
            saveChatDebounced: vi.fn(),
            saveSettingsDebounced: vi.fn(),
            extensionSettings: {}
        };

        (globalThis as any).SillyTavern = {
            getContext: () => mockSTContext
        };
    });

    it('whenReady 应能成功等待宿主上下文就绪', async () => {
        const host = new HostFacade();
        await expect(host.whenReady(1000)).resolves.toBeUndefined();
    });

    it('onCharacterMessageRendered 应注册宿主事件并在触发时规范化消息对象', () => {
        const host = new HostFacade();
        const handler = vi.fn();

        host.onCharacterMessageRendered(handler);

        expect(mockSTContext.eventSource.on).toHaveBeenCalledWith(
            'CHARACTER_MESSAGE_RENDERED',
            expect.any(Function)
        );

        // 模拟宿主派发事件
        const registeredListener = mockSTContext.eventSource.on.mock.calls[0][1];
        registeredListener(0);

        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                messageId: 0,
                chatId: 'chat-12345',
                isUser: false,
                rawText: '你好'
            })
        );
    });

    it('writeChatMessageExtra 应向独立命名空间写入数据并触发防抖存盘', () => {
        const host = new HostFacade();

        host.writeChatMessageExtra(1, 'lastImageId', 'img-999');

        expect(mockSTContext.chat[1].extra['ST-DrawAssistant'].lastImageId).toBe('img-999');
        expect(mockSTContext.eventSource.emit).toHaveBeenCalledWith('MESSAGE_UPDATED', 1);
        expect(mockSTContext.saveChatDebounced).toHaveBeenCalledTimes(1);
    });

    it('读写扩展设置应当隔离在 ST-DrawAssistant 命名空间下', () => {
        const host = new HostFacade();

        host.saveExtensionSettings({ enabled: true, theme: 'dark' });

        expect(mockSTContext.extensionSettings['ST-DrawAssistant']).toEqual({
            enabled: true,
            theme: 'dark'
        });
        expect(host.getExtensionSettings()).toEqual({ enabled: true, theme: 'dark' });
        expect(mockSTContext.saveSettingsDebounced).toHaveBeenCalledTimes(1);
    });
});
