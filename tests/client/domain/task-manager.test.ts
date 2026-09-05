import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManager } from '../../../src/client/domain/task/task-manager';
import { AdapterRegistry } from '../../../src/client/domain/drivers/adapter-registry';
import { ImageEngineAdapter, GenerationRequest, GenerationResult } from '../../../src/client/domain/types';
import { TypedEventBus } from '../../../src/client/core/event-bus';
import { CoreEventMap } from '../../../src/client/core/types';

describe('TaskManager (任务调度中心与状态机)', () => {
    let adapters: AdapterRegistry;
    let events: TypedEventBus<CoreEventMap>;
    let mockAdapter: ImageEngineAdapter;

    beforeEach(() => {
        adapters = new AdapterRegistry();
        events = new TypedEventBus<CoreEventMap>();

        mockAdapter = {
            id: 'comfyui',
            name: 'ComfyUI Engine',
            capabilities: { txt2img: true, img2img: false },
            checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
            generate: vi.fn().mockImplementation(async (req: GenerationRequest) => {
                await new Promise((r) => setTimeout(r, 20));
                return {
                    taskId: req.taskId,
                    engine: req.targetEngine,
                    images: [{ blob: new Blob(['test']), format: 'png' }],
                    durationMs: 20
                } as GenerationResult;
            }),
            interrupt: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn()
        };

        adapters.register(mockAdapter);
    });

    it('应该成功提交任务并顺序执行完成 (PENDING -> RUNNING -> COMPLETED)', async () => {
        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 5000 })
        });

        const stateChanges: string[] = [];
        events.on('task:state_changed', (e: any) => {
            stateChanges.push(e.status);
        });

        const taskId = await manager.submit({
            request: {
                taskId: 'test_task_1',
                targetEngine: 'comfyui',
                prompt: 'a cute cat',
                engineOptions: {}
            },
            chatId: 'chat_1',
            messageId: 101
        });

        expect(taskId).toBe('test_task_1');

        // 等待异步完成
        await vi.waitFor(() => {
            expect(manager.getTask('test_task_1')?.status).toBe('COMPLETED');
        });

        const snap = manager.getTask('test_task_1')!;
        expect(snap.status).toBe('COMPLETED');
        expect(snap.result?.images).toHaveLength(1);
        expect(stateChanges).toContain('PENDING');
        expect(stateChanges).toContain('RUNNING');
        expect(stateChanges).toContain('COMPLETED');

        const tasksForMsg = manager.getTasksByMessage('chat_1', 101);
        expect(tasksForMsg).toHaveLength(1);
        expect(tasksForMsg[0].id).toBe('test_task_1');
    });

    it('并发配额限制：超额任务排队等待并自动出队执行', async () => {
        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 5000 })
        });

        const id1 = await manager.submit({
            request: { taskId: 't1', targetEngine: 'comfyui', prompt: 'p1', engineOptions: {} }
        });
        const id2 = await manager.submit({
            request: { taskId: 't2', targetEngine: 'comfyui', prompt: 'p2', engineOptions: {} }
        });

        // 此时 t1 在运行，t2 在排队
        expect(manager.getActiveCount()).toBe(1);
        expect(manager.getQueueLength()).toBe(1);
        expect(manager.getTask(id1)?.status).toBe('RUNNING');
        expect(manager.getTask(id2)?.status).toBe('PENDING');

        // 等待全部完成
        await vi.waitFor(() => {
            expect(manager.getTask(id2)?.status).toBe('COMPLETED');
        });

        expect(manager.getTask(id1)?.status).toBe('COMPLETED');
        expect(manager.getTask(id2)?.status).toBe('COMPLETED');
        expect(manager.getActiveCount()).toBe(0);
        expect(manager.getQueueLength()).toBe(0);
    });


    it('排队中的任务取消后应直接移出队列并标记为 CANCELLED', async () => {
        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 5000 })
        });

        await manager.submit({
            request: { taskId: 'running_t', targetEngine: 'comfyui', prompt: 'p', engineOptions: {} }
        });
        const queuedId = await manager.submit({
            request: { taskId: 'queued_t', targetEngine: 'comfyui', prompt: 'p', engineOptions: {} }
        });

        expect(manager.getTask(queuedId)?.status).toBe('PENDING');
        await manager.cancelTask(queuedId, '不想画了');

        expect(manager.getTask(queuedId)?.status).toBe('CANCELLED');
        expect(manager.getTask(queuedId)?.error).toBe('不想画了');
        expect(manager.getQueueLength()).toBe(0);
    });

    it('取消丢弃保护机制 (Cancel & Drop Guard)：运行中取消的任务，结果返回后直接丢弃', async () => {
        // 创建一个持续耗时的适配器
        let finishGenerate: (res: GenerationResult) => void;
        const slowAdapter: ImageEngineAdapter = {
            id: 'slow',
            name: 'Slow Adapter',
            capabilities: { txt2img: true, img2img: false },
            checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
            generate: vi.fn().mockImplementation(() => {
                return new Promise((resolve) => {
                    finishGenerate = resolve;
                });
            }),
            interrupt: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn()
        };
        adapters.register(slowAdapter);

        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 5000 })
        });

        const completedEvents: any[] = [];
        events.on('task:completed', (e: any) => {
            completedEvents.push(e);
        });

        const taskId = await manager.submit({
            request: { taskId: 'slow_task', targetEngine: 'slow', prompt: 'slow prompt', engineOptions: {} }
        });

        expect(manager.getTask(taskId)?.status).toBe('RUNNING');

        // 用户中途取消
        await manager.cancelTask(taskId, '等待超时取消');
        expect(manager.getTask(taskId)?.status).toBe('CANCELLED');
        expect(slowAdapter.interrupt).toHaveBeenCalledWith(taskId);

        // 延迟一段时间后底层网络仍返回了图片
        finishGenerate!({
            taskId,
            engine: 'slow',
            images: [{ blob: new Blob(['delayed image']), format: 'png' }],
            durationMs: 500
        });

        // 短暂等待
        await new Promise((r) => setTimeout(r, 20));

        // 断路丢弃生效：状态依然是 CANCELLED，未触发 completed 事件，结果为 undefined
        expect(manager.getTask(taskId)?.status).toBe('CANCELLED');
        expect(manager.getTask(taskId)?.result).toBeUndefined();
        expect(completedEvents).toHaveLength(0);
    });

    it('找不到适配器时任务应标记为 FAILED', async () => {
        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 5000 })
        });

        const taskId = await manager.submit({
            request: { taskId: 'fail_t', targetEngine: 'non_exist_engine', prompt: 'test', engineOptions: {} }
        });

        await vi.waitFor(() => {
            return manager.getTask(taskId)?.status === 'FAILED';
        });

        expect(manager.getTask(taskId)?.status).toBe('FAILED');
        expect(manager.getTask(taskId)?.error).toContain('未找到标识为 [non_exist_engine]');
    });

    it('dispose 应安全清理并中断所有在途任务', async () => {
        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 5000 })
        });

        await manager.submit({
            request: { taskId: 't1', targetEngine: 'comfyui', prompt: 'test', engineOptions: {} }
        });

        manager.dispose();
        expect(manager.getQueueLength()).toBe(0);
        await expect(manager.submit({
            request: { taskId: 't2', targetEngine: 'comfyui', prompt: 'test', engineOptions: {} }
        })).rejects.toThrow('已被销毁');
    });

    it('任务执行超时应标记为超时错误，且不被 abort 异常二次覆盖，事件仅触发一次', async () => {
        // 创建一个永远不返回的适配器，模拟卡死超时
        const hangingAdapter: ImageEngineAdapter = {
            id: 'hanging',
            name: 'Hanging Engine',
            capabilities: { txt2img: true, img2img: false },
            checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
            generate: vi.fn().mockImplementation((_req, signal: AbortSignal) => {
                return new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        reject(new Error('请求已中止 AbortError'));
                    });
                });
            }),
            interrupt: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn()
        };
        adapters.register(hangingAdapter);

        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 50 })
        });

        const failedEvents: any[] = [];
        events.on('task:failed', (e) => {
            failedEvents.push(e);
        });

        const taskId = await manager.submit({
            request: { taskId: 'timeout_t', targetEngine: 'hanging', prompt: 'test', engineOptions: {} }
        });

        await vi.waitFor(() => {
            expect(manager.getTask(taskId)?.status).toBe('FAILED');
        }, { timeout: 2000, interval: 20 });

        const snap = manager.getTask(taskId)!;
        expect(snap.status).toBe('FAILED');
        // 验证保留的是真实的超时诊断原因，没有被 catch 块中的通用中止错误覆盖
        expect(snap.error).toContain('生图任务超时');
        // 验证 task:failed 事件仅触发了一次，没有重复触发
        expect(failedEvents).toHaveLength(1);
        expect(failedEvents[0].taskId).toBe('timeout_t');
        expect(failedEvents[0].error).toContain('生图任务超时');
    });

    it('会话切换时自动级联取消旧会话任务 (chat:changed 监听与生命周期管控)', async () => {
        // 创建耗时任务适配器
        let resolveGen: () => void;
        const slowAdapter: ImageEngineAdapter = {
            id: 'slow_chat',
            name: 'Slow Chat Adapter',
            capabilities: { txt2img: true, img2img: false },
            checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
            generate: vi.fn().mockImplementation((_req: any, signal?: AbortSignal) => new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(new Error('Aborted'));
                    return;
                }
                signal?.addEventListener('abort', () => reject(new Error('Aborted')));
                resolveGen = () => resolve({
                    taskId: 'any',
                    engine: 'slow_chat',
                    images: [{ blob: new Blob(['x']), format: 'png' }],
                    durationMs: 10
                });
            })),
            interrupt: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn()
        };
        adapters.register(slowAdapter);

        const manager = new TaskManager({
            adapters,
            events,
            getConfig: () => ({ maxConcurrentTasks: 1, taskTimeoutMs: 10000 })
        });

        // 提交旧会话运行中任务
        const oldRunningId = await manager.submit({
            request: { taskId: 'old_running', targetEngine: 'slow_chat', prompt: 'cat', engineOptions: {} },
            chatId: 'chat_old'
        });

        // 提交旧会话排队中任务
        const oldQueuedId = await manager.submit({
            request: { taskId: 'old_queued', targetEngine: 'slow_chat', prompt: 'dog', engineOptions: {} },
            chatId: 'chat_old'
        });

        // 提交一个与会话无关的任务
        const globalTaskId = await manager.submit({
            request: { taskId: 'global_task', targetEngine: 'slow_chat', prompt: 'fish', engineOptions: {} }
        });

        expect(manager.getTask(oldRunningId)?.status).toBe('RUNNING');
        expect(manager.getTask(oldQueuedId)?.status).toBe('PENDING');
        expect(manager.getTask(globalTaskId)?.status).toBe('PENDING');

        // 派发会话切换事件，切换至 chat_new
        events.emit('chat:changed', { chatId: 'chat_new' });

        // 等待异步取消生效
        await vi.waitFor(() => {
            expect(manager.getTask(oldRunningId)?.status).toBe('CANCELLED');
            expect(manager.getTask(oldQueuedId)?.status).toBe('CANCELLED');
        });

        expect(manager.getTask(oldRunningId)?.error).toContain('会话已切换');
        expect(manager.getTask(oldQueuedId)?.error).toContain('会话已切换');
        expect(slowAdapter.interrupt).toHaveBeenCalledWith('old_running');

        // 无 chatId 关联的独立任务不受影响，并在队列推进后转为 RUNNING
        await vi.waitFor(() => {
            expect(manager.getTask(globalTaskId)?.status).toBe('RUNNING');
        });

        resolveGen!();
    });
});

