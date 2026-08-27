import { describe, it, expect, vi } from 'vitest';
import {
    createPipelineHooks,
    PromptPipeline,
    VariableEvaluator,
    TaskManager,
    IDrawDriver,
    GenerationPayload
} from '../src/domain';
import { TypedEventBus, ObservableStore, migrateSettings, DriverRegistry, IndexedDBStorageAdapter } from '../src/core';

describe('Batch 2: Domain Layer Tests (Specification Aligned)', () => {
    describe('VariableEvaluator', () => {
        it('should parse <lora:...> and <wlr:...> syntax tags', () => {
            const evaluator = new VariableEvaluator();
            const text = '1girl, <lora:genshin_keqing:0.8>, <wlr:maid_dress:1.0:0.8:maid>, solo';
            const { cleanText, loras } = evaluator.parseLoraTags(text);

            expect(cleanText).toBe('1girl, solo');
            expect(loras.length).toBe(2);
            expect(loras[0].name).toBe('genshin_keqing');
            expect(loras[0].modelWeight).toBe(0.8);
            expect(loras[1].name).toBe('maid_dress');
            expect(loras[1].clipWeight).toBe(0.8);
        });
    });

    describe('PromptPipeline Multi-stage Hooks Execution', () => {
        it('should execute beforeClean -> beforePromptBuild -> beforeSubmit in waterfall sequence', async () => {
            const hooks = createPipelineHooks();
            const pipeline = new PromptPipeline(hooks);

            hooks.beforeClean.tap('test-clean', (text) => text.replace('cat', 'neko'));
            hooks.beforePromptBuild.tap('test-build', (text) => `${text}, anime style`);
            hooks.beforeSubmit.tap('test-submit', (payload) => {
                payload.params.steps = 30;
                return payload;
            });

            const settings = migrateSettings({ promptPrefix: 'masterpiece' });
            const result = await pipeline.process(
                {
                    rawPrompt: '1girl, cat girl',
                    messageId: 1,
                    chatId: 'chat_1'
                },
                settings
            );

            expect(result.payload.prompt).toContain('neko girl');
            expect(result.payload.prompt).toContain('anime style');
            expect(result.payload.params.steps).toBe(30);
        });
    });

    describe('TaskManager State Machine & Client-side Discard', () => {
        it('should handle PENDING -> DISCARDED on cancel running task', async () => {
            const events = new TypedEventBus();
            const store = new ObservableStore(migrateSettings({}));
            const drivers = new DriverRegistry();
            const storage = new IndexedDBStorageAdapter();

            let resolveGen: any;
            const mockDriver: IDrawDriver = {
                id: 'comfyui',
                name: 'Mock ComfyUI',
                ping: async () => true,
                formatPrompt: (p) => p,
                generate: async (payload, onProgress) => {
                    onProgress({ percent: 30 });
                    return new Promise((resolve) => {
                        resolveGen = resolve;
                    });
                },
                interrupt: vi.fn()
            };

            drivers.register(mockDriver);

            const taskManager = new TaskManager({ events, store, drivers, storage });

            const taskId = await taskManager.submit({
                chatId: 'chat_1',
                messageId: 10,
                payload: {
                    mode: 'txt2img',
                    prompt: 'test',
                    negativePrompt: '',
                    params: { seed: 1, steps: 20, cfgScale: 7, samplerName: 'Euler', width: 512, height: 512 }
                }
            });

            const taskBefore = taskManager.getTask(taskId);
            expect(taskBefore?.status).toBe('RUNNING');

            // 执行中取消 -> 客户端丢弃模式
            await taskManager.cancelTask(taskId);
            const taskAfter = taskManager.getTask(taskId);
            expect(taskAfter?.status).toBe('DISCARDED');
            expect(mockDriver.interrupt).toHaveBeenCalled();

            // 模拟异步返回，确保静默丢弃
            resolveGen?.({ imageBlobs: [new Blob(['test'])] });
            expect(taskManager.getTask(taskId)?.status).toBe('DISCARDED');

            taskManager.dispose();
            storage.dispose();
        });
    });
});
