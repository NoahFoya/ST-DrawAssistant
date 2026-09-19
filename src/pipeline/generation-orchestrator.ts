/**
 * 绘图任务编排调度器。
 *
 * @remarks
 * 负责生图任务创建、FIFO 并发排队调度、进度转发、超时控制、
 * 客户端取消中断、IndexedDB 结果分表持久化与跨会话楼层渲染隔离。
 */

import type {
    DrawingTask,
    DrawingTaskStatus,
    GenerationProvider,
    GenerationRequest,
    GenerationResult,
    ProviderRegistry,
    ProviderType,
    SlotMountTarget,
    StoredImageRecord,
    TaskProgressInfo,
} from '@types';
import { providerRegistry } from '../provider/registry';
import { imageStorage, type ImageStorage } from '../store/image-storage';
import { promptPipeline, type PromptPipeline } from './prompt-pipeline';
import { settingsStore, type SettingsStore, DEFAULT_TASK_TIMEOUT_MS } from '../store/settings-store';
import { eventBus, type EventBus } from '../util/event-bus';
import { sessionLifecycle, type SessionLifecycleManager } from './session-lifecycle';
import { logger } from '../util/logger';

/** 提交生图任务参数选项 */
export interface SubmitTaskOptions {
    /** 绘图插槽目标挂载坐标 */
    target: SlotMountTarget;
    /** 用户原始输入或楼层提取的提示词文本 */
    rawPrompt: string;
    /** 选用的服务提供方类型，未指定时采用配置中心激活提供方 */
    providerType?: ProviderType;
    /** 可选单次任务覆盖超参数 */
    parameters?: Record<string, unknown>;
}

/** 任务编排调度器依赖选项（用于测试隔离与依赖注入） */
export interface OrchestratorOptions {
    registry?: ProviderRegistry;
    storage?: ImageStorage;
    promptPipeline?: PromptPipeline;
    settingsStore?: SettingsStore;
    eventBus?: EventBus;
    sessionLifecycle?: SessionLifecycleManager;
    maxConcurrent?: number;
    getActiveChatId?: () => string | undefined;
}

/**
 * 绘图任务编排调度器类。
 */
export class GenerationOrchestrator {
    private readonly _registry: ProviderRegistry;
    private readonly _storage: ImageStorage;
    private readonly _promptPipeline: PromptPipeline;
    private readonly _settingsStore: SettingsStore;
    private readonly _eventBus: EventBus;
    private readonly _sessionLifecycle: SessionLifecycleManager;
    private readonly _getActiveChatId: () => string | undefined;

    private readonly _tasks = new Map<string, DrawingTask>();
    private readonly _queue: string[] = [];
    private readonly _controllers = new Map<string, AbortController>();
    private readonly _timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

    private _activeCount = 0;
    private _isProcessingQueue = false;
    private _isDisposed = false;
    private _customMaxConcurrent?: number;

    public static readonly MAX_TASK_HISTORY = 150;

    public constructor(options: OrchestratorOptions = {}) {
        this._registry = options.registry ?? providerRegistry;
        this._storage = options.storage ?? imageStorage;
        this._promptPipeline = options.promptPipeline ?? promptPipeline;
        this._settingsStore = options.settingsStore ?? settingsStore;
        this._eventBus = options.eventBus ?? eventBus;
        this._sessionLifecycle = options.sessionLifecycle ?? sessionLifecycle;
        this._customMaxConcurrent = options.maxConcurrent;
        this._getActiveChatId =
            options.getActiveChatId ??
            (() => {
                const hostContext = (window as any).SillyTavern?.getContext?.();
                return hostContext?.chatId;
            });
    }

    /**
     * 更新任务状态并广播 task:status 事件。
     */
    private transitionTaskStatus(
        taskId: string,
        status: DrawingTaskStatus,
        extra?: { error?: string; imageId?: string; cancelReason?: string }
    ): void {
        const task = this._tasks.get(taskId);
        if (!task) {
            return;
        }

        task.status = status;
        if (extra?.error) {
            task.error = extra.error;
        }
        if (extra?.imageId) {
            task.imageId = extra.imageId;
        }

        this._eventBus.emit('task:status', {
            taskId,
            status,
            task,
            error: extra?.error,
            imageId: extra?.imageId,
            cancelReason: extra?.cancelReason,
        });
    }

    /**
     * 查询指定任务是否处于已取消状态。
     */
    private isTaskCancelled(taskId: string): boolean {
        const task = this._tasks.get(taskId);
        return task?.status === 'cancelled';
    }

    /**
     * 获取当前系统生效的最大并发数。
     */
    public getMaxConcurrent(): number {
        if (typeof this._customMaxConcurrent === 'number' && this._customMaxConcurrent > 0) {
            return this._customMaxConcurrent;
        }

        return 1;
    }

    /**
     * 设置自定义最大并发数。
     */
    public setMaxConcurrent(limit: number): void {
        if (limit > 0) {
            this._customMaxConcurrent = limit;
            this.processQueue();
        }
    }

    /**
     * 提交新的绘图任务并加入调度队列。
     *
     * @param options 提交任务参数选项
     * @returns 生成的任务唯一标识符
     */
    public async submitTask(options: SubmitTaskOptions): Promise<string> {
        if (this._isDisposed) {
            throw new Error('调度器已销毁，拒绝接收新任务');
        }

        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        this.trimTaskHistory();

        // 1. 通过提示词流水线清洗并解析正负提示词
        const request = this._promptPipeline.buildGenerationRequest({
            rawPrompt: options.rawPrompt,
            parameters: options.parameters,
        });

        // 确定生图服务提供方类型
        const providerType: ProviderType =
            options.providerType ??
            (this._settingsStore.get('activeProvider') as ProviderType) ??
            'comfyui';

        // 2. 构建领域模型 DrawingTask
        const task: DrawingTask = {
            taskId,
            target: options.target,
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
            providerType,
            parametersSnapshot: options.parameters ? { ...options.parameters } : undefined,
            createdAt: Date.now(),
            status: 'pending',
        };

        this._tasks.set(taskId, task);
        this._queue.push(taskId);

        logger.info(`生图任务已入队: ${taskId} (目标会话: ${options.target.chatId}, 楼层 #${options.target.messageId})`);
        this._eventBus.emit('task:created', task);
        this.transitionTaskStatus(taskId, 'pending');

        // 3. 驱动队列消费
        this.processQueue();

        return taskId;
    }

    /**
     * 取消指定生图任务（客户端丢弃策略）。
     *
     * @param taskId 任务唯一标识符
     * @param reason 取消原因描述
     */
    public cancelTask(taskId: string, reason = '用户主动取消'): void {
        const task = this._tasks.get(taskId);
        if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            return;
        }

        if (task.status === 'pending') {
            const queueIndex = this._queue.indexOf(taskId);
            if (queueIndex !== -1) {
                this._queue.splice(queueIndex, 1);
            }
            this.transitionTaskStatus(taskId, 'cancelled', { cancelReason: reason });
            logger.info(`排队中任务已取消: ${taskId}`);
            return;
        }

        if (task.status === 'generating') {
            this.transitionTaskStatus(taskId, 'cancelled', { cancelReason: reason });
            const controller = this._controllers.get(taskId);
            if (controller) {
                controller.abort();
            }
            logger.info(`执行中任务已取消并终止网络等待: ${taskId}`);
        }
    }

    /**
     * 查询指定 ID 的任务对象快照。
     */
    public getTask(taskId: string): DrawingTask | undefined {
        return this._tasks.get(taskId);
    }

    /**
     * 调度队列消费，依据当前活跃数与并发上限提取后续任务。
     */
    private processQueue(): void {
        if (this._isProcessingQueue || this._isDisposed) {
            return;
        }

        this._isProcessingQueue = true;

        try {
            const maxConcurrent = this.getMaxConcurrent();

            while (this._activeCount < maxConcurrent && this._queue.length > 0) {
                const nextTaskId = this._queue.shift();
                if (!nextTaskId) {
                    break;
                }

                const task = this._tasks.get(nextTaskId);
                if (!task || task.status !== 'pending') {
                    continue;
                }

                this._activeCount++;
                void this.executeTask(nextTaskId);
            }
        } finally {
            this._isProcessingQueue = false;
        }
    }

    /**
     * 执行单个生图任务。
     */
    private async executeTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) {
            this._activeCount--;
            this.processQueue();
            return;
        }

        this.transitionTaskStatus(taskId, 'generating');

        // 1. 建立 AbortController 与超时控制
        const controller = new AbortController();
        this._controllers.set(taskId, controller);

        const configuredTimeout = this._settingsStore.get('taskTimeoutMs');
        const timeoutMs =
            typeof configuredTimeout === 'number' && configuredTimeout > 0
                ? configuredTimeout
                : DEFAULT_TASK_TIMEOUT_MS;

        const timeoutTimer = setTimeout(() => {
            logger.warn(`任务执行超时 (${Math.round(timeoutMs / 1000)}s): ${taskId}`);
            controller.abort();
        }, timeoutMs);
        this._timeoutTimers.set(taskId, timeoutTimer);

        // 2. 检索生图提供方驱动
        const provider: GenerationProvider | undefined = this._registry.getProvider(task.providerType);
        if (!provider) {
            this.finalizeFailure(taskId, `未找到标识为 ${task.providerType} 的生图提供方`);
            return;
        }

        try {
            // 3. 构造生图请求参数
            const request: GenerationRequest = {
                prompt: task.prompt,
                negativePrompt: task.negativePrompt,
                parameters: task.parametersSnapshot,
            };

            // 4. 进度转发回调
            const onProgress = (info: TaskProgressInfo) => {
                const current = this._tasks.get(taskId);
                if (current && current.status === 'generating') {
                    this._eventBus.emit('task:progress', { taskId, progress: info });
                }
            };

            // 5. 调度提供方执行
            const result: GenerationResult = await provider.generate(request, onProgress, controller.signal);

            // 6. 若任务在网络等待期间被用户主动取消，则安全丢弃响应
            if (controller.signal.aborted || this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务的响应到达，已安全丢弃: ${taskId}`);
                return;
            }

            // 7. 本地持久化至 IndexedDB（元数据与二进制分表存储）
            const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const record: StoredImageRecord = {
                imageId,
                taskId: task.taskId,
                mimeType: result.blob.type || 'image/png',
                byteSize: result.blob.size,
                chatId: task.target.chatId,
                status: 'ready',
                metadata: {
                    ...result.metadata,
                    prompt: task.prompt,
                    negativePrompt: task.negativePrompt,
                },
                createdAt: Date.now(),
            };

            await this._storage.saveImage(record, result.blob);

            // 8. 会话一致性判断：仅当宿主当前处于目标会话时回写楼层消息，避免在其他会话中错乱渲染
            const currentChatId = this._getActiveChatId();
            if (currentChatId && currentChatId !== task.target.chatId) {
                logger.info(
                    `任务 [${taskId}] 完成时当前活跃会话 (${currentChatId}) 与目标会话 (${task.target.chatId}) 不一致，跳过当前视图楼层回写`
                );
            } else {
                try {
                    await this._sessionLifecycle.updateMessageSlot(task.target, imageId);
                } catch (writeErr) {
                    logger.error(`任务 [${taskId}] 楼层资产回写异常:`, writeErr);
                }
            }

            // 9. 更新状态为完成并广播事件
            task.generationMetadata = record.metadata;
            this.transitionTaskStatus(taskId, 'completed', { imageId });
            logger.info(`生图任务执行成功: ${taskId} (资产 ID: ${imageId})`);
        } catch (err: any) {
            if (controller.signal.aborted || this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务异常退出: ${taskId}`);
                return;
            }

            const errorMsg = err?.message || '生图服务执行异常';
            this.finalizeFailure(taskId, errorMsg);
        } finally {
            // 清理控制器与定时器
            clearTimeout(timeoutTimer);
            this._timeoutTimers.delete(taskId);
            this._controllers.delete(taskId);

            // 计数递减并调度后续任务
            this._activeCount--;
            this.processQueue();
        }
    }

    /**
     * 终结任务为失败状态。
     */
    private finalizeFailure(taskId: string, errorMsg: string): void {
        const task = this._tasks.get(taskId);
        if (task && task.status !== 'cancelled' && task.status !== 'completed') {
            this.transitionTaskStatus(taskId, 'failed', { error: errorMsg });
            logger.error(`生图任务失败 [${taskId}]: ${errorMsg}`);
        }
    }

    /**
     * 修剪历史终态任务以防内存占用过高。
     */
    private trimTaskHistory(): void {
        if (this._tasks.size <= GenerationOrchestrator.MAX_TASK_HISTORY) {
            return;
        }

        const terminalIds: string[] = [];
        for (const [id, t] of this._tasks.entries()) {
            if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') {
                terminalIds.push(id);
                if (this._tasks.size - terminalIds.length <= GenerationOrchestrator.MAX_TASK_HISTORY) {
                    break;
                }
            }
        }

        for (const id of terminalIds) {
            this._tasks.delete(id);
        }
    }

    /**
     * 销毁调度器并清理所有队列状态与未决定时器。
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._queue.length = 0;

        for (const timer of this._timeoutTimers.values()) {
            clearTimeout(timer);
        }
        this._timeoutTimers.clear();

        for (const controller of this._controllers.values()) {
            controller.abort();
        }
        this._controllers.clear();
        this._tasks.clear();
    }
}

/** 全局默认单例任务编排调度器 */
export const generationOrchestrator = new GenerationOrchestrator();
