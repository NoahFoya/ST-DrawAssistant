import { describe, it, expect, vi } from 'vitest';
import {
    DisposableStore,
    toDisposable,
    TypedEventBus,
    ObservableStore,
    migrateSettings,
    IndexedDBStorageAdapter,
    ExtensionRegistry,
    UIRegistry,
    PresetRegistry,
    DriverRegistry,
    Logger,
    LogBuffer,
    createKernelContext
} from '../src/core';
import { VERSION } from '../src/core/constants';

describe('Batch 1: Core Kernel Layer Tests (Specification Aligned)', () => {
    describe('Disposable Lifecycle Network', () => {
        it('should dispose resources in reverse order', () => {
            const store = new DisposableStore();
            const log: number[] = [];

            store.add(toDisposable(() => log.push(1)));
            store.add(toDisposable(() => log.push(2)));
            store.add(toDisposable(() => log.push(3)));

            store.dispose();
            expect(log).toEqual([3, 2, 1]);
        });
    });

    describe('TypedEventBus', () => {
        it('should emit and unsubscribe typed events safely', () => {
            const bus = new TypedEventBus();
            const spy = vi.fn();

            const sub = bus.on('task:state_changed', spy);
            bus.emit('task:state_changed', { taskId: 't1', status: 'RUNNING', progress: 50 });

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith({ taskId: 't1', status: 'RUNNING', progress: 50 });

            sub.dispose();
            bus.emit('task:state_changed', { taskId: 't1', status: 'COMPLETED' });
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    describe('ObservableStore & Schema Migration', () => {
        it('should migrate legacy settings to v0.3.4 schema', () => {
            const legacy = { serverUrl: 'http://127.0.0.1:8188' };
            const migrated = migrateSettings(legacy);

            expect(migrated.version).toBe('0.3.4');
            expect(migrated.provider).toBe('comfyui');
            expect(migrated.serverUrl).toBe('http://127.0.0.1:8188');
        });

        it('should notify subscribers on property changes', () => {
            const store = new ObservableStore(migrateSettings({}));
            const spy = vi.fn();

            const sub = store.subscribeKey('provider', spy);
            store.set('provider', 'sdwebui');

            expect(spy).toHaveBeenCalledWith('sdwebui', 'comfyui');
            sub.dispose();
        });
    });

    describe('IndexedDB & SHA-256 Deduplication', () => {
        it('should calculate SHA-256 and deduplicate identical image records', async () => {
            const adapter = new IndexedDBStorageAdapter();
            const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const hash = await adapter.calculateHash(data);

            const id1 = await adapter.saveImage({
                id: 'img-1',
                prompt: 'test prompt',
                data
            });

            // 存入相同数据的第二张图，应命中 SHA-256 去重索引返回已有 ID
            const id2 = await adapter.saveImage({
                id: 'img-2',
                prompt: 'test prompt 2',
                data
            });

            expect(id2).toBe(id1);
            adapter.dispose();
        });
    });

    describe('PresetRegistry by Driver & Category', () => {
        it('should register and retrieve presets by composite key', () => {
            const reg = new PresetRegistry();
            const sub = reg.register({
                metadata: {
                    id: 'default-wf',
                    name: '默认文生图工作流',
                    driver: 'comfyui',
                    category: 'workflows-txt2img'
                },
                data: { promptNodeId: '6' }
            });

            const found = reg.get('comfyui', 'workflows-txt2img', 'default-wf');
            expect(found).toBeDefined();
            expect(found?.data).toEqual({ promptNodeId: '6' });

            const list = reg.list('comfyui', 'workflows-txt2img');
            expect(list.length).toBe(1);

            sub.dispose();
            expect(reg.get('comfyui', 'workflows-txt2img', 'default-wf')).toBeUndefined();
        });
    });

    describe('KernelContext Assembly', () => {
        it('should assemble all core subsystems into a unified context', () => {
            const context = createKernelContext(VERSION);

            expect(context.version).toBe(VERSION);
            expect(context.host).toBeDefined();
            expect(context.events).toBeDefined();
            expect(context.store).toBeDefined();
            expect(context.storage).toBeDefined();
            expect(context.extensions).toBeDefined();
            expect(context.ui).toBeDefined();
            expect(context.presets).toBeDefined();
            expect(context.drivers).toBeDefined();
            expect(context.logger).toBeDefined();

            context.dispose();
        });
    });
});
