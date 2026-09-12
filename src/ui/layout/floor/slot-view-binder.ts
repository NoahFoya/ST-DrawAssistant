/**
 * 插槽 DOM 视图与视口绑定器 (SlotViewBinder)
 * 职责：
 * 1. 构造标准规范的插槽 DOM 节点（wrapper、imgSlot、button）并隔离点击冒泡；
 * 2. 维护按钮状态机（default / loading / pending / progress / done / error）与提示文案；
 * 3. 封装 IntersectionObserver 视口按需装载与离屏高度占位脱水；
 * 4. 绑定图片渲染装配与操作交互面板回调；
 * 5. 集中管理与释放本地创建的 Blob Object URL。
 */

import { IDisposable, ChatImageEntry } from '../../../types';
import { StorageService, SettingsStore } from '../../../state';
import { separatePromptByPipe } from '../../../pipeline';
import { renderImageToMessage, ImageActionCallbacks } from '../../media/image-renderer';
import { openInpaintCanvasModal } from '../../media/image-editor';
import { base64ToBlob } from '../../../utils';

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

export interface SlotViewBinderOptions {
    store: SettingsStore;
    storage: StorageService;
    onButtonClick: (ctx: DynamicSlotContext) => void;
    onRegenerate: (ctx: DynamicSlotContext) => void;
    onInpaint: (ctx: DynamicSlotContext, inpaintData: { initImageBlob: Blob; maskImageBlob: Blob; prompt: string }) => void;
    onDeleteImage: (ctx: DynamicSlotContext, assetId?: string) => Promise<void>;
    getImageEntry: (messageId: number, swipeId: number, slotIndex: number) => ChatImageEntry | undefined;
    getCurrentSwipeId: (messageId: number) => number;
}

export class SlotViewBinder implements IDisposable {
    private readonly _store: SettingsStore;
    private readonly _storage: StorageService;
    private readonly _options: SlotViewBinderOptions;
    private readonly _trackedObjectUrls = new Set<string>();

    private _intersectionObserver: IntersectionObserver | null = null;
    private _isDisposed = false;

    public static readonly BUTTON_LABELS: Record<FloorButtonState, string> = {
        default: '生成图像',
        loading: '提交中...',
        pending: '排队中 (点击取消)',
        progress: '生成中 (点击取消)',
        done: '重新生成',
        error: '重试'
    };

    constructor(options: SlotViewBinderOptions) {
        this._options = options;
        this._store = options.store;
        this._storage = options.storage;

        this.initIntersectionObserver();
    }

    // 1. DOM 节点构造与上下文解析

    /**
     * 创建标准化的插槽 DOM 元素
     */
    public createSlotElement(
        doc: Document,
        messageId: number,
        slotIndex: number,
        swipeId: number,
        prompt: string
    ): HTMLElement {
        const wrapper = doc.createElement('span');
        wrapper.className = 'da-floor-btn-wrapper da-floor-slot st-da-root';
        wrapper.dataset.slotKey = `${messageId}_${swipeId}_${slotIndex}`;
        wrapper.dataset.slotIndex = String(slotIndex);
        wrapper.dataset.swipeId = String(swipeId);
        wrapper.dataset.prompt = prompt;
        wrapper.dataset.state = 'default';
        wrapper.dataset.daInserted = 'true';

        const imgSlot = doc.createElement('span');
        imgSlot.className = 'da-floor-btn-img-slot';

        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'da-btn da-floor-btn da-floor-btn--default';
        btn.textContent = SlotViewBinder.BUTTON_LABELS.default;

        wrapper.appendChild(imgSlot);
        wrapper.appendChild(btn);

        // 阻止冒泡，避免触发宿主外层消息点击
        btn.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const currentCtx = this.getSlotContext(btn);
            if (!currentCtx) return;

            this._options.onButtonClick(currentCtx);
        };

        return wrapper;
    }

    /**
     * 从目标 DOM 节点向上寻址并解析动态插槽上下文
     */
    public getSlotContext(target: HTMLElement): DynamicSlotContext | null {
        const wrapper = target.closest<HTMLElement>('.da-floor-slot');
        if (!wrapper) return null;

        const mesNode = wrapper.closest<HTMLElement>('.mes[mesid]');
        const rawMesId = mesNode?.getAttribute('mesid');
        const messageId = rawMesId !== null && rawMesId !== undefined ? parseInt(rawMesId, 10) : NaN;
        if (isNaN(messageId)) return null;

        const slotIndex = parseInt(wrapper.dataset.slotIndex || '0', 10);
        const swipeId = this._options.getCurrentSwipeId(messageId);
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
     * 更新插槽按钮状态与提示文案
     */
    public updateButtonState(ctx: DynamicSlotContext, state: FloorButtonState): void {
        ctx.state = state;
        ctx.wrapper.dataset.state = state;
        ctx.btn.className = `da-btn da-floor-btn da-floor-btn--${state}`;
        ctx.btn.textContent = SlotViewBinder.BUTTON_LABELS[state] || '生成图像';
        ctx.btn.disabled = state === 'loading';
        if (state === 'pending' || state === 'progress') {
            ctx.btn.title = '正在生成中，点击可取消任务';
        } else {
            ctx.btn.removeAttribute('title');
        }
    }

    // 2. 视口按需装载 (IntersectionObserver)

    private initIntersectionObserver(): void {
        if (!('IntersectionObserver' in window)) {
            return;
        }

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

    public observeSlot(slot: HTMLElement): void {
        if (this._intersectionObserver) {
            this._intersectionObserver.observe(slot);
        } else {
            this.hydrateSlotImage(slot);
        }
    }

    public unobserveSlot(slot: HTMLElement): void {
        if (this._intersectionObserver) {
            this._intersectionObserver.unobserve(slot);
        }
    }

    /**
     * 视口装载：当插槽进入可见区域时，按需获取图片资源并挂载
     */
    public hydrateSlotImage(slot: HTMLElement): void {
        if (this._isDisposed) return;
        const ctx = this.getSlotContext(slot);
        if (!ctx) return;

        // 任务执行中保留状态，不打断
        if (ctx.state === 'loading' || ctx.state === 'pending' || ctx.state === 'progress') {
            return;
        }

        const entry = this._options.getImageEntry(ctx.messageId, ctx.swipeId, ctx.slotIndex);
        const existingImg = ctx.imgSlot.querySelector<HTMLImageElement>('.da-generated-img');

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
        if (existingImg && existingImg.src && (ctx.wrapper.dataset.assetId === targetAssetId || ctx.currentAssetId === targetAssetId)) {
            return;
        }

        ctx.wrapper.dataset.assetId = targetAssetId;
        ctx.currentAssetId = targetAssetId;

        if (entry.url) {
            this.mountRenderedImage(ctx, entry.url, entry.prompt, entry.negativePrompt, targetAssetId, entry.metadata);
        } else if (entry.storageStrategy === 'embedded' && entry.base64) {
            this.mountRenderedImage(ctx, entry.base64, entry.prompt, entry.negativePrompt, targetAssetId, entry.metadata);
        } else if (entry.uuid) {
            const swipeId = ctx.swipeId;
            void this._storage.getImageUrl(entry.uuid).then((url) => {
                if (!url || this._isDisposed) return;
                const curSwipe = this._options.getCurrentSwipeId(ctx.messageId);
                if (curSwipe !== swipeId) {
                    this._storage.releaseImageUrl(entry.uuid);
                    return;
                }
                this._trackedObjectUrls.add(url);
                this.mountRenderedImage(ctx, url, entry.prompt, entry.negativePrompt, targetAssetId, entry.metadata);
            });
        }
    }

    /**
     * 离屏释放：当插槽滑出视口远端时，安全释放临时 Object URL 与引用计数，保留占位高度防跳动
     */
    public dehydrateSlotImage(slot: HTMLElement): void {
        if (this._isDisposed) return;
        const ctx = this.getSlotContext(slot);
        if (!ctx) return;

        if (ctx.state === 'loading' || ctx.state === 'pending' || ctx.state === 'progress') {
            return;
        }

        const currentHeight = ctx.imgSlot.offsetHeight;
        if (currentHeight > 0) {
            ctx.imgSlot.style.minHeight = `${currentHeight}px`;
        }
        this.clearSlotImage(ctx, false);
    }

    /**
     * 清理插槽图片资源
     */
    public clearSlotImage(ctx: DynamicSlotContext, keepAssetId = false): void {
        if (ctx.currentAssetId && !keepAssetId) {
            this._storage.releaseImageUrl(ctx.currentAssetId);
            ctx.wrapper.dataset.assetId = '';
            ctx.currentAssetId = null;
        }
        const img = ctx.imgSlot?.querySelector<HTMLImageElement>('.da-generated-img');
        if (img?.src?.startsWith('blob:') || img?.dataset?.ownsBlob === 'true') {
            try {
                URL.revokeObjectURL(img.src);
            } catch {}
            this._trackedObjectUrls.delete(img.src);
        }
        if (ctx.imgSlot) {
            ctx.imgSlot.innerHTML = '';
        }
    }

    /**
     * 挂载渲染出的图片与动作交互面板
     */
    public mountRenderedImage(
        ctx: DynamicSlotContext,
        src: string,
        prompt: string,
        negativePrompt?: string,
        assetId?: string,
        metadata?: Record<string, any>
    ): void {
        this.clearSlotImage(ctx, true);

        if (assetId) {
            ctx.wrapper.dataset.assetId = assetId;
            ctx.currentAssetId = assetId;
        }

        const settings = this._store.getState();
        const entry = this._options.getImageEntry(ctx.messageId, ctx.swipeId, ctx.slotIndex);
        const resolvedMetadata = metadata || entry?.metadata || {};

        // 单源真实优先级决议 (Single Source of Truth)
        const resolvedPrompt = ctx.overridePrompt
            || resolvedMetadata.finalPrompt
            || prompt
            || entry?.prompt
            || ctx.promptText;

        const resolvedNegativePrompt = ctx.overrideNegativePrompt
            || resolvedMetadata.finalNegativePrompt
            || negativePrompt
            || entry?.negativePrompt
            || ctx.rawNegativePrompt;

        const actionCallbacks: ImageActionCallbacks = {
            imageSrc: src,
            uuid: assetId || entry?.uuid,
            metadata: resolvedMetadata,
            promptText: resolvedPrompt,
            negativePrompt: resolvedNegativePrompt,
            messageIndex: ctx.messageId,
            buttonIndex: ctx.slotIndex,
            storage: this._storage,
            onConfirm: (newPrompt: string, newNegativePrompt?: string) => {
                const refreshed = this.getSlotContext(ctx.wrapper);
                if (refreshed) {
                    refreshed.overridePrompt = newPrompt;
                    refreshed.overrideNegativePrompt = newNegativePrompt;
                    ctx.wrapper.dataset.overridePrompt = newPrompt;
                    if (newNegativePrompt !== undefined) {
                        ctx.wrapper.dataset.overrideNegativePrompt = newNegativePrompt;
                    }
                }
            },
            onRegenerate: () => {
                const refreshed = this.getSlotContext(ctx.wrapper);
                if (refreshed) {
                    this._options.onRegenerate(refreshed);
                }
            },
            onInpaint: () => {
                openInpaintCanvasModal({
                    imageSrc: src,
                    initialPrompt: resolvedPrompt,
                    onConfirm: (res) => {
                        const refreshed = this.getSlotContext(ctx.wrapper);
                        if (!refreshed) return;
                        this._options.onInpaint(refreshed, {
                            initImageBlob: base64ToBlob(res.initImage),
                            maskImageBlob: base64ToBlob(res.maskImage),
                            prompt: res.prompt
                        });
                    }
                });
            },
            onDelete: async () => {
                const refreshed = this.getSlotContext(ctx.wrapper) || ctx;
                const assetIdToDelete = refreshed.currentAssetId || undefined;
                this.clearSlotImage(refreshed, false);
                this.updateButtonState(refreshed, 'default');

                await this._options.onDeleteImage(refreshed, assetIdToDelete);
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

    public trackBlobUrl(url: string): void {
        this._trackedObjectUrls.add(url);
    }

    public cleanupTrackedUrls(): void {
        this._trackedObjectUrls.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch {}
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

        this.cleanupTrackedUrls();
    }
}
