import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResultIntegrator } from '../../../src/client/domain/task/result-integrator';
import { TypedEventBus } from '../../../src/client/core/event-bus';
import { CoreEventMap, DrawAssistantSettings } from '../../../src/client/core/types';
import { TaskManager } from '../../../src/client/domain/task/task-manager';
import { AdapterRegistry } from '../../../src/client/domain/drivers/adapter-registry';
import { DEFAULT_SETTINGS } from '../../../src/client/core/config/config-store';

describe('ResultIntegrator (生图结果多策略持久化与上下文集成)', () => {
    let events: TypedEventBus<CoreEventMap>;
    let mockStorage: any;
    let mockHost: any;
    let taskManager: TaskManager;
    let adapters: AdapterRegistry;
    let currentSettings: DrawAssistantSettings;

    beforeEach(() => {
        events = new TypedEventBus<CoreEventMap>();
        adapters = new AdapterRegistry();
        adapters.register({
            id: 'mock',
            name: 'Mock Adapter',
            capabilities: { txt2img: true, img2img: false },
            checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
            generate: vi.fn().mockImplementation(() => new Promise(() => {})), // 挂起，由测试手动触发或取消
            interrupt: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn()
        });
        currentSettings = { ...DEFAULT_SETTINGS };

        const fakeDb = new Map<string, any>();
        mockStorage = {
            saveImage: vi.fn().mockImplementation(async (record) => {
                fakeDb.set(record.id, record);
                return record.id;
            }),
            getImage: vi.fn().mockImplementation(async (id) => fakeDb.get(id))
        };

        const messageExtraDb = new Map<number, Record<string, any>>();
        mockHost = {
            readChatMessageExtra: vi.fn().mockImplementation((messageId: number, key?: string) => {
                const mes = messageExtraDb.get(messageId);
                return key ? mes?.[key] : mes;
            }),
            writeChatMessageExtra: vi.fn().mockImplementation((messageId: number, key: string, value: any) => {
                let mes = messageExtraDb.get(messageId);
                if (!mes) {
                    mes = {};
                    messageExtraDb.set(messageId, mes);
                }
                mes[key] = value;
            })
        };

        taskManager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 5000 })
        });
    });

    it('split 策略：持久化至本地存储，并在消息 extra 记录轻量引用，不内嵌大体积 Base64', async () => {
        currentSettings.storageStrategy = 'split';

        const integrator = new ResultIntegrator({
            events,
            storage: mockStorage,
            host: mockHost,
            tasks: taskManager,
            getSettings: () => currentSettings
        });

        // 提交一个带有 messageId 的任务
        const taskId = await taskManager.submit({
            request: {
                taskId: 't_split',
                targetEngine: 'mock',
                prompt: 'a scenic landscape',
                negativePrompt: 'blurry',
                contextInfo: { messageId: 42, chatId: 'chat_100' },
                engineOptions: {}
            }
        });

        const savedAssets: any[] = [];
        events.on('asset:saved', (e) => savedAssets.push(e));

        const fakeImageBlob = new Blob(['image binary content'], { type: 'image/png' });
        const result = {
            taskId,
            engine: 'mock',
            images: [{ blob: fakeImageBlob, format: 'png' }],
            durationMs: 120
        };

        const records = await integrator.integrate(taskId, result);

        expect(records).toHaveLength(1);
        expect(mockStorage.saveImage).toHaveBeenCalledTimes(1);
        expect(savedAssets).toHaveLength(1);
        expect(savedAssets[0].record.prompt).toBe('a scenic landscape');

        // 检查消息 extra 写入 (da_images 结构)
        expect(mockHost.writeChatMessageExtra).toHaveBeenCalledWith(42, 'da_images', expect.any(Object));
        const writtenDaImages = mockHost.readChatMessageExtra(42, 'da_images');
        expect(writtenDaImages).toBeDefined();
        expect(writtenDaImages[0][0].storageStrategy).toBe('split');
        expect(writtenDaImages[0][0].base64).toBeUndefined();
        expect(writtenDaImages[0][0].prompt).toBe('a scenic landscape');
        expect(writtenDaImages[0][0].uuid).toBeDefined();

        integrator.dispose();
    });

    it('embedded 策略：原图直接转为 Base64 内嵌写入消息 extra，满足自包含随聊天导出需求', async () => {
        currentSettings.storageStrategy = 'embedded';

        const integrator = new ResultIntegrator({
            events,
            storage: mockStorage,
            host: mockHost,
            tasks: taskManager,
            getSettings: () => currentSettings
        });

        const taskId = await taskManager.submit({
            request: {
                taskId: 't_embedded',
                targetEngine: 'mock',
                prompt: 'portrait of a princess',
                contextInfo: { messageId: 88, swipeId: 1, buttonIndex: 0 },
                engineOptions: {}
            }
        });

        const fakeImageBlob = new Blob(['embedded raw bytes'], { type: 'image/png' });
        const result = {
            taskId,
            engine: 'mock',
            images: [{ blob: fakeImageBlob, format: 'png' }],
            durationMs: 200
        };

        const records = await integrator.integrate(taskId, result);

        expect(records).toHaveLength(1);
        expect(mockStorage.saveImage).toHaveBeenCalledTimes(1);

        const writtenDaImages = mockHost.readChatMessageExtra(88, 'da_images');
        expect(writtenDaImages).toBeDefined();
        expect(writtenDaImages[1][0].storageStrategy).toBe('embedded');
        // 关键断言：包含完整合法的 data:image/png;base64 前缀与 Base64 内容
        expect(writtenDaImages[1][0].base64).toBeDefined();
        expect(writtenDaImages[1][0].base64).toMatch(/^data:image\/png;base64,/);

        integrator.dispose();
    });

    it('当任务已取消时，自动跳过持久化集成', async () => {
        const integrator = new ResultIntegrator({
            events,
            storage: mockStorage,
            host: mockHost,
            tasks: taskManager,
            getSettings: () => currentSettings
        });

        const taskId = await taskManager.submit({
            request: { taskId: 't_cancel', targetEngine: 'mock', prompt: 'test', engineOptions: {} }
        });

        await taskManager.cancelTask(taskId, '主动取消');

        const records = await integrator.integrate(taskId, {
            taskId,
            engine: 'mock',
            images: [{ blob: new Blob(['bytes']), format: 'png' }],
            durationMs: 50
        });

        expect(records).toHaveLength(0);
        expect(mockStorage.saveImage).not.toHaveBeenCalled();

        integrator.dispose();
    });

    it('监听 task:completed 事件时自动触发 integrate', async () => {
        const integrator = new ResultIntegrator({
            events,
            storage: mockStorage,
            host: mockHost,
            tasks: taskManager,
            getSettings: () => currentSettings
        });

        const taskId = await taskManager.submit({
            request: {
                taskId: 't_auto_complete',
                targetEngine: 'mock',
                prompt: 'test auto integrate',
                contextInfo: { messageId: 10, swipeId: 0, buttonIndex: 1 },
                engineOptions: {}
            }
        });

        events.emit('task:completed', {
            taskId,
            result: {
                taskId,
                engine: 'mock',
                images: [{ blob: new Blob(['auto']), format: 'png' }],
                durationMs: 80
            }
        });

        // 等待异步持久化完成
        await vi.waitFor(() => {
            expect(mockStorage.saveImage).toHaveBeenCalled();
        });

        expect(mockHost.writeChatMessageExtra).toHaveBeenCalledWith(10, 'da_images', expect.any(Object));
        const daImages = mockHost.readChatMessageExtra(10, 'da_images');
        expect(daImages[0][1]).toBeDefined();

        integrator.dispose();
    });
});
