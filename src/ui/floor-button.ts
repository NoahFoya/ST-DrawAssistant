/**
 * @module ui/floor-button
 * @description 楼层生图按钮控制器
 *
 * 职责：
 * 1. 扫描 AI 消息文本，识别 `image###提示词###` 占位符
 * 2. 将占位符替换为交互式生图按钮
 * 3. 管理按钮状态机（DEFAULT → LOADING → PROGRESS → DONE/ERROR）
 * 4. 点击按钮触发生图，点击进行中的按钮可取消
 *
 * 占位符格式（用户配置）：
 *   默认起始：image###
 *   默认结束：###
 *   示例：image###1girl, cityscape, night###
 *
 * DOM 注入生命周期：
 * 每次 CHARACTER_MESSAGE_RENDERED 事件触发时，扫描新渲染的消息楼层，
 * 识别占位符并注入按钮 DOM。按钮与 TaskManager 通过 taskId 绑定，
 * 任务完成后 ImageDB 落盘，图片原位挂载到消息楼层容器。
 */


import { TaskManager } from '../task/manager';
import type { ImageDriver } from '../drivers/types';
import type { DrawAssistantSettings } from '../settings/types';
import { renderImageToMessage } from './image-renderer';
import { getContext } from '../core/context';
import { saveImageToDB, getImageFromDB } from '../storage/image-db';
import { logger } from '../core/logger';
import { showToastError } from '../utils/toast';

import { escapeHtmlAttr } from '../utils/html';
import { buildFinalPrompt } from '../core/prompt-pipeline';
import type { GenerateOptions } from '../drivers/types';
import { FeedbackService } from './feedback-service';

interface SavedImageMeta {
    uuid?: string;
    base64?: string;
    mime?: string;
    prompt?: string;
    timestamp?: number;
}

// ─── 按钮状态 ─────────────────────────────────────────────────────────────────

type ButtonState = 'default' | 'loading' | 'progress' | 'done' | 'error';

interface FloorButtonContext {
    buttonEl: HTMLButtonElement;
    wrapperEl: HTMLElement;
    imageSlot: HTMLElement;
    promptText: string;
    rawNegativePrompt?: string;
    overridePrompt?: string;
    overrideNegativePrompt?: string;
    overrideInpaintData?: Record<string, unknown>;
    currentTaskId: string | null;
    state: ButtonState;
    messageElement: HTMLElement;
    messageIndex: number;
    buttonIndex: number;
    cleanupTaskListeners?: () => void;
}

const BUTTON_LABELS: Record<ButtonState, string> = {
    default:  '🎨 生成图像',
    loading:  '⏳ 提交中...',
    progress: '⚙️ 生成中',
    done:     '🔄 重新生成',
    error:    '❌ 重试',
};

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 扫描一条 AI 消息，查找所有占位符并注入生图按钮
 *
 * @param messageElement 消息 DOM 元素（.mes）
 * @param messageIndex 该消息在 chat 数组中的索引
 * @param taskManager TaskManager 实例
 * @param driver 当前图像驱动
 * @param settings 扩展设置
 */
export function injectFloorButtons(
    messageElement: HTMLElement,
    messageIndex: number,
    taskManager: TaskManager,
    driver: ImageDriver,
    settings: DrawAssistantSettings
): void {
    const mesTextEl = messageElement.querySelector<HTMLElement>('.mes_text');
    if (!mesTextEl) {
        logger.debug(`injectFloorButtons[${messageIndex}]: .mes_text not found`, messageElement);
        return;
    }

    const { placeholderStart, placeholderEnd } = settings;

    // 构建正则：兼容 `#` 及其 HTML 实体转义字符 (&#35; 和 &num;)
    const pattern = buildPlaceholderRegex(placeholderStart, placeholderEnd);

    // 扫描 mes_text 的文本内容（含 HTML）
    const originalHtml = mesTextEl.innerHTML;

    // 若当前 DOM 中没有任何未替换的占位符模式，直接返回
    if (!pattern.test(originalHtml)) {
        return;
    }

    // 重置正则匹配游标
    pattern.lastIndex = 0;

    // 调试：打印前 200 字符
    logger.debug(`injectFloorButtons[${messageIndex}]: scanning, pattern=${pattern.source}, html preview=${originalHtml.slice(0, 200).replace(/\n/g, '\\n')}`);

    let hasMatch = false;
    let matchIndex = 0;

    const newHtml = originalHtml.replace(pattern, (_fullMatch, capturedPrompt: string) => {
        hasMatch = true;
        // 清理 prompt 中可能的 HTML 标签（如 markdown 解析留下的 <br> 或 <p>）
        const cleanPrompt = capturedPrompt.replace(/<[^>]+>/g, ' ').trim();
        const btnId = `da-floor-btn-${messageIndex}-${matchIndex++}`;
        logger.debug(`injectFloorButtons[${messageIndex}]: match found! prompt="${cleanPrompt.slice(0, 60)}"`);
        return `<span class="da-floor-btn-placeholder" id="${btnId}" data-prompt="${escapeHtmlAttr(cleanPrompt)}"></span>`;
    });

    if (!hasMatch) {
        return;
    }

    // 更新 DOM
    mesTextEl.innerHTML = newHtml;



    // 为每个占位符创建实际按钮
    const placeholders = mesTextEl.querySelectorAll<HTMLElement>('.da-floor-btn-placeholder');
    logger.debug(`injectFloorButtons[${messageIndex}]: replacing ${placeholders.length} placeholder(s) with button(s)`);
    placeholders.forEach(async (placeholder, idx) => {
        const promptText = placeholder.getAttribute('data-prompt') ?? '';
        const ctx = createButton(placeholder, promptText, messageElement, messageIndex, idx);
        const callbacks = createActionCallbacks(ctx, settings);
        const hasRestored = await restoreSavedImage(ctx, callbacks);
        bindButtonEvents(ctx, taskManager, driver, settings, callbacks);

        if (!hasRestored && settings.autoGenerate) {
            logger.info(`autoGenerate 已开启，自动触发楼层生图: messageIndex=${messageIndex}, buttonIndex=${idx}`);
            setTimeout(() => {
                ctx.buttonEl.click();
            }, 800);
        }
    });
}

// ─── 按钮创建 ─────────────────────────────────────────────────────────────────

function createButton(
    placeholder: HTMLElement,
    promptText: string,
    messageElement: HTMLElement,
    messageIndex: number,
    buttonIndex: number
): FloorButtonContext {
    // 创建按钮外层包装（改为 div block 元素，确保图片独占一行）
    const wrapperEl = document.createElement('div');
    wrapperEl.className = 'da-floor-btn-wrapper';

    // 创建按钮
    const buttonEl = document.createElement('button');
    buttonEl.className = 'da-floor-btn da-floor-btn--default';
    buttonEl.textContent = BUTTON_LABELS.default;
    buttonEl.title = `提示词：${promptText}`;

    // 创建提示词预览（折叠显示）
    const promptPreview = document.createElement('span');
    promptPreview.className = 'da-floor-btn-prompt';
    promptPreview.textContent = truncateText(promptText, 40);
    promptPreview.title = promptText;

    // 创建该按钮专属的图像挂载 Slot（width:100% 确保换行独占）
    const imageSlot = document.createElement('div');
    imageSlot.className = 'da-floor-btn-img-slot';

    wrapperEl.appendChild(buttonEl);
    wrapperEl.appendChild(promptPreview);
    wrapperEl.appendChild(imageSlot);

    // 替换占位符
    placeholder.replaceWith(wrapperEl);

    const ctx: FloorButtonContext = {
        buttonEl,
        wrapperEl,
        imageSlot,
        promptText,
        currentTaskId: null,
        state: 'default',
        messageElement,
        messageIndex,
        buttonIndex,
    };

    return ctx;
}

/**
 * 创建与当前楼层关联的图像手势与操作栏回调映射
 *
 * @param ctx 楼层按钮上下文对象
 * @param settings 扩展全局设置
 * @returns 包含提示词、重新生成、局部重绘等动作回调的服务对象
 */
function createActionCallbacks(
    ctx: FloorButtonContext,
    _settings: DrawAssistantSettings
): import('./image-renderer').ImageActionCallbacks {
    const triggerInpaint = () => {
        const imgEl = ctx.imageSlot.querySelector<HTMLImageElement>('.da-generated-img');
        if (imgEl?.src) {
            import('./components/inpaint-canvas-modal').then(({ openInpaintCanvasModal }) => {
                openInpaintCanvasModal({
                    imageSrc: imgEl.src,
                    initialPrompt: ctx.overridePrompt || ctx.promptText,
                    onConfirm: (result) => {
                        logger.info('局部重绘请求就绪，准备触发生图', result.prompt);
                        ctx.overridePrompt = result.prompt;
                        ctx.overrideInpaintData = {
                            isInpaint: true,
                            initImage: result.initImage,
                            maskImage: result.maskImage,
                        };
                        ctx.buttonEl.click();
                    }
                });
            }).catch(err => logger.error('加载 InpaintCanvasModal 失败', err));
        }
    };

    const getCurrentImageSrc = (): string => {
        const imgEl = ctx.imageSlot.querySelector<HTMLImageElement>('.da-generated-img');
        return imgEl?.src || '';
    };

    const getSavedUuid = (): string | undefined => {
        try {
            const stCtx = getContext();
            const msg = stCtx.chat?.[ctx.messageIndex];
            if (!msg) return undefined;

            const swipeId = msg.swipe_id ?? (msg.extra?.swipe_id as number | undefined) ?? 0;
            const daImagesRoot = msg.extra?.da_images as Record<string | number, unknown> | undefined;
            if (!daImagesRoot) return undefined;

            const swipeObj = (daImagesRoot[swipeId] ?? daImagesRoot[String(swipeId)]) as Record<string | number, SavedImageMeta> | undefined;
            if (swipeObj && typeof swipeObj === 'object') {
                return swipeObj[ctx.buttonIndex]?.uuid ?? swipeObj[String(ctx.buttonIndex)]?.uuid;
            }
        } catch (e) {
            // ignore
        }
        return undefined;
    };

    return {
        promptText: ctx.overridePrompt || ctx.promptText,
        negativePrompt: ctx.overrideNegativePrompt ?? ctx.rawNegativePrompt ?? '',
        messageIndex: ctx.messageIndex,
        buttonIndex: ctx.buttonIndex,
        get imageSrc() {
            return getCurrentImageSrc();
        },
        get uuid() {
            return getSavedUuid();
        },
        onConfirm: (newPrompt, newNegativePrompt) => {
            ctx.overridePrompt = newPrompt;
            if (newNegativePrompt !== undefined) {
                ctx.overrideNegativePrompt = newNegativePrompt;
            }
            ctx.buttonEl.click();
        },
        onRegenerate: () => {
            ctx.buttonEl.click();
        },
        onInpaint: triggerInpaint,
        onDelete: () => {
            import('./components/modals').then(({ showConfirmDialog }) => {
                showConfirmDialog({
                    title: '删除图像确认',
                    message: '确定要移除当前导出的生成的图像吗？',
                    isDangerous: true,
                }).then(confirmed => {
                    if (confirmed) {
                        ctx.imageSlot.innerHTML = '';
                        setButtonState(ctx, 'default');
                        logger.info(`已移除第 #${ctx.messageIndex} 条消息的已生成图像卡片`);
                    }
                });
            }).catch(err => logger.error('加载 ConfirmDialog 失败', err));
        }
    };
}

/** 尝试从 IndexedDB (及旧 extra 结构) 恢复历史生成的图像 */
async function restoreSavedImage(
    ctx: FloorButtonContext,
    callbacks?: import('./image-renderer').ImageActionCallbacks
): Promise<boolean> {
    try {
        const stCtx = getContext();
        const msg = stCtx.chat?.[ctx.messageIndex];
        if (!msg) return false;

        const swipeId = msg.swipe_id ?? (msg.extra?.swipe_id as number | undefined) ?? 0;
        const daImagesRoot = msg.extra?.da_images as Record<string | number, unknown> | undefined;
        if (!daImagesRoot) return false;

        let savedMeta: SavedImageMeta | undefined;

        const swipeObj = (daImagesRoot[swipeId] ?? daImagesRoot[String(swipeId)]) as Record<string | number, SavedImageMeta> | undefined;
        if (swipeObj && typeof swipeObj === 'object') {
            savedMeta = swipeObj[ctx.buttonIndex] ?? swipeObj[String(ctx.buttonIndex)];
        } else if (daImagesRoot[ctx.buttonIndex] !== undefined || daImagesRoot[String(ctx.buttonIndex)] !== undefined) {
            // 兼容回退旧格式
            savedMeta = (daImagesRoot[ctx.buttonIndex] ?? daImagesRoot[String(ctx.buttonIndex)]) as SavedImageMeta;
        }

        if (!savedMeta) return false;

        let imageDataStr: string | null = null;
        let mime = savedMeta.mime || 'image/png';

        // 1. 新规范：从 IndexedDB 按 UUID 获取图像
        if (savedMeta.uuid) {
            const record = await getImageFromDB(savedMeta.uuid);
            if (record) {
                imageDataStr = record.data;
                mime = record.mime || mime;
                if (record.rawNegativePrompt !== undefined) {
                    ctx.rawNegativePrompt = record.rawNegativePrompt;
                }
            }
        }
        // 2. 旧数据平滑无缝迁移：若读到存量 Base64，自动存入 IndexedDB 并把 chat.json 中的 Base64 擦除
        else if (savedMeta.base64) {
            imageDataStr = savedMeta.base64;
            const newUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : `migrated_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            await saveImageToDB(newUuid, savedMeta.base64, mime, savedMeta.prompt || ctx.promptText);

            // 清除巨型 Base64，仅留 uuid 引用
            delete savedMeta.base64;
            savedMeta.uuid = newUuid;

            const saveFn = stCtx.saveChatConditional ?? (window as unknown as { saveChatConditional?: () => void }).saveChatConditional;
            if (typeof saveFn === 'function') {
                saveFn();
            }
        }

        if (imageDataStr) {
            renderImageToMessage(ctx.imageSlot, imageDataStr, mime, callbacks);
            setButtonState(ctx, 'done');
            return true;
        }
    } catch (err) {
        logger.warn('恢复历史图像失败', err);
    }
    return false;
}

// ─── 事件绑定 ─────────────────────────────────────────────────────────────────

function bindButtonEvents(
    ctx: FloorButtonContext,
    taskManager: TaskManager,
    driver: ImageDriver,
    settings: DrawAssistantSettings,
    callbacks?: import('./image-renderer').ImageActionCallbacks
): void {

    ctx.buttonEl.addEventListener('click', async () => {
        if (ctx.state === 'loading') return; // 防抖

        if (ctx.state === 'progress' && ctx.currentTaskId) {
            // 点击进行中的按钮 → 取消
            logger.warn(`用户点击取消生图任务: messageIndex=${ctx.messageIndex}, taskId=${ctx.currentTaskId}`);
            taskManager.cancelWithDriver(ctx.currentTaskId, driver);
            setButtonState(ctx, 'default');
            return;
        }

        // 使用楼层专属编辑后的提示词（若有）或原生抽取提示词（注：overridePrompt 保持持久，重新生成继续沿用）
        const effectivePrompt = ctx.overridePrompt ?? ctx.promptText;

        // 开始生图
        logger.info(`用户触发楼层生图: messageIndex=${ctx.messageIndex}, prompt="${effectivePrompt.slice(0, 50)}..."`);
        setButtonState(ctx, 'loading');

        try {
            const params = await buildGenerateParams(effectivePrompt, settings, ctx.messageIndex, ctx.buttonIndex, ctx);
            const taskId = await taskManager.submit(params, driver, ctx.messageIndex);
            ctx.currentTaskId = taskId;
            setButtonState(ctx, 'progress');

            // 若之前已有残留监听器，优先触发安全清理
            if (ctx.cleanupTaskListeners) {
                ctx.cleanupTaskListeners();
                ctx.cleanupTaskListeners = undefined;
            }

            const unbinds: Array<() => void> = [];

            const cleanup = () => {
                unbinds.forEach(fn => {
                    try { fn(); } catch { /* ignore */ }
                });
                unbinds.length = 0;
                if (ctx.cleanupTaskListeners === cleanup) {
                    ctx.cleanupTaskListeners = undefined;
                }
            };
            ctx.cleanupTaskListeners = cleanup;

            const onProgress = (tid: string, percent: number, msg?: string) => {
                if (tid !== taskId) return;
                updateProgress(ctx, percent, msg);
            };

            const onComplete = (tid: string, result: import('../drivers/types').GenerateResult) => {
                if (tid !== taskId) return;
                cleanup();

                logger.info(`楼层生图任务完成: messageIndex=${ctx.messageIndex}, taskId=${taskId}`);
                renderImageToMessage(ctx.imageSlot, result.imageData, result.mimeType, callbacks);
                setButtonState(ctx, 'done');
                ctx.currentTaskId = null;

                // 持久化保存图像到聊天记录 extra 字段（若已启用）
                void persistImageToChat(ctx, result.imageData, result.mimeType, settings, result.seed);
            };

            const onError = (tid: string, error: Error) => {
                if (tid !== taskId) return;
                cleanup();

                logger.error(`楼层生图任务失败: messageIndex=${ctx.messageIndex}, taskId=${taskId}`, error);
                setButtonState(ctx, 'error');
                ctx.buttonEl.title = `错误：${error.message}`;
                ctx.currentTaskId = null;

                logger.error('楼层生图触发渲染错误', error);
                showToastError(error.message);
            };

            const onCancelled = (tid: string) => {
                if (tid !== taskId) return;
                cleanup();

                setButtonState(ctx, 'default');
                ctx.currentTaskId = null;
            };

            unbinds.push(
                taskManager.on('progress', onProgress),
                taskManager.on('complete', onComplete),
                taskManager.on('error', onError),
                taskManager.on('cancelled', onCancelled)
            );

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.error('提交楼层生图任务失败', err);
            setButtonState(ctx, 'error');
            ctx.currentTaskId = null;
            showToastError(errorMsg);
        }
    });
}

/** 辅助转码工具：根据设置转码图片 */
async function compressImageData(
    imageData: string,
    mimeType: string,
    format?: 'original' | 'webp' | 'jpeg',
    quality: number = 0.85
): Promise<{ data: string; mime: string }> {
    if (!format || format === 'original') {
        return { data: imageData, mime: mimeType };
    }
    const targetMime = format === 'webp' ? 'image/webp' : 'image/jpeg';
    if (mimeType === targetMime) {
        return { data: imageData, mime: mimeType };
    }
    try {
        return await new Promise((resolve) => {
            const img = new Image();
            const src = imageData.startsWith('data:') ? imageData : `data:${mimeType};base64,${imageData}`;

            // 5 秒加载超时保底，规避转码异步挂起
            const timer = setTimeout(() => {
                logger.warn('图片转码加载超时，降级回退原始格式');
                cleanup();
                resolve({ data: imageData, mime: mimeType });
            }, 5000);

            const cleanup = () => {
                clearTimeout(timer);
                img.onload = null;
                img.onerror = null;
            };

            img.onload = () => {
                cleanup();
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, img.width);
                    canvas.height = Math.max(1, img.height);
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0);
                        const dataUrl = canvas.toDataURL(targetMime, quality);
                        const base64 = dataUrl.split(',')[1] || imageData;
                        resolve({ data: base64, mime: targetMime });
                        return;
                    }
                } catch (e) {
                    logger.warn('Canvas 绘制转码图片异常，降级回退原始格式', e);
                }
                resolve({ data: imageData, mime: mimeType });
            };

            img.onerror = (err) => {
                cleanup();
                logger.warn('加载转码图片源失败', err);
                resolve({ data: imageData, mime: mimeType });
            };

            img.src = src;
        });
    } catch (err) {
        logger.warn('压缩图像降级回退原始格式', err);
        return { data: imageData, mime: mimeType };
    }
}

/** 持久化保存图片：检查 persistToChat 阻断与 imageStorageMode 分流 */
async function persistImageToChat(
    ctx: FloorButtonContext,
    rawImageData: string,
    rawMimeType: string,
    settings: DrawAssistantSettings,
    seed?: number
): Promise<void> {
    if (!settings.persistToChat) return;

    try {
        const stCtx = getContext();
        const msg = stCtx.chat?.[ctx.messageIndex];
        if (!msg) return;

        // 转码为选定格式 (PNG / WebP / JPEG)
        const { data: imageData, mime: mimeType } = await compressImageData(
            rawImageData,
            rawMimeType,
            settings.imageFormat,
            settings.imageQuality
        );

        // 1. 优先存入 IndexedDB（实现二进制媒体与聊天 JSON 的解耦）
        const uuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const params = await buildGenerateParams(ctx.promptText, settings, ctx.messageIndex, ctx.buttonIndex, ctx);
        const fullPositivePrompt = params.prompt;
        const fullNegativePrompt = params.negativePrompt;

        const metadata = {
            provider: settings.provider ?? 'comfyui',
            ckptName: settings.ckptName,
            clipName: settings.clipName,
            vaeName: settings.vaeName,
            samplerName: settings.samplerName,
            scheduler: settings.scheduler,
            steps: settings.steps,
            cfgScale: settings.cfgScale,
            width: settings.width,
            height: settings.height,
            fullPositivePrompt,
            fullNegativePrompt,
            negativePrompt: fullNegativePrompt,
            seed: seed ?? (params.seed !== -1 ? params.seed : undefined),
            denoise: params.denoise,
            maskBlur: params.maskBlur,
            growMaskBy: params.growMaskBy,
        };

        const rawPos = ctx.overridePrompt || ctx.promptText;
        const rawNeg = ctx.overrideNegativePrompt ?? ctx.rawNegativePrompt ?? '';

        try {
            await saveImageToDB(uuid, imageData, mimeType, rawPos, metadata, rawNeg);
        } catch (dbErr) {
            logger.error('保存图像数据至 IndexedDB 失败', dbErr);
            FeedbackService.toastWarning('图像渲染成功，但本地 IndexedDB 存储失败（可能存储配额已满）', '存储异常');
            return;
        }

        // 2. 宿主聊天记录 message.extra.da_images 中仅持久化 UUID 引用
        const swipeId = msg.swipe_id ?? (msg.extra?.swipe_id as number | undefined) ?? 0;
        const extra = { ...(msg.extra ?? {}) };
        const daImagesRoot = { ...(extra.da_images as Record<string | number, unknown> ?? {}) };
        const swipeImages = { ...(daImagesRoot[swipeId] as Record<number, unknown> ?? {}) };

        const imageEntry: Record<string, unknown> = {
            uuid,
            mime: mimeType,
            prompt: fullPositivePrompt,
            timestamp: Date.now(),
        };

        if (settings.extraSaveToChat) {
            imageEntry.base64 = imageData;
        }

        swipeImages[ctx.buttonIndex] = imageEntry;

        daImagesRoot[swipeId] = swipeImages;
        extra.da_images = daImagesRoot;
        msg.extra = extra;

        const saveFn = stCtx.saveChat ?? stCtx.saveChatConditional ?? (window as unknown as { saveChat?: () => void }).saveChat;
        if (typeof saveFn === 'function') {
            saveFn();
        }
    } catch (err) {
        logger.warn('持久化图片 UUID 引用至聊天记录失败', err);
        FeedbackService.toastWarning('图像已存入本地图库，但写入聊天记录失败，刷新后图像可能从楼层解绑', '存储警告');
    }
}

// ─── 按钮状态更新 ─────────────────────────────────────────────────────────────

function setButtonState(ctx: FloorButtonContext, state: ButtonState): void {
    ctx.state = state;
    ctx.buttonEl.textContent = BUTTON_LABELS[state];
    ctx.buttonEl.className = `da-floor-btn da-floor-btn--${state}`;
    ctx.buttonEl.disabled = state === 'loading';

    if (state === 'progress') {
        ctx.buttonEl.title = '点击可取消';
    } else if (state === 'done') {
        ctx.buttonEl.title = '点击重新生成';
    } else if (state === 'error') {
        ctx.buttonEl.title = '生图失败，点击重试';
    }
}

function updateProgress(ctx: FloorButtonContext, percent: number, _message?: string): void {
    if (ctx.state !== 'progress') return;
    if (percent >= 0) {
        ctx.buttonEl.textContent = `⚙️ ${percent}%`;
    } else {
        ctx.buttonEl.textContent = '⚙️ 预览中...';
    }
}

async function buildGenerateParams(
    promptText: string,
    settings: DrawAssistantSettings,
    messageIndex = 0,
    buttonIndex = 0,
    ctx?: FloorButtonContext
): Promise<GenerateOptions> {
    const effectivePrompt = ctx?.overridePrompt || promptText;
    const { positive, negative, rawPositive, rawNegative } = await buildFinalPrompt(effectivePrompt, settings, {
        messageIndex,
        buttonIndex,
        rawPrompt: effectivePrompt,
    });

    if (ctx) {
        if (!ctx.overridePrompt) ctx.promptText = rawPositive;
        if (ctx.overrideNegativePrompt === undefined) ctx.rawNegativePrompt = rawNegative;
    }

    const inpaintData = ctx?.overrideInpaintData;
    if (ctx) {
        // 重置单次重绘瞬态数据，确保后续重新生图自动切回常规文生图，而 overridePrompt 则持续有效
        ctx.overrideInpaintData = undefined;
    }

    const options: GenerateOptions = {
        prompt: positive,
        negativePrompt: negative,
        ckptName: settings.ckptName,
        clipName: settings.clipName,
        vaeName: settings.vaeName,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        cfgScale: settings.cfgScale,
        samplerName: settings.samplerName,
        scheduler: settings.scheduler,
        seed: -1,
    };

    if (inpaintData) {
        options.denoise = settings.inpaintDenoise ?? 0.75;
        options.maskBlur = settings.inpaintMaskBlur ?? 8;
        options.growMaskBy = settings.inpaintGrowMask ?? 6;
        options.extra = { ...inpaintData };
    }

    return options;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 构建占位符正则，支持简洁高效匹配与 `#` / HTML 实体兼容
 */
function buildPlaceholderRegex(start: string, end: string): RegExp {
    const s = (start && start.trim()) ? start.trim() : 'image###';
    const e = (end && end.trim()) ? end.trim() : '###';
    const startPattern = escapeRegex(s).replace(/#/g, '(?:#|&#35;|&num;)');
    const endPattern = escapeRegex(e).replace(/#/g, '(?:#|&#35;|&num;)');
    return new RegExp(`${startPattern}([\\s\\S]*?)${endPattern}`, 'gi');
}

function truncateText(text: string, maxLen: number): string {
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}
