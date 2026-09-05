/**
 * @module ui/layout/floor-button-container
 * @description 楼层生图按钮注入与交互管理控制器 (FloorButtonContainer)
 */

import {
    IDisposable,
    DisposableStore,
    ConfigStore,
    EventBus,
    CoreEventMap,
    ChatImagesRoot
} from '../../core';
import { HostClient } from '../../core/host';
import { StorageService } from '../../core/storage';
import { TaskManager } from '../../domain/task/task-manager';
import { PromptPipeline } from '../../domain/pipeline/prompt-pipeline';
import { openInpaintCanvasModal } from '../media/image-editor';
import { renderImageToMessage, ImageActionCallbacks, dataURLtoBlob } from '../media/image-renderer';
import { FeedbackService } from '../feedback/feedback';

export interface FloorButtonContainerOptions {
    host: HostClient;
    events: EventBus<CoreEventMap>;
    store: ConfigStore;
    taskManager: TaskManager;
    pipeline: PromptPipeline;
    storage: StorageService;
}

type ButtonState = 'default' | 'loading' | 'progress' | 'done' | 'error';

interface FloorButtonContext {
    btn: HTMLButtonElement;
    wrapper: HTMLElement;
    imgSlot: HTMLElement;
    promptText: string;
    overridePrompt?: string;
    overrideNegativePrompt?: string;
    overrideInpaintData?: { initImageBlob: Blob; maskImageBlob: Blob };
    rawNegativePrompt?: string;
    currentTaskId: string | null;
    state: ButtonState;
    messageId: number;
    buttonIndex: number;
}

export class FloorButtonContainer implements IDisposable {
    private readonly _host: HostClient;
    private readonly _events: EventBus<CoreEventMap>;
    private readonly _store: ConfigStore;
    private readonly _taskManager: TaskManager;
    private readonly _pipeline: PromptPipeline;
    private readonly _storage: StorageService;
    private readonly _disposables = new DisposableStore();
    private readonly _contextMap = new Map<string, FloorButtonContext>();
    private readonly _trackedObjectUrls = new Set<string>();
    private readonly _activeTaskUnbinds = new Map<string, () => void>();
    private _isDisposed = false;

    private static readonly BUTTON_LABELS: Record<ButtonState, string> = {
        default: '生成图像',
        loading: '提交中...',
        progress: '生成中 (点击取消)',
        done: '重新生成',
        error: '重试'
    };

    constructor(options: FloorButtonContainerOptions) {
        this._host = options.host;
        this._events = options.events;
        this._store = options.store;
        this._taskManager = options.taskManager;
        this._pipeline = options.pipeline;
        this._storage = options.storage;

        this.initHostEventListeners();
        this.scanAllMessages();
    }

    private initHostEventListeners(): void {
        this._disposables.add(
            this._host.onCharacterMessageRendered((ev) => {
                if (!ev.isUser && ev.messageId !== undefined) {
                    void this.scanAndInjectMessage(ev.messageId);

                    const settings = this._store.getState();
                    if (settings.autoGenerate) {
                        setTimeout(() => {
                            for (const [key, ctx] of this._contextMap.entries()) {
                                if (key.startsWith(`${ev.messageId}_`) && ctx.state === 'default') {
                                    void this.triggerGeneration(ctx);
                                }
                            }
                        }, 300);
                    }
                }
            })
        );

        this._disposables.add(
            this._host.onUserMessageRendered((ev) => {
                if (ev.messageId !== undefined) {
                    void this.scanAndInjectMessage(ev.messageId);
                }
            })
        );

        this._disposables.add(
            this._host.onChatChanged(() => {
                this.cleanupTrackedUrls();
                this._contextMap.clear();
                this.scanAllMessages();
            })
        );

        this._disposables.add(
            this._host.onChatSwiped((ev) => {
                if (ev.messageId !== undefined) {
                    void this.scanAndInjectMessage(ev.messageId);
                }
            })
        );
    }

    /**
     * 全量扫描当前已渲染的聊天消息
     */
    public scanAllMessages(): void {
        if (typeof document === 'undefined' || this._isDisposed) return;
        const msgNodes = document.querySelectorAll<HTMLElement>('.mes[mesid]');
        msgNodes.forEach((node) => {
            const id = parseInt(node.getAttribute('mesid') || '', 10);
            if (!isNaN(id)) {
                void this.scanAndInjectMessage(id);
            }
        });
    }

    /**
     * 扫描单条消息并注入生图按钮及图片插槽
     */
    public async scanAndInjectMessage(messageId: number): Promise<void> {
        if (typeof document === 'undefined' || this._isDisposed) return;

        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (!msgNode) return;

        const textNode = msgNode.querySelector<HTMLElement>('.mes_text');
        if (!textNode) return;

        const text = textNode.textContent || '';
        const startTag = this._store.get('placeholderStart') || 'image###';
        const endTag = this._store.get('placeholderEnd') || '###';

        const matches = this.extractPlaceholders(text, startTag, endTag);
        if (matches.length === 0) return;

        let floorRoot = msgNode.querySelector<HTMLElement>('.da-floor-root');
        if (!floorRoot) {
            floorRoot = document.createElement('div');
            floorRoot.className = 'da-floor-root st-da-root';
            msgNode.appendChild(floorRoot);
        }

        matches.forEach((item, index) => {
            const contextKey = `${messageId}_${index}`;
            let ctx = this._contextMap.get(contextKey);

            if (!ctx) {
                const wrapper = document.createElement('div');
                wrapper.className = 'da-floor-wrapper';

                const imgSlot = document.createElement('div');
                imgSlot.className = 'da-floor-img-slot';

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'da-btn da-btn--primary da-floor-btn';
                btn.textContent = FloorButtonContainer.BUTTON_LABELS.default;

                wrapper.appendChild(imgSlot);
                wrapper.appendChild(btn);
                floorRoot!.appendChild(wrapper);

                ctx = {
                    btn,
                    wrapper,
                    imgSlot,
                    promptText: item.prompt,
                    rawNegativePrompt: item.negativePrompt,
                    currentTaskId: null,
                    state: 'default',
                    messageId,
                    buttonIndex: index
                };

                btn.onclick = () => {
                    if (ctx!.state === 'progress' && ctx!.currentTaskId) {
                        this._taskManager.cancelTask(ctx!.currentTaskId, '用户在楼层主动中断');
                    } else if (ctx!.state === 'default' || ctx!.state === 'done' || ctx!.state === 'error') {
                        void this.triggerGeneration(ctx!);
                    }
                };

                this._contextMap.set(contextKey, ctx);
            } else {
                ctx.promptText = item.prompt;
                ctx.rawNegativePrompt = item.negativePrompt;
            }

            // 检查消息中是否已持久化了图片
            this.restoreExistingImage(ctx);
        });
    }

    private extractPlaceholders(text: string, startTag: string, endTag: string): Array<{ prompt: string; negativePrompt?: string }> {
        const results: Array<{ prompt: string; negativePrompt?: string }> = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            const start = text.indexOf(startTag, startIndex);
            if (start === -1) break;

            const end = text.indexOf(endTag, start + startTag.length);
            if (end === -1) break;

            const rawContent = text.substring(start + startTag.length, end).trim();
            if (rawContent) {
                const parts = rawContent.split('|');
                const prompt = parts[0]?.trim() || '';
                const negativePrompt = parts[1]?.trim();
                results.push({ prompt, negativePrompt });
            }

            startIndex = end + endTag.length;
        }

        return results;
    }

    private restoreExistingImage(ctx: FloorButtonContext): void {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(ctx.messageId, 'da_images');
        const msg = this._host.getMessageById(ctx.messageId);
        const swipeId = msg?.swipe_id ?? 0;
        const entry = daImages ? daImages[swipeId]?.[ctx.buttonIndex] : undefined;

        if (!entry) {
            // 当切换到无持久化图片的分支时，清空之前分支可能留存的图片并复位按钮状态
            if (ctx.imgSlot.innerHTML) {
                ctx.imgSlot.innerHTML = '';
            }
            if (ctx.state === 'done') {
                this.updateButtonState(ctx, 'default');
                ctx.btn.style.display = 'inline-block';
            }
            return;
        }

        let src = '';
        if (entry.storageStrategy === 'embedded' && entry.base64) {
            src = entry.base64;
        } else if (entry.storageStrategy === 'server' && entry.url) {
            src = entry.url;
        } else if (entry.uuid) {
            void this._storage.getImageUrl(entry.uuid).then((url) => {
                if (url) {
                    this._trackedObjectUrls.add(url);
                    this.mountRenderedImage(ctx, url, entry.prompt, entry.negativePrompt);
                }
            });
            return;
        }

        if (src) {
            this.mountRenderedImage(ctx, src, entry.prompt, entry.negativePrompt);
        }
    }

    private mountRenderedImage(
        ctx: FloorButtonContext,
        src: string,
        prompt: string,
        negativePrompt?: string
    ): void {
        const settings = this._store.getState();
        const actionCallbacks: ImageActionCallbacks = {
            promptText: prompt,
            negativePrompt,
            messageIndex: ctx.messageId,
            buttonIndex: ctx.buttonIndex,
            storage: this._storage,
            onRegenerate: () => {
                void this.triggerGeneration(ctx);
            },
            onInpaint: () => {
                openInpaintCanvasModal({
                    imageSrc: src,
                    initialPrompt: prompt,
                    onConfirm: (res) => {
                        ctx.overridePrompt = res.prompt;
                        ctx.overrideInpaintData = {
                            initImageBlob: dataURLtoBlob(res.initImage),
                            maskImageBlob: dataURLtoBlob(res.maskImage)
                        };
                        void this.triggerGeneration(ctx);
                    }
                });
            },
            onDelete: async () => {
                ctx.imgSlot.innerHTML = '';
                this.updateButtonState(ctx, 'default');
                const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(ctx.messageId, 'da_images');
                if (daImages) {
                    const msg = this._host.getMessageById(ctx.messageId);
                    const swipeId = msg?.swipe_id ?? 0;
                    const entry = daImages[swipeId]?.[ctx.buttonIndex];
                    if (entry) {
                        const uuid = entry.uuid;
                        delete daImages[swipeId][ctx.buttonIndex];
                        if (Object.keys(daImages[swipeId]).length === 0) {
                            delete daImages[swipeId];
                        }
                        this._host.writeChatMessageExtra(ctx.messageId, 'da_images', daImages);
                        if (uuid) {
                            this._storage.releaseImageUrl(uuid);
                            await this._storage.delete(uuid);
                        }
                    }
                }
            }
        };

        renderImageToMessage(ctx.imgSlot, src, settings, actionCallbacks);
        this.updateButtonState(ctx, 'done');

        if (settings.hideButtonOnDone) {
            ctx.btn.style.display = 'none';
        } else {
            ctx.btn.style.display = 'inline-block';
        }
    }

    private async triggerGeneration(ctx: FloorButtonContext): Promise<void> {
        if (ctx.state === 'progress' || ctx.state === 'loading') return;

        const settings = this._store.getState();
        const activeProvider = settings.activeProvider || 'comfyui';

        this.updateButtonState(ctx, 'loading');

        try {
            const promptToUse = ctx.overridePrompt || ctx.promptText;
            const negativeToUse = ctx.overrideNegativePrompt || ctx.rawNegativePrompt;

            const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            ctx.currentTaskId = taskId;

            const engineConfig = this._store.getEngineConfig(activeProvider) || {};

            const imageInputs = ctx.overrideInpaintData ? {
                initImageBlob: ctx.overrideInpaintData.initImageBlob,
                maskImageBlob: ctx.overrideInpaintData.maskImageBlob
            } : undefined;

            // 提示词流水线处理并组装标准化请求
            const processResult = await this._pipeline.process({
                rawPrompt: promptToUse,
                negativePrompt: negativeToUse,
                targetEngine: activeProvider,
                taskId,
                engineOptions: engineConfig as Record<string, unknown>,
                imageInputs,
                contextInfo: {
                    messageId: ctx.messageId,
                    swipeId: this._host.getMessageById(ctx.messageId)?.swipe_id ?? 0,
                    buttonIndex: ctx.buttonIndex
                }
            }, settings);

            // 监听任务生命周期
            const unsubProgress = this._events.on('task:progress', (ev) => {
                if (ev.taskId === taskId) {
                    this.updateButtonState(ctx, 'progress', ev.progress);
                }
            });

            const unsubCompleted = this._events.on('task:completed', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.currentTaskId = null;
                    const firstImage = ev.result.images[0];
                    if (firstImage) {
                        this.onImageGenerated(ctx, firstImage.blob, processResult.prompt, processResult.request.negativePrompt);
                    }
                }
            });

            const unsubFailed = this._events.on('task:failed', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.currentTaskId = null;
                    this.updateButtonState(ctx, 'error');
                    FeedbackService.toastError(`生图任务失败: ${ev.error}`);
                }
            });

            const unsubCancelled = this._events.on('task:cancelled', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.currentTaskId = null;
                    this.updateButtonState(ctx, 'default');
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

            // 提交任务到任务管理器
            await this._taskManager.submit({
                request: processResult.request,
                messageId: ctx.messageId
            });

            this.updateButtonState(ctx, 'progress');
        } catch (err: any) {
            this.updateButtonState(ctx, 'error');
            FeedbackService.toastError(`生图触发异常: ${err?.message || err}`);
        }
    }

    private onImageGenerated(
        ctx: FloorButtonContext,
        blob: Blob,
        prompt: string,
        negativePrompt?: string
    ): void {
        const blobUrl = URL.createObjectURL(blob);
        this._trackedObjectUrls.add(blobUrl);

        // 挂载到图片插槽中
        this.mountRenderedImage(ctx, blobUrl, prompt, negativePrompt);
        FeedbackService.toastSuccess('生图完成！');
    }

    private updateButtonState(ctx: FloorButtonContext, state: ButtonState, progress = 0): void {
        ctx.state = state;
        ctx.btn.className = `da-btn da-floor-btn da-floor-btn--${state}`;

        if (state === 'progress' && progress > 0) {
            ctx.btn.textContent = `生成中 (${Math.round(progress * 100)}%) - 点击取消`;
        } else {
            ctx.btn.textContent = FloorButtonContainer.BUTTON_LABELS[state] || '生成图像';
        }
    }

    private cleanupTrackedUrls(): void {
        this._trackedObjectUrls.forEach((url) => {
            URL.revokeObjectURL(url);
        });
        this._trackedObjectUrls.clear();
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;

        this._activeTaskUnbinds.forEach((unbind) => unbind());
        this._activeTaskUnbinds.clear();

        this.cleanupTrackedUrls();
        this._disposables.dispose();

        if (typeof document !== 'undefined') {
            document.querySelectorAll('.da-floor-root').forEach((el) => el.remove());
        }
        this._contextMap.clear();
    }
}
