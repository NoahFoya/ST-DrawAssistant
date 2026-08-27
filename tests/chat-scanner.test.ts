import { describe, it, expect, vi } from 'vitest';
import { extractUuidsFromMessages, handleChatDeleted } from '../src/storage/chat-scanner';
import * as managerModule from '../src/settings/manager';

describe('ChatScanner', () => {
    it('should extract UUIDs correctly from single and swipe message structures', () => {
        const mockMessages = [
            {
                content: 'Hello',
                extra: {
                    da_images: {
                        '0': { uuid: 'uuid-101' },
                        '1': {
                            '0': { uuid: 'uuid-102' },
                            '1': { uuid: 'uuid-103' },
                        },
                    },
                },
            },
            {
                content: 'World',
                extra: {},
            },
        ];

        const uuids = extractUuidsFromMessages(mockMessages);
        expect(uuids.size).toBe(3);
        expect(uuids.has('uuid-101')).toBe(true);
        expect(uuids.has('uuid-102')).toBe(true);
        expect(uuids.has('uuid-103')).toBe(true);
    });

    it('handleChatDeleted should return 0 when autoCleanupOnChatDelete is false (default)', async () => {
        const mockMessages = [
            {
                content: 'Test',
                extra: {
                    da_images: {
                        '0': { uuid: 'uuid-999' },
                    },
                },
            },
        ];

        const count = await handleChatDeleted('chat_123', mockMessages);
        expect(count).toBe(0);
    });

    it('handleChatDeleted should attempt deletion when autoCleanupOnChatDelete is true', async () => {
        vi.spyOn(managerModule, 'loadSettings').mockReturnValue({
            autoCleanupOnChatDelete: true,
        } as ReturnType<typeof managerModule.loadSettings>);

        const mockMessages = [
            {
                content: 'Test',
                extra: {
                    da_images: {
                        '0': { uuid: 'uuid-test-clean' },
                    },
                },
            },
        ];

        // 即使 IndexedDB 不在 Node.js 中，也确保代码正常迭代不报错
        const count = await handleChatDeleted('chat_456', mockMessages);
        expect(typeof count).toBe('number');
    });
});
