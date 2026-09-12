/**
 * 楼层生图业务协调门面 (FloorButtonManager)
 * 职责：
 * 1. 业务协同中枢：组合 SlotDomParser（纯 DOM 算法）与 SlotViewBinder（视图状态与视口观察）；
 * 2. 监听宿主生命周期事件（流式生成避让、分支切换、消息编辑与删除、会话切换）；
 * 3. 调度生图流水线与 TaskManager 任务，驱动插槽按钮状态流转；
 * 4. 级联清理图片资产（宿主 Extra、服务端文件、本地 IndexedDB）；
 * 5. 保持完全向后兼容的公共接口。
 */

import { IDisposable, DisposableStore, CoreEventMap, ChatImagesRoot, ChatImageEntry } from '../../types';
import { TypedEventBus } from '../../utils';
import { SettingsStore, StorageService } from '../../state';
import { HostClient } from '../../host';
import { TaskManager } from '../../tasks/task-manager';
import { PromptPipeline, PipelineProcessResult } from '../../pipeline';
import { normalizePromptPunctuation } from '../../pipeline/prompt-utils';
import { FeedbackService } from '../feedback/feedback';
import {
    SlotDomParser,
    SlotViewBinder,
    DynamicSlotContext,
    FloorButtonState
} from './floor';

export type { DynamicSlotContext, FloorButtonState };

export interface FloorButtonManagerOptions {
    host: HostClient;
    events: TypedEventBus<CoreEventMap>;
    store: SettingsStore;
    taskManager: TaskManager;
    pipeline: PromptPipeline;
    storage: StorageService;
}

export interface FloorTaskSubmitOptions {
    prompt: string;
    negativePrompt?: string;
    messageId: number;
    swipeId: number;
    slotIndex: number;
    overridePrompt?: string;
    overrideNegativePrompt?: string;
    overrideInpaintData?: { initImageBlob: Blob; maskImageBlob: Blob };
}

export interface SubmitFloorTaskResult {
    taskId: string;
    processResult: PipelineProcessResult;
}

export class FloorButtonManager implements IDisposable {
    private readonly _host: HostClient;
    private readonly _events: TypedEventBus<CoreEventMap>;
    private readonly _store: SettingsStore;
    private readonly _taskManager: TaskManager;
    private readonly _pipeline: PromptPipeline;
    private readonly _storage: StorageService;
    private readonly _disposables = new DisposableStore();
    private readonly _viewBinder: SlotViewBinder;
    private readonly _activeTaskUnbinds = new Map<string, () => void>();

    private _isHostGenerating = false;
    private _isDisposed = false;

    /** 批处理扫描合并队列 */
    private readonly _pendingScanMessageIds = new Set<number>();
    private _scanScheduled = false;

    constructor(options: FloorButtonManagerOptions) {
        this._host = options.host;
        this._events = options.events;
        this._store = options.store;
        this._taskManager = options.taskManager;
        this._pipeline = options.pipeline;
        this._storage = options.storage;

        this._viewBinder = new SlotViewBinder({
            store: this._store,
            storage: this._storage,
            onButtonClick: (ctx) => this.handleButtonClick(ctx),
            onRegenerate: (ctx) => void this.triggerGeneration(ctx),
            onInpaint: (ctx, inpaintData) => {
                ctx.overridePrompt = inpaintData.prompt;
                ctx.overrideInpaintData = {
                    initImageBlob: inpaintData.initImageBlob,
                    maskImageBlob: inpaintData.maskImageBlob
                };
                void this.triggerGeneration(ctx);
            },
            onDeleteImage: async (ctx, assetId) => {
                await this.deleteImage(ctx.messageId, ctx.swipeId, ctx.slotIndex, assetId);
            },
            getImageEntry: (messageId, swipeId, slotIndex) => this.getImageEntry(messageId, swipeId, slotIndex),
            getCurrentSwipeId: (messageId) => this._host.getMessageById(messageId)?.swipe_id ?? 0
        });

        this.initHostEventListeners();

        // 资产持久化后更新对应插槽的 assetId，供滚动与状态比对复用
        this._disposables.add(
            this._events.on('asset:saved', ({ assetId, record }) => {
                const contextInfo = record.metadata?.contextInfo;
                if (!contextInfo) return;
                const { messageId, buttonIndex } = contextInfo;
                if (typeof messageId !== 'number' || typeof buttonIndex !== 'number') return;

                const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
                if (!msgNode) return;
                const slot = msgNode.querySelector<HTMLElement>(`.da-floor-slot[data-slot-index="${buttonIndex}"]`);
                if (!slot) return;

                slot.dataset.assetId = assetId;
            })
        );

        void this.scanAllMessages();
    }

    // 1. 宿主生命周期事件监听

    private initHostEventListeners(): void {
        // 角色消息渲染
        this._disposables.add(
            this._host.onCharacterMessageRendered((ev) => {
                if (ev.messageId === undefined) return;
                if (this._isHostGenerating && this.isLatestMessage(ev.messageId)) {
                    return;
                }
                this.scheduleScanMessage(ev.messageId);
            })
        );

        // 用户消息渲染
        this._disposables.add(
            this._host.onUserMessageRendered((ev) => {
                if (ev.messageId !== undefined) {
                    this.scheduleScanMessage(ev.messageId);
                }
            })
        );

        // 历史消息翻页滚动加载
        this._disposables.add(
            this._host.onMoreMessagesLoaded(() => {
                void this.scanAllMessages();
            })
        );

        // 会话加载完成
        this._disposables.add(
            this._host.onChatLoaded(() => {
                void this.scanAllMessages();
            })
        );

        // 流式生成开始
        this._disposables.add(
            this._host.onGenerationStarted(() => {
                this._isHostGenerating = true;
            })
        );

        // 生成结束
        this._disposables.add(
            this._host.onGenerationEnded(async () => {
                this._isHostGenerating = false;
                await this.scanAllMessages();

                const settings = this._store.getState();
                if (!settings.autoGenerate) return;

                const chat = this._host.getChat();
                if (!chat || chat.length === 0) return;
                const lastIndex = chat.length - 1;
                const lastMsg = chat[lastIndex];
                if (lastMsg?.is_user) return;

                const lastMsgNode = document.querySelector<HTMLElement>(`.mes[mesid="${lastIndex}"]`);
                if (lastMsgNode) {
                    const slots = Array.from(lastMsgNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
                    for (const slot of slots) {
                        const ctx = this.getSlotContext(slot);
                        if (ctx && ctx.state === 'default') {
                            await this.triggerGeneration(ctx);
                        }
                    }
                }
            })
        );

        // 消息分支切换
        this._disposables.add(
            this._host.onChatSwiped((ev) => {
                if (ev.messageId !== undefined) {
                    this.scheduleScanMessage(ev.messageId);
                }
            })
        );

        // 消息编辑修改
        this._disposables.add(
            this._host.onMessageUpdated((ev) => {
                if (ev.messageId !== undefined) {
                    this.scheduleScanMessage(ev.messageId);
                }
            })
        );
        this._disposables.add(
            this._host.onMessageEdited((ev) => {
                if (ev.messageId !== undefined) {
                    this.scheduleScanMessage(ev.messageId);
                }
            })
        );

        // 消息删除
        this._disposables.add(
            this._host.onMessageDeleted((ev) => {
                this.handleMessageDeleted(ev.newChatLength ?? ev.messageId ?? 0);
            })
        );

        // 会话切换
        this._disposables.add(
            this._host.onChatChanged(() => {
                this._viewBinder.cleanupTrackedUrls();
                this._isHostGenerating = false;
                void this.scanAllMessages();
            })
        );
    }

    private isLatestMessage(messageId: number): boolean {
        const chat = this._host.getChat();
        if (!chat || chat.length === 0) return false;
        return messageId >= chat.length - 1;
    }

    private scheduleScanMessage(messageId: number): void {
        this._pendingScanMessageIds.add(messageId);
        if (!this._scanScheduled) {
            this._scanScheduled = true;
            requestAnimationFrame(() => {
                this._scanScheduled = false;
                if (this._isDisposed) return;
                const ids = Array.from(this._pendingScanMessageIds);
                this._pendingScanMessageIds.clear();
                for (const id of ids) {
                    void this.scanAndInjectMessage(id);
                }
            });
        }
    }

    private handleMessageDeleted(newChatLength: number): void {
        for (const [taskId] of this._activeTaskUnbinds.entries()) {
            const task = this._taskManager.getTask(taskId);
            const msgId = task?.request?.contextInfo?.messageId;
            if (typeof msgId === 'number' && msgId >= newChatLength) {
                this.cancelTask(taskId, '消息已从宿主中删除');
            }
        }

        const slots = document.querySelectorAll<HTMLElement>('.da-floor-slot');
        slots.forEach((slot) => {
            const ctx = this.getSlotContext(slot);
            if (!ctx || ctx.messageId >= newChatLength) {
                if (ctx?.currentTaskId) {
                    this.cancelTask(ctx.currentTaskId, '消息已从宿主中删除');
                }
                this._viewBinder.unobserveSlot(slot);
                if (ctx) {
                    this._viewBinder.clearSlotImage(ctx);
                }
                slot.remove();
            }
        });
    }

    // 2. 双通道扫描与精准原位挂载

    public async scanAllMessages(): Promise<void> {
        if (this._isDisposed) return;
        const allMsgNodes = Array.from(document.querySelectorAll<HTMLElement>('.mes[mesid]'));
        await Promise.allSettled(
            allMsgNodes.map(async (node) => {
                const id = parseInt(node.getAttribute('mesid') || '', 10);
                if (!isNaN(id)) {
                    await this.scanAndInjectMessage(id);
                }
            })
        );
    }

    /**
     * 扫描单条消息并在段落中间精准原位替换占位符
     */
    public async scanAndInjectMessage(messageId: number): Promise<void> {
        if (this._isDisposed) return;

        try {
            const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
            if (!msgNode) return;

            const textNode = msgNode.querySelector<HTMLElement>('.mes_text');
            if (!textNode) return;

            // 在途任务保护：若楼层存在正在生成的插槽，严禁打断或重建
            const inFlightSlot = textNode.querySelector<HTMLElement>(
                '.da-floor-slot[data-state="loading"], .da-floor-slot[data-state="pending"], .da-floor-slot[data-state="progress"]'
            );
            if (inFlightSlot) {
                return;
            }

            const msg = this._host.getMessageById(messageId);
            const swipeId = msg?.swipe_id ?? 0;
            const doc = textNode.ownerDocument || document;

            const startTag = this._store.get('placeholderStart') || 'image###';
            const endTag = this._store.get('placeholderEnd') || '###';
            const hasPlaceholder = SlotDomParser.hasPlaceholder(textNode, startTag);

            const existingSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));

            // 步骤 1：幂等保护（DOM 中已有已注入插槽且无新占位符待消费时，保持插槽并刷新水合）
            if (existingSlots.length > 0 && !hasPlaceholder) {
                for (const slot of existingSlots) {
                    const idx = parseInt(slot.dataset.slotIndex || '0', 10);
                    slot.dataset.slotKey = `${messageId}_${swipeId}_${idx}`;
                    slot.dataset.swipeId = String(swipeId);
                    this._viewBinder.hydrateSlotImage(slot);
                    this._viewBinder.observeSlot(slot);
                }
                textNode.dataset.daProcessed = 'true';
                textNode.dataset.daContentLength = String(textNode.textContent?.length || 0);
                return;
            }

            // 步骤 2：跳过无关消息（正文中无占位符，绝不在末尾凭空生成任何幽灵按钮）
            if (!hasPlaceholder) {
                textNode.dataset.daProcessed = 'true';
                textNode.dataset.daContentLength = String(textNode.textContent?.length || 0);
                return;
            }

            // 纯 DOM 树扫描
            const { nodeInfos, matches } = SlotDomParser.scanTextNode(textNode, startTag, endTag, doc);
            if (matches.length === 0) {
                SlotDomParser.cleanStaleSlots(textNode, () => false, (slot) => {
                    this._viewBinder.unobserveSlot(slot);
                    const ctx = this.getSlotContext(slot);
                    if (ctx) this._viewBinder.clearSlotImage(ctx);
                });
                textNode.dataset.daProcessed = 'true';
                textNode.dataset.daContentLength = String(textNode.textContent?.length || 0);
                return;
            }

            // 逆序遍历匹配项，基于 Range 精准原位替换（保证前序索引不发生位移）
            for (let i = matches.length - 1; i >= 0; i--) {
                const matchItem = matches[i];
                const slotIndex = i;

                // 基于 slotIndex 寻址已有插槽（如分支切换或文本轻微编辑原地复用）
                const existingSlot = textNode.querySelector<HTMLElement>(`.da-floor-slot[data-slot-index="${slotIndex}"]`);
                if (existingSlot && existingSlot.isConnected) {
                    existingSlot.dataset.slotKey = `${messageId}_${swipeId}_${slotIndex}`;
                    existingSlot.dataset.prompt = matchItem.content.trim();
                    existingSlot.dataset.swipeId = String(swipeId);
                    this._viewBinder.hydrateSlotImage(existingSlot);
                    this._viewBinder.observeSlot(existingSlot);
                    continue;
                }

                const wrapper = this._viewBinder.createSlotElement(doc, messageId, slotIndex, swipeId, matchItem.content.trim());
                const replaced = SlotDomParser.replaceMatchWithSlot(doc, matchItem, nodeInfos, wrapper);
                if (replaced) {
                    this._viewBinder.hydrateSlotImage(wrapper);
                    this._viewBinder.observeSlot(wrapper);
                }
            }

            // 物理清理超出匹配数量的旧插槽
            SlotDomParser.cleanStaleSlots(textNode, (idx) => idx < matches.length, (slot) => {
                this._viewBinder.unobserveSlot(slot);
                const ctx = this.getSlotContext(slot);
                if (ctx) this._viewBinder.clearSlotImage(ctx);
            });

            textNode.dataset.daProcessed = 'true';
            textNode.dataset.daContentLength = String(textNode.textContent?.length || 0);
        } catch (err) {
            console.warn(`[FloorButtonManager] 扫描楼层 #${messageId} 异常:`, err);
        }
    }

    public cleanMessageFloorSlots(messageId: number): void {
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        const textNode = msgNode?.querySelector<HTMLElement>('.mes_text');
        if (textNode) {
            SlotDomParser.cleanStaleSlots(textNode, () => false, (slot) => {
                this._viewBinder.unobserveSlot(slot);
                const ctx = this.getSlotContext(slot);
                if (ctx) this._viewBinder.clearSlotImage(ctx);
            });
            delete textNode.dataset.daProcessed;
            delete textNode.dataset.daContentLength;
        }
    }

    // 3. 上下文、视口与出图管理代理

    public getSlotContext(target: HTMLElement): DynamicSlotContext | null {
        return this._viewBinder.getSlotContext(target);
    }

    public hydrateSlotImage(slot: HTMLElement): void {
        this._viewBinder.hydrateSlotImage(slot);
    }

    public dehydrateSlotImage(slot: HTMLElement): void {
        this._viewBinder.dehydrateSlotImage(slot);
    }

    public mountRenderedImage(
        ctx: DynamicSlotContext,
        src: string,
        prompt: string,
        negativePrompt?: string,
        assetId?: string,
        metadata?: Record<string, any>
    ): void {
        this._viewBinder.mountRenderedImage(ctx, src, prompt, negativePrompt, assetId, metadata);
    }

    public getImageEntry(messageId: number, swipeId: number, slotIndex: number): ChatImageEntry | undefined {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
        return daImages ? daImages[swipeId]?.[slotIndex] : undefined;
    }

    private handleButtonClick(ctx: DynamicSlotContext): void {
        if ((ctx.state === 'progress' || ctx.state === 'pending') && ctx.currentTaskId) {
            this.cancelTask(ctx.currentTaskId, '用户在楼层主动中断');
        } else if (ctx.state === 'default' || ctx.state === 'done' || ctx.state === 'error') {
            void this.triggerGeneration(ctx);
        }
    }

    // 4. 任务调度与状态机闭环

    public async submitTask(options: FloorTaskSubmitOptions): Promise<SubmitFloorTaskResult> {
        if (this._isDisposed) {
            throw new Error('FloorButtonManager has been disposed');
        }

        const settings = this._store.getState();
        const activeProvider = settings.activeProvider || 'comfyui';
        const engineConfig = this._store.getEngineConfig(activeProvider) || {};

        const rawPositive = options.overridePrompt || options.prompt;
        const rawNegative = options.overrideNegativePrompt || options.negativePrompt;

        const promptToUse = normalizePromptPunctuation(rawPositive);
        const negativeToUse = rawNegative ? normalizePromptPunctuation(rawNegative) : undefined;

        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const imageInputs = options.overrideInpaintData ? {
            initImageBlob: options.overrideInpaintData.initImageBlob,
            maskImageBlob: options.overrideInpaintData.maskImageBlob
        } : undefined;

        const processResult = await this._pipeline.process({
            rawPrompt: promptToUse,
            negativePrompt: negativeToUse,
            targetEngine: activeProvider,
            taskId,
            engineOptions: engineConfig as Record<string, unknown>,
            imageInputs,
            contextInfo: {
                messageId: options.messageId,
                swipeId: options.swipeId,
                buttonIndex: options.slotIndex
            }
        }, settings);

        await this._taskManager.submit({
            request: processResult.request,
            chatId: this._host.getCurrentChatId() ?? undefined,
            messageId: options.messageId,
            swipeId: options.swipeId
        });

        return {
            taskId,
            processResult
        };
    }

    public async triggerGeneration(ctx: DynamicSlotContext): Promise<void> {
        if (ctx.state === 'progress' || ctx.state === 'loading' || ctx.state === 'pending') return;

        this._viewBinder.updateButtonState(ctx, 'loading');

        try {
            const targetChatId = this._host.getCurrentChatId();
            const targetSwipeId = this._host.getMessageById(ctx.messageId)?.swipe_id ?? ctx.swipeId;

            const { taskId, processResult } = await this.submitTask({
                prompt: ctx.promptText,
                negativePrompt: ctx.rawNegativePrompt,
                messageId: ctx.messageId,
                swipeId: targetSwipeId,
                slotIndex: ctx.slotIndex,
                overridePrompt: ctx.overridePrompt,
                overrideNegativePrompt: ctx.overrideNegativePrompt,
                overrideInpaintData: ctx.overrideInpaintData
            });

            ctx.wrapper.dataset.taskId = taskId;

            const unsubProgress = this._events.on('task:progress', (ev) => {
                if (ev.taskId === taskId) {
                    this._viewBinder.updateButtonState(ctx, 'progress');
                }
            });

            const unsubCompleted = this._events.on('task:completed', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.wrapper.dataset.taskId = '';
                    const firstImage = ev.result.images[0];
                    if (firstImage) {
                        const currentChatId = this._host.getCurrentChatId();
                        if (targetChatId && currentChatId && currentChatId !== targetChatId) {
                            FeedbackService.toastSuccess('生图完成（会话已切换，已静默持久化）');
                            return;
                        }
                        const refreshed = this.getSlotContext(ctx.wrapper);
                        if (!refreshed || !ctx.wrapper.isConnected) {
                            return;
                        }
                        const currentSwipeId = this._host.getMessageById(refreshed.messageId)?.swipe_id ?? 0;
                        if (currentSwipeId === targetSwipeId) {
                            const curSettings = this._store.getState();
                            const activeEngine = curSettings.activeProvider || 'comfyui';
                            const currentEngineConfig = this._store.getEngineConfig(activeEngine) || {};
                            const executionMetadata: Record<string, any> = {
                                ...(firstImage.metadata || {}),
                                finalPrompt: processResult.prompt,
                                finalNegativePrompt: processResult.request.negativePrompt,
                                engine: activeEngine,
                                ...((currentEngineConfig as any) || {})
                            };
                            const assetId = (firstImage as any).assetId || (firstImage as any).uuid || (firstImage as any).id;
                            
                            const blobUrl = URL.createObjectURL(firstImage.blob);
                            this._viewBinder.trackBlobUrl(blobUrl);

                            const effectivePrompt = refreshed.overridePrompt || processResult.prompt || ctx.promptText;
                            const effectiveNegativePrompt = refreshed.overrideNegativePrompt || processResult.request.negativePrompt || ctx.rawNegativePrompt;

                            this._viewBinder.mountRenderedImage(
                                refreshed,
                                blobUrl,
                                effectivePrompt,
                                effectiveNegativePrompt,
                                assetId,
                                executionMetadata
                            );
                            FeedbackService.toastSuccess('生图完成！');
                        } else {
                            FeedbackService.toastSuccess('生图完成（分支已切换，已静默持久化）');
                        }
                    }
                }
            });

            const unsubFailed = this._events.on('task:failed', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.wrapper.dataset.taskId = '';
                    this._viewBinder.updateButtonState(ctx, 'error');
                    FeedbackService.toastError(`生图任务失败: ${ev.error}`);
                }
            });

            const unsubCancelled = this._events.on('task:cancelled', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.wrapper.dataset.taskId = '';
                    this._viewBinder.updateButtonState(ctx, 'default');
                    FeedbackService.toastWarn('生图任务已取消');
                }
            });

            const cleanupTask = () => {
                unsubProgress.dispose();
                unsubCompleted.dispose();
                unsubFailed.dispose();
                unsubCancelled.dispose();
                this._activeTaskUnbinds.delete(taskId);
            };

            this._activeTaskUnbinds.set(taskId, cleanupTask);
            this._viewBinder.updateButtonState(ctx, 'pending');
        } catch (err: any) {
            this._viewBinder.updateButtonState(ctx, 'error');
            FeedbackService.toastError(`生图触发异常: ${err?.message || err}`);
        }
    }

    public cancelTask(taskId: string, reason = '用户在楼层主动中断'): void {
        if (this._isDisposed || !taskId) return;
        this._taskManager.cancelTask(taskId, reason);
    }

    // 5. 图片资产级联删除

    public async deleteImage(
        messageId: number,
        swipeId: number,
        slotIndex: number,
        assetId?: string
    ): Promise<void> {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
        const entry = daImages ? daImages[swipeId]?.[slotIndex] : undefined;
        const uuidToDelete = assetId || entry?.uuid;

        // 1. 宿主 extra 元数据清理
        if (daImages && entry) {
            delete daImages[swipeId][slotIndex];
            if (Object.keys(daImages[swipeId]).length === 0) {
                delete daImages[swipeId];
            }
            this._host.writeChatMessageExtra(messageId, 'da_images', daImages);
        }

        // 2. 删除服务端静态文件
        if (entry?.url) {
            try {
                await this._host.deleteImageFromServer(entry.url);
            } catch (err) {
                console.warn('[FloorButtonManager] 删除服务端静态文件异常:', err);
            }
        }

        // 3. 释放临时 URL 并从本地数据库删除
        if (uuidToDelete) {
            this._storage.releaseImageUrl(uuidToDelete);
            try {
                await this._storage.deleteImage(uuidToDelete);
            } catch (err) {
                console.warn('[FloorButtonManager] 删除本地 IndexedDB 记录异常:', err);
            }
        }
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;

        this._pendingScanMessageIds.clear();
        this._scanScheduled = false;

        this._activeTaskUnbinds.forEach((unbind) => unbind());
        this._activeTaskUnbinds.clear();

        this._viewBinder.dispose();
        this._disposables.dispose();

        document.querySelectorAll('.da-floor-slot').forEach((el) => el.remove());
    }
}
