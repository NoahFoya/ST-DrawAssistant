/**
 * 消息楼层生图控制器 (FloorManager)
 *
 * 功能：
 * 1. 扫描消息楼层正文中的绘图占位符指令，原位挂载生图按钮与展示插槽；
 * 2. 维护各绘图指令的上下文模型 (FloorButtonContext)，隔离多指令任务状态与插槽；
 * 3. 异步读取会话持久化元数据并从本地存储还原历史已生成的图片 (restoreSavedImage)；
 * 4. 响应会话切换 (CHAT_CHANGED) 与分支切换 (MESSAGE_SWIPED) 的插槽刷新与资源清理；
 * 5. 统一提供手动与自动生图触发入口，协同任务队列调度执行。
 *
 * Tips：
 * 1. 临时生成的图片 Object URL 在插槽更新或会话重置时严格执行 revokeObjectURL，防止内存泄露；
 * 2. 楼层分支切换时若存在未完成任务，支持自动取消未决任务并重置上下文。
 */

import { createElement } from '../../util/dom';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';
import { extractPlaceholders, sanitizeMessageText, normalizePromptPunctuation, separatePromptByPipe } from '../../util/prompt';
import { buildEngineParams } from '../../function/params-builder';
import type { ImageActionData } from './image-action-panel';
import type { SettingsStore } from '../../store/settings';
import type { PersistentStorage } from '../../store/storage';
import type { GenerationOrchestrator } from '../../function/orchestrator';
import type { TaskQueueManager } from '../../store/task';
import type { IDisposable } from '../../util/event-bus';
import type { EngineType } from '@types';

export type FloorButtonState = 'default' | 'loading' | 'progress' | 'done' | 'error';

export interface FloorButtonContext {
    contextKey: string;
    messageId: number | string;
    swipeId: number;
    buttonIndex: number;
    prompt: string;
    negativePrompt?: string;
    state: FloorButtonState;
    btnElement: HTMLButtonElement;
    slotElement: HTMLElement;
    containerElement: HTMLElement;
    currentTaskId: string | null;
}

export interface FloorManagerOptions {
    settingsStore: SettingsStore;
    storage?: PersistentStorage;
    orchestrator?: GenerationOrchestrator;
    taskQueue?: TaskQueueManager;
    onPreviewImage?: (url: string) => void;
    onInpaintImage?: (blob: Blob) => void;
    onViewImageInfo?: (metadata: Record<string, unknown>) => void;
    onOpenActionPanel?: (data: ImageActionData) => void;
}

export interface FloorManagerHandle {
    mountToMessage(messageElement: HTMLElement, messageId: number | string, isUserMessage?: boolean): void;
    updateFloorProgress(messageId: number | string, progress: number, buttonIndex?: number): void;
    attachFloorImage(messageId: number | string, imageUrl: string, metadata?: Record<string, unknown>, imageBlob?: Blob, buttonIndex?: number): void;
    triggerFloorGenerate(messageElement: HTMLElement, messageId: number | string, explicitPrompt?: string, explicitNegativePrompt?: string, buttonIndex?: number): void;
    triggerAutoGenerate(messageId: number | string): void;
    handleMessageSwiped(messageId: number | string): void;
    restoreSavedImage(ctx: FloorButtonContext): Promise<boolean>;
    clearSessionState(): void;
    dispose(): void;
}

export class FloorManager implements FloorManagerHandle {
    private readonly _settingsStore: SettingsStore;
    private readonly _storage?: PersistentStorage;
    private readonly _orchestrator?: GenerationOrchestrator;
    private readonly _taskQueue?: TaskQueueManager;
    private readonly _options: FloorManagerOptions;

    /** 指令级上下文索引表：键为 `${messageId}_${buttonIndex}` */
    private _contexts = new Map<string, FloorButtonContext>();
    /** 每个插槽对应的图片 Object URL 索引，用于更新时释放旧资源 */
    private _slotUrls = new Map<string, string>();
    /** 会话生命周期内分配的临时 Object URL 集合，用于会话切换时统一撤销 */
    private _allocatedUrls = new Set<string>();
    private _disposers: IDisposable[] = [];
    private _isDisposed = false;

    constructor(options: FloorManagerOptions) {
        this._settingsStore = options.settingsStore;
        this._storage = options.storage;
        this._orchestrator = options.orchestrator;
        this._taskQueue = options.taskQueue;
        this._options = options;

        if (this._taskQueue) {
            this._setupTaskListeners(this._taskQueue);
        }
    }

    public get orchestrator(): GenerationOrchestrator | undefined {
        return this._orchestrator;
    }

    private _getContextKey(messageId: number | string, buttonIndex: number): string {
        return `${messageId}_${buttonIndex}`;
    }

    private _getHostChatMessage(messageId: number | string): any {
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            const chat = window.SillyTavern.getContext().chat;
            const numId = typeof messageId === 'number' ? messageId : parseInt(String(messageId), 10);
            if (Array.isArray(chat) && !Number.isNaN(numId) && chat[numId]) {
                return chat[numId];
            }
        }
        return undefined;
    }

    private _getCurrentSwipeId(messageId: number | string): number {
        const msg = this._getHostChatMessage(messageId);
        const rawSwipe = msg?.swipe_id ?? (msg?.extra?.swipe_id as number | undefined);
        return typeof rawSwipe === 'number' ? rawSwipe : 0;
    }

    /**
     * 清理指定楼层的上下文记录与关联的 Object URL
     */
    private _removeMessageContexts(messageId: number | string, cancelRunning = false): void {
        const prefix = `${messageId}_`;
        for (const [key, ctx] of this._contexts.entries()) {
            if (key.startsWith(prefix)) {
                if (cancelRunning && ctx.currentTaskId && this._taskQueue) {
                    void this._taskQueue.cancelTask(ctx.currentTaskId, '楼层上下文重置');
                }
                const oldUrl = this._slotUrls.get(key);
                if (oldUrl && oldUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(oldUrl);
                    this._allocatedUrls.delete(oldUrl);
                }
                this._slotUrls.delete(key);
                this._contexts.delete(key);
            }
        }
    }

    /**
     * 挂载生图控制按钮与展示插槽至指定消息楼层
     * 在消息正文 (.mes_text) 中检索绘图指令，并就地将其原位替换为独立插槽，防止裸露原始代码字符并保证图文排版对应。
     */
    public mountToMessage(messageElement: HTMLElement, messageId: number | string, _isUserMessage = false): void {
        if (this._isDisposed || !messageElement) return;

        const mesEl = messageElement.classList?.contains('mes') ? messageElement : ((messageElement.closest?.('.mes') as HTMLElement) || messageElement);
        const textElement = mesEl.querySelector<HTMLElement>('.mes_text') || mesEl;
        const rawHtml = textElement.innerHTML || '';
        if (!rawHtml.trim()) return;

        const startTag = this._settingsStore.get('placeholderStart') || 'image###';
        const endTag = this._settingsStore.get('placeholderEnd') || '###';

        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startPat = escapeRegex(startTag).replace(/#/g, '(?:#|&#35;|&num;)');
        const endPat = escapeRegex(endTag).replace(/#/g, '(?:#|&#35;|&num;)');
        const regex = new RegExp(`${startPat}([\\s\\S]*?)${endPat}`, 'gi');

        // 提取所有绘图指令匹配
        const matches: Array<{ prompt: string; negativePrompt?: string; rawMatch: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = regex.exec(rawHtml)) !== null) {
            const rawContent = m[1].replace(/<[^>]+>/g, ' ').trim();
            if (rawContent) {
                const { positive, negative } = separatePromptByPipe(rawContent);
                matches.push({
                    prompt: positive,
                    negativePrompt: negative ? negative : undefined,
                    rawMatch: m[0]
                });
            }
        }
        regex.lastIndex = 0;

        // 清理末尾追加的旧结构（若存在）
        const legacyWrapper = messageElement.querySelector(':scope > .da-image-collapse-wrapper');
        if (legacyWrapper) {
            legacyWrapper.remove();
        }

        // 无指令时清理既有上下文并退出
        if (matches.length === 0) {
            this._removeMessageContexts(messageId, true);
            return;
        }

        // 指令内容未变动且 DOM 插槽完好时复用既有 DOM 结构
        const existingSlots = textElement.querySelectorAll<HTMLElement>(`.da-floor-slot[data-message-id="${messageId}"]`);
        if (existingSlots.length === matches.length && matches.length > 0) {
            let isExactMatch = true;
            for (let idx = 0; idx < matches.length; idx++) {
                const key = this._getContextKey(messageId, idx);
                const ctx = this._contexts.get(key);
                if (!ctx || ctx.prompt !== matches[idx].prompt) {
                    isExactMatch = false;
                    break;
                }
            }
            if (isExactMatch) {
                return;
            }
        }

        this._removeMessageContexts(messageId, true);

        // 正文原位替换：将 image###...### 占位符替换为临时锚点 span
        let matchCount = 0;
        const newHtml = rawHtml.replace(regex, () => {
            const btnIdx = matchCount++;
            return `<span class="da-floor-slot-placeholder" data-btn-idx="${btnIdx}"></span>`;
        });
        textElement.innerHTML = newHtml;

        const placeholders = textElement.querySelectorAll<HTMLElement>('.da-floor-slot-placeholder');
        const align = this._settingsStore.get('ui')?.imageDisplay?.align || 'center';
        const actionPanelConfig = this._settingsStore.get('ui')?.actionPanel;
        const showTriggerBtn = actionPanelConfig?.enabled ?? true;
        const swipeId = this._getCurrentSwipeId(messageId);
        const totalButtons = placeholders.length;

        placeholders.forEach((ph) => {
            const idx = parseInt(ph.getAttribute('data-btn-idx') || '0', 10);
            const phInfo = matches[idx];
            if (!phInfo) return;

            const slotContainer = createElement('div', {
                className: `da-floor-slot da-image-collapse-wrapper da-floor-slot--${align} da-image-collapse-wrapper--${align}`,
                attributes: {
                    'data-message-id': String(messageId),
                    'data-button-index': String(idx),
                    'data-original-placeholder': phInfo.rawMatch
                }
            });

            const btn = createElement('button', {
                className: 'da-floor-btn da-floor-btn--default',
                attributes: {
                    type: 'button',
                    title: `依据绘图指令生成: ${phInfo.prompt}`
                }
            });
            const label = this._getButtonLabel('default', idx, totalButtons);
            btn.innerHTML = `${getIconSvg('palette')} <span>${label}</span>`;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.triggerFloorGenerate(mesEl, messageId, phInfo.prompt, phInfo.negativePrompt, idx);
            });

            const imgSlot = createElement('div', {
                className: `da-floor-btn-img-slot da-floor-btn-img-slot--${align}`
            });

            if (showTriggerBtn) {
                slotContainer.appendChild(btn);
            }
            slotContainer.appendChild(imgSlot);

            // 若父元素为段落标签且主要包裹该插槽，应用紧凑样式类
            const parentP = ph.parentElement;
            if (parentP && parentP.tagName === 'P') {
                parentP.classList.add('da-floor-slot-p');
            }

            ph.replaceWith(slotContainer);

            const contextKey = this._getContextKey(messageId, idx);
            const ctx: FloorButtonContext = {
                contextKey,
                messageId,
                swipeId,
                buttonIndex: idx,
                prompt: phInfo.prompt,
                negativePrompt: phInfo.negativePrompt,
                state: 'default',
                btnElement: btn,
                slotElement: imgSlot,
                containerElement: slotContainer,
                currentTaskId: null
            };

            this._contexts.set(contextKey, ctx);

            // 异步恢复当前分支的历史持久化图像
            void this.restoreSavedImage(ctx);
        });
    }

    /**
     * 异步读取会话持久化元数据，恢复已生成的历史图片
     */
    public async restoreSavedImage(ctx: FloorButtonContext): Promise<boolean> {
        if (this._isDisposed) return false;

        const msg = this._getHostChatMessage(ctx.messageId);
        if (!msg) return false;

        const swipeId = this._getCurrentSwipeId(ctx.messageId);
        ctx.swipeId = swipeId;

        const daImagesRoot = msg.extra?.da_images as Record<string | number, unknown> | undefined;
        if (!daImagesRoot) return false;

        const swipeObj = (daImagesRoot[swipeId] ?? daImagesRoot[String(swipeId)]) as Record<string | number, any> | undefined;
        const savedMeta = swipeObj?.[ctx.buttonIndex] ?? swipeObj?.[String(ctx.buttonIndex)];
        if (!savedMeta) return false;

        try {
            // 优先使用静态 URL
            if (savedMeta.url && typeof savedMeta.url === 'string') {
                this.attachFloorImage(ctx.messageId, savedMeta.url, savedMeta.metadata, undefined, ctx.buttonIndex);
                this.setButtonState(ctx, 'done');
                return true;
            }

            // 从本地持久化存储加载二进制 Blob 原图
            const recordId = savedMeta.id || savedMeta.uuid;
            if (recordId && this._storage) {
                const record = await this._storage.getImage(recordId);
                const rawBlob = record?.originalBlob;
                if (rawBlob instanceof Blob) {
                    const blobUrl = URL.createObjectURL(rawBlob);
                    this.attachFloorImage(ctx.messageId, blobUrl, record?.metadata || savedMeta.metadata, rawBlob, ctx.buttonIndex);
                    this.setButtonState(ctx, 'done');
                    return true;
                }
            }
        } catch (err) {
            console.warn(`[FloorManager] 恢复楼层 #${ctx.messageId} 历史图像失败:`, err);
        }

        return false;
    }

    /**
     * 生成规范的生图按钮文案与编号后缀
     */
    private _getButtonLabel(state: FloorButtonState, buttonIndex: number, totalButtons: number): string {
        const suffix = totalButtons > 1 ? ` #${buttonIndex + 1}` : '';
        switch (state) {
            case 'default':
                return `生成图片${suffix}`;
            case 'loading':
                return `提交中${suffix}...`;
            case 'progress':
                return `正在绘制${suffix} (点击取消)`;
            case 'done':
                return `重新生成${suffix}`;
            case 'error':
                return `重试生图${suffix}`;
            default:
                return `生成图片${suffix}`;
        }
    }

    /**
     * 计算指定楼层的总绘图指令按钮数
     */
    private _getTotalButtons(messageId: number | string): number {
        const prefix = `${messageId}_`;
        let count = 0;
        for (const key of this._contexts.keys()) {
            if (key.startsWith(prefix)) count++;
        }
        return count > 0 ? count : 1;
    }

    /**
     * 更新生图按钮的生命周期状态与呈现样式
     */
    public setButtonState(ctx: FloorButtonContext, state: FloorButtonState): void {
        ctx.state = state;
        ctx.btnElement.className = `da-floor-btn da-floor-btn--${state}`;
        ctx.btnElement.disabled = state === 'loading';

        const totalButtons = this._getTotalButtons(ctx.messageId);
        const label = this._getButtonLabel(state, ctx.buttonIndex, totalButtons);

        if (state === 'default') {
            ctx.btnElement.innerHTML = `${getIconSvg('palette')} <span>${label}</span>`;
            ctx.btnElement.title = `提示词: ${ctx.prompt}`;
        } else if (state === 'loading') {
            ctx.btnElement.innerHTML = `${getIconSvg('spinner')} <span>${label}</span>`;
            ctx.btnElement.title = '任务正在提交至调度队列';
        } else if (state === 'progress') {
            ctx.btnElement.innerHTML = `${getIconSvg('spinner')} <span>${label}</span>`;
            ctx.btnElement.title = '点击取消当前生图任务';
        } else if (state === 'done') {
            ctx.btnElement.innerHTML = `${getIconSvg('sparkles')} <span>${label}</span>`;
            ctx.btnElement.title = '点击重新生成图像';
        } else if (state === 'error') {
            ctx.btnElement.innerHTML = `${getIconSvg('palette')} <span>${label}</span>`;
            ctx.btnElement.title = '生成失败，点击重试';
        }

        const hideButtonOnDone = !!this._settingsStore.get('ui')?.actionPanel?.hideButtonOnDone;
        if (state === 'done' && hideButtonOnDone) {
            ctx.btnElement.style.display = 'none';
        } else {
            ctx.btnElement.style.display = '';
        }
    }

    /**
     * 更新指定楼层与插槽的生图进度展示
     */
    public updateFloorProgress(messageId: number | string, progress: number, buttonIndex = 0): void {
        if (this._isDisposed) return;
        const key = this._getContextKey(messageId, buttonIndex);
        const ctx = this._contexts.get(key);
        if (!ctx) return;

        const slot = ctx.slotElement;
        let progressEl = slot.querySelector('.da-floor-progress-bar') as HTMLElement;
        if (!progressEl) {
            slot.innerHTML = '';
            progressEl = createElement('div', { className: 'da-floor-progress-bar' });
            progressEl.innerHTML = `
                <div class="da-icon-spin" style="display: inline-flex;">${getIconSvg('spinner')}</div>
                <span class="da-progress-text">正在绘制中... 0%</span>
            `;
            slot.appendChild(progressEl);
        }

        const pctText = progressEl.querySelector('.da-progress-text');
        if (pctText) {
            pctText.textContent = `正在绘制中... ${Math.round(progress * 100)}%`;
        }
    }

    /**
     * 挂载生成的图像元素并绑定交互手势与操作面板
     */
    public attachFloorImage(
        messageId: number | string,
        imageUrl: string,
        metadata?: Record<string, unknown>,
        imageBlob?: Blob,
        buttonIndex = 0
    ): void {
        if (this._isDisposed) return;
        const contextKey = this._getContextKey(messageId, buttonIndex);
        const ctx = this._contexts.get(contextKey);
        if (!ctx) return;

        const slot = ctx.slotElement;

        // 释放先前占用的 Object URL
        const oldUrl = this._slotUrls.get(contextKey);
        if (oldUrl && oldUrl !== imageUrl) {
            if (oldUrl.startsWith('blob:')) {
                URL.revokeObjectURL(oldUrl);
            }
            this._allocatedUrls.delete(oldUrl);
        }
        this._slotUrls.set(contextKey, imageUrl);
        this._allocatedUrls.add(imageUrl);

        slot.innerHTML = '';

        const displayConfig = this._settingsStore.get('ui')?.imageDisplay;
        const autoBlur = !!(displayConfig?.autoBlur ?? displayConfig?.collapsed);
        let isMasked = autoBlur;

        const maxWidthPct = typeof displayConfig?.maxWidthPct === 'number' ? displayConfig.maxWidthPct : 100;
        const maxHeight = typeof displayConfig?.maxHeight === 'number' ? displayConfig.maxHeight : 480;
        const objectFit = displayConfig?.objectFit || 'contain';
        const rounded = displayConfig?.rounded ?? true;
        const align = displayConfig?.align || 'center';

        const imgWrap = createElement('div', {
            className: `da-image-wrapper ${rounded ? 'da-image-wrapper--rounded' : ''} da-image-wrapper--${align} ${isMasked ? 'da-image-wrapper--masked' : ''}`,
            attributes: {
                style: `max-height: ${maxHeight}px; max-width: ${maxWidthPct}%;`
            }
        });

        let maskBadge: HTMLElement | null = null;
        const unmask = () => {
            if (!isMasked) return;
            isMasked = false;
            imgWrap.classList.remove('da-image-wrapper--masked');
            if (maskBadge) {
                maskBadge.remove();
                maskBadge = null;
            }
        };

        if (isMasked) {
            maskBadge = createElement('div', {
                className: 'da-image-mask-badge',
                innerHTML: `${getIconSvg('eye')}<span>轻触或悬停显现</span>`
            });
            maskBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                unmask();
            });
            imgWrap.appendChild(maskBadge);
        }

        imgWrap.addEventListener('click', () => {
            if (isMasked) {
                unmask();
            }
        });

        const img = createElement('img', {
            className: `da-generated-img ${rounded ? 'da-generated-img--rounded' : ''}`,
            attributes: {
                src: imageUrl,
                alt: '生成的图片',
                style: `max-height: ${maxHeight}px; object-fit: ${objectFit};`
            }
        });

        const triggerActionPanel = () => {
            this._options.onOpenActionPanel?.({
                messageId,
                swipeId: ctx.swipeId,
                buttonIndex: ctx.buttonIndex,
                imageUrl,
                imageBlob,
                metadata,
                prompt: typeof metadata?.prompt === 'string' ? metadata.prompt : ctx.prompt,
                negativePrompt: typeof metadata?.negativePrompt === 'string' ? metadata.negativePrompt : ctx.negativePrompt
            });
        };

        // 移动端 380ms 长按检测
        let longPressTimer: ReturnType<typeof setTimeout> | null = null;
        let isLongPress = false;
        let startX = 0;
        let startY = 0;

        const cancelLongPress = () => {
            if (longPressTimer !== null) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        img.addEventListener('pointerdown', (e) => {
            isLongPress = false;
            startX = e.clientX;
            startY = e.clientY;
            cancelLongPress();
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                isLongPress = true;
                try {
                    navigator.vibrate?.(35);
                } catch {}
                triggerActionPanel();
            }, 380);
        });

        img.addEventListener('pointermove', (e) => {
            if (longPressTimer !== null) {
                const dx = Math.abs(e.clientX - startX);
                const dy = Math.abs(e.clientY - startY);
                if (dx > 8 || dy > 8) {
                    cancelLongPress();
                }
            }
        });

        img.addEventListener('pointerup', cancelLongPress);
        img.addEventListener('pointercancel', cancelLongPress);
        img.addEventListener('pointerleave', cancelLongPress);

        // 桌面端右键菜单
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cancelLongPress();
            triggerActionPanel();
        });

        // 单击大图预览
        img.addEventListener('click', (e: MouseEvent) => {
            if (isLongPress) {
                e.stopPropagation();
                return;
            }
            if (isMasked) {
                unmask();
                if ((e as PointerEvent).pointerType === 'touch') {
                    e.stopPropagation();
                    return;
                }
            }
            this._options.onPreviewImage?.(imageUrl);
        });

        imgWrap.appendChild(img);

        // 右上角操作胶囊
        const actionTrigger = createElement('button', {
            className: 'da-image-action-trigger',
            attributes: {
                type: 'button',
                title: '图像操作 (重绘 / 元数据 / 重新生成)'
            }
        });
        actionTrigger.innerHTML = getIconSvg('sparkles');
        actionTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            triggerActionPanel();
        });
        imgWrap.appendChild(actionTrigger);

        slot.appendChild(imgWrap);

        this.setButtonState(ctx, 'done');
    }

    /**
     * 注册任务调度器事件监听，按 task.identity 将进度与结果分发至目标插槽
     */
    private _setupTaskListeners(taskQueue: TaskQueueManager): void {
        const unsubProgress = taskQueue.events.on('task:progress', ({ taskId, progress }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined) {
                const btnIdx = task.identity.buttonIndex ?? 0;
                this.updateFloorProgress(task.identity.messageId, progress, btnIdx);
            }
        });
        this._disposers.push(unsubProgress);

        const unsubCompleted = taskQueue.events.on('task:completed', ({ taskId, result }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined && result.blob) {
                const btnIdx = task.identity.buttonIndex ?? 0;
                const blobUrl = URL.createObjectURL(result.blob);
                this.attachFloorImage(task.identity.messageId, blobUrl, result.metadata, result.blob, btnIdx);
            }
        });
        this._disposers.push(unsubCompleted);

        const unsubFailed = taskQueue.events.on('task:failed', ({ taskId, error }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined) {
                const btnIdx = task.identity.buttonIndex ?? 0;
                this._showFloorError(task.identity.messageId, error, btnIdx);
            }
        });
        this._disposers.push(unsubFailed);

        const unsubCancelled = taskQueue.events.on('task:cancelled', ({ taskId, reason }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined) {
                const btnIdx = task.identity.buttonIndex ?? 0;
                this._showFloorCancelled(task.identity.messageId, reason, btnIdx);
            }
        });
        this._disposers.push(unsubCancelled);
    }

    private _showFloorError(messageId: number | string, error: string, buttonIndex = 0): void {
        if (this._isDisposed) return;
        const ctx = this._contexts.get(this._getContextKey(messageId, buttonIndex));
        if (!ctx) return;

        ctx.slotElement.innerHTML = '';
        const errorEl = createElement('div', { className: 'da-floor-error-bar' });
        errorEl.textContent = `生图失败: ${error}`;
        ctx.slotElement.appendChild(errorEl);
        this.setButtonState(ctx, 'error');
    }

    private _showFloorCancelled(messageId: number | string, reason?: string, buttonIndex = 0): void {
        if (this._isDisposed) return;
        const ctx = this._contexts.get(this._getContextKey(messageId, buttonIndex));
        if (!ctx) return;

        ctx.slotElement.innerHTML = '';
        const cancelEl = createElement('div', { className: 'da-floor-cancel-bar' });
        cancelEl.textContent = `生图已取消${reason ? ` (${reason})` : ''}`;
        ctx.slotElement.appendChild(cancelEl);
        this.setButtonState(ctx, 'default');
    }

    /**
     * 响应候选回复分支切换 (MESSAGE_SWIPED) 并重构当前楼层视图
     */
    public handleMessageSwiped(messageId: number | string): void {
        if (this._isDisposed) return;
        const selector = `#chat .mes[mesid="${messageId}"], .mes[mesid="${messageId}"]`;
        const messageEl = document.querySelector<HTMLElement>(selector);
        if (messageEl) {
            this._removeMessageContexts(messageId, false);
            const wrappers = messageEl.querySelectorAll<HTMLElement>('.da-floor-slot, .da-image-collapse-wrapper');
            for (const wrapper of wrappers) {
                const orig = wrapper.getAttribute('data-original-placeholder');
                if (orig) {
                    wrapper.replaceWith(document.createTextNode(orig));
                } else {
                    wrapper.remove();
                }
            }
            this.mountToMessage(messageEl, messageId);
        }
    }

    /**
     * 自动触发指定楼层中状态为 default 的生图按钮
     */
    public triggerAutoGenerate(messageId: number | string): void {
        if (this._isDisposed) return;
        const prefix = `${messageId}_`;
        for (const [key, ctx] of this._contexts.entries()) {
            if (key.startsWith(prefix) && ctx.state === 'default') {
                ctx.btnElement.click();
            }
        }
    }

    /**
     * 提交楼层生图任务至调度队列
     */
    public triggerFloorGenerate(
        messageElement: HTMLElement,
        messageId: number | string,
        explicitPrompt?: string,
        explicitNegativePrompt?: string,
        buttonIndex = 0
    ): void {
        const contextKey = this._getContextKey(messageId, buttonIndex);
        const ctx = this._contexts.get(contextKey);

        if (ctx) {
            if (ctx.state === 'loading') return;
            if (ctx.state === 'progress' && ctx.currentTaskId && this._taskQueue) {
                void this._taskQueue.cancelTask(ctx.currentTaskId, '用户取消');
                this.setButtonState(ctx, 'default');
                ctx.currentTaskId = null;
                return;
            }
        }

        const textElement = messageElement.querySelector('.mes_text');
        const textContent = (textElement?.textContent || messageElement.textContent || '').trim();
        if (!textContent && !explicitPrompt) {
            Toast.warn('该楼层内容为空，无法提取提示词');
            return;
        }

        if (!this._taskQueue) {
            Toast.warn('生图任务调度队列未就绪');
            return;
        }

        const activeEngine = (this._settingsStore.get('activeEngine') as EngineType) || 'comfyui';
        let chatId = 'default';
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            chatId = window.SillyTavern.getContext().chatId || 'default';
        }

        let promptText = explicitPrompt || ctx?.prompt;
        let negativePromptText = explicitNegativePrompt || ctx?.negativePrompt;

        if (!promptText) {
            const startTag = this._settingsStore.get('placeholderStart') || 'image###';
            const endTag = this._settingsStore.get('placeholderEnd') || '###';
            const placeholders = extractPlaceholders(textContent, startTag, endTag);
            if (placeholders.length > 0) {
                promptText = placeholders[0].prompt;
                negativePromptText = placeholders[0].negativePrompt;
            } else {
                promptText = sanitizeMessageText(textContent);
            }
        }

        if (this._settingsStore.get('cleanPrompt') !== false) {
            promptText = normalizePromptPunctuation(promptText);
            if (negativePromptText) {
                negativePromptText = normalizePromptPunctuation(negativePromptText);
            }
        }

        const taskParams = buildEngineParams({
            engine: activeEngine,
            prompt: promptText,
            negativePrompt: negativePromptText,
            settingsStore: this._settingsStore
        });

        const numMessageId = typeof messageId === 'number' ? messageId : parseInt(String(messageId), 10);
        const parsedMessageId = Number.isNaN(numMessageId) ? undefined : numMessageId;
        const swipeId = this._getCurrentSwipeId(messageId);

        if (ctx) {
            this.setButtonState(ctx, 'loading');
        }
        this.updateFloorProgress(messageId, 0.05, buttonIndex);

        try {
            const taskId = this._taskQueue.submit(
                taskParams,
                {
                    chatId,
                    messageId: parsedMessageId,
                    swipeId,
                    buttonIndex
                },
                taskParams.engine
            );
            if (ctx) {
                ctx.currentTaskId = taskId;
                this.setButtonState(ctx, 'progress');
            }
            Toast.info(`已提取第 #${messageId} 楼层指令，加入生图队列`);
        } catch (err: any) {
            const errorMsg = err?.message || String(err) || '未知提交异常';
            Toast.error(`提交生图任务失败: ${errorMsg}`);
            this._showFloorError(messageId, errorMsg, buttonIndex);
        }
    }

    /**
     * 会话切换时清理所有临时 Object URL 与楼层上下文映射
     */
    public clearSessionState(): void {
        for (const url of this._allocatedUrls) {
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        }
        this._allocatedUrls.clear();
        this._slotUrls.clear();
        this._contexts.clear();
    }

    /**
     * 释放管理器监听器与全部持有的临时资源
     */
    public dispose(): void {
        this.clearSessionState();
        for (const unbind of this._disposers) {
            try {
                unbind.dispose();
            } catch (err) {
                console.error('[FloorManager] 释放监听器异常:', err);
            }
        }
        this._disposers = [];
        this._isDisposed = true;
    }
}
