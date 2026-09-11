/**
 * 楼层生图控制器与业务管理中枢 (FloorButtonManager)
 * 职责：
 * 1. 聚合 DOM 原位插槽表现层与楼层生图业务流水线；
 * 2. 结合 IntersectionObserver 实现视口按需装载与离屏内存释放，控制长会话内存占用；
 * 3. 对齐宿主生命周期事件（流式输出避让、定稿扫描、分支切换、消息编辑与消息删除）；
 * 4. 采用正文段落内 Range 逆序原位替换与双态幂等保护；
 * 5. 统一调度任务提交、状态机维护与四重级联删除。
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
        void this.scanAllMessages();
    }

    // 1. 生命周期与宿主事件监听

    private initHostEventListeners(): void {
        // 角色消息渲染：若正在流式生成最新消息，暂缓原位替换以避让流式重排
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

        // 流式生成开始：标记生成中状态
        this._disposables.add(
            this._host.onGenerationStarted(() => {
                this._isHostGenerating = true;
            })
        );

        // 流式生成定稿：重置状态并全量扫描最新消息与调度自动生图
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

        // 消息删除：取消关联任务并释放对应资源的临时引用
        this._disposables.add(
            this._host.onMessageDeleted((ev) => {
                if (ev.messageId !== undefined) {
                    this.handleMessageDeleted(ev.messageId);
                }
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
            const scheduleFn = typeof requestAnimationFrame !== 'undefined'
                ? requestAnimationFrame
                : (cb: () => void) => setTimeout(cb, 16);

            scheduleFn(() => {
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
     * 处理楼层删除：取消未完结任务并释放该楼层已分配的图片资源
     */
    private handleMessageDeleted(messageId: number): void {
        if (typeof document === 'undefined') return;
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (!msgNode) return;

        const slots = msgNode.querySelectorAll<HTMLElement>('.da-floor-slot');
        slots.forEach((slot) => {
            const taskId = slot.dataset.taskId;
            if (taskId) {
                this.cancelTask(taskId, '消息已从宿主中删除');
            }
            this.unobserveSlot(slot);
            const img = slot.querySelector<HTMLImageElement>('.da-generated-img');
            if (img?.dataset?.ownsBlob === 'true' && img.src?.startsWith('blob:')) {
                URL.revokeObjectURL(img.src);
                this._trackedObjectUrls.delete(img.src);
            }
        });
    }

    // 2. 视口按需加载 (IntersectionObserver 惰性装载与离屏释放)

    private initIntersectionObserver(): void {
        if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
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
     * 视口装载：当插槽进入可见区域时，按需从本地 IndexedDB 读取 Blob 并创建 Object URL
     */
    public hydrateSlotImage(slot: HTMLElement): void {
        if (this._isDisposed) return;
        const ctx = this.getSlotContext(slot);
        if (!ctx) return;

        const existingImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
        if (existingImg && existingImg.src) {
            return;
        }

        const entry = this.getImageEntry(ctx.messageId, ctx.swipeId, ctx.slotIndex);
        if (!entry) {
            ctx.wrapper.dataset.assetId = '';
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

        if (entry.url) {
            this.mountRenderedImage(ctx, entry.url, entry.prompt, entry.negativePrompt);
        } else if (entry.storageStrategy === 'embedded' && entry.base64) {
            this.mountRenderedImage(ctx, entry.base64, entry.prompt, entry.negativePrompt);
        } else if (entry.uuid) {
            const swipeId = ctx.swipeId;
            void this._storage.getImageUrl(entry.uuid).then((url) => {
                if (!url || this._isDisposed) return;
                const currentMsg = this._host.getMessageById(ctx.messageId);
                if (currentMsg && (currentMsg.swipe_id ?? 0) !== swipeId) {
                    return;
                }
                this._trackedObjectUrls.add(url);
                this.mountRenderedImage(ctx, url, entry.prompt, entry.negativePrompt);
            });
        }
    }

    /**
     * 离屏释放：当插槽滑出视口远端时，安全释放临时 Object URL 以控制显存开销，并保留占位高度
     */
    public dehydrateSlotImage(slot: HTMLElement): void {
        if (this._isDisposed) return;
        const img = slot.querySelector<HTMLImageElement>('.da-generated-img');
        if (!img) return;

        // 仅对持有本地 Blob Object URL 的图片进行内存释放，远端 HTTP 缓存保留
        if (img.src?.startsWith('blob:') || img.dataset?.ownsBlob === 'true') {
            URL.revokeObjectURL(img.src);
            this._trackedObjectUrls.delete(img.src);

            const imgSlot = slot.querySelector<HTMLElement>('.da-floor-btn-img-slot');
            if (imgSlot) {
                const currentHeight = imgSlot.offsetHeight;
                if (currentHeight > 0) {
                    imgSlot.style.minHeight = `${currentHeight}px`;
                }
                imgSlot.innerHTML = '';
            }
        }
    }

    // 3. 动态无状态 DOM 寻址

    public getSlotContext(target: HTMLElement): DynamicSlotContext | null {
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
            promptText: normalizePromptPunctuation(positive),
            rawNegativePrompt: negative ? normalizePromptPunctuation(negative) : undefined,
            overridePrompt: wrapper.dataset.overridePrompt || undefined,
            overrideNegativePrompt: wrapper.dataset.overrideNegativePrompt || undefined,
            currentTaskId,
            currentAssetId,
            state
        };
    }

    // 3. 段落中间原位替换与双态幂等扫描

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
     * 扫描单条消息并在段落中间精准原位替换占位符
     * 具备严格的双态幂等保护，彻底解决二次扫描误杀旧插槽的问题
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

        // 使用 TreeWalker 收集有效文本与 <br>，排除代码块、思维链与已注入插槽
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

                    // 过滤代码块
                    if (CODE_RELATED_TAGS.has(parentTag) || parent?.closest('pre, code, textarea, kbd, samp')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // 过滤思维链容器
                    const thinkingAncestor = parent?.closest('details.thinking, .think, .thinking, .thought, .reasoning, .chat-thought, .mind-fold, details[class*="think"]');
                    if (thinkingAncestor) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    if (parent?.className && typeof parent.className === 'string') {
                        for (const pattern of CODE_CLASS_PATTERNS) {
                            if (parent.className.includes(pattern)) return NodeFilter.FILTER_REJECT;
                        }
                        for (const pattern of THINKING_CLASS_PATTERNS) {
                            if (parent.className.includes(pattern)) return NodeFilter.FILTER_REJECT;
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

        // 双态幂等保护核心：
        // 若当前未匹配到文本占位符，检查是否已经原位挂载过插槽
        if (matches.length === 0) {
            const existingSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
            if (existingSlots.length > 0) {
                // 已原位挂载过插槽，说明该楼层已处于挂载状态，仅同步分支并注册视口观察
                for (const slot of existingSlots) {
                    slot.dataset.swipeId = String(swipeId);
                    this.observeSlot(slot);
                }
                return;
            }

            // 既无占位符也无插槽，确认该楼层无插槽
            this.cleanMessageFloorSlots(messageId);
            return;
        }

        // 逆序遍历匹配项，基于 Range 精准原位替换
        for (let i = matches.length - 1; i >= 0; i--) {
            const matchItem = matches[i];
            const slotIndex = i;
            const contextKey = `${messageId}_${swipeId}_${slotIndex}`;

            const existingSlot = textNode.querySelector<HTMLElement>(`[data-slot-key="${contextKey}"]`);
            if (existingSlot && existingSlot.isConnected) {
                existingSlot.dataset.prompt = matchItem.content.trim();
                existingSlot.dataset.swipeId = String(swipeId);
                existingSlot.dataset.slotIndex = String(slotIndex);
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

            // 原位删除文本标记
            range.deleteContents();

            // 构建原位段落插槽容器
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
            btn.textContent = FloorButtonManager.BUTTON_LABELS.default;

            wrapper.appendChild(imgSlot);
            wrapper.appendChild(btn);

            // 段落中间就地原位嵌入
            range.insertNode(wrapper);

            btn.onclick = () => {
                const currentCtx = this.getSlotContext(btn);
                if (!currentCtx) return;

                if ((currentCtx.state === 'progress' || currentCtx.state === 'pending') && currentCtx.currentTaskId) {
                    this.cancelTask(currentCtx.currentTaskId, '用户在楼层主动中断');
                } else if (currentCtx.state === 'default' || currentCtx.state === 'done' || currentCtx.state === 'error') {
                    void this.triggerGeneration(currentCtx);
                }
            };

            // 注册到视口按需装载观察器
            this.observeSlot(wrapper);
        }

        // 清理超出匹配数量的旧插槽（如编辑后删减占位符）
        const currentSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
        currentSlots.forEach((slot) => {
            const idx = parseInt(slot.dataset.slotIndex || '0', 10);
            if (idx >= matches.length) {
                this.unobserveSlot(slot);
                const oldImg = slot.querySelector<HTMLImageElement>('.da-generated-img');
                if (oldImg?.dataset?.ownsBlob === 'true' && oldImg.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(oldImg.src);
                    this._trackedObjectUrls.delete(oldImg.src);
                }
                slot.remove();
            }
        });
    }

    public cleanMessageFloorSlots(messageId: number): void {
        if (typeof document === 'undefined') return;
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (msgNode) {
            msgNode.querySelectorAll<HTMLElement>('.da-floor-slot').forEach((el) => {
                this.unobserveSlot(el);
                const img = el.querySelector<HTMLImageElement>('.da-generated-img');
                if (img?.dataset?.ownsBlob === 'true' && img.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(img.src);
                    this._trackedObjectUrls.delete(img.src);
                }
                el.remove();
            });
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
        negativePrompt?: string
    ): void {
        const oldImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
        if (oldImg?.src?.startsWith('blob:')) {
            try {
                URL.revokeObjectURL(oldImg.src);
            } catch {}
            this._trackedObjectUrls.delete(oldImg.src);
        }
        if (ctx.currentAssetId) {
            this._storage.releaseImageUrl(ctx.currentAssetId);
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

                await this.deleteImage(
                    refreshed.messageId,
                    refreshed.swipeId,
                    refreshed.slotIndex,
                    assetId
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

    // 5. 生图任务调度与状态机闭环

    /**
     * 提交楼层生图任务
     * 执行全角中文标点标准化清洗，调用 PromptPipeline 生成标准化请求，并提交到 TaskManager。
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
            messageId: options.messageId
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
     * 级联删除指定楼层的图片资产：
     * 1. 清理宿主消息 extra 中的 da_images[swipeId][slotIndex]；
     * 2. 若配置了服务端保存且存在静态 URL，从服务端磁盘物理删除；
     * 3. 若存在本地 IndexedDB 记录，释放 Object URL 并从数据库物理删除。
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

        // 2. 服务端静态文件级联物理删除闭环
        if (entry?.url) {
            try {
                await this._host.deleteImageFromServer(entry.url);
            } catch (err) {
                console.warn('[FloorButtonManager] 删除服务端静态文件异常:', err);
            }
        }

        // 3. 本地数据库与临时 URL 级联物理删除
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
        negativePrompt?: string
    ): void {
        const blobUrl = URL.createObjectURL(blob);
        this._trackedObjectUrls.add(blobUrl);

        this.mountRenderedImage(ctx, blobUrl, prompt, negativePrompt);
        FeedbackService.toastSuccess('生图完成！');
    }

    private updateButtonState(ctx: DynamicSlotContext, state: FloorButtonState): void {
        ctx.state = state;
        ctx.wrapper.dataset.state = state;
        ctx.btn.className = `da-btn da-floor-btn da-floor-btn--${state}`;
        ctx.btn.textContent = FloorButtonManager.BUTTON_LABELS[state] || '生成图像';
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

        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
            this._intersectionObserver = null;
        }

        this._activeTaskUnbinds.forEach((unbind) => unbind());
        this._activeTaskUnbinds.clear();

        this.cleanupTrackedUrls();
        this._disposables.dispose();

        if (typeof document !== 'undefined') {
            document.querySelectorAll('.da-floor-slot').forEach((el) => el.remove());
        }
    }
}
