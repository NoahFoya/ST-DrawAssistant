/**
 * 生图任务调度器 (GenerationOrchestrator)。
 *
 * 负责任务的入队、串行调度、状态流转与结果持久化：
 * 1. 串行队列：按先进先出顺序单并发排队调度；
 * 2. 状态流转：管理 pending、generating、completed、failed、cancelled 状态；
 * 3. 结果保存：生成完成后保存图片到本地存储，并在同会话下回写楼层并通知前端渲染。
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
    ImageStorageQuality,
} from '@types';
import { providerRegistry } from '../provider/registry';
import { imageStorage, type ImageStorage } from '../store/image-storage';
import { PromptPipeline, promptPipeline } from './prompt-pipeline';
import { settingsStore, type SettingsStore, DEFAULT_TASK_TIMEOUT_MS } from '../store/settings-store';
import { eventBus, type EventBus } from '../util/event-bus';
import { sessionLifecycle, type SessionLifecycleManager } from './session-lifecycle';
import { logger } from '../util/logger';
import { applyImageStorageQuality } from '../util/image-compress';
import { ensureValidImageBlob } from '../util/http-client';

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
    /** 是否在初始化时向 sessionLifecycle 注册会话切换自动取消回调 */
    bindTaskCanceller?: boolean;
    getActiveChatId?: () => string | undefined;
}

/** 取消生图任务控制选项 */
export interface CancelTaskOptions {
    /** 为 true 时通知上层抑制逐条取消提示弹窗（如批量取消旧分支队列后统一汇总提示） */
    silentToast?: boolean;
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

    public static readonly MAX_TASK_HISTORY = 150;

    public constructor(options: OrchestratorOptions = {}) {
        this._registry = options.registry ?? providerRegistry;
        this._storage = options.storage ?? imageStorage;
        this._settingsStore = options.settingsStore ?? settingsStore;
        this._promptPipeline =
            options.promptPipeline ??
            (options.settingsStore ? new PromptPipeline(options.settingsStore) : promptPipeline);
        this._eventBus = options.eventBus ?? eventBus;
        this._sessionLifecycle = options.sessionLifecycle ?? sessionLifecycle;
        if (options.bindTaskCanceller && typeof this._sessionLifecycle?.setTaskCanceller === 'function') {
            this._sessionLifecycle.setTaskCanceller((chatId, reason) => {
                this.cancelTasksByChat(chatId, reason);
            });
        }
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
        extra?: { error?: string; imageId?: string; cancelReason?: string; silentToast?: boolean }
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
            ...(extra?.silentToast !== undefined ? { silentToast: extra.silentToast } : {}),
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
     * 取消指定会话下的全部活跃生图任务（用于会话切换时清理未完成任务）。
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
     * 处理消息分支删除：取消被删分支的任务，并对同楼层后续分支的在途任务执行 swipeId 前移校准。
     */
    public handleSwipeDeleted(
        chatId: string,
        messageId: number,
        deletedSwipeId: number,
        reason = '目标候选分支已删除'
    ): void {
        for (const task of this._tasks.values()) {
            if (
                task.target.chatId !== chatId ||
                task.target.messageId !== messageId ||
                (task.status !== 'pending' && task.status !== 'generating')
            ) {
                continue;
            }
            const sw = task.target.swipeId ?? 0;
            if (sw === deletedSwipeId) {
                this.cancelTask(task.taskId, reason);
            } else if (sw > deletedSwipeId) {
                task.target = {
                    ...task.target,
                    swipeId: sw - 1,
                };
            }
        }
    }

    /**
     * 处理消息楼层删除：结合被删索引与当前会话消息指令正文，取消已删除楼层的任务并重定位前移楼层的在途任务。
     */
    public reconcileTasksAfterMessageDelete(
        chatId: string,
        currentChat: ReadonlyArray<{ mes?: string; swipes?: unknown[]; swipe_id?: number } | undefined>,
        deletedIndex?: number,
        reason = '目标消息楼层已删除'
    ): void {
        const matchesTaskCommand = (
            msg: { mes?: string; swipes?: unknown[]; swipe_id?: number } | undefined,
            task: DrawingTask
        ): boolean => {
            if (!msg) return false;
            const sw = task.target.swipeId ?? 0;
            const rawText =
                Array.isArray(msg.swipes) && typeof msg.swipes[sw] === 'string'
                    ? (msg.swipes[sw] as string)
                    : typeof msg.mes === 'string'
                      ? msg.mes
                      : '';
            if (!rawText) return false;
            const cmds = this._promptPipeline.extractCommands(rawText);
            const cmd = cmds[task.target.instructionIndex];
            return Boolean(cmd && cmd.promptText === task.rawPrompt);
        };

        for (const task of this._tasks.values()) {
            if (
                task.target.chatId !== chatId ||
                (task.status !== 'pending' && task.status !== 'generating')
            ) {
                continue;
            }
            const findShiftedIndex = (): number => {
                const startIdx = Math.min(origIdx - 1, currentChat.length - 1);
                for (let idx = startIdx; idx >= 0; idx--) {
                    if (matchesTaskCommand(currentChat[idx], task)) {
                        return idx;
                    }
                }
                return -1;
            };

            const origIdx = task.target.messageId;
            if (typeof deletedIndex === 'number' && Number.isFinite(deletedIndex) && deletedIndex >= 0) {
                if (origIdx === deletedIndex) {
                    this.cancelTask(task.taskId, reason);
                } else if (origIdx > deletedIndex) {
                    const shiftedIdx = findShiftedIndex();
                    if (shiftedIdx >= 0) {
                        task.target = { ...task.target, messageId: shiftedIdx };
                    } else {
                        this.cancelTask(task.taskId, reason);
                    }
                }
                continue;
            }

            if (origIdx >= currentChat.length || !matchesTaskCommand(currentChat[origIdx], task)) {
                const shiftedIdx = findShiftedIndex();
                if (shiftedIdx >= 0) {
                    task.target = { ...task.target, messageId: shiftedIdx };
                } else {
                    this.cancelTask(task.taskId, reason);
                }
            }
        }
    }

    /**
     * 取消指定消息分支下的活跃生图任务（用于消息编辑导致结构变更时清理当前分支任务）。
     */
    public cancelTasksBySwipe(
        chatId: string,
        messageId: number,
        swipeId: number,
        reason = '目标候选分支已删除',
        options?: CancelTaskOptions
    ): void {
        for (const task of this._tasks.values()) {
            if (
                task.target.chatId === chatId &&
                task.target.messageId === messageId &&
                (task.target.swipeId ?? 0) === swipeId &&
                (task.status === 'pending' || task.status === 'generating')
            ) {
                this.cancelTask(task.taskId, reason, options);
            }
        }
    }

    /**
     * 取消同一楼层下除当前激活分支外的其余历史分支未完成生图任务。
     *
     * @remarks
     * 用于右滑重 roll 生成全新候选分支时释放单并发队列，使新分支生图请求得以优先执行。
     *
     * @returns 本次实际取消的任务数量
     */
    public cancelOtherSwipeTasks(
        chatId: string,
        messageId: number,
        activeSwipeId: number,
        reason = '重 roll 生成新分支，已自动取消旧分支任务',
        options?: CancelTaskOptions
    ): number {
        const targetIds: string[] = [];
        for (const task of this._tasks.values()) {
            if (
                task.target.chatId === chatId &&
                task.target.messageId === messageId &&
                (task.target.swipeId ?? 0) !== activeSwipeId &&
                (task.status === 'pending' || task.status === 'generating')
            ) {
                targetIds.push(task.taskId);
            }
        }

        let cancelledCount = 0;
        for (const taskId of targetIds) {
            const task = this._tasks.get(taskId);
            if (task && (task.status === 'pending' || task.status === 'generating')) {
                this.cancelTask(taskId, reason, options);
                cancelledCount++;
            }
        }
        return cancelledCount;
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

        // 1. 预处理提示词并固化当前生效的生图参数预设快照，确保排队期间切换预设不导致参数错配
        const explicitDrawingId =
            typeof options.parameters?.drawingPresetId === 'string'
                ? options.parameters.drawingPresetId
                : undefined;
        const resolvedDrawing = this._settingsStore.resolveDrawingPreset(providerType, {
            explicitPresetId: explicitDrawingId,
            throwOnMissingActive: true,
        });
        const effectiveDrawingPresetId = resolvedDrawing.presetId;

        const rawParamSource = options.parameters?.sourceImage as Blob | string | undefined;
        const rawParamMask = options.parameters?.maskImage as Blob | string | undefined;
        const effectiveSourceImage = options.sourceImage ?? rawParamSource;
        const effectiveMaskImage = options.maskImage ?? rawParamMask;

        const mergedParamsSnapshot: Record<string, unknown> | undefined =
            options.parameters || effectiveDrawingPresetId
                ? { ...(options.parameters ?? {}) }
                : undefined;

        if (mergedParamsSnapshot) {
            delete mergedParamsSnapshot.sourceImage;
            delete mergedParamsSnapshot.maskImage;
            if (effectiveDrawingPresetId && !mergedParamsSnapshot.drawingPresetId) {
                mergedParamsSnapshot.drawingPresetId = effectiveDrawingPresetId;
            }
        }

        const request = this._promptPipeline.buildGenerationRequest({
            rawPrompt: options.rawPrompt,
            sourceImage: effectiveSourceImage,
            maskImage: effectiveMaskImage,
            parameters: mergedParamsSnapshot,
            providerType,
        });

        // 2. 创建任务对象并分配 imageId
        const task: DrawingTask = {
            taskId,
            imageId,
            target: options.target,
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
            rawPrompt: request.rawPrompt,
            rawNegativePrompt: request.rawNegativePrompt,
            loras: request.loras,
            providerType,
            parametersSnapshot: mergedParamsSnapshot,
            resolvedPromptPresetId: request.resolvedPromptPresetId,
            resolvedPromptPresetName: request.resolvedPromptPresetName,
            sourceImage: effectiveSourceImage,
            maskImage: effectiveMaskImage,
            createdAt: Date.now(),
            status: 'pending',
        };

        this._tasks.set(taskId, task);
        this._queue.push(taskId);

        const transport = this._settingsStore.get('transport') || 'direct';
        const promptPresetLabel =
            request.resolvedPromptPresetName || request.resolvedPromptPresetId || '无';
        logger.info(
            `生图任务已入队: ${taskId} (资产: ${imageId}, 引擎: ${providerType}, 通道: ${transport}, 提示词预设: ${promptPresetLabel}, 会话: ${options.target.chatId}, 楼层 #${options.target.messageId})`
        );
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
    public cancelTask(taskId: string, reason = '用户主动取消', options?: CancelTaskOptions): void {
        const task = this._tasks.get(taskId);
        if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            return;
        }

        const silentToast = options?.silentToast;

        if (task.status === 'pending') {
            const queueIndex = this._queue.indexOf(taskId);
            if (queueIndex !== -1) {
                this._queue.splice(queueIndex, 1);
            }
            task.sourceImage = undefined;
            task.maskImage = undefined;
            this.transitionTaskStatus(taskId, 'cancelled', { cancelReason: reason, silentToast });
            logger.info(`排队中任务已取消: ${taskId}`);
            return;
        }

        if (task.status === 'generating') {
            this.transitionTaskStatus(taskId, 'cancelled', {
                cancelReason: reason,
                imageId: task.imageId,
                silentToast,
            });
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
            while (this._activeCount < 1 && this._queue.length > 0) {
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
     * 1. 将任务状态更新为 generating 并建立超时与取消控制；
     * 2. 调用对应 Provider 发送生图请求，支持超时与取消；
     * 3. 生成完成后保存图片至本地存储，并将任务状态更新为 completed；
     * 4. 若仍在原会话中，同步回写楼层消息（内部按 saveToServer 配置执行服务端转存）并触发 image:ready 事件；跨会话完成时仅保留在本地图库。
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

        // 1. 使用任务入队时分配的唯一主键 imageId
        const imageId = task.imageId;
        if (!imageId) {
            this.finalizeFailure(taskId, '生图任务缺少有效的图像标识符');
            this._activeCount = Math.max(0, this._activeCount - 1);
            this.processQueue();
            return;
        }

        // 2. 先注册 AbortController，确保同步状态事件回调触发取消时可立即中止
        const controller = new AbortController();
        this._controllers.set(taskId, controller);

        // 3. 将任务状态更新为 generating
        this.transitionTaskStatus(taskId, 'generating', { imageId });

        if (controller.signal.aborted || this.isTaskCancelled(taskId)) {
            this._controllers.delete(taskId);
            this._activeCount = Math.max(0, this._activeCount - 1);
            this.processQueue();
            return;
        }

        let isTimedOut = false;
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        let timeoutMs = DEFAULT_TASK_TIMEOUT_MS;

        const handleAbortedOrTimedOut = async (savedId?: string): Promise<boolean> => {
            const cancelled = this.isTaskCancelled(taskId);
            if (!controller.signal.aborted && !cancelled && !isTimedOut) {
                return false;
            }
            if (savedId) {
                await this._storage.deleteImage(savedId).catch((delErr) => {
                    logger.warn(`清理已取消/超时任务的未关联图像记录失败 [${savedId}]:`, delErr);
                });
            }
            if (cancelled) {
                logger.info(`已取消任务退出，已丢弃未保存结果: ${taskId}`);
            } else if (isTimedOut) {
                const timeoutSec = Math.round(timeoutMs / 1000);
                this.finalizeFailure(taskId, `生图服务响应超时 (${timeoutSec}s)`);
            } else if (!this._isDisposed) {
                this.finalizeFailure(taskId, '生图任务已中止');
            }
            return true;
        };

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
                loras: task.loras,
                sourceImage: task.sourceImage,
                maskImage: task.maskImage,
                parameters: task.parametersSnapshot,
            };

            // 6. 调度提供方执行生图
            const result: GenerationResult = await provider.generate(request, controller.signal);

            // 7. 校验任务取消或超时状态
            if (await handleAbortedOrTimedOut()) {
                return;
            }

            // 8. 生成图像有效性校验与质量处理（拦截 0 字节或损坏结果，防止写入库中）
            const validatedRawBlob = await ensureValidImageBlob(
                result?.blob,
                provider.name || task.providerType
            );
            const configuredQuality = (this._settingsStore.get('imageQuality') || 'original') as ImageStorageQuality;
            const finalBlob = await applyImageStorageQuality(validatedRawBlob, configuredQuality);

            if (await handleAbortedOrTimedOut()) {
                return;
            }

            const supportsNegative = provider.supportsNegativePrompt !== false;
            const finalizedMetadata = {
                ...result.metadata,
                prompt: result.metadata?.prompt ?? task.prompt,
                negativePrompt: supportsNegative
                    ? (result.metadata?.negativePrompt ?? task.negativePrompt)
                    : undefined,
                rawPrompt: result.metadata?.rawPrompt ?? task.rawPrompt,
                rawNegativePrompt: supportsNegative
                    ? (result.metadata?.rawNegativePrompt ?? task.rawNegativePrompt)
                    : undefined,
                resolvedPromptPresetId:
                    result.metadata?.resolvedPromptPresetId ?? task.resolvedPromptPresetId,
                resolvedPromptPresetName:
                    result.metadata?.resolvedPromptPresetName ?? task.resolvedPromptPresetName,
            };

            // 9. 分表持久化（写入元数据索引与图像二进制 Blob）
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

            if (timeoutTimer !== null) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
            this._timeoutTimers.delete(taskId);

            if (await handleAbortedOrTimedOut(imageId)) {
                return;
            }

            // 10. 调度宿主楼层消息资产回写（回写期间保持 generating 状态，确保转存上传仍可响应 cancelTask / CHAT_CHANGED 中止）
            const currentChatId = this._getActiveChatId();
            const isCrossSession = !currentChatId || currentChatId !== task.target.chatId;
            if (isCrossSession) {
                logger.info(
                    `[GenerationOrchestrator] 任务 [${taskId}] 完成时当前活跃会话 (${currentChatId ?? 'none'}) 与目标会话 (${task.target.chatId}) 不一致，仅保存至 IndexedDB 图库`
                );
            } else {
                let wroteSlot = false;
                try {
                    wroteSlot = await this._sessionLifecycle.updateMessageSlot(
                        task.target,
                        { imageId },
                        { signal: controller.signal }
                    );
                } catch (writeErr) {
                    logger.error(`任务 [${taskId}] 楼层资产回写异常:`, writeErr);
                }

                // 仅在尚未实际写入宿主楼层时才回滚已入库图像并中断收尾，避免楼层引用指向已删除资产
                if (!wroteSlot && (await handleAbortedOrTimedOut(imageId))) {
                    return;
                }
            }

            // 11. 更新为完成状态并仅在同一会话内通知前端渲染
            task.generationMetadata = finalizedMetadata;
            this.transitionTaskStatus(taskId, 'completed', { imageId });

            if (!isCrossSession) {
                this._eventBus.emit('image:ready', { imageId, target: task.target });
            }
            const dimSummary =
                finalizedMetadata.width && finalizedMetadata.height
                    ? `${finalizedMetadata.width}×${finalizedMetadata.height}`
                    : finalizedMetadata.aspectRatio || '--';
            logger.info(
                `生图任务执行成功: ${taskId} (资产 ID: ${imageId}, 引擎: ${task.providerType}, 模型: ${finalizedMetadata.baseModel || '默认'}, 规格: ${dimSummary}, 耗时: ${finalizedMetadata.durationMs ?? '-'}ms)`
            );
        } catch (err: unknown) {
            if (this.isTaskCancelled(taskId)) {
                logger.info(`已取消任务异常退出: ${taskId}`);
                return;
            }

            if (isTimedOut) {
                const timeoutSec = Math.round(timeoutMs / 1000);
                this.finalizeFailure(taskId, `生图服务响应超时 (${timeoutSec}s)`, err);
                return;
            }

            if (controller.signal.aborted) {
                if (!this._isDisposed) {
                    this.finalizeFailure(taskId, '生图任务已中止', err);
                }
                return;
            }

            const errorMsg = err instanceof Error ? err.message : (typeof err === 'string' ? err : '生图服务执行异常');
            this.finalizeFailure(taskId, errorMsg, err);
        } finally {
            // 清理控制器与定时器
            if (timeoutTimer !== null) {
                clearTimeout(timeoutTimer);
            }
            this._timeoutTimers.delete(taskId);
            this._controllers.delete(taskId);

            // 统一清空底图与蒙版引用（含 Blob 与 Base64 字符串），防止内存占用滞留
            task.sourceImage = undefined;
            task.maskImage = undefined;

            // 计数递减并调度后续任务
            this._activeCount = Math.max(0, this._activeCount - 1);
            this.processQueue();
        }
    }

    /**
     * 终结任务为失败状态。
     *
     * @remarks
     * 失败任务仅保留在内存任务表，不写入 IndexedDB；
     * 仅在内存状态机中流转并广播 task:status 供 UI 展示重试状态。
     */
    private finalizeFailure(taskId: string, errorMsg: string, rawError?: unknown): void {
        const task = this._tasks.get(taskId);
        if (task && task.status !== 'cancelled' && task.status !== 'completed') {
            this.transitionTaskStatus(taskId, 'failed', { error: errorMsg, imageId: task.imageId });
            if (rawError !== undefined) {
                logger.error(`生图任务失败 [${taskId}] (${task.providerType}): ${errorMsg}`, rawError);
            } else {
                logger.error(`生图任务失败 [${taskId}] (${task.providerType}): ${errorMsg}`);
            }
        }
    }

    /**
     * 清理已完成或已取消的旧任务记录，控制内存占用。
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
     * 恢复调度器运行状态（用于插件停用后重新激活）。
     */
    public restore(): void {
        this._isDisposed = false;
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
export const generationOrchestrator = new GenerationOrchestrator({ bindTaskCanceller: true });
