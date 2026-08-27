/**
 * @module ui/layout/floor-button-container
 * @description 楼层生图按钮注入与交互管理 (FloorButtonContainer)
 *
 * 设计意图：
 * - 监听宿主消息渲染与变更事件；
 * - 识别消息中的提示词占位符并渲染为生图按钮；
 * - 协调生图任务触发、进度反馈与图片展示。
 */

import {
    IDisposable,
    DisposableStore,
    IHostBridge,
    HostMessageEvent,
    ITypedEventBus,
    ObservableStore,
    DrawAssistantSettings,
    IStorageAdapter,
    Logger
} from '../../core';
import { ITaskManager, PromptPipeline } from '../../domain';
import { openInpaintCanvasModal } from '../media/image-editor';
import { renderImageToMessage, ImageActionCallbacks, transcodeImage, dataURLtoBlob } from '../media/image-renderer';
import { FeedbackService } from '../feedback/feedback';

export interface FloorButtonContainerOptions {
    hostBridge: IHostBridge;
    events: ITypedEventBus;
    store: ObservableStore<DrawAssistantSettings>;
    taskManager: ITaskManager;
    pipeline: PromptPipeline;
    storage: IStorageAdapter;
}

type ButtonState = 'default' | 'loading' | 'progress' | 'done' | 'error';

interface FloorButtonContext {
    btn: HTMLButtonElement;
    wrapper: HTMLElement;
    imgSlot: HTMLElement;
    promptText: string;
    overridePrompt?: string;
    overrideNegativePrompt?: string;
    overrideInpaintData?: Record<string, unknown>;
    rawNegativePrompt?: string;
    currentTaskId: string | null;
    state: ButtonState;
    messageId: number;
    buttonIndex: number;
}

export class FloorButtonContainer implements IDisposable {
    private readonly _hostBridge: IHostBridge;
    private readonly _events: ITypedEventBus;
    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _taskManager: ITaskManager;
    private readonly _pipeline: PromptPipeline;
    private readonly _storage: IStorageAdapter;
    private readonly _logger = new Logger('FloorButtonContainer');
    private readonly _disposables = new DisposableStore();
    private readonly _contextMap = new Map<string, FloorButtonContext>();
    private readonly _trackedObjectUrls = new Set<string>();
    private readonly _activeTaskUnbinds = new Map<string, () => void>();
    private _isDisposed = false;
    private _isChatLoading = false;
    private _scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    private static readonly BUTTON_LABELS: Record<ButtonState, string> = {
        default: '生成图像',
        loading: '提交中...',
        progress: '生成中 (点击取消)',
        done: '重新生成',
        error: '重试'
    };

    constructor(options: FloorButtonContainerOptions) {
        this._hostBridge = options.hostBridge;
        this._events = options.events;
        this._store = options.store;
        this._taskManager = options.taskManager;
        this._pipeline = options.pipeline;
        this._storage = options.storage;

        this.initHostEventListeners();

        if (typeof setTimeout !== 'undefined') {
            this._isChatLoading = true;
            setTimeout(() => {
                if (this.hasActiveChat()) {
                    this.scanAllMessages();
                }
                this._isChatLoading = false;
            }, 400);
        }
    }

    private hasActiveChat(): boolean {
        const chatId = this._hostBridge.getCurrentChatId();
        return Boolean(chatId && chatId !== '');
    }

    private initHostEventListeners(): void {
        this._disposables.add(
            this._hostBridge.onCharacterMessageRendered(async (ev: HostMessageEvent) => {
                if (!ev.isUser && ev.messageId !== undefined && this.hasActiveChat()) {
                    await this.scanAndInjectMessage(ev.messageId);

                    const settings = this._store.getState();
                    if (!this._isChatLoading && settings.autoGenerate) {
                        const ctx = this._contextMap.get(`${ev.messageId}_0`);
                        if (ctx && ctx.state === 'default') {
                            this._logger.info(`实时 AI 回复完成，autoGenerate 触发自动生图: #${ev.messageId}`);
                            setTimeout(() => {
                                if (ctx.state === 'default') {
                                    ctx.btn.click();
                                }
                            }, 500);
                        }
                    }
                }
            })
        );

        this._disposables.add(
            this._hostBridge.onUserMessageRendered((ev: HostMessageEvent) => {
                if (ev.messageId !== undefined && this.hasActiveChat()) {
                    this.scanAndInjectMessage(ev.messageId);
                }
            })
        );

        this._disposables.add(
            this._hostBridge.onMessageSwiped(({ messageId }) => {
                if (this.hasActiveChat()) {
                    this.handleMessageSwiped(messageId);
                }
            })
        );

        this._disposables.add(
            this._hostBridge.onMessageEdited(({ messageId }) => {
                if (this.hasActiveChat()) {
                    this.scanAndInjectMessage(messageId);
                }
            })
        );

        this._disposables.add(
            this._hostBridge.onMessageDeleted(({ messageId }) => {
                this.handleMessageDeleted(messageId);
            })
        );

        this._disposables.add(
            this._hostBridge.onChatChanged((chatId) => {
                this.clearAllContexts();
                if (!chatId) {
                    this._logger.debug('当前退出或关闭聊天记录，已清空楼层上下文');
                    return;
                }
                this._logger.info(`检测到聊天记录切换 (${chatId})，准备重新扫描楼层`);
                this._isChatLoading = true;
                this.debounceScanAll(400);
                setTimeout(() => {
                    this._isChatLoading = false;
                }, 500);
            })
        );
    }

    private debounceScanAll(delayMs = 300): void {
        if (this._scanDebounceTimer) {
            clearTimeout(this._scanDebounceTimer);
        }
        this._scanDebounceTimer = setTimeout(() => {
            this._scanDebounceTimer = null;
            if (this.hasActiveChat()) {
                this.scanAllMessages();
            }
        }, delayMs);
    }

    private clearAllContexts(): void {
        for (const ctx of this._contextMap.values()) {
            const oldImg = ctx.imgSlot?.querySelector<HTMLImageElement>('.da-generated-img');
            if (oldImg?.src?.startsWith('blob:')) {
                URL.revokeObjectURL(oldImg.src);
                this._trackedObjectUrls.delete(oldImg.src);
            }
        }
        this._contextMap.clear();

        for (const url of this._trackedObjectUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch {}
        }
        this._trackedObjectUrls.clear();

        for (const cleanup of this._activeTaskUnbinds.values()) {
            try { cleanup(); } catch {}
        }
        this._activeTaskUnbinds.clear();
    }

    private removeMessageContexts(messageId: number, cancelRunning = false): void {
        for (const [key, ctx] of this._contextMap.entries()) {
            if (key.startsWith(`${messageId}_`)) {
                const oldImg = ctx.imgSlot?.querySelector<HTMLImageElement>('.da-generated-img');
                if (oldImg?.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(oldImg.src);
                    this._trackedObjectUrls.delete(oldImg.src);
                }
                if (cancelRunning && ctx.currentTaskId) {
                    void this._taskManager.cancelTask(ctx.currentTaskId);
                }
                this._contextMap.delete(key);
            }
        }
    }

    private handleMessageDeleted(messageId: number): void {
        this.removeMessageContexts(messageId, true);
        this.debounceScanAll(300);
    }

    public scanAllMessages(): void {
        if (typeof document === 'undefined' || this._isDisposed) return;
        if (!this.hasActiveChat()) {
            this._logger.debug('当前未打开任何聊天记录，跳过全量楼层扫描');
            return;
        }

        const mesList = document.querySelectorAll<HTMLElement>('.mes[mesid]');
        mesList.forEach((el) => {
            const mesIdAttr = el.getAttribute('mesid');
            if (mesIdAttr !== null) {
                const msgId = parseInt(mesIdAttr, 10);
                if (!isNaN(msgId)) {
                    this.scanAndInjectMessage(msgId);
                }
            }
        });
    }

    public scanAndInjectMessage(messageId: number): void {
        if (typeof document === 'undefined' || this._isDisposed) return;
        if (!this.hasActiveChat()) return;

        const mesEl = document.querySelector(`.mes[mesid="${messageId}"]`) as HTMLElement;
        if (!mesEl) return;

        const mesTextEl = mesEl.querySelector('.mes_text') as HTMLElement;
        if (!mesTextEl) return;

        const settings = this._store.getState();
        const start = settings.placeholderStart || 'image###';
        const end = settings.placeholderEnd || '###';

        const regex = FloorButtonContainer.buildPlaceholderRegex(start, end);
        const rawHtml = mesTextEl.innerHTML;

        if (!regex.test(rawHtml)) {
            this.removeMessageContexts(messageId, false);
            return;
        }
        regex.lastIndex = 0;

        let hasActiveTask = false;
        for (const [key, ctx] of this._contextMap.entries()) {
            if (key.startsWith(`${messageId}_`) && (ctx.state === 'loading' || ctx.state === 'progress')) {
                hasActiveTask = true;
                break;
            }
        }
        if (hasActiveTask) {
            this._logger.debug(`楼层 ${messageId} 存在正在执行的生图任务，跳过重复的 DOM 重置`);
            return;
        }

        // 状态与提示词指纹比对：若当前已有按钮且提取的提示词完全一致，直接跳过 DOM 重构
        const existingWrappers = mesTextEl.querySelectorAll('.da-floor-btn-wrapper');
        const matches: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = regex.exec(rawHtml)) !== null) {
            matches.push(m[1].replace(/<[^>]+>/g, ' ').trim());
        }
        regex.lastIndex = 0;

        if (existingWrappers.length === matches.length && matches.length > 0) {
            let isExactMatch = true;
            for (let idx = 0; idx < matches.length; idx++) {
                const ctx = this._contextMap.get(`${messageId}_${idx}`);
                if (!ctx || ctx.promptText !== matches[idx]) {
                    isExactMatch = false;
                    break;
                }
            }
            if (isExactMatch) {
                return;
            }
        }

        this.removeMessageContexts(messageId, false);

        let matchCount = 0;
        const newHtml = rawHtml.replace(regex, (_, prompt) => {
            const clean = prompt.replace(/<[^>]+>/g, ' ').trim();
            const btnIdx = matchCount++;
            return `<span class="da-floor-btn-placeholder" data-prompt="${encodeURIComponent(clean)}" data-btn-idx="${btnIdx}"></span>`;
        });

        mesTextEl.innerHTML = newHtml;

        const placeholders = mesTextEl.querySelectorAll('.da-floor-btn-placeholder');
        placeholders.forEach(async (ph) => {
            const prompt = decodeURIComponent(ph.getAttribute('data-prompt') || '');
            const btnIdx = parseInt(ph.getAttribute('data-btn-idx') || '0', 10);
            await this.createButton(ph as HTMLElement, prompt, messageId, btnIdx);
        });
    }

    private async handleMessageSwiped(messageId: number): Promise<void> {
        this.removeMessageContexts(messageId, false);
        this.scanAndInjectMessage(messageId);
    }

    private static buildPlaceholderRegex(start: string, end: string): RegExp {
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startPat = escapeRegex(start).replace(/#/g, '(?:#|&#35;|&num;)');
        const endPat = escapeRegex(end).replace(/#/g, '(?:#|&#35;|&num;)');
        return new RegExp(`${startPat}([\\s\\S]*?)${endPat}`, 'gi');
    }

    private async createButton(
        placeholder: HTMLElement,
        prompt: string,
        messageId: number,
        buttonIndex: number
    ): Promise<void> {
        const contextKey = `${messageId}_${buttonIndex}`;

        const wrapper = document.createElement('div');
        wrapper.className = 'da-floor-btn-wrapper';

        const btn = document.createElement('button');
        btn.className = 'da-floor-btn da-floor-btn--default';
        btn.textContent = FloorButtonContainer.BUTTON_LABELS.default;
        btn.title = `提示词：${prompt}`;

        const promptPreview = document.createElement('span');
        promptPreview.className = 'da-floor-btn-prompt';
        promptPreview.textContent = prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt;
        promptPreview.title = prompt;

        const imgSlot = document.createElement('div');
        imgSlot.className = 'da-floor-btn-img-slot';

        wrapper.appendChild(btn);
        wrapper.appendChild(promptPreview);
        wrapper.appendChild(imgSlot);
        placeholder.replaceWith(wrapper);

        const ctx: FloorButtonContext = {
            btn,
            wrapper,
            imgSlot,
            promptText: prompt,
            currentTaskId: null,
            state: 'default',
            messageId,
            buttonIndex
        };

        this._contextMap.set(contextKey, ctx);

        const callbacks = this.createActionCallbacks(ctx);
        await this.restoreSavedImage(ctx, callbacks);
        this.bindButtonEvents(ctx, callbacks);
    }

    private createActionCallbacks(ctx: FloorButtonContext): ImageActionCallbacks {
        return {
            messageIndex: ctx.messageId,
            buttonIndex: ctx.buttonIndex,
            promptText: ctx.overridePrompt || ctx.promptText,
            storage: this._storage,
            onConfirm: (newPos: string) => {
                this._logger.info(`从图像操作栏触发重新生成: msgId=${ctx.messageId}, newPrompt="${newPos.slice(0, 40)}..."`);
                ctx.overridePrompt = newPos;
                ctx.btn.click();
            },
            onRegenerate: () => {
                this._logger.info(`从图像操作栏直接触发重新生成: msgId=${ctx.messageId}`);
                ctx.btn.click();
            },
            onInpaint: () => {
                const imgEl = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
                if (imgEl?.src) {
                    openInpaintCanvasModal({
                        imageSrc: imgEl.src,
                        initialPrompt: ctx.overridePrompt || ctx.promptText,
                        onConfirm: (result) => {
                            this._logger.info('局部重绘请求就绪，准备触发生图', result.prompt);
                            ctx.overridePrompt = result.prompt;
                            ctx.overrideInpaintData = {
                                isInpaint: true,
                                initBlob: result.initImage,
                                maskBlob: result.maskImage
                            };
                            ctx.btn.click();
                        }
                    });
                }
            },
            onDelete: async () => {
                const confirmed = await FeedbackService.confirm({
                    title: '删除图像确认',
                    message: '确定要移除当前楼层已生成的图像吗？',
                    isDangerous: true
                });
                if (confirmed) {
                    ctx.imgSlot.innerHTML = '';
                    this.setButtonState(ctx, 'default');

                    try {
                        const msg = this._hostBridge.getChatMessage(ctx.messageId);
                        const swipeId = msg?.swipe_id ?? (msg?.extra?.swipe_id as number | undefined) ?? 0;
                        this._hostBridge.patchChatMessageExtra(ctx.messageId, 'da_images', (prevRoot: any) => {
                            const root = { ...(prevRoot ?? {}) };
                            const swipeImages = { ...(root[swipeId] ?? {}) };
                            delete swipeImages[ctx.buttonIndex];
                            root[swipeId] = swipeImages;
                            return root;
                        });
                    } catch (e) {
                        this._logger.warn('擦除聊天记录图像引用失败', e);
                    }

                    FeedbackService.toastSuccess('图像已从视图与聊天记录中移除');
                    this._logger.info(`已成功移除第 #${ctx.messageId} 条消息的图像引用`);
                }
            }
        };
    }

    private bindButtonEvents(ctx: FloorButtonContext, callbacks: ImageActionCallbacks): void {
        ctx.btn.onclick = async () => {
            if (ctx.state === 'loading') return;

            if (ctx.state === 'progress' && ctx.currentTaskId) {
                this._logger.warn(`用户点击取消生图任务: msgId=${ctx.messageId}, taskId=${ctx.currentTaskId}`);
                await this._taskManager.cancelTask(ctx.currentTaskId);
                this.setButtonState(ctx, 'default');
                ctx.currentTaskId = null;
                return;
            }

            const effectivePrompt = ctx.overridePrompt || ctx.promptText;
            this._logger.info(`触发楼层生图: msgId=${ctx.messageId}, prompt="${effectivePrompt.slice(0, 50)}..."`);
            this.setButtonState(ctx, 'loading');

            try {
                const chatId = this._hostBridge.getCurrentChatId() || 'default';
                const inpaintData = ctx.overrideInpaintData;
                ctx.overrideInpaintData = undefined;

                const pipelineResult = await this._pipeline.process(
                    {
                        rawPrompt: effectivePrompt,
                        messageId: ctx.messageId,
                        chatId,
                        mode: inpaintData ? 'inpaint' : 'txt2img',
                        initImageBlob: inpaintData?.initBlob as Blob | undefined,
                        maskImageBlob: inpaintData?.maskBlob as Blob | undefined,
                        driver: this._taskManager.getActiveDriver()
                    },
                    this._store.getState()
                );

                const taskId = await this._taskManager.submit({
                    chatId,
                    messageId: ctx.messageId,
                    payload: pipelineResult.payload
                });

                ctx.currentTaskId = taskId;
                this.setButtonState(ctx, 'progress');

                const unbind = this._events.on('task:state_changed', async (evt) => {
                    if (evt.taskId !== taskId) return;

                    if (evt.status === 'RUNNING' || (evt.status as string) === 'GENERATING') {
                        this.setButtonState(ctx, 'progress');
                    } else if (evt.status === 'COMPLETED') {
                        this._activeTaskUnbinds.delete(taskId);
                        unbind.dispose();
                        ctx.currentTaskId = null;
                        this.setButtonState(ctx, 'done');

                        const task = this._taskManager.getTask(taskId);
                        if (task?.resultBlobs?.[0]) {
                            const blob = task.resultBlobs[0];
                            const renderedImg = renderImageToMessage(ctx.imgSlot, blob, this._store.getState(), callbacks);
                            if (renderedImg?.src?.startsWith('blob:')) {
                                this._trackedObjectUrls.add(renderedImg.src);
                            }

                            setTimeout(() => {
                                void this.persistGeneratedImage(ctx, blob, effectivePrompt, pipelineResult.payload);
                            }, 0);
                        }
                    } else if (evt.status === 'DISCARDED' || evt.status === 'CANCELLED') {
                        this._activeTaskUnbinds.delete(taskId);
                        unbind.dispose();
                        ctx.currentTaskId = null;
                        this.setButtonState(ctx, 'default');
                    } else if (evt.status === 'ERROR' || (evt.status as string) === 'FAILED') {
                        this._activeTaskUnbinds.delete(taskId);
                        unbind.dispose();
                        ctx.currentTaskId = null;
                        this.setButtonState(ctx, 'error');
                        FeedbackService.toast(evt.error || '生图任务执行失败', true);
                    }
                });

                this._activeTaskUnbinds.set(taskId, () => unbind.dispose());
            } catch (err: any) {
                this.setButtonState(ctx, 'error');
                ctx.currentTaskId = null;
                this._logger.error('提交生图任务失败:', err);
                FeedbackService.toast(err.message || '提交生图任务失败', true);
            }
        };
    }

    private setButtonState(ctx: FloorButtonContext, state: ButtonState): void {
        ctx.state = state;
        ctx.btn.textContent = FloorButtonContainer.BUTTON_LABELS[state];
        ctx.btn.className = `da-floor-btn da-floor-btn--${state}`;
        ctx.btn.disabled = state === 'loading';

        const settings = this._store.getState();

        if (state === 'progress') {
            ctx.btn.style.display = '';
            ctx.btn.title = '点击可取消生成';
        } else if (state === 'done') {
            ctx.btn.title = '点击重新生成图像';
            if (settings.hideButtonOnDone) {
                ctx.btn.style.display = 'none';
            } else {
                ctx.btn.style.display = '';
            }
        } else if (state === 'error') {
            ctx.btn.style.display = '';
            ctx.btn.title = '生图失败，点击重试';
        } else {
            ctx.btn.style.display = '';
        }
    }

    private async restoreSavedImage(
        ctx: FloorButtonContext,
        callbacks: ImageActionCallbacks
    ): Promise<boolean> {
        const currentChatId = this._hostBridge.getCurrentChatId();
        if (!currentChatId) return false;

        try {
            const msg = this._hostBridge.getChatMessage(ctx.messageId);
            if (!msg) return false;

            const swipeId = msg.swipe_id ?? (msg.extra?.swipe_id as number | undefined) ?? 0;
            const daImagesRoot = msg.extra?.da_images as Record<string | number, unknown> | undefined;
            if (!daImagesRoot) return false;

            let savedMeta: Record<string, any> | undefined;
            const swipeObj = (daImagesRoot[swipeId] ?? daImagesRoot[String(swipeId)]) as Record<string | number, any> | undefined;
            if (swipeObj && typeof swipeObj === 'object') {
                savedMeta = swipeObj[ctx.buttonIndex] ?? swipeObj[String(ctx.buttonIndex)];
            } else if (daImagesRoot[ctx.buttonIndex] !== undefined || daImagesRoot[String(ctx.buttonIndex)] !== undefined) {
                savedMeta = (daImagesRoot[ctx.buttonIndex] ?? daImagesRoot[String(ctx.buttonIndex)]) as Record<string, any>;
            }

            if (!savedMeta) return false;

            let finalBlob: Blob | null = null;

            if (savedMeta.uuid) {
                const record = await this._storage.getImage(savedMeta.uuid);
                if (record?.data) {
                    finalBlob = record.data instanceof Blob ? record.data : dataURLtoBlob(record.data);
                }
            } else if (savedMeta.base64) {
                // 历史 Base64 结构自动无损迁移至 IndexedDB UUID 引用体系
                const uuid = crypto.randomUUID?.() ?? `migrated_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                const mime = savedMeta.mime || 'image/png';
                const dataURL = savedMeta.base64.startsWith('data:')
                    ? savedMeta.base64
                    : `data:${mime};base64,${savedMeta.base64}`;

                await this._storage.saveImage({
                    id: uuid,
                    prompt: savedMeta.prompt || ctx.promptText,
                    data: dataURL
                });

                // 增量写回楼层 extra，移除冗余的 base64 字符串以精简聊天文件体积
                this._hostBridge.patchChatMessageExtra(ctx.messageId, 'da_images', (prevRoot: any) => {
                    const root = { ...(prevRoot ?? {}) };
                    const swipeImages = { ...(root[swipeId] ?? {}) };
                    swipeImages[ctx.buttonIndex] = {
                        uuid,
                        mime,
                        prompt: savedMeta?.prompt || ctx.promptText,
                        timestamp: savedMeta?.timestamp || Date.now()
                    };
                    root[swipeId] = swipeImages;
                    return root;
                });

                finalBlob = dataURLtoBlob(dataURL);
            }

            if (finalBlob) {
                const renderedImg = renderImageToMessage(ctx.imgSlot, finalBlob, this._store.getState(), callbacks);
                if (renderedImg?.src?.startsWith('blob:')) {
                    this._trackedObjectUrls.add(renderedImg.src);
                }
                this.setButtonState(ctx, 'done');
                return true;
            }
        } catch (err) {
            this._logger.warn('恢复历史图像异常:', err);
        }
        return false;
    }

    /**
     * 将生成的图像转码、哈希去重并存入 IndexedDB 本地图库，同时将 UUID 关联写入会话消息元数据
     */
    private async persistGeneratedImage(
        ctx: FloorButtonContext,
        rawBlob: Blob,
        prompt: string,
        payload: any
    ): Promise<void> {
        const currentChatId = this._hostBridge.getCurrentChatId();
        if (!currentChatId) return;

        const settings = this._store.getState();

        try {
            const { blob: finalBlob, mime } = await transcodeImage(
                rawBlob,
                settings.imageFormat,
                settings.imageQuality
            );

            const hash = await this._storage.calculateHash(finalBlob);
            const existing = await this._storage.getImageByHash(hash);
            const uuid = existing?.id ?? (crypto.randomUUID?.() ?? `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

            if (!existing) {
                await this._storage.saveImage({
                    id: uuid,
                    hash,
                    prompt,
                    data: finalBlob,
                    metadata: {
                        messageId: ctx.messageId,
                        buttonIndex: ctx.buttonIndex,
                        params: payload?.params
                    }
                }, settings.maxStoredImages);
            }

            const msg = this._hostBridge.getChatMessage(ctx.messageId);
            const swipeId = msg?.swipe_id ?? (msg?.extra?.swipe_id as number | undefined) ?? 0;

            const imageEntry: Record<string, unknown> = {
                uuid,
                mime,
                prompt,
                timestamp: Date.now()
            };

            this._hostBridge.patchChatMessageExtra(ctx.messageId, 'da_images', (prevRoot: any) => {
                const root = { ...(prevRoot ?? {}) };
                const swipeImages = { ...(root[swipeId] ?? {}) };
                swipeImages[ctx.buttonIndex] = imageEntry;
                root[swipeId] = swipeImages;
                return root;
            });
            this._logger.info(`已成功将图像 UUID 引用持久化至楼层 #${ctx.messageId} (Swipe: ${swipeId})`);
        } catch (err) {
            this._logger.error('持久化图像至聊天记录失败:', err);
        }
    }

    public dispose(): void {
        this._isDisposed = true;
        if (this._scanDebounceTimer) {
            clearTimeout(this._scanDebounceTimer);
            this._scanDebounceTimer = null;
        }
        this.clearAllContexts();
        this._disposables.dispose();
    }
}
