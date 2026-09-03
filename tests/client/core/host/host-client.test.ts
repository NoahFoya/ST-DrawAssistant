import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HostClient } from '../../../../src/client/core/host';

describe('HostClient (宿主环境交互)', () => {
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
        const host = new HostClient();
        await expect(host.whenReady(1000)).resolves.toBeUndefined();
    });

    it('whenReady 若超时未检测到宿主环境应明确 reject 而非伪就绪', async () => {
        (globalThis as any).SillyTavern = {
            getContext: () => null
        };
        const host = new HostClient();
        await expect(host.whenReady(50)).rejects.toThrow('等待 SillyTavern 宿主环境就绪超时');
    });

    it('onCharacterMessageRendered 应注册酒馆事件并在触发时构造标准消息对象', () => {
        const host = new HostClient();
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
        const host = new HostClient();

        host.writeChatMessageExtra(1, 'lastImageId', 'img-999');

        expect(mockSTContext.chat[1].extra['ST-DrawAssistant'].lastImageId).toBe('img-999');
        expect(mockSTContext.eventSource.emit).toHaveBeenCalledWith('MESSAGE_UPDATED', 1);
        expect(mockSTContext.saveChatDebounced).toHaveBeenCalledTimes(1);
    });

    it('读写扩展设置应当隔离在 ST-DrawAssistant 命名空间下', () => {
        const host = new HostClient();

        host.saveExtensionSettings({ enabled: true, theme: 'dark' });

        expect(mockSTContext.extensionSettings['ST-DrawAssistant']).toEqual({
            enabled: true,
            theme: 'dark'
        });
        expect(host.getExtensionSettings()).toEqual({ enabled: true, theme: 'dark' });
        expect(mockSTContext.saveSettingsDebounced).toHaveBeenCalledTimes(1);
    });

    it('在宿主未就绪前注册监听器不应抛错，就绪后应自动完成绑定', async () => {
        // 先设为未就绪
        (globalThis as any).SillyTavern = { getContext: () => null };
        const host = new HostClient();
        const handler = vi.fn();

        // 未就绪时注册，不应抛出异常
        expect(() => host.onChatChanged(handler)).not.toThrow();

        // 随后宿主环境就绪
        (globalThis as any).SillyTavern = { getContext: () => mockSTContext };
        await host.whenReady(100);

        expect(mockSTContext.eventSource.on).toHaveBeenCalledWith(
            'CHAT_CHANGED',
            expect.any(Function)
        );

        host.dispose();
    });

    it('whenReady 等待期间调用 dispose 应安全清除所有轮询与超时定时器', () => {
        (globalThis as any).SillyTavern = { getContext: () => null };
        const host = new HostClient();

        void host.whenReady(5000);
        // 立即 dispose
        expect(() => host.dispose()).not.toThrow();
    });
});
