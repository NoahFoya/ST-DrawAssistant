/**
 * 楼层装饰与生成状态协调服务 (FloorCoordinator)。
 *
 * @remarks
 * 不包含任何 DOM 操作与 UI 导入，负责协调楼层装饰的阶段 A 逻辑：
 * 1. 自动生图一次性票据管理、宿主生成状态纪元与稳定性等待信号；
 * 2. 楼层指令与档案提取规划（汇总目标坐标、本地存储记录与在途任务状态）；
 * 3. 分支滑动重 roll 取消、消息编辑结构变动清理与删除后任务对齐；
 * 4. 当前激活预设资产预校验与生图任务入队/取消调度。
 */

import type {
    CharacterExtractionConfig,
    ChatMessage,
    DrawingPresetData,
    DrawingSlotEntry,
    DrawingTask,
    ProviderStoredConfig,
    ProviderType,
    ResolvedLoraSpec,
    SillyTavernContext,
    SlotMountTarget,
} from '@types';
import { getHostContext } from '../host';
import { settingsStore } from '../store/settings-store';
import { validatePresetAssets } from '../util/asset-matcher';
import { logger } from '../util/logger';
import { extractArchivesFromText, type ExtractedArchiveItem } from './archive-extractor';
import { generationOrchestrator, type SubmitTaskOptions } from './generation-orchestrator';
import { resolveActiveMaterialExtractionConfig } from './material-definitions';
import { promptPipeline, resolveEffectivePromptPresetsForValidation } from './prompt-pipeline';
import { sessionLifecycle } from './session-lifecycle';

export type ExtractedFloorCommand = ReturnType<typeof promptPipeline.extractCommands>[number];

/** 构造楼层按钮与容器的唯一映射键 */
export function buildFloorSlotKey(
    chatId: string,
    messageId: number,
    swipeId: number,
    instructionIndex: number
): string {
    return `${chatId}:${messageId}:${swipeId}:${instructionIndex}`;
}

/** 从尾部安全判断容器映射键是否归属指定楼层（兼容含 `:` 的 chatId） */
export function matchesFloorSlotMessage(key: string, messageId: number): boolean {
    const parts = key.split(':');
    return parts.length >= 4 && Number(parts[parts.length - 3]) === messageId;
}

/** 判断容器映射键是否精确匹配指定会话、楼层与候选分支 */
export function matchesFloorSlotScope(
    key: string,
    chatId: string,
    messageId: number,
    swipeId: number
): boolean {
    const suffix = `:${messageId}:${swipeId}:`;
    const lastColon = key.lastIndexOf(':');
    if (lastColon <= chatId.length) {
        return false;
    }
    const prefix = key.slice(0, lastColon + 1);
    return prefix === `${chatId}${suffix}`;
}

/**
 * 校验当前激活预设中的资产（主模型、VAE、CLIP、LoRA）是否存在于资产缓存中。
 */
export function validateCurrentPresetAssets(
    providerType: ProviderType
): { valid: boolean; missing: string[] } {
    const pCfg = settingsStore.getProviderConfig<ProviderStoredConfig>(providerType);
    const activeDrawingId = pCfg?.activeDrawingPresetId;
    const cache = pCfg?.assetCache;

    if (!activeDrawingId) {
        return { valid: true, missing: [] };
    }

    const dp = settingsStore.getPreset<DrawingPresetData>('drawing', activeDrawingId, providerType);
    const promptPresetsForCheck = resolveEffectivePromptPresetsForValidation(
        settingsStore,
        providerType,
        dp?.data
    );

    return validatePresetAssets({
        drawingPreset: dp?.data,
        promptPresets: promptPresetsForCheck,
        assetCache: cache,
        providerType,
    });
}

/** 判断指定楼层是否为当前会话中的最新一条非用户（AI）消息 */
function isLatestAiMessage(
    chat: ReadonlyArray<ChatMessage | undefined> | undefined,
    messageId: number
): boolean {
    if (!Array.isArray(chat)) {
        return false;
    }
    for (let i = chat.length - 1; i >= 0; i--) {
        const item = chat[i];
        if (item && !item.is_user && !item.is_system) {
            return i === messageId;
        }
    }
    return false;
}

/** 判断当前触发的候选分支滑动是否为右滑重 roll 生成的新分支 (Overswipe) */
export function isOverswipeTarget(
    message: ChatMessage | undefined,
    targetSwipeId: number
): boolean {
    if (!message) {
        return false;
    }
    if (Array.isArray(message.swipes) && targetSwipeId >= message.swipes.length) {
        return true;
    }
    if (Array.isArray(message.swipe_info) && !message.swipe_info[targetSwipeId]) {
        return true;
    }
    return false;
}

export interface FloorAutoGenTarget {
    readonly chatId: string;
    readonly messageId: number;
    readonly swipeId: number;
}

export interface FloorSlotDecorationPlan {
    readonly instructionIndex: number;
    readonly slotKey: string;
    readonly cmd: ExtractedFloorCommand;
    readonly target: SlotMountTarget;
    readonly slotEntry: DrawingSlotEntry | undefined;
    readonly activeTask: DrawingTask | undefined;
}

export interface FloorDecorationPlan {
    readonly chatId: string;
    readonly messageId: number;
    readonly swipeId: number;
    readonly rawMes: string;
    readonly isLatestAi: boolean;
    readonly extractionCfg: CharacterExtractionConfig;
    readonly archives: ExtractedArchiveItem[];
    readonly commands: ExtractedFloorCommand[];
    readonly slotPlans: FloorSlotDecorationPlan[];
    readonly hideButtonOnDone: boolean;
}

export class FloorCoordinator {
    private lifecycleGeneration = 0;
    private isHostGeneratingFlag = false;
    private activeGenerationEpoch = 0;
    private readonly generationEndCallbacks = new Set<() => void>();
    private readonly activeAutoGenControllers = new Set<AbortController>();
    private pendingAutoGenReply: FloorAutoGenTarget | null = null;
    private pendingAutoGenTarget: FloorAutoGenTarget | null = null;

    /** 重置生命周期纪元并清理全部待处理自动生图票据与等待队列 */
    public resetLifecycle(): void {
        this.lifecycleGeneration += 1;
        this.isHostGeneratingFlag = false;
        this.pendingAutoGenReply = null;
        this.pendingAutoGenTarget = null;
        this.abortActiveAutoGenWaits();
        this.generationEndCallbacks.clear();
    }

    public getLifecycleGeneration(): number {
        return this.lifecycleGeneration;
    }

    public getGenerationEpoch(): number {
        return this.activeGenerationEpoch;
    }

    public isHostGenerating(): boolean {
        return this.isHostGeneratingFlag;
    }

    /** 通知协调器宿主已开始生成新一轮 AI 回复 */
    public onHostGenerationStarted(): void {
        this.abortActiveAutoGenWaits();
        this.isHostGeneratingFlag = true;
        this.activeGenerationEpoch += 1;
    }

    /** 通知协调器宿主正常结束本轮生成，唤醒所有等待中的稳定化检测 */
    public onHostGenerationEnded(): void {
        this.isHostGeneratingFlag = false;
        this.flushGenerationEndCallbacks();
    }

    /** 通知协调器宿主已中止生成，作废未消费自动生图票据并唤醒等待中的检测 */
    public onHostGenerationStopped(): void {
        this.isHostGeneratingFlag = false;
        this.pendingAutoGenReply = null;
        this.abortActiveAutoGenWaits();
        this.pendingAutoGenTarget = null;
        this.flushGenerationEndCallbacks();
    }

    private flushGenerationEndCallbacks(): void {
        if (this.generationEndCallbacks.size === 0) return;
        const callbacks = Array.from(this.generationEndCallbacks);
        this.generationEndCallbacks.clear();
        for (const cb of callbacks) {
            cb();
        }
    }

    /** 注册自动生图等待期的 AbortController，并返回移除函数 */
    public trackAutoGenWaitController(controller: AbortController): () => void {
        this.activeAutoGenControllers.add(controller);
        return () => {
            this.activeAutoGenControllers.delete(controller);
        };
    }

    /** 中止所有正在等待 DOM 稳定的自动生图协程 */
    public abortActiveAutoGenWaits(): void {
        for (const controller of this.activeAutoGenControllers) {
            controller.abort();
        }
        this.activeAutoGenControllers.clear();
    }

    /** 等待宿主当前生成回合结束 */
    public waitForGenerationEnd(signal?: AbortSignal): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!this.isHostGeneratingFlag || signal?.aborted) {
                resolve();
                return;
            }
            const onDone = () => {
                signal?.removeEventListener('abort', onDone);
                this.generationEndCallbacks.delete(onDone);
                resolve();
            };
            this.generationEndCallbacks.add(onDone);
            signal?.addEventListener('abort', onDone, { once: true });
        });
    }

    /** 在收到真实 AI 回复事件时签发一次性自动生图票据 */
    public issueAutoGenTicket(messageId: number, type?: unknown): void {
        if (type === 'first_message' || type === 'quiet') {
            return;
        }
        const settings = settingsStore.getSettings();
        if (!settings.enabled || !settings.autoGenerate) {
            return;
        }
        const ctx = getHostContext();
        const msg = ctx?.chat?.[messageId];
        if (!msg || msg.is_user || msg.is_system) {
            return;
        }
        this.pendingAutoGenReply = {
            chatId: ctx?.chatId || 'default_chat',
            messageId,
            swipeId: msg.swipe_id ?? 0,
        };
    }

    /** 清理尚未消费的自动生图票据 */
    public clearAutoGenTicket(): void {
        this.pendingAutoGenReply = null;
    }

    /** 一次性消费并校验自动生图票据，防止重复触发 */
    public consumeAutoGenTicket(params: {
        chatId: string;
        messageId: number;
        swipeId: number;
        type?: unknown;
        messageObj?: ChatMessage;
    }): boolean {
        const settings = settingsStore.getSettings();
        const ticketMatches = Boolean(
            this.pendingAutoGenReply &&
                this.pendingAutoGenReply.chatId === params.chatId &&
                this.pendingAutoGenReply.messageId === params.messageId &&
                this.pendingAutoGenReply.swipeId === params.swipeId
        );
        if (ticketMatches) {
            this.pendingAutoGenReply = null;
        }
        return Boolean(
            ticketMatches &&
                settings.enabled &&
                settings.autoGenerate &&
                params.type !== 'first_message' &&
                params.type !== 'quiet' &&
                params.messageObj &&
                !params.messageObj.is_user &&
                !params.messageObj.is_system
        );
    }

    /** 记录指定楼层与分支的一次性待自动生图意图 */
    public markPendingAutoGenerate(chatId: string, messageId: number, swipeId: number): void {
        this.pendingAutoGenTarget = { chatId, messageId, swipeId };
    }

    /** 清除指定楼层（或全部）待自动生图标记 */
    public clearPendingAutoGenerate(messageId?: number): void {
        if (messageId === undefined || this.pendingAutoGenTarget?.messageId === messageId) {
            this.pendingAutoGenTarget = null;
        }
    }

    public matchesPendingAutoGenerate(
        chatId: string,
        messageId: number,
        swipeId: number
    ): boolean {
        return Boolean(
            this.pendingAutoGenTarget &&
                this.pendingAutoGenTarget.chatId === chatId &&
                this.pendingAutoGenTarget.messageId === messageId &&
                this.pendingAutoGenTarget.swipeId === swipeId
        );
    }

    /** 校验异步等待窗口期间当前聊天与消息快照是否仍保持有效 */
    public isAutoGenContextValid(params: {
        expectedLifecycleGen: number;
        expectedGenEpoch: number;
        messageId: number;
        initialChatId: string | undefined;
        initialMessageObj: unknown;
        initialSwipeId: number;
    }): boolean {
        if (
            this.lifecycleGeneration !== params.expectedLifecycleGen ||
            this.activeGenerationEpoch !== params.expectedGenEpoch
        ) {
            return false;
        }
        const latestCtx = getHostContext();
        const latestSettings = settingsStore.getSettings();
        return Boolean(
            latestSettings.enabled &&
                latestSettings.autoGenerate &&
                latestCtx?.chatId === params.initialChatId &&
                latestCtx?.chat?.[params.messageId] === params.initialMessageObj &&
                (latestCtx?.chat?.[params.messageId]?.swipe_id ?? 0) === params.initialSwipeId
        );
    }

    /** 解析指定楼层对应的实时会话与分支坐标 */
    public resolveSlotCoordinates(
        messageId: number,
        chatId?: string,
        swipeId?: number
    ): { chatId: string; swipeId: number } {
        const hostContext = getHostContext();
        return {
            chatId: chatId || hostContext?.chatId || 'default_chat',
            swipeId: swipeId ?? (hostContext?.chat?.[messageId]?.swipe_id ?? 0),
        };
    }

    /** 获取当前宿主的会话标识及指定楼层消息引用 */
    public getMessageSnapshot(messageId: number): {
        hostContext: SillyTavernContext;
        chatId: string;
        message: ChatMessage;
        swipeId: number;
        isLatestAi: boolean;
    } | null {
        const hostContext = getHostContext();
        if (!hostContext || !Array.isArray(hostContext.chat)) {
            return null;
        }
        const message = hostContext.chat[messageId];
        if (!message) {
            return null;
        }
        return {
            hostContext,
            chatId: hostContext.chatId || 'default_chat',
            message,
            swipeId: message.swipe_id ?? 0,
            isLatestAi: isLatestAiMessage(hostContext.chat, messageId),
        };
    }

    /** 检查是否处于目标会话与目标分支（用于 `image:ready` / `task:status` 防串台守卫） */
    public isTargetActiveInHost(target?: SlotMountTarget): target is SlotMountTarget {
        if (!target) {
            return false;
        }
        const hostContext = getHostContext();
        const currentChatId = hostContext?.chatId;
        if (!currentChatId || currentChatId !== target.chatId) {
            return false;
        }
        const currentMsg = hostContext?.chat?.[target.messageId];
        if (currentMsg && (target.swipeId ?? 0) !== (currentMsg.swipe_id ?? 0)) {
            return false;
        }
        return true;
    }

    /** 检查外部 MutationObserver 回调关联的楼层状态是否仍匹配当前宿主消息 */
    public isObservedLatestFloorStillValid(
        chatId: string,
        messageId: number,
        swipeId: number,
        requireLatestAi = false
    ): { valid: boolean; rawMes?: string } {
        const hostContext = getHostContext();
        if (!hostContext || hostContext.chatId !== chatId) {
            return { valid: false };
        }
        const msg = hostContext.chat?.[messageId];
        if (!msg || msg.is_user || (msg.swipe_id ?? 0) !== swipeId) {
            return { valid: false };
        }
        if (requireLatestAi && !isLatestAiMessage(hostContext.chat, messageId)) {
            return { valid: false };
        }
        return {
            valid: true,
            rawMes: typeof msg.mes === 'string' ? msg.mes : undefined,
        };
    }

    /** 判断文本中是否存在待处理的生图指令或素材档案 */
    public hasDecoratableContent(rawMes: string): boolean {
        if (!rawMes) return false;
        if (promptPipeline.extractCommands(rawMes).length > 0) {
            return true;
        }
        const extractionCfg = resolveActiveMaterialExtractionConfig(settingsStore.getSettings());
        return (
            extractionCfg?.enabled !== false &&
            extractArchivesFromText(rawMes, extractionCfg).length > 0
        );
    }

    /** 阶段 A：解析楼层装饰所需档案、指令与当前插槽持久化/运行期状态 */
    public planMessageDecoration(messageId: number): FloorDecorationPlan | null {
        const settings = settingsStore.getSettings();
        if (!settings.enabled) {
            return null;
        }
        const snapshot = this.getMessageSnapshot(messageId);
        if (!snapshot || typeof snapshot.message.mes !== 'string') {
            return null;
        }

        const rawMes = snapshot.message.mes;
        const extractionCfg = resolveActiveMaterialExtractionConfig(settings);
        const archives =
            extractionCfg?.enabled !== false &&
            (extractionCfg?.autoDetect || extractionCfg?.collapseInFloor)
                ? extractArchivesFromText(rawMes, extractionCfg)
                : [];
        const commands = promptPipeline.extractCommands(rawMes);
        const hideButtonOnDone = settings.ui?.floorButton?.hideOnDone ?? false;

        const slotPlans: FloorSlotDecorationPlan[] = commands.map((cmd) => {
            const target: SlotMountTarget = {
                chatId: snapshot.chatId,
                messageId,
                swipeId: snapshot.swipeId,
                instructionIndex: cmd.instructionIndex,
            };
            return {
                instructionIndex: cmd.instructionIndex,
                slotKey: buildFloorSlotKey(
                    snapshot.chatId,
                    messageId,
                    snapshot.swipeId,
                    cmd.instructionIndex
                ),
                cmd,
                target,
                slotEntry: sessionLifecycle.getSlotEntry(target),
                activeTask: generationOrchestrator.getActiveTaskByTarget(target),
            };
        });

        return {
            chatId: snapshot.chatId,
            messageId,
            swipeId: snapshot.swipeId,
            rawMes,
            isLatestAi: snapshot.isLatestAi,
            extractionCfg,
            archives,
            commands,
            slotPlans,
            hideButtonOnDone,
        };
    }

    /** 提取指定楼层特定指令的原始生图提示词 */
    public extractSlotRawPrompt(messageId: number, instructionIndex: number): string {
        const mes = getHostContext()?.chat?.[messageId]?.mes;
        if (typeof mes !== 'string') {
            return '';
        }
        const matched = promptPipeline
            .extractCommands(mes)
            .find((c) => c.instructionIndex === instructionIndex);
        return matched?.promptText || '';
    }

    /** 检查宿主消息中可用于档案确认弹窗的未导出档案（不含开场白与用户消息） */
    public resolvePendingArchivesForModal(messageId: number): {
        chatId: string;
        swipeId: number;
        signature: string;
        archives: ExtractedArchiveItem[];
    } | null {
        const snapshot = this.getMessageSnapshot(messageId);
        if (!snapshot || snapshot.message.is_user || typeof snapshot.message.mes !== 'string') {
            return null;
        }
        const settings = settingsStore.getSettings();
        if (!settings.enabled) {
            return null;
        }
        const extractionCfg = resolveActiveMaterialExtractionConfig(settings);
        if (extractionCfg?.enabled === false || extractionCfg?.autoDetect === false) {
            return null;
        }
        const archives = extractArchivesFromText(snapshot.message.mes, extractionCfg);
        if (archives.length === 0) {
            return null;
        }
        const signature = `${snapshot.chatId}_${messageId}_${snapshot.swipeId}_${archives
            .map((a) => `${a.kind}:${a.name}:${a.parts.appearance || a.parts.style || ''}`)
            .join('|')}`;
        return {
            chatId: snapshot.chatId,
            swipeId: snapshot.swipeId,
            signature,
            archives,
        };
    }

    /** 处理候选分支切换与重 roll 任务取消、消息分支同步 */
    public processSwipeChange(
        messageId: number,
        swipeId?: number,
        options?: { skipSwipeCancel?: boolean }
    ): { cancelledCount: number } {
        this.clearPendingAutoGenerate(messageId);
        const hostContext = getHostContext();
        const message = hostContext?.chat?.[messageId];
        const targetSwipeId = swipeId ?? message?.swipe_id ?? 0;

        let cancelledCount = 0;
        if (
            !options?.skipSwipeCancel &&
            (settingsStore.getSettings().cancelOnSwipe ?? true) &&
            isOverswipeTarget(message, targetSwipeId)
        ) {
            const chatId = hostContext?.chatId || 'default_chat';
            cancelledCount = generationOrchestrator.cancelOtherSwipeTasks(
                chatId,
                messageId,
                targetSwipeId,
                '重 roll 生成新分支，已自动取消旧分支任务',
                { silentToast: true }
            );
        }

        sessionLifecycle.syncSwipeState(messageId);
        return { cancelledCount };
    }

    /** 处理宿主删除特定候选分支时的在途队列清理 */
    public handleSwipeDeleted(messageId: number, deletedSwipeId?: number): void {
        if (deletedSwipeId === undefined) {
            return;
        }
        const chatId = getHostContext()?.chatId || 'default_chat';
        generationOrchestrator.handleSwipeDeleted(chatId, messageId, deletedSwipeId);
    }

    /** 评估消息正文编辑是否改变了指令结构，若变更则自动取消在途任务并清理旧记录 */
    public evaluateAndHandleMessageEdit(
        messageId: number,
        oldSlotCount: number
    ): { isStructureChanged: boolean } {
        const hostContext = getHostContext();
        const message = hostContext?.chat?.[messageId];
        let isStructureChanged = false;
        if (message && typeof message.mes === 'string') {
            const newCommands = promptPipeline.extractCommands(message.mes);
            const swipeId = message.swipe_id ?? 0;
            const existingDrawings = sessionLifecycle.getSwipeDrawings(messageId, swipeId) || {};
            const existingCount = Object.keys(existingDrawings).length;

            isStructureChanged =
                (oldSlotCount > 0 && oldSlotCount !== newCommands.length) ||
                (existingCount > 0 && existingCount !== newCommands.length);

            if (isStructureChanged) {
                const chatId = hostContext?.chatId || 'default_chat';
                generationOrchestrator.cancelTasksBySwipe(chatId, messageId, swipeId);
                sessionLifecycle.clearMessageSlotDrawings(messageId);
            }
        }
        return { isStructureChanged };
    }

    /** 在宿主删除消息后校准队列与在途任务所属楼层坐标 */
    public reconcileDeletedMessages(info: {
        deletedIndex?: number;
        remainingCount?: number;
    }): void {
        const liveCtx = getHostContext();
        const chatId = liveCtx?.chatId || 'default_chat';
        if (Array.isArray(liveCtx?.chat)) {
            generationOrchestrator.reconcileTasksAfterMessageDelete(
                chatId,
                liveCtx.chat,
                info.deletedIndex
            );
        } else if (info.remainingCount !== undefined) {
            generationOrchestrator.cancelTasksOutOfRange(chatId, info.remainingCount);
        }
    }

    /** 提交生图任务并同步关联状态检查 */
    public async submitSlotTask(options: {
        target: SlotMountTarget;
        rawPrompt: string;
        negativePrompt?: string;
        providerType?: ProviderType;
        promptMode?: 'raw' | 'final';
        explicitLoras?: readonly ResolvedLoraSpec[];
        sourceImageId?: string;
        originRawPrompt?: string;
        originRawNegativePrompt?: string;
        extraParams?: Record<string, unknown>;
    }): Promise<{ taskId: string; status: string | undefined }> {
        const resolvedProvider =
            options.providerType ?? (settingsStore.getSettings().activeProvider as ProviderType);
        const {
            sourceImage: rawSourceImage,
            maskImage: rawMaskImage,
            ...restExtraParams
        } = options.extraParams || {};
        const mergedParams: Record<string, unknown> = { ...restExtraParams };
        if (options.negativePrompt) {
            mergedParams.negativePrompt = options.negativePrompt;
        }

        const submitOptions: SubmitTaskOptions = {
            destination: 'floor',
            rawPrompt: options.rawPrompt,
            promptMode: options.promptMode,
            explicitLoras: options.explicitLoras,
            sourceImageId: options.sourceImageId,
            originRawPrompt: options.originRawPrompt,
            originRawNegativePrompt: options.originRawNegativePrompt,
            sourceImage: rawSourceImage as Blob | string | undefined,
            maskImage: rawMaskImage as Blob | string | undefined,
            providerType: resolvedProvider,
            target: options.target,
            parameters: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
        };

        try {
            const taskId = await generationOrchestrator.submitTask(submitOptions);
            const task = taskId ? generationOrchestrator.getTask(taskId) : undefined;
            return { taskId, status: task?.status };
        } catch (err: unknown) {
            const errMessage = err instanceof Error ? err.message : String(err);
            logger.error(`[FloorCoordinator] 任务提交失败: ${errMessage}`);
            throw err;
        }
    }

    /** 校验当前激活预设中引用的模型资产是否在缓存中齐备 */
    public validateCurrentPresetAssets(
        providerType: ProviderType
    ): { valid: boolean; missing: string[] } {
        return validateCurrentPresetAssets(providerType);
    }

    /** 取消指定插槽的在途生图任务 */
    public cancelSlotTask(target: SlotMountTarget, reason = '用户主动取消'): void {
        const task = generationOrchestrator.getActiveTaskByTarget(target);
        if (task) {
            generationOrchestrator.cancelTask(task.taskId, reason);
        }
    }
}

/** 全局楼层与生命周期协调器单例 */
export const floorCoordinator = new FloorCoordinator();
