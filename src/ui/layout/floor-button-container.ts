/**
 * 楼层生图按钮注入与交互管理控制器 (FloorButtonContainer)
 * 监听酒馆消息渲染与滚动更新，解析提示词占位符并注入交互按钮与图片槽位
 */

import { IDisposable, DisposableStore, CoreEventMap, ChatImagesRoot } from '../../types';
import { TypedEventBus } from '../../utils';
import { SettingsStore } from '../../state';
import { base64ToBlob } from '../../utils';
import { HostClient } from '../../host';
import { StorageService } from '../../state';
import { TaskManager } from '../../tasks';
import { PromptPipeline } from '../../pipeline';
import { extractPlaceholders } from '../../pipeline';
import { openInpaintCanvasModal } from '../media/image-editor';
import { renderImageToMessage, ImageActionCallbacks } from '../media/image-renderer';
import { FeedbackService } from '../feedback/feedback';

export interface FloorButtonContainerOptions {
    host: HostClient;
    events: TypedEventBus<CoreEventMap>;
    store: SettingsStore;
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
    currentAssetId?: string | null;
    state: ButtonState;
    messageId: number;
    swipeId: number;
    buttonIndex: number;
}

export class FloorButtonContainer implements IDisposable {
    private readonly _host: HostClient;
    private readonly _events: TypedEventBus<CoreEventMap>;
    private readonly _store: SettingsStore;
    private readonly _taskManager: TaskManager;
    private readonly _pipeline: PromptPipeline;
    private readonly _storage: StorageService;
    private readonly _disposables = new DisposableStore();
    private readonly _contextMap = new Map<string, FloorButtonContext>();
    private readonly _trackedObjectUrls = new Set<string>();
    private readonly _activeTaskUnbinds = new Map<string, () => void>();
    private _intersectionObserver: IntersectionObserver | null = null;
    private _observedMsgNodes = new WeakSet<HTMLElement>();
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

        this.initIntersectionObserver();
        this.initHostEventListeners();
        this.scanAllMessages();
    }

    /**
     * 初始化视口可见性观察器 (IntersectionObserver)
     * 以酒馆聊天窗口容器为根视口，提供 300px 上下预加载缓冲区
     * 仅当消息进入视口区域时动态注入与恢复插槽，离开远端视口时按需轻量化
     */
    private initIntersectionObserver(): void {
        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;

        const chatRoot = document.querySelector<HTMLElement>('#chat') || null;
        this._intersectionObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const target = entry.target as HTMLElement;
                    const id = parseInt(target.getAttribute('mesid') || '', 10);
                    if (isNaN(id)) return;

                    if (entry.isIntersecting) {
                        void this.scanAndInjectMessage(id);
                    } else {
                        // 离开视口较远时释放 Blob URL 防内存泄露
                        this.lightenMessageOutOfViewport(id);
                    }
                });
            },
            {
                root: chatRoot,
                rootMargin: '300px 0px'
            }
        );
    }

    private initHostEventListeners(): void {
        this._disposables.add(
            this._host.onCharacterMessageRendered((ev) => {
                if (!ev.isUser && ev.messageId !== undefined) {
                    this.observeAndScanMessage(ev.messageId);
                }
            })
        );

        this._disposables.add(
            this._host.onUserMessageRendered((ev) => {
                if (ev.messageId !== undefined) {
                    this.observeAndScanMessage(ev.messageId);
                }
            })
        );

        // 监听用户编辑消息事件，正文修改后动态重新解析并刷新段落插槽
        this._disposables.add(
            this._host.onMessageUpdated((ev) => {
                if (ev.messageId !== undefined) {
                    this.observeAndScanMessage(ev.messageId);
                }
            })
        );

        this._disposables.add(
            this._host.onChatChanged(() => {
                this._intersectionObserver?.disconnect();
                this._observedMsgNodes = new WeakSet<HTMLElement>();
                this.cleanupTrackedUrls();
                this._contextMap.clear();
                this.scanAllMessages();
            })
        );

        this._disposables.add(
            this._host.onChatSwiped((ev) => {
                if (ev.messageId !== undefined) {
                    this.observeAndScanMessage(ev.messageId);
                }
            })
        );

        // 监听图像资产保存完成事件，将生成的持久化 uuid 绑定到插槽上下文，消除删除与缓存读取时序差
        this._disposables.add(
            this._events.on('asset:saved', (ev) => {
                const info = ev.record?.metadata?.contextInfo;
                if (info && typeof info.messageId === 'number') {
                    const contextKey = `${info.messageId}_${info.swipeId ?? 0}_${info.buttonIndex ?? 0}`;
                    const ctx = this._contextMap.get(contextKey);
                    if (ctx) {
                        ctx.currentAssetId = ev.assetId;
                    }
                }
            })
        );

        // 自动生图时机收敛至整条消息完全生成定稿后触发，杜绝流式打字过程中的抢跑与并发冲突
        this._disposables.add(
            this._host.onGenerationEnded(() => {
                const settings = this._store.getState();
                if (!settings.autoGenerate) return;

                const chat = this._host.getChat();
                if (!chat || chat.length === 0) return;
                const lastIndex = chat.length - 1;
                const lastMsg = chat[lastIndex];
                if (lastMsg.is_user) return;

                const swipeId = lastMsg.swipe_id ?? 0;
                for (const [key, ctx] of this._contextMap.entries()) {
                    if (key.startsWith(`${lastIndex}_${swipeId}_`) && ctx.state === 'default') {
                        void this.triggerGeneration(ctx);
                    }
                }
            })
        );
    }

    /**
     * 将单条消息加入视口观察并按需处理
     */
    private observeAndScanMessage(messageId: number): void {
        if (typeof document === 'undefined' || this._isDisposed) return;
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (!msgNode) return;

        if (this._intersectionObserver && !this._observedMsgNodes.has(msgNode)) {
            this._intersectionObserver.observe(msgNode);
            this._observedMsgNodes.add(msgNode);
        }

        // 新消息渲染时直接优先扫描一次
        void this.scanAndInjectMessage(messageId);
    }

    /**
     * 扫描消息：通过 IntersectionObserver 动态跟随视口管理
     */
    public scanAllMessages(): void {
        if (typeof document === 'undefined' || this._isDisposed) return;
        const allMsgNodes = Array.from(document.querySelectorAll<HTMLElement>('.mes[mesid]'));
        if (allMsgNodes.length === 0) return;

        allMsgNodes.forEach((node) => {
            const id = parseInt(node.getAttribute('mesid') || '', 10);
            if (isNaN(id)) return;

            if (this._intersectionObserver) {
                if (!this._observedMsgNodes.has(node)) {
                    this._intersectionObserver.observe(node);
                    this._observedMsgNodes.add(node);
                }
            } else {
                // 浏览器不支持 IntersectionObserver 时兜底直接扫描
                void this.scanAndInjectMessage(id);
            }
        });

        // 优先即时渲染最新 3 条消息，确保初次进房或底部新消息瞬间呈现
        const recentNodes = allMsgNodes.slice(-3);
        recentNodes.forEach((node) => {
            const id = parseInt(node.getAttribute('mesid') || '', 10);
            if (!isNaN(id)) {
                void this.scanAndInjectMessage(id);
            }
        });
    }

    /**
     * 消息移出视口较远时的轻量化处理：释放临时 Blob URL 降低内存开销
     */
    private lightenMessageOutOfViewport(messageId: number): void {
        for (const [key, ctx] of this._contextMap.entries()) {
            if (key.startsWith(`${messageId}_`)) {
                const img = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
                if (img?.dataset?.ownsBlob === 'true' && img.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(img.src);
                    this._trackedObjectUrls.delete(img.src);
                    img.dataset.ownsBlob = 'false';
                }
            }
        }
    }

    /**
     * 清理单条消息内挂载的楼层生图插槽与上下文
     */
    public cleanMessageFloorSlots(messageId: number): void {
        if (typeof document === 'undefined') return;
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (msgNode) {
            msgNode.querySelectorAll<HTMLElement>('.da-floor-slot, .da-floor-root').forEach((el) => {
                el.remove();
            });
        }
        for (const [key, ctx] of Array.from(this._contextMap.entries())) {
            if (key.startsWith(`${messageId}_`)) {
                const oldImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
                if (oldImg?.dataset?.ownsBlob === 'true' && oldImg.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(oldImg.src);
                    this._trackedObjectUrls.delete(oldImg.src);
                }
                this._contextMap.delete(key);
            }
        }
    }

    /**
     * 在文本容器中查找目标指令符并将其替换为生图插槽容器，插入到对应段落
     * 自动清除前后多余的空白符与换行，当父级段落只含有该指令时直接整段替换，根除多余空行
     */
    private insertSlotAtMatchedText(container: HTMLElement, targetText: string, elementToInsert: HTMLElement): boolean {
        if (!targetText) return false;
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;

        while ((node = walker.nextNode())) {
            const text = node.textContent || '';
            const idx = text.indexOf(targetText);
            if (idx !== -1) {
                const textNode = node as Text;
                const parent = textNode.parentElement;

                // 检查直接父元素（如 <p>）是否在剔除目标文本及紧邻空白后为空段落
                if (parent && parent !== container && (parent.tagName === 'P' || parent.tagName === 'DIV')) {
                    const rawParentText = parent.textContent || '';
                    const remainingText = rawParentText.replace(targetText, '').trim();
                    // 若父级段落除该指令文本外无其他实际文字内容，直接替换整个父段落，避免非法嵌套与产生多余空行
                    if (remainingText.length === 0) {
                        parent.replaceWith(elementToInsert);
                        return true;
                    }
                }

                // 若处于包含其他实质文字的段落内部，则进行节点切分并修剪前后断点的换行与多余空白
                const beforeText = text.slice(0, idx).replace(/[\r\n]+$/, '');
                const afterText = text.slice(idx + targetText.length).replace(/^[\r\n]+/, '');

                textNode.textContent = beforeText;
                const afterNode = document.createTextNode(afterText);

                const parentNode = textNode.parentNode;
                if (parentNode) {
                    parentNode.insertBefore(elementToInsert, textNode.nextSibling);
                    parentNode.insertBefore(afterNode, elementToInsert.nextSibling);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 扫描单条消息并在对应段落替换插入生图按钮及图片插槽
     * 捕获到绘图标志符后，替换正文中的标志符内容，并在原段落位置就地插入插槽
     */
    public async scanAndInjectMessage(messageId: number): Promise<void> {
        if (typeof document === 'undefined' || this._isDisposed) return;

        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (!msgNode) return;

        const textNode = msgNode.querySelector<HTMLElement>('.mes_text');
        if (!textNode) return;

        const msg = this._host.getMessageById(messageId);
        const swipeId = msg?.swipe_id ?? 0;

        const text = textNode.textContent || '';
        const startTag = this._store.get('placeholderStart') || 'image###';
        const endTag = this._store.get('placeholderEnd') || '###';

        const matches = extractPlaceholders(text, startTag, endTag);
        if (matches.length === 0) {
            // 当前分支或消息无绘图指令符时，主动清理可能存在的旧插槽
            this.cleanMessageFloorSlots(messageId);
            return;
        }

        matches.forEach((item, index) => {
            const contextKey = `${messageId}_${swipeId}_${index}`;
            let ctx = this._contextMap.get(contextKey);

            // 检查 DOM 中是否已存在对应段落插槽
            const existingSlot = textNode.querySelector<HTMLElement>(`[data-slot-key="${contextKey}"]`);

            if (!ctx || !existingSlot || !existingSlot.isConnected) {
                // 如果旧插槽悬挂但未连接，先清理
                if (existingSlot) {
                    existingSlot.remove();
                }

                const wrapper = document.createElement('div');
                wrapper.className = 'da-floor-btn-wrapper da-floor-slot st-da-root';
                wrapper.dataset.slotKey = contextKey;
                wrapper.dataset.swipeId = String(swipeId);

                const imgSlot = document.createElement('div');
                imgSlot.className = 'da-floor-btn-img-slot';

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'da-btn da-floor-btn da-floor-btn--default';
                btn.textContent = FloorButtonContainer.BUTTON_LABELS.default;

                wrapper.appendChild(imgSlot);
                wrapper.appendChild(btn);

                // 替换正文中的标志符内容，并将按钮与插槽就地插入到对应段落
                const inserted = item.rawMatch
                    ? this.insertSlotAtMatchedText(textNode, item.rawMatch, wrapper)
                    : false;

                // 若因特殊格式未精确匹配到文本节点，则置于段落末尾作为兜底
                if (!inserted) {
                    textNode.appendChild(wrapper);
                }

                ctx = {
                    btn,
                    wrapper,
                    imgSlot,
                    promptText: item.prompt,
                    rawNegativePrompt: item.negativePrompt,
                    currentTaskId: null,
                    state: 'default',
                    messageId,
                    swipeId,
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
                // 如果正文中依然有 rawMatch 文本未替换，尝试替换
                if (item.rawMatch && textNode.textContent?.includes(item.rawMatch)) {
                    this.insertSlotAtMatchedText(textNode, item.rawMatch, ctx.wrapper);
                }
            }

            // 检查消息中是否已持久化了图片并恢复
            this.restoreExistingImage(ctx);
        });
    }

    private restoreExistingImage(ctx: FloorButtonContext): void {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(ctx.messageId, 'da_images');
        const swipeId = ctx.swipeId;
        const entry = daImages ? daImages[swipeId]?.[ctx.buttonIndex] : undefined;

        if (!entry) {
            ctx.currentAssetId = null;
            // 当切换到无持久化图片的分支时，清空之前分支留存的图片并复位按钮状态
            const oldImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
            if (oldImg?.dataset?.ownsBlob === 'true' && oldImg.src?.startsWith('blob:')) {
                URL.revokeObjectURL(oldImg.src);
                this._trackedObjectUrls.delete(oldImg.src);
            }
            if (ctx.imgSlot.innerHTML) {
                ctx.imgSlot.innerHTML = '';
            }
            if (ctx.state === 'done') {
                this.updateButtonState(ctx, 'default');
                ctx.btn.style.display = 'inline-flex';
            }
            return;
        }

        ctx.currentAssetId = entry.uuid || null;

        let src = '';
        if (entry.storageStrategy === 'embedded' && entry.base64) {
            src = entry.base64;
        } else if (entry.url) {
            src = entry.url;
        } else if (entry.uuid) {
            void this._storage.getImageUrl(entry.uuid).then((url) => {
                if (url) {
                    // 防滑动竞态：异步读取完成时校验当前楼层实际活跃的 swipe_id，避免旧分支图片错挂到新分支
                    const currentMsg = this._host.getMessageById(ctx.messageId);
                    if (currentMsg && (currentMsg.swipe_id ?? 0) !== swipeId) {
                        return;
                    }
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
                            initImageBlob: base64ToBlob(res.initImage),
                            maskImageBlob: base64ToBlob(res.maskImage)
                        };
                        void this.triggerGeneration(ctx);
                    }
                });
            },
            onDelete: async () => {
                ctx.imgSlot.innerHTML = '';
                this.updateButtonState(ctx, 'default');
                const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(ctx.messageId, 'da_images');
                const swipeId = ctx.swipeId;
                const entry = daImages ? daImages[swipeId]?.[ctx.buttonIndex] : undefined;
                const uuidToDelete = ctx.currentAssetId || entry?.uuid;
                ctx.currentAssetId = null;

                if (daImages && entry) {
                    delete daImages[swipeId][ctx.buttonIndex];
                    if (Object.keys(daImages[swipeId]).length === 0) {
                        delete daImages[swipeId];
                    }
                    this._host.writeChatMessageExtra(ctx.messageId, 'da_images', daImages);
                }
                if (uuidToDelete) {
                    this._storage.releaseImageUrl(uuidToDelete);
                    await this._storage.delete(uuidToDelete);
                }
            }
        };

        renderImageToMessage(ctx.imgSlot, src, settings, actionCallbacks);
        this.updateButtonState(ctx, 'done');

        if (settings.hideButtonOnDone) {
            ctx.btn.style.display = 'none';
        } else {
            ctx.btn.style.display = 'inline-flex';
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

            const targetSwipeId = this._host.getMessageById(ctx.messageId)?.swipe_id ?? 0;

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
                    swipeId: targetSwipeId,
                    buttonIndex: ctx.buttonIndex
                }
            }, settings);

            // 监听任务生命周期并同步进度至按钮
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
                        const currentSwipeId = this._host.getMessageById(ctx.messageId)?.swipe_id ?? 0;
                        if (currentSwipeId === targetSwipeId) {
                            this.onImageGenerated(ctx, firstImage.blob, processResult.prompt, processResult.request.negativePrompt);
                        } else {
                            FeedbackService.toastSuccess('生图完成（分支已切换，已静默持久化）');
                        }
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

    private updateButtonState(ctx: FloorButtonContext, state: ButtonState, progress?: number): void {
        ctx.state = state;
        ctx.btn.className = `da-btn da-floor-btn da-floor-btn--${state}`;
        if (state === 'progress') {
            if (typeof progress === 'number' && progress > 0) {
                const pct = Math.min(100, Math.round(progress * 100));
                ctx.btn.textContent = `生成中 ${pct}% (点击取消)`;
            } else {
                ctx.btn.textContent = FloorButtonContainer.BUTTON_LABELS.progress;
            }
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

        this._intersectionObserver?.disconnect();
        this._intersectionObserver = null;
        this._observedMsgNodes = new WeakSet<HTMLElement>();

        this.cleanupTrackedUrls();
        this._disposables.dispose();

        if (typeof document !== 'undefined') {
            document.querySelectorAll('.da-floor-slot, .da-floor-root').forEach((el) => el.remove());
        }
        this._contextMap.clear();
    }
}
