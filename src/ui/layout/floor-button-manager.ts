/**
 * 楼层生图控制器 (FloorButtonManager)
 * 职责：
 * 1. 负责消息楼层中占位符插槽的解析、DOM 替换与生图按钮挂载；
 * 2. 结合 IntersectionObserver 实现按需装载与视口外图片释放，控制长会话内存占用；
 * 3. 监听并响应酒馆核心事件（生成结束、分支切换、消息编辑与消息删除）；
 * 4. 在正文段落内通过 Range 替换占位符并挂载插槽；
 * 5. 统一调度任务提交、状态更新与图片删除清理。
 */

import { IDisposable, DisposableStore, CoreEventMap, ChatImagesRoot, ChatImageEntry } from '../../types';
import { TypedEventBus, base64ToBlob } from '../../utils';
import { SettingsStore, StorageService } from '../../state';
import { HostClient } from '../../host';
import { TaskManager } from '../../tasks/task-manager';
import { PromptPipeline, PipelineProcessResult, separatePromptByPipe } from '../../pipeline';
import { normalizePromptPunctuation } from '../../pipeline/prompt-utils';
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

/** 统一判定节点是否处于代码块、思维链或禁止注入的容器内部 */
function isNodeInCodeOrThinking(node: Node): boolean {
    const parent = node.parentElement;
    if (!parent) return false;
    const parentTag = parent.tagName || '';
    if (CODE_RELATED_TAGS.has(parentTag)) return true;
    if (parent.closest('pre, code, textarea, kbd, samp')) return true;
    if (parent.closest('details.thinking, .think, .thinking, .thought, .reasoning, .chat-thought, .mind-fold, details[class*="think"]')) return true;

    const parentClass = parent.className;
    if (typeof parentClass === 'string') {
        if (CODE_CLASS_PATTERNS.some((p) => parentClass.includes(p))) return true;
        if (THINKING_CLASS_PATTERNS.some((p) => parentClass.includes(p))) return true;
    }
    return false;
}

interface NodeRangeInfo {
    node: Node;
    start: number;
    end: number;
}

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

export type FloorButtonState = 'default' | 'loading' | 'pending' | 'progress' | 'done' | 'error';

/** 运行时从 DOM 动态解析的无状态插槽上下文 */
export interface DynamicSlotContext {
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
    state: FloorButtonState;
}

export class FloorButtonManager implements IDisposable {
    private readonly _host: HostClient;
    private readonly _events: TypedEventBus<CoreEventMap>;
    private readonly _store: SettingsStore;
    private readonly _taskManager: TaskManager;
    private readonly _pipeline: PromptPipeline;
    private readonly _storage: StorageService;
    private readonly _disposables = new DisposableStore();
    private readonly _trackedObjectUrls = new Set<string>();
    private readonly _activeTaskUnbinds = new Map<string, () => void>();

    private _intersectionObserver: IntersectionObserver | null = null;
    private _isHostGenerating = false;
    private _isDisposed = false;

    /** 批处理扫描去重队列 */
    private readonly _pendingScanMessageIds = new Set<number>();
    private _scanScheduled = false;

    private static readonly BUTTON_LABELS: Record<FloorButtonState, string> = {
        default: '生成图像',
        loading: '提交中...',
        pending: '排队中 (点击取消)',
        progress: '生成中 (点击取消)',
        done: '重新生成',
        error: '重试'
    };

    constructor(options: FloorButtonManagerOptions) {
        this._host = options.host;
        this._events = options.events;
        this._store = options.store;
        this._taskManager = options.taskManager;
        this._pipeline = options.pipeline;
        this._storage = options.storage;

        this.initIntersectionObserver();
        this.initHostEventListeners();

        // 资产持久化完成后更新对应插槽的 assetId，供后续视口滚动与状态比对复用
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

    // 1. 生命周期与宿主事件监听

    private initHostEventListeners(): void {
        // 角色消息渲染：若正在流式生成最新消息，暂缓替换以避让流式重排
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

        // 历史消息翻页向上滚动加载（原生对齐酒馆 MORE_MESSAGES_LOADED）
        this._disposables.add(
            this._host.onMoreMessagesLoaded(() => {
                void this.scanAllMessages();
            })
        );

        // 会话加载完成（原生对齐酒馆 CHAT_LOADED）
        this._disposables.add(
            this._host.onChatLoaded(() => {
                void this.scanAllMessages();
            })
        );

        // 流式生成开始：标记生成中状态
        this._disposables.add(
            this._host.onGenerationStarted(() => {
                this._isHostGenerating = true;
            })
        );

        // 生成结束（流式定稿或非流式完成）：重置状态并全量扫描最新消息；若开启 autoGenerate 则调度末尾消息生图
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

        // 消息分支切换：重新挂载插槽骨架并按需同步分支图片
        this._disposables.add(
            this._host.onChatSwiped((ev) => {
                if (ev.messageId !== undefined) {
                    this.scheduleScanMessage(ev.messageId);
                }
            })
        );

        // 消息编辑修改：重新扫描并对齐提示词与插槽数量
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

        // 消息删除：酒馆在删楼后重新重编剩余消息 mesid，并传入新 chat.length
        this._disposables.add(
            this._host.onMessageDeleted((ev) => {
                this.handleMessageDeleted(ev.newChatLength ?? ev.messageId ?? 0);
            })
        );

        // 会话切换：重置所有观察器并释放当前会话已创建的 Object URL
        this._disposables.add(
            this._host.onChatChanged(() => {
                this.cleanupTrackedUrls();
                this._isHostGenerating = false;
                void this.scanAllMessages();
            })
        );
    }

    /**
     * 判断指定楼层是否为当前会话最新的末尾消息
     */
    private isLatestMessage(messageId: number): boolean {
        const chat = this._host.getChat();
        if (!chat || chat.length === 0) return false;
        return messageId >= chat.length - 1;
    }

    /**
     * 批处理扫描队列：在下一渲染帧合并执行，减少多次连续事件带来的布局重排
     */
    private scheduleScanMessage(messageId: number): void {
        this._pendingScanMessageIds.add(messageId);
        if (!this._scanScheduled) {
            this._scanScheduled = true;
            requestAnimationFrame(() => {
                this._scanScheduled = false;
                const ids = Array.from(this._pendingScanMessageIds);
                this._pendingScanMessageIds.clear();
                for (const id of ids) {
                    void this.scanAndInjectMessage(id);
                }
            });
        }
    }

    /**
     * 处理楼层删除：取消越界在途任务并清理脱离文档的插槽资源
     */
    private handleMessageDeleted(newChatLength: number): void {
        // 1. 取消越界消息的在途生图任务（消息已被删除，无法再回填）
        for (const [taskId] of this._activeTaskUnbinds.entries()) {
            const task = this._taskManager.getTask(taskId);
            const msgId = task?.request?.contextInfo?.messageId;
            if (typeof msgId === 'number' && msgId >= newChatLength) {
                this.cancelTask(taskId, '消息已从宿主中删除');
            }
        }

        // 2. 清理已被宿主从 DOM 移除的孤立插槽或超出有效消息范围的插槽
        const slots = document.querySelectorAll<HTMLElement>('.da-floor-slot');
        slots.forEach((slot) => {
            const ctx = this.getSlotContext(slot);
            if (!ctx || ctx.messageId >= newChatLength) {
                if (ctx?.currentTaskId) {
                    this.cancelTask(ctx.currentTaskId, '消息已从宿主中删除');
                }
                this.unobserveSlot(slot);
                if (ctx) {
                    this.clearSlotImage(ctx);
                }
                slot.remove();
            }
        });
    }

    // 2. 视口按需加载 (IntersectionObserver 惰性装载与离屏释放)

    private initIntersectionObserver(): void {
        if (!('IntersectionObserver' in window)) {
            return;
        }

        // 预设 300px 缓冲边距，使用户平滑滚动时无感提前完成解码装载
        this._intersectionObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const target = entry.target as HTMLElement;
                    if (entry.isIntersecting) {
                        this.hydrateSlotImage(target);
                    } else {
                        this.dehydrateSlotImage(target);
                    }
                }
            },
            { root: null, rootMargin: '300px 0px 300px 0px', threshold: 0 }
        );
    }

    private observeSlot(slot: HTMLElement): void {
        if (this._intersectionObserver) {
            this._intersectionObserver.observe(slot);
        } else {
            // 环境未提供 IntersectionObserver 时降级为立即装载
            this.hydrateSlotImage(slot);
        }
    }

    private unobserveSlot(slot: HTMLElement): void {
        if (this._intersectionObserver) {
            this._intersectionObserver.unobserve(slot);
        }
    }

    /**
     * 清理插槽已挂载的图像资源：
     * 1. 释放 StorageService.urlPool 中的引用计数；
     * 2. 撤销本地创建的临时 Blob Object URL 并从跟踪集合清除；
     * 3. 清空插槽 DOM 容器。
     * @param keepAssetId 若为 true 则保留 wrapper 上的 assetId 标记（用于出图时的原子平滑更新）
     */
    private clearSlotImage(ctx: DynamicSlotContext, keepAssetId = false): void {
        if (ctx.currentAssetId && !keepAssetId) {
            this._storage.releaseImageUrl(ctx.currentAssetId);
            ctx.wrapper.dataset.assetId = '';
            ctx.currentAssetId = null;
        }
        const img = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
        if (img?.src?.startsWith('blob:') || img?.dataset?.ownsBlob === 'true') {
            try {
                URL.revokeObjectURL(img.src);
            } catch {}
            this._trackedObjectUrls.delete(img.src);
        }
        ctx.imgSlot.innerHTML = '';
    }

    /**
     * 视口装载：当插槽进入可见区域时，按需获取图片资源并挂载
     */
    public hydrateSlotImage(slot: HTMLElement): void {
        if (this._isDisposed) return;
        const ctx = this.getSlotContext(slot);
        if (!ctx) return;

        // 1. 任务执行中（loading / pending / progress）跳过重置，保留当前状态
        if (ctx.state === 'loading' || ctx.state === 'pending' || ctx.state === 'progress') {
            return;
        }

        const entry = this.getImageEntry(ctx.messageId, ctx.swipeId, ctx.slotIndex);
        const existingImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');

        // 2. 若已出图且处于完成态，但元数据记录仍在异步持久化排队中，保留当前预览图
        if (!entry) {
            if (ctx.state === 'done' && existingImg && existingImg.src) {
                return;
            }
            this.clearSlotImage(ctx, false);
            if (ctx.state === 'done') {
                this.updateButtonState(ctx, 'default');
                ctx.btn.style.display = 'inline-flex';
            }
            return;
        }

        const targetAssetId = entry.uuid || entry.url || '';
        // 3. 检查当前已渲染图片与资产 ID 是否匹配，匹配时跳过重复挂载
        if (existingImg && existingImg.src && (ctx.wrapper.dataset.assetId === targetAssetId || ctx.currentAssetId === targetAssetId)) {
            return;
        }

        ctx.wrapper.dataset.assetId = targetAssetId;
        ctx.currentAssetId = targetAssetId;

        if (entry.url) {
            this.mountRenderedImage(ctx, entry.url, entry.prompt, entry.negativePrompt, targetAssetId);
        } else if (entry.storageStrategy === 'embedded' && entry.base64) {
            this.mountRenderedImage(ctx, entry.base64, entry.prompt, entry.negativePrompt, targetAssetId);
        } else if (entry.uuid) {
            const swipeId = ctx.swipeId;
            void this._storage.getImageUrl(entry.uuid).then((url) => {
                if (!url || this._isDisposed) return;
                const currentMsg = this._host.getMessageById(ctx.messageId);
                if (currentMsg && (currentMsg.swipe_id ?? 0) !== swipeId) {
                    this._storage.releaseImageUrl(entry.uuid);
                    return;
                }
                this._trackedObjectUrls.add(url);
                this.mountRenderedImage(ctx, url, entry.prompt, entry.negativePrompt, targetAssetId);
            });
        }
    }

    /**
     * 离屏释放：当插槽滑出视口远端时，安全释放临时 Object URL 与引用计数，保留占位高度防跳变
     */
    public dehydrateSlotImage(slot: HTMLElement): void {
        if (this._isDisposed) return;
        const ctx = this.getSlotContext(slot);
        if (!ctx) return;

        // 生成中在途插槽禁止离屏释放
        if (ctx.state === 'loading' || ctx.state === 'pending' || ctx.state === 'progress') {
            return;
        }

        const currentHeight = ctx.imgSlot.offsetHeight;
        if (currentHeight > 0) {
            ctx.imgSlot.style.minHeight = `${currentHeight}px`;
        }
        this.clearSlotImage(ctx, false);
    }

    // 3. 插槽 DOM 寻址与构造

    public getSlotContext(target: HTMLElement): DynamicSlotContext | null {
        const wrapper = target.closest<HTMLElement>('.da-floor-slot');
        if (!wrapper) return null;

        const mesNode = wrapper.closest<HTMLElement>('.mes[mesid]');
        const rawMesId = mesNode?.getAttribute('mesid');
        const messageId = rawMesId !== null && rawMesId !== undefined ? parseInt(rawMesId, 10) : NaN;
        if (isNaN(messageId)) return null;

        const slotIndex = parseInt(wrapper.dataset.slotIndex || '0', 10);
        // 优先从宿主当前消息模型获取实时 swipe_id，避免 DOM dataset 滞后
        const msg = this._host.getMessageById(messageId);
        const swipeId = msg?.swipe_id ?? parseInt(wrapper.dataset.swipeId || '0', 10);
        wrapper.dataset.swipeId = String(swipeId);

        const promptRaw = wrapper.dataset.prompt || '';
        const { positive, negative } = separatePromptByPipe(promptRaw);

        const btn = wrapper.querySelector<HTMLButtonElement>('.da-floor-btn');
        const imgSlot = wrapper.querySelector<HTMLElement>('.da-floor-btn-img-slot');
        if (!btn || !imgSlot) return null;

        const state = (wrapper.dataset.state as FloorButtonState) || 'default';
        const currentTaskId = wrapper.dataset.taskId || null;
        const currentAssetId = wrapper.dataset.assetId || null;

        return {
            wrapper,
            btn,
            imgSlot,
            messageId,
            swipeId,
            slotIndex,
            promptText: positive.trim(),
            rawNegativePrompt: negative?.trim() || undefined,
            overridePrompt: wrapper.dataset.overridePrompt || undefined,
            overrideNegativePrompt: wrapper.dataset.overrideNegativePrompt || undefined,
            currentTaskId,
            currentAssetId,
            state
        };
    }

    /**
     * 构造具备严格事件隔离与标准样式的插槽 DOM 节点
     */
    private createSlotElement(
        doc: Document,
        messageId: number,
        slotIndex: number,
        swipeId: number,
        prompt: string
    ): HTMLElement {
        const wrapper = doc.createElement('div');
        wrapper.className = 'da-floor-btn-wrapper da-floor-slot st-da-root';
        wrapper.dataset.slotKey = `${messageId}_${swipeId}_${slotIndex}`;
        wrapper.dataset.slotIndex = String(slotIndex);
        wrapper.dataset.swipeId = String(swipeId);
        wrapper.dataset.prompt = prompt;
        wrapper.dataset.state = 'default';
        wrapper.dataset.daInserted = 'true';

        const imgSlot = doc.createElement('div');
        imgSlot.className = 'da-floor-btn-img-slot';

        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'da-btn da-floor-btn da-floor-btn--default';
        btn.textContent = FloorButtonManager.BUTTON_LABELS.default;

        wrapper.appendChild(imgSlot);
        wrapper.appendChild(btn);

        // 阻止事件冒泡与默认行为，避免触发宿主楼层外层的点击与手势处理
        btn.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const currentCtx = this.getSlotContext(btn);
            if (!currentCtx) return;

            if ((currentCtx.state === 'progress' || currentCtx.state === 'pending') && currentCtx.currentTaskId) {
                this.cancelTask(currentCtx.currentTaskId, '用户在楼层主动中断');
            } else if (currentCtx.state === 'default' || currentCtx.state === 'done' || currentCtx.state === 'error') {
                void this.triggerGeneration(currentCtx);
            }
        };

        return wrapper;
    }

    // 4. 双通道扫描（正则占位符 + extra 历史出图回溯）

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
     * 扫描单条消息并在段落中间精准原位替换占位符，或根据 extra 历史出图数据恢复插槽
     */
    public async scanAndInjectMessage(messageId: number): Promise<void> {
        if (this._isDisposed) return;

        try {
            const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
            if (!msgNode) return;

            const textNode = msgNode.querySelector<HTMLElement>('.mes_text');
            if (!textNode) return;

            // 1. 在途任务保护：若当前楼层存在正在生成的插槽，严禁打断或重建
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
            const textContent = textNode.textContent || '';
            const hasPlaceholder = textContent.includes(startTag);

            // 获取宿主 extra 中的历史图片记录
            const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
            const swipeImages = daImages ? daImages[swipeId] : undefined;
            const hasHistory = Boolean(swipeImages && Object.keys(swipeImages).length > 0);
            const existingSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));

            // 步骤 1：检查已有插槽（DOM 中已有插槽且无待消费占位符）
            if (existingSlots.length > 0 && !hasPlaceholder) {
                for (const slot of existingSlots) {
                    const idx = parseInt(slot.dataset.slotIndex || '0', 10);
                    slot.dataset.slotKey = `${messageId}_${swipeId}_${idx}`;
                    slot.dataset.swipeId = String(swipeId);
                    this.hydrateSlotImage(slot);
                    this.observeSlot(slot);
                }
                textNode.dataset.daProcessed = 'true';
                textNode.dataset.daContentLength = String(textContent.length);
                return;
            }

            // 步骤 2：跳过无关消息（正文中无占位符且无出图记录）
            if (!hasPlaceholder && !hasHistory) {
                if (existingSlots.length > 0) {
                    this.cleanMessageFloorSlots(messageId);
                }
                textNode.dataset.daProcessed = 'true';
                textNode.dataset.daContentLength = String(textContent.length);
                return;
            }

            // 步骤 3：解析占位符并使用 Range 替换为按钮插槽
            if (hasPlaceholder) {
                const walker = doc.createTreeWalker(
                    textNode,
                    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
                    {
                        acceptNode: (node: Node) => {
                            if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName !== 'BR') {
                                return NodeFilter.FILTER_SKIP;
                            }
                            if (node.parentElement?.closest('.da-floor-slot, .st-da-root') || isNodeInCodeOrThinking(node)) {
                                return NodeFilter.FILTER_REJECT;
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

                if (matches.length > 0) {
                    // 逆序遍历匹配项，基于 Range 精准原位替换（保证索引不因前序插入而偏移）
                    for (let i = matches.length - 1; i >= 0; i--) {
                        const matchItem = matches[i];
                        const slotIndex = i;

                        // 基于 slotIndex 寻址，避免分支切换生成重复插槽
                        const existingSlot = textNode.querySelector<HTMLElement>(`.da-floor-slot[data-slot-index="${slotIndex}"]`);
                        if (existingSlot && existingSlot.isConnected) {
                            existingSlot.dataset.slotKey = `${messageId}_${swipeId}_${slotIndex}`;
                            existingSlot.dataset.prompt = matchItem.content.trim();
                            existingSlot.dataset.swipeId = String(swipeId);
                            this.hydrateSlotImage(existingSlot);
                            this.observeSlot(existingSlot);
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
                            console.warn('[FloorButtonManager] Range 边界计算异常，跳过此占位符', err);
                            continue;
                        }

                        range.deleteContents();
                        const wrapper = this.createSlotElement(doc, messageId, slotIndex, swipeId, matchItem.content.trim());
                        range.insertNode(wrapper);

                        this.hydrateSlotImage(wrapper);
                        this.observeSlot(wrapper);
                    }

                    this.cleanStaleSlots(textNode, (idx) => idx < matches.length || Boolean(swipeImages?.[idx]));
                    textNode.dataset.daProcessed = 'true';
                    textNode.dataset.daContentLength = String(textNode.textContent?.length || 0);
                    return;
                }
            }

            // 步骤 4：恢复历史出图记录（无占位符时在消息末尾展示历史插槽）
            if (hasHistory && existingSlots.length === 0) {
                const slotIndices = Object.keys(swipeImages!).map(Number).sort((a, b) => a - b);
                for (const slotIndex of slotIndices) {
                    const prompt = swipeImages![slotIndex]?.prompt || '';
                    const wrapper = this.createSlotElement(doc, messageId, slotIndex, swipeId, prompt);
                    textNode.appendChild(wrapper);
                    this.hydrateSlotImage(wrapper);
                    this.observeSlot(wrapper);
                }
                textNode.dataset.daProcessed = 'true';
                textNode.dataset.daContentLength = String(textNode.textContent?.length || 0);
                return;
            }
        } catch (err) {
            console.warn(`[FloorButtonManager] 扫描楼层 #${messageId} 失败，捕获异常以避免影响其他楼层`, err);
        }
    }

    /**
     * 清理超出有效索引范围的过期插槽，释放其视口观察器与引用的临时资源
     */
    private cleanStaleSlots(textNode: HTMLElement, isValidSlot: (idx: number) => boolean): void {
        const currentSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
        for (const slot of currentSlots) {
            const idx = parseInt(slot.dataset.slotIndex || '0', 10);
            if (!isValidSlot(idx)) {
                this.unobserveSlot(slot);
                const ctx = this.getSlotContext(slot);
                if (ctx) {
                    this.clearSlotImage(ctx, false);
                }
                slot.remove();
            }
        }
    }

    public cleanMessageFloorSlots(messageId: number): void {
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        const textNode = msgNode?.querySelector<HTMLElement>('.mes_text');
        if (textNode) {
            this.cleanStaleSlots(textNode, () => false);
            delete textNode.dataset.daProcessed;
            delete textNode.dataset.daContentLength;
        }
    }

    // 4. 图片回溯与出图渲染

    public getImageEntry(messageId: number, swipeId: number, slotIndex: number): ChatImageEntry | undefined {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
        return daImages ? daImages[swipeId]?.[slotIndex] : undefined;
    }

    private mountRenderedImage(
        ctx: DynamicSlotContext,
        src: string,
        prompt: string,
        negativePrompt?: string,
        assetId?: string
    ): void {
        this.clearSlotImage(ctx, true);

        // 在容器中记录当前资产 ID，用于视口滚动时的缓存匹配与去重
        if (assetId) {
            ctx.wrapper.dataset.assetId = assetId;
            ctx.currentAssetId = assetId;
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
                const refreshed = this.getSlotContext(ctx.wrapper) || ctx;
                const assetIdToDelete = refreshed.currentAssetId || undefined;
                this.clearSlotImage(refreshed, false);
                this.updateButtonState(refreshed, 'default');

                await this.deleteImage(
                    refreshed.messageId,
                    refreshed.swipeId,
                    refreshed.slotIndex,
                    assetIdToDelete
                );
            }
        };

        ctx.imgSlot.style.minHeight = '';
        renderImageToMessage(ctx.imgSlot, src, settings, actionCallbacks);
        const mountedImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
        if (mountedImg && src.startsWith('blob:')) {
            mountedImg.dataset.ownsBlob = 'true';
        }
        this.updateButtonState(ctx, 'done');

        if (settings.hideButtonOnDone) {
            ctx.btn.style.display = 'none';
        } else {
            ctx.btn.style.display = 'inline-flex';
        }
    }

    // 5. 任务调度与资产级联清理

    /**
     * 提交楼层生图任务
     * 前置统一清洗全角中文标点，调用 PromptPipeline 生成标准化请求并提交至 TaskManager。
     */
    public async submitTask(options: FloorTaskSubmitOptions): Promise<SubmitFloorTaskResult> {
        if (this._isDisposed) {
            throw new Error('FloorButtonManager has been disposed');
        }

        const settings = this._store.getState();
        const activeProvider = settings.activeProvider || 'comfyui';
        const engineConfig = this._store.getEngineConfig(activeProvider) || {};

        const rawPositive = options.overridePrompt || options.prompt;
        const rawNegative = options.overrideNegativePrompt || options.negativePrompt;

        // 统一前置清洗全角中文标点（，；：（）等），避免影响后续分词与模型提示词解析
        const promptToUse = normalizePromptPunctuation(rawPositive);
        const negativeToUse = rawNegative ? normalizePromptPunctuation(rawNegative) : undefined;

        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const imageInputs = options.overrideInpaintData ? {
            initImageBlob: options.overrideInpaintData.initImageBlob,
            maskImageBlob: options.overrideInpaintData.maskImageBlob
        } : undefined;

        // 流水线处理
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

        // 提交至任务管理器
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

        this.updateButtonState(ctx, 'loading');

        try {
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
                    this.updateButtonState(ctx, 'progress');
                }
            });

            const unsubCompleted = this._events.on('task:completed', (ev) => {
                if (ev.taskId === taskId) {
                    cleanupTask();
                    ctx.wrapper.dataset.taskId = '';
                    const firstImage = ev.result.images[0];
                    if (firstImage) {
                        const refreshed = this.getSlotContext(ctx.wrapper);
                        if (!refreshed || !ctx.wrapper.isConnected) {
                            return;
                        }
                        const currentSwipeId = this._host.getMessageById(refreshed.messageId)?.swipe_id ?? 0;
                        if (currentSwipeId === targetSwipeId) {
                            this.onImageGenerated(refreshed, firstImage.blob, processResult.prompt, processResult.request.negativePrompt);
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
            this.updateButtonState(ctx, 'pending');
        } catch (err: any) {
            this.updateButtonState(ctx, 'error');
            FeedbackService.toastError(`生图触发异常: ${err?.message || err}`);
        }
    }

    public cancelTask(taskId: string, reason = '用户在楼层主动中断'): void {
        if (this._isDisposed || !taskId) return;
        this._taskManager.cancelTask(taskId, reason);
    }

    /**
     * 删除指定楼层的图片资产：
     * 1. 清理宿主消息 extra 中的 da_images[swipeId][slotIndex]；
     * 2. 若配置了服务端保存且存在静态 URL，从服务端磁盘删除；
     * 3. 若存在本地 IndexedDB 记录，释放 Object URL 并从数据库删除。
     */
    public async deleteImage(
        messageId: number,
        swipeId: number,
        slotIndex: number,
        assetId?: string
    ): Promise<void> {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
        const entry = daImages ? daImages[swipeId]?.[slotIndex] : undefined;
        const uuidToDelete = assetId || entry?.uuid;

        // 1. 宿主消息 extra 元数据清理
        if (daImages && entry) {
            delete daImages[swipeId][slotIndex];
            if (Object.keys(daImages[swipeId]).length === 0) {
                delete daImages[swipeId];
            }
            this._host.writeChatMessageExtra(messageId, 'da_images', daImages);
        }

        // 2. 删除已上传至服务端的静态文件
        if (entry?.url) {
            try {
                await this._host.deleteImageFromServer(entry.url);
            } catch (err) {
                console.warn('[FloorButtonManager] 删除服务端静态文件异常:', err);
            }
        }

        // 3. 释放临时 URL 并从本地数据库删除记录
        if (uuidToDelete) {
            this._storage.releaseImageUrl(uuidToDelete);
            try {
                await this._storage.delete(uuidToDelete);
            } catch (err) {
                console.warn('[FloorButtonManager] 删除本地 IndexedDB 记录异常:', err);
            }
        }
    }

    private onImageGenerated(
        ctx: DynamicSlotContext,
        blob: Blob,
        prompt: string,
        negativePrompt?: string,
        assetId?: string
    ): void {
        const blobUrl = URL.createObjectURL(blob);
        this._trackedObjectUrls.add(blobUrl);

        this.mountRenderedImage(ctx, blobUrl, prompt, negativePrompt, assetId);
        FeedbackService.toastSuccess('生图完成！');
    }

    private updateButtonState(ctx: DynamicSlotContext, state: FloorButtonState): void {
        ctx.state = state;
        ctx.wrapper.dataset.state = state;
        ctx.btn.className = `da-btn da-floor-btn da-floor-btn--${state}`;
        ctx.btn.textContent = FloorButtonManager.BUTTON_LABELS[state] || '生成图像';
        // 仅在 loading (网络请求提交握手瞬间) 短暂防重入；pending 与 progress 时保持可点击，以便响应点击取消
        ctx.btn.disabled = state === 'loading';
        if (state === 'pending' || state === 'progress') {
            ctx.btn.title = '正在生成中，点击可取消任务';
        } else {
            ctx.btn.removeAttribute('title');
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

        this._pendingScanMessageIds.clear();
        this._scanScheduled = false;

        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
            this._intersectionObserver = null;
        }

        this._activeTaskUnbinds.forEach((unbind) => unbind());
        this._activeTaskUnbinds.clear();

        this.cleanupTrackedUrls();
        this._disposables.dispose();

        document.querySelectorAll('.da-floor-slot').forEach((el) => el.remove());
    }
}
