/**
 * 生图任务调度器 (GenerationOrchestrator)。
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
    StoredImageRecord,
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
    /** 目标楼层挂载定位坐标（含 chatId、messageId、swipeId、instructionIndex） */
    target: SlotMountTarget;
    /** 用户原始输入或楼层提取的提示词文本 */
    rawPrompt: string;
    /** 选用的服务提供方类型，未指定时采用配置中心当前激活的提供方 */
    providerType?: ProviderType;
    /** 可选输入底图（图生图或局部重绘使用） */
    sourceImage?: Blob | string;
    /** 可选局部重绘遮罩蒙版 */
    maskImage?: Blob | string;
    /** 可选单次任务覆盖超参数 */
    parameters?: Record<string, unknown>;
}

/** 任务调度器依赖选项（用于测试隔离与依赖注入） */
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
 * 生图任务调度器类。
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
     * 按目标楼层位置检索当前处于活跃状态 (pending / generating) 的生图任务。
     *
     * @param target 目标楼层位置坐标
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
     * 取消指定消息分支下的活跃生图任务（用于 MESSAGE_SWIPE_DELETED 清理）。
     */
    public cancelTasksBySwipe(chatId: string, messageId: number, swipeId: number, reason = '目标候选分支已删除'): void {
        for (const task of this._tasks.values()) {
            if (
                task.target.chatId === chatId &&
                task.target.messageId === messageId &&
                (task.target.swipeId ?? 0) === swipeId &&
                (task.status === 'pending' || task.status === 'generating')
            ) {
                this.cancelTask(task.taskId, reason);
            }
        }
    }

    /**
     * 取消指定会话中楼层索引超出有效范围的活跃任务（用于 MESSAGE_DELETED 清理）。
     */
    public cancelTasksOutOfRange(chatId: string, validChatLength: number, reason = '目标消息楼层已删除'): void {
        for (const task of this._tasks.values()) {
            if (
                task.target.chatId === chatId &&
                task.target.messageId >= validChatLength &&
                (task.status === 'pending' || task.status === 'generating')
            ) {
                this.cancelTask(task.taskId, reason);
            }
        }
    }

    /**
     * 提交新的生图任务并加入调度队列。
     *
     * 同一楼层位置若已有活跃任务则直接复用；入队时为任务分配唯一 ID 并触发调度，
     * 仅在生图成功后才向宿主消息记录图片关联，避免任务失败或取消时残留无效 imageId。
     *
     * @param options 提交任务参数选项
     * @returns 生成的任务唯一标识符
     * @throws {Error} 若调度器已销毁则拒绝接收任务
     */
    public async submitTask(options: SubmitTaskOptions): Promise<string> {
        if (this._isDisposed) {
            throw new Error('调度器已销毁，拒绝接收新任务');
        }

        // 目标楼层防重：若同一楼层位置已有处于 pending 或 generating 状态的任务，直接返回已有任务 ID
        const existingTask = this.getActiveTaskByTarget(options.target);
        if (existingTask) {
            logger.info(`目标楼层已有活跃生图任务 (${existingTask.taskId})，跳过重复提交`);
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
        const effectiveSourceImage = options.sourceImage ?? (options.parameters?.sourceImage as Blob | string | undefined);
        const effectiveMaskImage = options.maskImage ?? (options.parameters?.maskImage as Blob | string | undefined);

        const request = this._promptPipeline.buildGenerationRequest({
            rawPrompt: options.rawPrompt,
            sourceImage: effectiveSourceImage,
            maskImage: effectiveMaskImage,
            parameters: options.parameters,
            providerType,
        });

        // 2. 创建任务对象并分配 imageId
        const mergedParamsSnapshot = options.parameters
            ? { ...options.parameters }
            : (effectiveSourceImage || effectiveMaskImage ? {} : undefined);

        if (mergedParamsSnapshot) {
            if (effectiveSourceImage && !mergedParamsSnapshot.sourceImage) {
                mergedParamsSnapshot.sourceImage = effectiveSourceImage;
            }
            if (effectiveMaskImage && !mergedParamsSnapshot.maskImage) {
                mergedParamsSnapshot.maskImage = effectiveMaskImage;
            }
        }

        const task: DrawingTask = {
            taskId,
            imageId,
            target: options.target,
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
            providerType,
            parametersSnapshot: mergedParamsSnapshot,
            createdAt: Date.now(),
            status: 'pending',
        };

        this._tasks.set(taskId, task);
        this._queue.push(taskId);

        logger.info(`生图任务已入队: ${taskId} (资产: ${imageId}, 会话: ${options.target.chatId}, 楼层 #${options.target.messageId})`);
        this._eventBus.emit('task:created', task);
        this.transitionTaskStatus(taskId, 'pending');

        // 3. 驱动队列消费
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
            if (task.parametersSnapshot) {
                if (task.parametersSnapshot.sourceImage instanceof Blob) {
                    task.parametersSnapshot.sourceImage = undefined;
                }
                if (task.parametersSnapshot.maskImage instanceof Blob) {
                    task.parametersSnapshot.maskImage = undefined;
                }
            }
            this.transitionTaskStatus(taskId, 'cancelled', { cancelReason: reason });
            logger.info(`排队中任务已取消: ${taskId}`);
            return;
        }

        if (task.status === 'generating') {
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
     * 1. 任务状态机迁移至 generating 状态并建立超时与取消控制；
     * 2. 调用对应 Provider 发送生图请求，支持超时与取消；
     * 3. 生成完成后保存图片至本地存储，更新楼层消息并触发 image:ready 事件；
     * 4. 若配置了服务端转存，在后台执行上传。
     *
     * @param taskId 待执行任务标识符
     */
    private async executeTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task) {
            this._activeCount = Math.max(0, this._activeCount - 1);
            this.processQueue();
            return;
        }

        // 1. 复用任务入队时分配的全局唯一主键 imageId
        const imageId = task.imageId || `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        task.imageId = imageId;

        // 2. 任务状态机迁移至 generating 状态
        this.transitionTaskStatus(taskId, 'generating', { imageId });

        // 3. 建立 AbortController 与超时控制
        const controller = new AbortController();
        this._controllers.set(taskId, controller);

        let isTimedOut = false;
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        let timeoutMs = DEFAULT_TASK_TIMEOUT_MS;

        try {
            const configuredTimeout = this._settingsStore.get('taskTimeoutMs');
            timeoutMs =
                typeof configuredTimeout === 'number' && configuredTimeout > 0
                    ? configuredTimeout
                    : DEFAULT_TASK_TIMEOUT_MS;

            timeoutTimer = setTimeout(() => {
                isTimedOut = true;
                logger.warn(`任务执行超时 (${Math.round(timeoutMs / 1000)}s): ${taskId}`);
                controller.abort();
            }, timeoutMs);
            this._timeoutTimers.set(taskId, timeoutTimer);

            // 4. 检索生图提供方驱动
            const provider: GenerationProvider | undefined = this._registry.getProvider(task.providerType);
            if (!provider) {
                this.finalizeFailure(taskId, `未找到标识为 ${task.providerType} 的生图提供方`);
                return;
            }

            // 5. 构造生图请求参数
            const request: GenerationRequest = {
                prompt: task.prompt,
                negativePrompt: task.negativePrompt,
                sourceImage: task.parametersSnapshot?.sourceImage as Blob | string | undefined,
                maskImage: task.parametersSnapshot?.maskImage as Blob | string | undefined,
                parameters: task.parametersSnapshot,
            };

            // 6. 调度提供方执行生图
            const result: GenerationResult = await provider.generate(request, controller.signal);

            // 7. 校验任务取消状态
            if (controller.signal.aborted || this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务的响应到达，已安全丢弃: ${taskId}`);
                return;
            }

            // 8. 图像质量处理与元数据归一化
            const configuredQuality = (this._settingsStore.get('imageQuality') || 'original') as ImageStorageQuality;
            const finalBlob = await applyImageStorageQuality(result.blob, configuredQuality);

            if (controller.signal.aborted || this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务在编码处理后退出，已丢弃结果: ${taskId}`);
                return;
            }

            const finalizedMetadata = {
                ...result.metadata,
                prompt: result.metadata?.prompt ?? task.prompt,
                negativePrompt: result.metadata?.negativePrompt ?? task.negativePrompt,
            };

            // 9. 资产原子持久化（成功后同步写入元数据与二进制 Blob，保证图库索引纯净）
            const record: StoredImageRecord = {
                imageId,
                taskId: task.taskId,
                chatId: task.target.chatId,
                mimeType: finalBlob.type || 'image/png',
                byteSize: finalBlob.size,
                status: 'ready',
                metadata: finalizedMetadata,
                createdAt: Date.now(),
            };

            await this._storage.saveImage(record, finalBlob);

            // 10. 任务状态机迁移至完成态
            task.generationMetadata = finalizedMetadata;
            this.transitionTaskStatus(taskId, 'completed', { imageId });

            // 11. 调度宿主楼层消息资产回写（仅在当前活跃会话与任务会话一致时回写楼层，跨会话后台任务仅保留至图库）
            const currentChatId = this._getActiveChatId();
            const isCrossSession = Boolean(currentChatId && currentChatId !== task.target.chatId);
            if (isCrossSession) {
                logger.info(
                    `[GenerationOrchestrator] 任务 [${taskId}] 完成时当前活跃会话 (${currentChatId}) 与目标会话 (${task.target.chatId}) 不一致，仅保存图库而不回写楼层`
                );
                this._sessionLifecycle.uploadImageToServer(imageId).catch((transferErr) => {
                    logger.warn(`后台服务端转存异常 [${imageId}]:`, transferErr);
                });
            } else {
                try {
                    await this._sessionLifecycle.updateMessageSlot(task.target, {
                        imageId,
                    });
                } catch (writeErr) {
                    logger.error(`任务 [${taskId}] 楼层资产回写异常:`, writeErr);
                }
            }

            // 12. 广播全局完成事件
            this._eventBus.emit('image:ready', { imageId, target: task.target });
            if (task.parametersSnapshot?.mode === 'inpaint') {
                this._eventBus.emit('image:updated', { imageId, target: task.target });
            }
            logger.info(`生图任务执行成功: ${taskId} (资产 ID: ${imageId})`);
        } catch (err: unknown) {
            if (this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务异常退出: ${taskId}`);
                return;
            }

            if (isTimedOut) {
                const timeoutSec = Math.round(timeoutMs / 1000);
                this.finalizeFailure(taskId, `生图服务响应超时 (${timeoutSec}s)`);
                return;
            }

            if (controller.signal.aborted) {
                logger.info(`已中止任务退出: ${taskId}`);
                return;
            }

            const errorMsg = err instanceof Error ? err.message : (typeof err === 'string' ? err : '生图服务执行异常');
            this.finalizeFailure(taskId, errorMsg);
        } finally {
            // 清理控制器与定时器
            if (timeoutTimer !== null) {
                clearTimeout(timeoutTimer);
            }
            this._timeoutTimers.delete(taskId);
            this._controllers.delete(taskId);

            // 释放任务快照中残留的大型 Blob 二进制引用，防止内存占用滞留
            if (task.parametersSnapshot) {
                if (task.parametersSnapshot.sourceImage instanceof Blob) {
                    task.parametersSnapshot.sourceImage = undefined;
                }
                if (task.parametersSnapshot.maskImage instanceof Blob) {
                    task.parametersSnapshot.maskImage = undefined;
                }
            }

            // 计数递减并调度后续任务
            this._activeCount = Math.max(0, this._activeCount - 1);
            this.processQueue();
        }
    }

    /**
     * 终结任务为失败状态。
     *
     * @remarks
     * 失败记录严禁存入持久化 IndexedDB，保持本地数据库纯净；
     * 仅在内存状态机中流转并广播 task:status 供 UI 展示重试状态。
     */
    private finalizeFailure(taskId: string, errorMsg: string): void {
        const task = this._tasks.get(taskId);
        if (task && task.status !== 'cancelled' && task.status !== 'completed') {
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
        this._activeCount = 0;

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

/** 全局默认单例生图任务调度器 */
export const generationOrchestrator = new GenerationOrchestrator();
