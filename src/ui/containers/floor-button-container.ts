/**
 * @module ui/containers/floor-button-container
 * @description 楼层生图按钮扫描器与控制器 (FloorButtonContainer)
 *
 * 核心职责：
 * 1. 扫描 AI 消息文本，识别占位符并注入交互式生图按钮
 * 2. 管理按钮状态机 (default / loading / progress / done / error)
 * 3. 历史图恢复：从 IndexedDB / chat.extra.da_images 恢复已生成的图像，支持存量 Base64 自动无感迁移
 * 4. 图文绑定持久化：图像生成后进行转码与 SHA-256 去重存入 IndexedDB，仅在宿主 extra 写入轻量 UUID 引用
 * 5. autoGenerate 自动生图触发、rAF 进度节流、Swipe 分支切换动态重扫
 */

import { IDisposable, DisposableStore } from '../../core/foundation/disposable';
import { IHostBridge, HostMessageEvent } from '../../core/foundation/host-bridge';
import { ITypedEventBus } from '../../core/foundation/event-bus';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IStorageAdapter } from '../../core/state/storage-adapter';
import { ITaskManager } from '../../domain/task/task-manager';
import { PromptPipeline } from '../../domain/pipeline/prompt-pipeline';
import { openInpaintCanvasModal } from '../components/inpaint-canvas-modal';
import { renderImageToMessage, ImageActionCallbacks } from '../image-renderer';
import { Logger } from '../../core/diagnostics/logger';
import { FeedbackService } from '../feedback-service';

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
    rafId: number | null;
    pendingPercent: number;
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
    private _isDisposed = false;

    private static readonly BUTTON_LABELS: Record<ButtonState, string> = {
        default: '🎨 生成图像',
        loading: '⏳ 提交中...',
        progress: '⚙️ 生成中',
        done: '🔄 重新生成',
        error: '❌ 重试'
    };

    constructor(options: FloorButtonContainerOptions) {
        this._hostBridge = options.hostBridge;
        this._events = options.events;
        this._store = options.store;
        this._taskManager = options.taskManager;
        this._pipeline = options.pipeline;
        this._storage = options.storage;

        this.initHostEventListeners();
    }

    private initHostEventListeners(): void {
        // 1. 监听 AI 角色消息渲染事件
        this._disposables.add(
            this._hostBridge.onCharacterMessageRendered((ev: HostMessageEvent) => {
                if (!ev.isUser && ev.messageId !== undefined) {
                    this.scanAndInjectMessage(ev.messageId);
                }
            })
        );

        // 2. 监听消息分支切换事件 (Swipe)
        this._disposables.add(
            this._hostBridge.onMessageSwiped(({ messageId }) => {
                this.scanAndInjectMessage(messageId);
            })
        );
    }

    /**
     * 扫描指定楼层并注入生图按钮
     *
     * @param messageId 楼层在 chat 数组中的索引
     */
    public scanAndInjectMessage(messageId: number): void {
        if (typeof document === 'undefined' || this._isDisposed) return;

        const mesEl = document.querySelector(`.mes[mesid="${messageId}"]`) as HTMLElement;
        if (!mesEl) return;

        const mesTextEl = mesEl.querySelector('.mes_text') as HTMLElement;
        if (!mesTextEl) return;

        const settings = this._store.getState();
        const start = settings.placeholderStart || 'image###';
        const end = settings.placeholderEnd || '###';

        const regex = FloorButtonContainer.buildPlaceholderRegex(start, end);
        const rawHtml = mesTextEl.innerHTML;

        if (!regex.test(rawHtml)) return;
        regex.lastIndex = 0;

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

    /**
     * 构建兼容 HTML 实体转义 (# / &#35; / &num;) 的占位符正则表达式
     */
    private static buildPlaceholderRegex(start: string, end: string): RegExp {
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startPat = escapeRegex(start).replace(/#/g, '(?:#|&#35;|&num;)');
        const endPat = escapeRegex(end).replace(/#/g, '(?:#|&#35;|&num;)');
        return new RegExp(`${startPat}([\\s\\S]*?)${endPat}`, 'gi');
    }

    /**
     * 创建楼层生图按钮上下文并绑定完整生命周期
     */
    private async createButton(
        placeholder: HTMLElement,
        prompt: string,
        messageId: number,
        buttonIndex: number
    ): Promise<void> {
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
            buttonIndex,
            rafId: null,
            pendingPercent: 0
        };

        const callbacks = this.createActionCallbacks(ctx);

        // 1. 尝试从 IndexedDB 恢复历史图像
        const hasRestored = await this.restoreSavedImage(ctx, callbacks);

        // 2. 绑定按钮点击与生图调度事件
        this.bindButtonEvents(ctx, callbacks);

        // 3. 若未恢复历史图且开启了 autoGenerate，延时 800ms 自动触发
        const settings = this._store.getState();
        if (!hasRestored && settings.autoGenerate) {
            this._logger.info(`autoGenerate 已开启，自动触发楼层生图: msgId=${messageId}, btnIdx=${buttonIndex}`);
            setTimeout(() => {
                if (ctx.state === 'default') {
                    ctx.btn.click();
                }
            }, 800);
        }
    }

    /**
     * 创建图像操作菜单回调
     */
    private createActionCallbacks(ctx: FloorButtonContext): ImageActionCallbacks {
        return {
            promptText: ctx.overridePrompt || ctx.promptText,
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
                                initBlob: result.initBlob,
                                maskBlob: result.maskBlob
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
                    this._logger.info(`已移除第 #${ctx.messageId} 条消息的已生成图像`);
                }
            }
        };
    }

    /**
     * 绑定楼层按钮点击与状态机调度
     */
    private bindButtonEvents(ctx: FloorButtonContext, callbacks: ImageActionCallbacks): void {
        ctx.btn.onclick = async () => {
            if (ctx.state === 'loading') return;

            // 点击进行中的按钮 → 取消生图
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
                ctx.overrideInpaintData = undefined; // 单次消耗

                const pipelineResult = await this._pipeline.process(
                    {
                        rawPrompt: effectivePrompt,
                        messageId: ctx.messageId,
                        chatId,
                        mode: inpaintData ? 'inpaint' : 'txt2img',
                        initImageBlob: inpaintData?.initBlob as Blob | undefined,
                        maskImageBlob: inpaintData?.maskBlob as Blob | undefined
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
                        this.updateProgress(ctx, evt.progress ?? 0);
                    } else if (evt.status === 'COMPLETED') {
                        unbind.dispose();
                        ctx.currentTaskId = null;
                        this.setButtonState(ctx, 'done');

                        const task = this._taskManager.getTask(taskId);
                        if (task?.resultBlobs?.[0]) {
                            const blob = task.resultBlobs[0];
                            renderImageToMessage(ctx.imgSlot, blob, this._store.getState(), callbacks);

                            // 异步持久化图像至 IndexedDB 与聊天记录 extra
                            setTimeout(() => {
                                void this.persistImageToChat(ctx, blob, effectivePrompt, pipelineResult.payload);
                            }, 0);
                        }
                    } else if (evt.status === 'DISCARDED' || evt.status === 'CANCELLED') {
                        unbind.dispose();
                        ctx.currentTaskId = null;
                        this.setButtonState(ctx, 'default');
                    } else if (evt.status === 'ERROR' || (evt.status as string) === 'FAILED') {
                        unbind.dispose();
                        ctx.currentTaskId = null;
                        this.setButtonState(ctx, 'error');
                        FeedbackService.toast(evt.error || '生图任务执行失败', true);
                    }
                });
            } catch (err: any) {
                this.setButtonState(ctx, 'error');
                ctx.currentTaskId = null;
                this._logger.error('提交生图任务失败:', err);
                FeedbackService.toast(err.message || '提交生图任务失败', true);
            }
        };
    }

    /**
     * 切换按钮状态机并同步 UI 样式
     */
    private setButtonState(ctx: FloorButtonContext, state: ButtonState): void {
        ctx.state = state;
        ctx.btn.textContent = FloorButtonContainer.BUTTON_LABELS[state];
        ctx.btn.className = `da-floor-btn da-floor-btn--${state}`;
        ctx.btn.disabled = state === 'loading';

        if (state === 'progress') {
            ctx.btn.title = '点击可取消生成';
        } else if (state === 'done') {
            ctx.btn.title = '点击重新生成图像';
        } else if (state === 'error') {
            ctx.btn.title = '生图失败，点击重试';
        }

        if (ctx.rafId !== null) {
            cancelAnimationFrame(ctx.rafId);
            ctx.rafId = null;
        }
    }

    /**
     * rAF 节流更新生成进度显示
     */
    private updateProgress(ctx: FloorButtonContext, percent: number): void {
        if (ctx.state !== 'progress') return;
        ctx.pendingPercent = percent;

        if (ctx.rafId === null) {
            ctx.rafId = requestAnimationFrame(() => {
                ctx.rafId = null;
                if (ctx.state !== 'progress') return;
                ctx.btn.textContent = `⚙️ ${ctx.pendingPercent}% (点击取消)`;
            });
        }
    }

    /**
     * 尝试从 IndexedDB (及旧 extra 结构) 恢复历史生成的图像
     */
    private async restoreSavedImage(
        ctx: FloorButtonContext,
        callbacks: ImageActionCallbacks
    ): Promise<boolean> {
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

            // 1. 标准规范：按 UUID 从 IndexedDB 提取图像
            if (savedMeta.uuid) {
                const record = await this._storage.getImage(savedMeta.uuid);
                if (record?.data) {
                    finalBlob = this.dataURLtoBlob(record.data);
                }
            }
            // 2. 旧数据平滑无感迁移：存量 Base64 存入 IndexedDB 并擦除 chat 中的 Base64
            else if (savedMeta.base64) {
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

                delete savedMeta.base64;
                savedMeta.uuid = uuid;

                this._hostBridge.writeChatMessageExtra(ctx.messageId, 'da_images', daImagesRoot);
                finalBlob = this.dataURLtoBlob(dataURL);
            }

            if (finalBlob) {
                renderImageToMessage(ctx.imgSlot, finalBlob, this._store.getState(), callbacks);
                this.setButtonState(ctx, 'done');
                return true;
            }
        } catch (err) {
            this._logger.warn('恢复历史图像异常:', err);
        }
        return false;
    }

    /**
     * 持久化图像：转码、IndexedDB 存储与聊天记录 extra 引用回写
     */
    private async persistImageToChat(
        ctx: FloorButtonContext,
        rawBlob: Blob,
        prompt: string,
        payload: any
    ): Promise<void> {
        const settings = this._store.getState();
        if (!settings.persistToChat) return;

        try {
            // 1. 转码为设置的目标格式 (PNG / WebP / JPEG)
            const { blob: finalBlob, mime } = await this.transcodeImage(
                rawBlob,
                settings.imageFormat,
                settings.imageQuality
            );
            const dataURL = await this.blobToDataURL(finalBlob);

            // 2. 内容寻址去重哈希计算
            const hash = await this._storage.calculateHash(finalBlob);
            const existing = await this._storage.getImageByHash(hash);
            const uuid = existing?.id ?? (crypto.randomUUID?.() ?? `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

            if (!existing) {
                await this._storage.saveImage({
                    id: uuid,
                    hash,
                    prompt,
                    data: dataURL,
                    metadata: {
                        messageId: ctx.messageId,
                        buttonIndex: ctx.buttonIndex,
                        params: payload?.params
                    }
                });
            }

            // 3. 宿主聊天记录仅持久化轻量 UUID 引用
            const msg = this._hostBridge.getChatMessage(ctx.messageId);
            const swipeId = msg?.swipe_id ?? (msg?.extra?.swipe_id as number | undefined) ?? 0;
            const extra = { ...(msg?.extra ?? {}) };
            const daImagesRoot = { ...((extra.da_images as Record<string | number, unknown>) ?? {}) };
            const swipeImages = { ...((daImagesRoot[swipeId] as Record<number, unknown>) ?? {}) };

            const imageEntry: Record<string, unknown> = {
                uuid,
                mime,
                prompt,
                timestamp: Date.now()
            };

            if (settings.extraSaveToChat) {
                imageEntry.base64 = dataURL;
            }

            swipeImages[ctx.buttonIndex] = imageEntry;
            daImagesRoot[swipeId] = swipeImages;

            this._hostBridge.writeChatMessageExtra(ctx.messageId, 'da_images', daImagesRoot);
            this._logger.info(`已成功将图像 UUID 引用持久化至楼层 #${ctx.messageId} (Swipe: ${swipeId})`);
        } catch (err) {
            this._logger.error('持久化图像至聊天记录失败:', err);
        }
    }

    /**
     * 图像格式与画质转码工具
     */
    private async transcodeImage(
        blob: Blob,
        format?: 'original' | 'webp' | 'jpeg',
        quality = 0.85
    ): Promise<{ blob: Blob; mime: string }> {
        if (!format || format === 'original') {
            return { blob, mime: blob.type || 'image/png' };
        }
        const targetMime = format === 'webp' ? 'image/webp' : 'image/jpeg';
        if (blob.type === targetMime) {
            return { blob, mime: targetMime };
        }

        try {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, bitmap.width);
            canvas.height = Math.max(1, bitmap.height);
            const ctx2d = canvas.getContext('2d');
            if (ctx2d) {
                ctx2d.drawImage(bitmap, 0, 0);
                bitmap.close();
                return new Promise((resolve) => {
                    canvas.toBlob(
                        (b) => {
                            resolve(b ? { blob: b, mime: targetMime } : { blob, mime: blob.type || 'image/png' });
                        },
                        targetMime,
                        quality
                    );
                });
            }
            bitmap.close();
        } catch (e) {
            this._logger.warn('图像转码异常，降级使用原始格式', e);
        }
        return { blob, mime: blob.type || 'image/png' };
    }

    private async blobToDataURL(blob: Blob): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private dataURLtoBlob(dataURL: string): Blob {
        const [header, data] = dataURL.split(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
        const binary = atob(data);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
        return new Blob([array], { type: mime });
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._disposables.dispose();
    }
}
