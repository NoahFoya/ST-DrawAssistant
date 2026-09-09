/**
 * 楼层生图按钮表现层控制器 (FloorButtonContainer)
 * 职责：纯 UI 表现层，负责正文占位符 TreeWalker 扫描、Range 原位替换、思维链/代码块排除、
 * 运行时无状态动态 DOM 寻址，并将提示词流水线与任务派发全权委托给 FloorTaskService。
 */

import { IDisposable, DisposableStore, CoreEventMap } from '../../types';
import { TypedEventBus, base64ToBlob } from '../../utils';
import { SettingsStore, StorageService } from '../../state';
import { HostClient } from '../../host';
import { TaskManager, FloorTaskService } from '../../tasks';
import { PromptPipeline, separatePromptByPipe } from '../../pipeline';
import { openInpaintCanvasModal } from '../media/image-editor';
import { renderImageToMessage, ImageActionCallbacks } from '../media/image-renderer';
import { FeedbackService } from '../feedback/feedback';

/** 需严格跳过的代码块容器标签 */
const CODE_RELATED_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'BUTTON',
    'PRE',
    'CODE',
    'TEXTAREA',
    'KBD',
    'SAMP',
    'VAR'
]);

/** 需严格跳过的高亮代码块样式类模式 */
const CODE_CLASS_PATTERNS = ['hljs', 'highlight', 'prism', 'language-', 'CodeMirror', 'ace_'];

/** 需严格跳过的思维链与思考折叠容器样式类模式 */
const THINKING_CLASS_PATTERNS = ['think', 'thinking', 'thought', 'reasoning', 'chat-thought', 'mind-fold', 'thinking-details'];

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface NodeRangeInfo {
    node: Node;
    start: number;
    end: number;
}

export interface FloorButtonContainerOptions {
    host: HostClient;
    events: TypedEventBus<CoreEventMap>;
    store: SettingsStore;
    floorTaskService?: FloorTaskService;
    taskManager?: TaskManager;
    pipeline?: PromptPipeline;
    storage: StorageService;
}

type ButtonState = 'default' | 'loading' | 'pending' | 'progress' | 'done' | 'error';

/** 运行时从 DOM 动态提取的无状态插槽上下文 */
interface DynamicSlotContext {
    wrapper: HTMLElement;
    btn: HTMLButtonElement;
    imgSlot: HTMLElement;
    messageId: number;
    swipeId: number;
    slotIndex: number;
    promptText: string;
    rawNegativePrompt?: string;
    overridePrompt?: string;
    overrideNegativePrompt?: string;
    overrideInpaintData?: { initImageBlob: Blob; maskImageBlob: Blob };
    currentTaskId: string | null;
    currentAssetId: string | null;
    state: ButtonState;
}

export class FloorButtonContainer implements IDisposable {
    private readonly _host: HostClient;
    private readonly _events: TypedEventBus<CoreEventMap>;
    private readonly _store: SettingsStore;
    private readonly _floorTaskService: FloorTaskService;
    private readonly _storage: StorageService;
    private readonly _disposables = new DisposableStore();
    private readonly _trackedObjectUrls = new Set<string>();
    private readonly _activeTaskUnbinds = new Map<string, () => void>();
    private _isDisposed = false;

    private static readonly BUTTON_LABELS: Record<ButtonState, string> = {
        default: '生成图像',
        loading: '提交中...',
        pending: '排队中 (点击取消)',
        progress: '生成中 (点击取消)',
        done: '重新生成',
        error: '重试'
    };

    constructor(options: FloorButtonContainerOptions) {
        this._host = options.host;
        this._events = options.events;
        this._store = options.store;
        this._storage = options.storage;

        if (options.floorTaskService) {
            this._floorTaskService = options.floorTaskService;
        } else if (options.taskManager && options.pipeline) {
            // 向后兼容兜底实例化
            this._floorTaskService = new FloorTaskService({
                host: options.host,
                store: options.store,
                taskManager: options.taskManager,
                pipeline: options.pipeline,
                storage: options.storage
            });
            this._disposables.add(this._floorTaskService);
        } else {
            throw new Error('FloorButtonContainer 缺少 FloorTaskService 依赖');
        }

        this.initHostEventListeners();
        void this.scanAllMessages();
    }

    // 1. 宿主生命周期事件订阅与自动生图调度

    private initHostEventListeners(): void {
        // 生成结束消息定稿后等待全量扫描挂载完毕，再触发自动生图，彻底避免异步时序扑空
        this._disposables.add(
            this._host.onGenerationEnded(async () => {
                // 确保全量消息扫描与 DOM 原位插槽挂载确凿完成
                await this.scanAllMessages();

                const settings = this._store.getState();
                if (!settings.autoGenerate) return;

                const chat = this._host.getChat();
                if (!chat || chat.length === 0) return;
                const lastIndex = chat.length - 1;
                const lastMsg = chat[lastIndex];
                if (lastMsg.is_user) return;

                // 此时 DOM 插槽已 100% 挂载就绪，按序触发该楼层内所有处于 default 态的按钮入队
                const lastMsgNode = document.querySelector<HTMLElement>(`.mes[mesid="${lastIndex}"]`);
                if (lastMsgNode) {
                    const slots = Array.from(lastMsgNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
                    for (const slot of slots) {
                        const ctx = this.getSlotContext(slot);
                        if (ctx && ctx.state === 'default') {
                            void this.triggerGeneration(ctx);
                        }
                    }
                }
            })
        );

        // 切换消息分支（Swipe）时刷新对应楼层插槽与图片展示
        this._disposables.add(
            this._host.onChatSwiped((ev) => {
                if (ev.messageId !== undefined) {
                    void this.scanAndInjectMessage(ev.messageId);
                }
            })
        );

        // 监听用户编辑消息事件，修改后重新扫描解析
        this._disposables.add(
            this._host.onMessageUpdated((ev) => {
                if (ev.messageId !== undefined) {
                    void this.scanAndInjectMessage(ev.messageId);
                }
            })
        );

        // 会话切换时清理临时创建的 Object URL，并重新扫描当前会话消息
        this._disposables.add(
            this._host.onChatChanged(() => {
                this.cleanupTrackedUrls();
                void this.scanAllMessages();
            })
        );
    }

    // 2. 运行时动态 DOM 寻址 (无状态解耦核心)

    /**
     * 从 DOM 节点向上实时解析楼层号与插槽上下文
     * 核心设计：消息自身持有图片数据，删楼时 DOM mesid 会由酒馆内核自动向前顺移；
     * 插件在用户点击的瞬间动态调用 closest('.mes[mesid]') 向上取号，天然 100% 免疫任何删楼位移。
     */
    private getSlotContext(target: HTMLElement): DynamicSlotContext | null {
        const wrapper = target.closest<HTMLElement>('.da-floor-slot');
        if (!wrapper) return null;

        const mesNode = wrapper.closest<HTMLElement>('.mes[mesid]');
        const rawMesId = mesNode?.getAttribute('mesid');
        const messageId = rawMesId !== null && rawMesId !== undefined ? parseInt(rawMesId, 10) : NaN;
        if (isNaN(messageId)) return null;

        const slotIndex = parseInt(wrapper.dataset.slotIndex || '0', 10);
        const swipeId = parseInt(wrapper.dataset.swipeId || '0', 10);
        const promptRaw = wrapper.dataset.prompt || '';
        const { positive, negative } = separatePromptByPipe(promptRaw);

        const btn = wrapper.querySelector<HTMLButtonElement>('.da-floor-btn');
        const imgSlot = wrapper.querySelector<HTMLElement>('.da-floor-btn-img-slot');
        if (!btn || !imgSlot) return null;

        const state = (wrapper.dataset.state as ButtonState) || 'default';
        const currentTaskId = wrapper.dataset.taskId || null;
        const currentAssetId = wrapper.dataset.assetId || null;

        return {
            wrapper,
            btn,
            imgSlot,
            messageId,
            swipeId,
            slotIndex,
            promptText: positive,
            rawNegativePrompt: negative || undefined,
            overridePrompt: wrapper.dataset.overridePrompt || undefined,
            overrideNegativePrompt: wrapper.dataset.overrideNegativePrompt || undefined,
            currentTaskId,
            currentAssetId,
            state
        };
    }

    // 3. 正文扫描、TreeWalker 过滤与 Range 原位插装

    /**
     * 扫描全部当前在 DOM 中的消息楼层（返回 Promise 确保可可靠等待）
     */
    public async scanAllMessages(): Promise<void> {
        if (typeof document === 'undefined' || this._isDisposed) return;
        const allMsgNodes = Array.from(document.querySelectorAll<HTMLElement>('.mes[mesid]'));
        await Promise.all(
            allMsgNodes.map(async (node) => {
                const id = parseInt(node.getAttribute('mesid') || '', 10);
                if (!isNaN(id)) {
                    await this.scanAndInjectMessage(id);
                }
            })
        );
    }

    /**
     * 扫描单条消息并在对应段落原位替换插入生图按钮及图片插槽
     * 采用 TreeWalker 构建逻辑文本映射，结合 Range 精确删除占位符并在原位就地插装，
     * 严格排除代码块与思维链标签，杜绝打字过程抢跑与父级段落破坏
     */
    public async scanAndInjectMessage(messageId: number): Promise<void> {
        if (typeof document === 'undefined' || this._isDisposed) return;

        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (!msgNode) return;

        const textNode = msgNode.querySelector<HTMLElement>('.mes_text');
        if (!textNode) return;

        const msg = this._host.getMessageById(messageId);
        const swipeId = msg?.swipe_id ?? 0;
        const doc = textNode.ownerDocument || document;

        // 使用 TreeWalker 收集有效文本与 <br>，严格排除代码块、思维链与已有插槽
        const walker = doc.createTreeWalker(
            textNode,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node: Node) => {
                    const parent = node.parentElement;
                    const parentTag = parent?.tagName || '';

                    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName !== 'BR') {
                        return NodeFilter.FILTER_SKIP;
                    }

                    // 过滤已注入的插槽内部内容
                    if (parent?.classList.contains('da-floor-slot') || parent?.closest('.da-floor-slot')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // 严格过滤代码块相关容器及其祖先
                    if (CODE_RELATED_TAGS.has(parentTag) || parent?.closest('pre, code, textarea, kbd, samp')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // 严格过滤思维链与思考折叠容器及其祖先 (如 details.thinking, .think, .thought)
                    const thinkingAncestor = parent?.closest('details.thinking, .think, .thinking, .thought, .reasoning, .chat-thought, .mind-fold, details[class*="think"]');
                    if (thinkingAncestor) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // 过滤高亮代码块与思维链样式类
                    if (parent?.className && typeof parent.className === 'string') {
                        for (const pattern of CODE_CLASS_PATTERNS) {
                            if (parent.className.includes(pattern)) {
                                return NodeFilter.FILTER_REJECT;
                            }
                        }
                        for (const pattern of THINKING_CLASS_PATTERNS) {
                            if (parent.className.includes(pattern)) {
                                return NodeFilter.FILTER_REJECT;
                            }
                        }
                    }

                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodeInfos: NodeRangeInfo[] = [];
        let logicalText = '';
        let n: Node | null;

        while ((n = walker.nextNode())) {
            const start = logicalText.length;
            let text = '';
            if (n.nodeType === Node.TEXT_NODE) {
                text = n.textContent || '';
            } else if ((n as Element).tagName === 'BR') {
                text = '\n';
            }
            logicalText += text;
            nodeInfos.push({ node: n, start, end: logicalText.length });
        }

        const startTag = this._store.get('placeholderStart') || 'image###';
        const endTag = this._store.get('placeholderEnd') || '###';
        const pattern = new RegExp(`${escapeRegExp(startTag)}([\\s\\S]*?)${escapeRegExp(endTag)}`, 'g');

        interface MatchItem {
            fullMatch: string;
            content: string;
            startIndex: number;
            endIndex: number;
        }

        const matches: MatchItem[] = [];
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(logicalText)) !== null) {
            matches.push({
                fullMatch: match[0],
                content: match[1],
                startIndex: match.index,
                endIndex: match.index + match[0].length
            });
        }

        if (matches.length === 0) {
            this.cleanMessageFloorSlots(messageId);
            return;
        }

        // 逆序遍历匹配项，基于 Range 精确删除占位符并原位插入插槽
        for (let i = matches.length - 1; i >= 0; i--) {
            const matchItem = matches[i];
            const slotIndex = i;
            const contextKey = `${messageId}_${swipeId}_${slotIndex}`;

            // 若已有插槽已挂载且处于 DOM 中，更新提示词并刷新已有图片显示
            const existingSlot = textNode.querySelector<HTMLElement>(`[data-slot-key="${contextKey}"]`);
            if (existingSlot && existingSlot.isConnected) {
                existingSlot.dataset.prompt = matchItem.content.trim();
                existingSlot.dataset.swipeId = String(swipeId);
                existingSlot.dataset.slotIndex = String(slotIndex);
                const ctx = this.getSlotContext(existingSlot);
                if (ctx) {
                    this.restoreExistingImage(ctx);
                }
                continue;
            }

            const nodesToProcess = nodeInfos.filter(
                (info) => matchItem.startIndex < info.end && matchItem.endIndex > info.start
            );
            if (nodesToProcess.length === 0) continue;

            const firstNodeInfo = nodesToProcess[0];
            const lastNodeInfo = nodesToProcess[nodesToProcess.length - 1];

            const range = doc.createRange();
            try {
                const startOffset = matchItem.startIndex - firstNodeInfo.start;
                if (firstNodeInfo.node.nodeType === Node.TEXT_NODE) {
                    const startLen = firstNodeInfo.node.textContent?.length ?? 0;
                    range.setStart(firstNodeInfo.node, Math.min(Math.max(0, startOffset), startLen));
                } else {
                    range.setStartBefore(firstNodeInfo.node);
                }

                const endOffset = matchItem.endIndex - lastNodeInfo.start;
                if (lastNodeInfo.node.nodeType === Node.TEXT_NODE) {
                    const endLen = lastNodeInfo.node.textContent?.length ?? 0;
                    range.setEnd(lastNodeInfo.node, Math.min(Math.max(0, endOffset), endLen));
                } else {
                    range.setEndAfter(lastNodeInfo.node);
                }
            } catch (err) {
                console.warn('[FloorButtonContainer] Range 边界计算异常，跳过此占位符', err);
                continue;
            }

            // 精准删除原占位符内容，不伤害外部段落结构
            range.deleteContents();

            // 构建插槽容器，无状态保存在 dataset 中
            const wrapper = doc.createElement('div');
            wrapper.className = 'da-floor-btn-wrapper da-floor-slot st-da-root';
            wrapper.dataset.slotKey = contextKey;
            wrapper.dataset.slotIndex = String(slotIndex);
            wrapper.dataset.swipeId = String(swipeId);
            wrapper.dataset.prompt = matchItem.content.trim();
            wrapper.dataset.state = 'default';
            wrapper.dataset.daInserted = 'true';

            const imgSlot = doc.createElement('div');
            imgSlot.className = 'da-floor-btn-img-slot';

            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'da-btn da-floor-btn da-floor-btn--default';
            btn.textContent = FloorButtonContainer.BUTTON_LABELS.default;

            wrapper.appendChild(imgSlot);
            wrapper.appendChild(btn);

            // 在原位精准插入
            range.insertNode(wrapper);

            btn.onclick = () => {
                const currentCtx = this.getSlotContext(btn);
                if (!currentCtx) return;

                if ((currentCtx.state === 'progress' || currentCtx.state === 'pending') && currentCtx.currentTaskId) {
                    this._floorTaskService.cancelTask(currentCtx.currentTaskId, '用户在楼层主动中断');
                } else if (currentCtx.state === 'default' || currentCtx.state === 'done' || currentCtx.state === 'error') {
                    void this.triggerGeneration(currentCtx);
                }
            };

            const ctx = this.getSlotContext(wrapper);
            if (ctx) {
                this.restoreExistingImage(ctx);
            }
        }

        // 清理当前消息内多余的废弃旧插槽（例如用户编辑消息删减了部分占位符）
        const currentSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
        currentSlots.forEach((slot) => {
            const idx = parseInt(slot.dataset.slotIndex || '0', 10);
            if (idx >= matches.length) {
                const oldImg = slot.querySelector<HTMLImageElement>('.da-generated-img');
                if (oldImg?.dataset?.ownsBlob === 'true' && oldImg.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(oldImg.src);
                    this._trackedObjectUrls.delete(oldImg.src);
                }
                slot.remove();
            }
        });
    }

    /**
     * 清理单条消息内挂载的楼层生图插槽
     */
    public cleanMessageFloorSlots(messageId: number): void {
        if (typeof document === 'undefined') return;
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (msgNode) {
            msgNode.querySelectorAll<HTMLElement>('.da-floor-slot, .da-floor-root').forEach((el) => {
                const img = el.querySelector<HTMLImageElement>('.da-generated-img');
                if (img?.dataset?.ownsBlob === 'true' && img.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(img.src);
                    this._trackedObjectUrls.delete(img.src);
                }
                el.remove();
            });
        }
    }

    // 4. 图片回溯、三级回退显示与交互反馈

    /**
     * 读取消息持有图片，依服务端静态 URL > Base64 > 本地 IndexedDB 优先级进行三级回退渲染
     */
    private restoreExistingImage(ctx: DynamicSlotContext): void {
        const entry = this._floorTaskService.getImageEntry(ctx.messageId, ctx.swipeId, ctx.slotIndex);

        if (!entry) {
            ctx.wrapper.dataset.assetId = '';
            // 分支无图片记录时清空旧图片并复位按钮
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

        ctx.wrapper.dataset.assetId = entry.uuid || '';

        let src = '';
        // 优先级 1：酒馆服务端静态相对路径
        if (entry.url) {
            src = entry.url;
        } else if (entry.storageStrategy === 'embedded' && entry.base64) {
            // 优先级 2：聊天记录内嵌 Base64
            src = entry.base64;
        } else if (entry.uuid) {
            // 优先级 3：本地 IndexedDB Blob URL 回退
            const swipeId = ctx.swipeId;
            void this._storage.getImageUrl(entry.uuid).then((url) => {
                if (url) {
                    // 防滑动竞态：异步读取完成时校验当前楼层实际活跃分支
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
        ctx: DynamicSlotContext,
        src: string,
        prompt: string,
        negativePrompt?: string
    ): void {
        // 内存防漏保护：在重新生成或覆盖图片前，显式释放该插槽此前可能占用的旧 Blob URL
        const oldImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
        if (oldImg?.dataset?.ownsBlob === 'true' && oldImg.src?.startsWith('blob:')) {
            URL.revokeObjectURL(oldImg.src);
            this._trackedObjectUrls.delete(oldImg.src);
        }

        const settings = this._store.getState();
        const actionCallbacks: ImageActionCallbacks = {
            promptText: prompt,
            negativePrompt,
            messageIndex: ctx.messageId,
            buttonIndex: ctx.slotIndex,
            storage: this._storage,
            onRegenerate: () => {
                const refreshed = this.getSlotContext(ctx.wrapper);
                if (refreshed) void this.triggerGeneration(refreshed);
            },
            onInpaint: () => {
                openInpaintCanvasModal({
                    imageSrc: src,
                    initialPrompt: prompt,
                    onConfirm: (res) => {
                        const refreshed = this.getSlotContext(ctx.wrapper);
                        if (!refreshed) return;
                        refreshed.overridePrompt = res.prompt;
                        refreshed.overrideInpaintData = {
                            initImageBlob: base64ToBlob(res.initImage),
                            maskImageBlob: base64ToBlob(res.maskImage)
                        };
                        void this.triggerGeneration(refreshed);
                    }
                });
            },
            onDelete: async () => {
                ctx.imgSlot.innerHTML = '';
                this.updateButtonState(ctx, 'default');
                const refreshed = this.getSlotContext(ctx.wrapper) || ctx;
                const assetId = refreshed.currentAssetId || undefined;
                refreshed.wrapper.dataset.assetId = '';

                // 级联清理委托给 FloorTaskService
                await this._floorTaskService.deleteImage(
                    refreshed.messageId,
                    refreshed.swipeId,
                    refreshed.slotIndex,
                    assetId
                );
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

    // 5. 任务触发与进度同步

    private async triggerGeneration(ctx: DynamicSlotContext): Promise<void> {
        if (ctx.state === 'progress' || ctx.state === 'loading' || ctx.state === 'pending') return;

        this.updateButtonState(ctx, 'loading');

        try {
            const targetSwipeId = this._host.getMessageById(ctx.messageId)?.swipe_id ?? ctx.swipeId;

            // 业务层处理与提交
            const { taskId, processResult } = await this._floorTaskService.submitTask({
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

            // 监听任务生命周期并同步进度至按钮
            const unsubProgress = this._events.on('task:progress', (ev) => {
                if (ev.taskId === taskId) {
                    this.updateButtonState(ctx, 'progress', ev.progress);
                }
            });

            const unsubCompleted = this._events.on('task:completed', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.wrapper.dataset.taskId = '';
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
                    ctx.wrapper.dataset.taskId = '';
                    this.updateButtonState(ctx, 'error');
                    FeedbackService.toastError(`生图任务失败: ${ev.error}`);
                }
            });

            const unsubCancelled = this._events.on('task:cancelled', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.wrapper.dataset.taskId = '';
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

            // 提交成功后置为排队中状态（若并发度为 1 且前面有任务，按钮清晰反馈排队中；若出队执行将通过 task:progress 切换为 progress）
            this.updateButtonState(ctx, 'pending');
        } catch (err: any) {
            this.updateButtonState(ctx, 'error');
            FeedbackService.toastError(`生图触发异常: ${err?.message || err}`);
        }
    }

    private onImageGenerated(
        ctx: DynamicSlotContext,
        blob: Blob,
        prompt: string,
        negativePrompt?: string
    ): void {
        const blobUrl = URL.createObjectURL(blob);
        this._trackedObjectUrls.add(blobUrl);

        this.mountRenderedImage(ctx, blobUrl, prompt, negativePrompt);
        FeedbackService.toastSuccess('生图完成！');
    }

    private updateButtonState(ctx: DynamicSlotContext, state: ButtonState, progress?: number): void {
        ctx.state = state;
        ctx.wrapper.dataset.state = state;
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

        this.cleanupTrackedUrls();
        this._disposables.dispose();

        if (typeof document !== 'undefined') {
            document.querySelectorAll('.da-floor-slot, .da-floor-root').forEach((el) => el.remove());
        }
    }
}
