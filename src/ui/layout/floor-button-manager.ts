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
    private _chatObserver: MutationObserver | null = null;
    private _chatObserverDebounceTimer: any = null;
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
        this.initChatObserver();
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

        // 流式生成定稿：重置状态并全量扫描最新消息；仅在用户显式开启 autoGenerate 时调度末尾消息自动生图
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
     * 监听聊天容器 DOM 变动与滚动动态加载，解决历史消息滑动不渲染按钮的问题
     */
    private initChatObserver(): void {
        const attachObserver = () => {
            if (this._isDisposed) return;
            const chatContainer = document.getElementById('chat') || document.body;
            if (!chatContainer) return;

            this._chatObserver?.disconnect();
            this._chatObserver = new MutationObserver((mutations) => {
                if (this._isDisposed) return;

                // 防递归死循环：若变动的节点全为插件自身管理的插槽元素，则直接忽略
                const isOnlyPluginMutations = mutations.every((m) => {
                    const nodes = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)];
                    if (nodes.length === 0) return this.isPluginManagedNode(m.target);
                    return nodes.every((n) => this.isPluginManagedNode(n));
                });

                if (isOnlyPluginMutations) return;

                // 收集变动的楼层 ID，优先按需定向扫描，减少不必要的全量扫描
                const changedMesIds = new Set<number>();
                let hasUnresolvedMutation = false;

                for (const m of mutations) {
                    const nodes = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)];
                    for (const node of nodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const el = node as HTMLElement;
                            const mesEl = el.closest<HTMLElement>('.mes[mesid]') || el.querySelector<HTMLElement>('.mes[mesid]');
                            if (mesEl) {
                                const id = parseInt(mesEl.getAttribute('mesid') || '', 10);
                                if (!isNaN(id)) changedMesIds.add(id);
                            } else {
                                hasUnresolvedMutation = true;
                            }
                        }
                    }
                }

                // 150ms 防抖调度扫描
                if (this._chatObserverDebounceTimer) {
                    clearTimeout(this._chatObserverDebounceTimer);
                }
                this._chatObserverDebounceTimer = setTimeout(() => {
                    this._chatObserverDebounceTimer = null;
                    if (changedMesIds.size > 0 && !hasUnresolvedMutation) {
                        for (const id of changedMesIds) {
                            this.scheduleScanMessage(id);
                        }
                    } else {
                        void this.scanAllMessages();
                    }
                }, 150);
            });

            this._chatObserver.observe(chatContainer, {
                childList: true,
                subtree: true
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
        } else {
            attachObserver();
        }
    }

    private isPluginManagedNode(node: Node): boolean {
        if (!node) return false;
        if (node.nodeType === Node.TEXT_NODE) {
            return Boolean(node.parentElement?.closest('.da-floor-slot, .st-da-root'));
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            return Boolean(el.matches?.('.da-floor-slot, .st-da-root') || el.closest?.('.da-floor-slot, .st-da-root'));
        }
        return false;
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
     * 处理楼层删除：取消未完结任务并释放该楼层已分配的图片资源
     */
    private handleMessageDeleted(messageId: number): void {
        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (!msgNode) return;

        const slots = msgNode.querySelectorAll<HTMLElement>('.da-floor-slot');
        slots.forEach((slot) => {
            const taskId = slot.dataset.taskId;
            if (taskId) {
                this.cancelTask(taskId, '消息已从宿主中删除');
            }
            this.unobserveSlot(slot);
            const ctx = this.getSlotContext(slot);
            if (ctx) {
                this.clearSlotImage(ctx);
            }
            slot.remove();
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
     */
    private clearSlotImage(ctx: DynamicSlotContext): void {
        if (ctx.currentAssetId) {
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

        const entry = this.getImageEntry(ctx.messageId, ctx.swipeId, ctx.slotIndex);
        if (!entry) {
            this.clearSlotImage(ctx);
            if (ctx.state === 'done') {
                this.updateButtonState(ctx, 'default');
                ctx.btn.style.display = 'inline-flex';
            }
            return;
        }

        const targetAssetId = entry.uuid || entry.url || '';
        const existingImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');
        if (existingImg && existingImg.src && ctx.wrapper.dataset.assetId === targetAssetId) {
            return;
        }

        ctx.wrapper.dataset.assetId = targetAssetId;

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
                    this._storage.releaseImageUrl(entry.uuid);
                    return;
                }
                this._trackedObjectUrls.add(url);
                this.mountRenderedImage(ctx, url, entry.prompt, entry.negativePrompt);
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

        const currentHeight = ctx.imgSlot.offsetHeight;
        if (currentHeight > 0) {
            ctx.imgSlot.style.minHeight = `${currentHeight}px`;
        }
        this.clearSlotImage(ctx);
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

        // 原生事件严格隔离：阻止冒泡与默认行为，杜绝与楼层原生按钮、手势、快捷栏冲突
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
     * 扫描单条消息并在段落中间精准原位替换占位符，或根据 extra 历史出图数据恢复插槽
     */
    public async scanAndInjectMessage(messageId: number): Promise<void> {
        if (this._isDisposed) return;

        const msgNode = document.querySelector<HTMLElement>(`.mes[mesid="${messageId}"]`);
        if (!msgNode) return;

        const textNode = msgNode.querySelector<HTMLElement>('.mes_text');
        if (!textNode) return;

        const msg = this._host.getMessageById(messageId);
        const swipeId = msg?.swipe_id ?? 0;
        const doc = textNode.ownerDocument || document;

        // 获取宿主 extra 中的历史图片记录
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
        const swipeImages = daImages ? daImages[swipeId] : undefined;

        const startTag = this._store.get('placeholderStart') || 'image###';
        const endTag = this._store.get('placeholderEnd') || '###';

        const existingSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
        const textContent = textNode.textContent || '';
        const hasPlaceholder = textContent.includes(startTag);

        // 快速通道 1：DOM 中已挂载插槽且正文中无未消费的占位符文本，直接刷新分支并退出，无需执行 TreeWalker
        if (existingSlots.length > 0 && !hasPlaceholder) {
            for (const slot of existingSlots) {
                const idx = parseInt(slot.dataset.slotIndex || '0', 10);
                slot.dataset.slotKey = `${messageId}_${swipeId}_${idx}`;
                slot.dataset.swipeId = String(swipeId);
                this.hydrateSlotImage(slot);
                this.observeSlot(slot);
            }
            return;
        }

        // 快速通道 2：正文中既无占位符、DOM 中无插槽，且 extra 中亦无历史出图，直接退出
        if (!hasPlaceholder && existingSlots.length === 0 && (!swipeImages || Object.keys(swipeImages).length === 0)) {
            return;
        }

        // 使用 TreeWalker 收集有效正文与 <br>，排除代码块、思维链与已注入插槽
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

                    // 跳过已注入插槽、原生代码块、思维链与思考折叠容器
                    if (
                        parent?.closest('.da-floor-slot, .st-da-root') ||
                        CODE_RELATED_TAGS.has(parentTag) ||
                        parent?.closest('pre, code, textarea, kbd, samp') ||
                        parent?.closest('details.thinking, .think, .thinking, .thought, .reasoning, .chat-thought, .mind-fold, details[class*="think"]')
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    const parentClass = parent?.className;
                    if (typeof parentClass === 'string') {
                        if (CODE_CLASS_PATTERNS.some((p) => parentClass.includes(p))) return NodeFilter.FILTER_REJECT;
                        if (THINKING_CLASS_PATTERNS.some((p) => parentClass.includes(p))) return NodeFilter.FILTER_REJECT;
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

        // 通道 A：正文中匹配到了未消费的生图占位符
        if (matches.length > 0) {
            // 逆序遍历匹配项，基于 Range 精准原位替换
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

                // 原位删除文本标记
                range.deleteContents();

                // 构建原位段落插槽容器并就地插入
                const wrapper = this.createSlotElement(doc, messageId, slotIndex, swipeId, matchItem.content.trim());
                range.insertNode(wrapper);

                // 按需装载图片并注册视口观察
                this.hydrateSlotImage(wrapper);
                this.observeSlot(wrapper);
            }

            // 清理多余旧插槽（如消息编辑删减占位符且 extra 中无历史图）
            this.cleanStaleSlots(textNode, (idx) => idx < matches.length || Boolean(swipeImages?.[idx]));
            return;
        }

        // 场景 1：DOM 中已挂载插槽（占位符文本此前已被替换为插槽元素）
        // 无论插槽是否已出图，均属于该楼层的合法交互节点，仅同步分支并刷新装载状态，绝不误杀未出图按钮
        const postSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
        if (postSlots.length > 0) {
            for (const slot of postSlots) {
                const idx = parseInt(slot.dataset.slotIndex || '0', 10);
                slot.dataset.slotKey = `${messageId}_${swipeId}_${idx}`;
                slot.dataset.swipeId = String(swipeId);
                this.hydrateSlotImage(slot);
                this.observeSlot(slot);
            }
            return;
        }

        // 场景 2：DOM 中无任何插槽（例如虚拟滚动首次加载历史消息），但宿主 extra 中存在历史出图记录
        if (swipeImages && Object.keys(swipeImages).length > 0) {
            const slotIndices = Object.keys(swipeImages).map(Number).sort((a, b) => a - b);
            for (const slotIndex of slotIndices) {
                const prompt = swipeImages[slotIndex]?.prompt || '';
                const wrapper = this.createSlotElement(doc, messageId, slotIndex, swipeId, prompt);
                textNode.appendChild(wrapper);
                this.hydrateSlotImage(wrapper);
                this.observeSlot(wrapper);
            }
            return;
        }

        // 场景 3：既无占位符、DOM 中无插槽、宿主 extra 亦无出图记录，清理该楼层残留插槽
        this.cleanMessageFloorSlots(messageId);
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
                    this.clearSlotImage(ctx);
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
        this.clearSlotImage(ctx);

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
                const assetId = refreshed.currentAssetId || undefined;
                this.clearSlotImage(refreshed);
                this.updateButtonState(refreshed, 'default');

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
        ctx.btn.disabled = state === 'loading' || state === 'pending' || state === 'progress';
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

        if (this._chatObserver) {
            this._chatObserver.disconnect();
            this._chatObserver = null;
        }
        if (this._chatObserverDebounceTimer) {
            clearTimeout(this._chatObserverDebounceTimer);
            this._chatObserverDebounceTimer = null;
        }

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
