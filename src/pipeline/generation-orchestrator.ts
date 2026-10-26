/**
 * 绘图任务编排调度器 (GenerationOrchestrator)。
 *
 * 负责任务的入队、并发限制、状态流转与生成调度：
 * 1. 任务队列：按先进先出排队，支持并发上限控制；
 * 2. 状态流转：管理 pending、generating、completed、failed、cancelled 状态；
 * 3. 结果保存：生成完成后保存图片到本地存储并通知前端渲染。
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
    TaskProgressInfo,
} from '@types';
import { providerRegistry } from '../provider/registry';
import { imageStorage, type ImageStorage } from '../store/image-storage';
import { promptPipeline, type PromptPipeline } from './prompt-pipeline';
import { settingsStore, type SettingsStore, DEFAULT_TASK_TIMEOUT_MS, type ImageStorageQuality } from '../store/settings-store';
import { eventBus, type EventBus } from '../util/event-bus';
import { sessionLifecycle, type SessionLifecycleManager } from './session-lifecycle';
import { logger } from '../util/logger';
import { applyImageStorageQuality } from '../util/image-compress';

/** 提交生图任务参数选项 */
export interface SubmitTaskOptions {
    /** 绘图插槽目标挂载坐标（含 chatId、messageId、swipeId、instructionIndex） */
    target: SlotMountTarget;
    /** 用户原始输入或楼层提取的提示词文本 */
    rawPrompt: string;
    /** 选用的服务提供方类型，未指定时采用配置中心当前激活的提供方 */
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
        if (typeof this._sessionLifecycle?.setTaskCanceller === 'function') {
            this._sessionLifecycle.setTaskCanceller((chatId, reason) => {
                this.cancelTasksByChat(chatId, reason);
            });
        }
        this._customMaxConcurrent = options.maxConcurrent;
        this._getActiveChatId =
            options.getActiveChatId ??
            (() => {
                const hostContext = window.SillyTavern?.getContext?.();
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
     * 按目标插槽坐标检索当前处于活跃状态 (pending / generating) 的生图任务。
     *
     * @param target 目标插槽坐标
     * @returns 匹配的活跃任务对象，未找到返回 undefined
     */
    public getActiveTaskByTarget(target: SlotMountTarget): DrawingTask | undefined {
        for (const task of this._tasks.values()) {
            if (
                task.target.chatId === target.chatId &&
                task.target.messageId === target.messageId &&
                (task.target.swipeId ?? 0) === (target.swipeId ?? 0) &&
                task.target.instructionIndex === target.instructionIndex &&
                (task.status === 'pending' || task.status === 'generating')
            ) {
                return task;
            }
        }
        return undefined;
    }

    /**
     * 取消指定会话下的全部活跃生图任务（用于 CHAT_CHANGED 时的生命周期主动熔断）。
     *
     * @param chatId 目标会话标识符
     * @param reason 取消原因描述
     */
    public cancelTasksByChat(chatId: string, reason = '会话已切换'): void {
        for (const task of this._tasks.values()) {
            if (task.target.chatId === chatId && (task.status === 'pending' || task.status === 'generating')) {
                this.cancelTask(task.taskId, reason);
            }
        }
    }

    /**
     * 提交新的绘图任务并加入调度队列。
     *
     * 同一插槽若已有活跃任务则直接复用；入队时为任务分配唯一 ID，在宿主消息中记录占位并触发调度。
     *
     * @param options 提交任务参数选项
     * @returns 生成的任务唯一标识符
     * @throws {Error} 若调度器已销毁则拒绝接收任务
     */
    public async submitTask(options: SubmitTaskOptions): Promise<string> {
        if (this._isDisposed) {
            throw new Error('调度器已销毁，拒绝接收新任务');
        }

        // 目标插槽防重：若同一插槽已有处于 pending 或 generating 状态的任务，直接返回已有任务 ID
        const existingTask = this.getActiveTaskByTarget(options.target);
        if (existingTask) {
            logger.info(`目标插槽已有活跃生图任务 (${existingTask.taskId})，跳过重复提交`);
            return existingTask.taskId;
        }

        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        this.trimTaskHistory();

        // 确定生图服务提供方类型
        const providerType: ProviderType =
            options.providerType ??
            (this._settingsStore.get('activeProvider') as ProviderType) ??
            'comfyui';

        // 1. 预处理提示词并构造生图请求
        const request = this._promptPipeline.buildGenerationRequest({
            rawPrompt: options.rawPrompt,
            parameters: options.parameters,
            providerType,
        });

        // 2. 创建任务对象并分配 imageId
        const task: DrawingTask = {
            taskId,
            imageId,
            target: options.target,
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
            providerType,
            parametersSnapshot: options.parameters ? { ...options.parameters } : undefined,
            createdAt: Date.now(),
            status: 'pending',
        };

        // 3. 在宿主消息中记录初始插槽占位
        try {
            this._sessionLifecycle.recordSlotEntry(options.target, {
                imageId,
            });
        } catch (err) {
            logger.warn(`初始插槽占位写入异常: ${taskId}`, err);
        }

        this._tasks.set(taskId, task);
        this._queue.push(taskId);

        logger.info(`生图任务已入队: ${taskId} (资产: ${imageId}, 会话: ${options.target.chatId}, 楼层 #${options.target.messageId})`);
        this._eventBus.emit('task:created', task);
        this.transitionTaskStatus(taskId, 'pending');

        // 4. 驱动队列消费
        this.processQueue();

        return taskId;
    }

    /**
     * 取消指定的生图任务。
     *
     * 排队中的任务直接移出队列；执行中的任务通过 AbortController 中止网络请求并标记为取消，
     * 不调用后端的全局中断接口，避免影响共享服务端的其他生成任务。
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
            if (task.imageId) {
                this._storage.updateImageRecord(task.imageId, { status: 'failed' }).catch((err) => {
                    logger.warn(`更新图像记录取消状态异常 [${task.imageId}]:`, err);
                });
            }
            this.transitionTaskStatus(taskId, 'cancelled', { cancelReason: reason, imageId: task.imageId });
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
     *
     * 包含以下流程：
     * 1. 任务状态置为 generating 并记录占位；
     * 2. 调用对应 Provider 发送绘图请求，支持超时与取消；
     * 3. 生成完成后保存图片至本地存储，更新消息插槽并触发 image:ready 事件；
     * 4. 若配置了服务端转存，在后台执行上传。
     *
     * @param taskId 待执行任务标识符
     */
    private async executeTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) {
            this._activeCount--;
            this.processQueue();
            return;
        }

        // 1. 复用任务入队时分配的全局唯一主键 imageId，确保插槽占位与元数据存储全生命周期严格一致
        const imageId = task.imageId || `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        task.imageId = imageId;

        this.transitionTaskStatus(taskId, 'generating', { imageId });

        // 2. 写入初始元数据占位
        try {
            await this._storage.saveImageMeta({
                imageId,
                taskId: task.taskId,
                mimeType: 'image/png',
                byteSize: 0,
                chatId: task.target.chatId,
                status: 'generating',
                metadata: {
                    prompt: task.prompt,
                    negativePrompt: task.negativePrompt,
                },
                createdAt: Date.now(),
            });
        } catch (storageErr) {
            logger.warn(`写入初始图像元数据占位异常: ${taskId}`, storageErr);
        }

        // 3. 在宿主消息中记录插槽占位
        const initialChatId = this._getActiveChatId();
        if (!initialChatId || initialChatId === task.target.chatId) {
            try {
                await this._sessionLifecycle.updateMessageSlot(task.target, imageId);
            } catch (writeErr) {
                logger.warn(`初始楼层资产插槽占位回写异常 [${taskId}]:`, writeErr);
            }
        }

        // 4. 建立 AbortController 与超时控制
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

        // 5. 检索生图提供方驱动
        const provider: GenerationProvider | undefined = this._registry.getProvider(task.providerType);
        if (!provider) {
            this.finalizeFailure(taskId, `未找到标识为 ${task.providerType} 的生图提供方`);
            return;
        }

        try {
            // 6. 构造生图请求参数
            const request: GenerationRequest = {
                prompt: task.prompt,
                negativePrompt: task.negativePrompt,
                parameters: task.parametersSnapshot,
            };

            // 7. 进度转发回调
            const onProgress = (info: TaskProgressInfo) => {
                const current = this._tasks.get(taskId);
                if (current && current.status === 'generating') {
                    this._eventBus.emit('task:progress', { taskId, progress: info });
                }
            };

            // 8. 调度提供方执行网络生成
            const result: GenerationResult = await provider.generate(request, onProgress, controller.signal);

            // 9. 检查任务是否已取消
            if (controller.signal.aborted || this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务的响应到达，已安全丢弃: ${taskId}`);
                return;
            }

            // 10. 保存图片数据并更新元数据
            const configuredQuality = (this._settingsStore.get('imageQuality') || 'original') as ImageStorageQuality;
            const finalBlob = await applyImageStorageQuality(result.blob, configuredQuality);

            const finalizedMetadata = {
                ...result.metadata,
                prompt: result.metadata?.prompt ?? task.prompt,
                negativePrompt: result.metadata?.negativePrompt ?? task.negativePrompt,
            };

            await this._storage.finalizeImage(imageId, finalBlob, {
                mimeType: finalBlob.type || 'image/png',
                byteSize: finalBlob.size,
                status: 'ready',
                metadata: finalizedMetadata,
            });

            // 11. 更新宿主消息插槽
            const currentChatId = this._getActiveChatId();
            if (currentChatId && currentChatId !== task.target.chatId) {
                logger.info(
                    `任务 [${taskId}] 完成时当前活跃会话 (${currentChatId}) 与目标会话 (${task.target.chatId}) 不一致，跳过当前视图楼层回写`
                );
            } else {
                try {
                    await this._sessionLifecycle.updateMessageSlot(task.target, {
                        imageId,
                    });
                } catch (writeErr) {
                    logger.error(`任务 [${taskId}] 楼层资产回写异常:`, writeErr);
                }
            }

            // 12. 更新任务状态为完成并广播 image:ready 事件
            task.generationMetadata = finalizedMetadata;
            this.transitionTaskStatus(taskId, 'completed', { imageId });
            this._eventBus.emit('image:ready', { imageId, target: task.target });
            logger.info(`生图任务执行成功: ${taskId} (资产 ID: ${imageId})`);

            // 13. 若开启服务端存储，后台执行转存
            this._sessionLifecycle.uploadImageToServer(imageId).catch((transferErr) => {
                logger.warn(`后台服务端转存异常 [${imageId}]:`, transferErr);
            });
        } catch (err: unknown) {
            if (controller.signal.aborted || this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务异常退出: ${taskId}`);
                return;
            }

            const errorMsg = err instanceof Error ? err.message : (typeof err === 'string' ? err : '生图服务执行异常');
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
            if (task.imageId) {
                this._storage.updateImageRecord(task.imageId, { status: 'failed' }).catch((err) => {
                    logger.warn(`更新图像记录失败状态异常 [${task.imageId}]:`, err);
                });
            }
            this.transitionTaskStatus(taskId, 'failed', { error: errorMsg, imageId: task.imageId });
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
