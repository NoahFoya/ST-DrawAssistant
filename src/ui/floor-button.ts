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
 * 规范参考：
 * - .agents/Skills/st-image-generation-patterns/SKILL.md §5 (楼层按钮交互模式与生命周期)
 */


import { TaskManager } from '../task/manager';
import type { ImageDriver } from '../drivers/types';
import type { DrawAssistantSettings } from '../settings/types';
import { renderImageToMessage, renderPreviewToMessage, clearPreview } from './image-renderer';
import { getContext } from '../core/context';
import { saveImageToDB, getImageFromDB } from '../storage/image-db';
import { logger } from '../core/logger';

import { escapeHtmlAttr } from '../utils/html';
import { injectCharacterPlaceholders } from '../core/character-injection';

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
    placeholders.forEach((placeholder, idx) => {
        const promptText = placeholder.getAttribute('data-prompt') ?? '';
        const ctx = createButton(placeholder, promptText, messageElement, messageIndex, idx);
        restoreSavedImage(ctx);
        bindButtonEvents(ctx, taskManager, driver, settings);
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

/** 尝试从 IndexedDB (及旧 extra 结构) 恢复历史生成的图像 */
async function restoreSavedImage(ctx: FloorButtonContext): Promise<void> {
    try {
        const stCtx = getContext();
        const msg = stCtx.chat?.[ctx.messageIndex];
        if (!msg) return;

        const swipeId = msg.swipe_id ?? (msg.extra?.swipe_id as number | undefined) ?? 0;
        const daImagesRoot = msg.extra?.da_images as Record<string | number, unknown> | undefined;
        if (!daImagesRoot) return;

        let savedMeta: SavedImageMeta | undefined;

        if (daImagesRoot[swipeId] && typeof daImagesRoot[swipeId] === 'object') {
            const swipeImages = daImagesRoot[swipeId] as Record<number, SavedImageMeta>;
            savedMeta = swipeImages[ctx.buttonIndex];
        } else if (daImagesRoot[ctx.buttonIndex]) {
            // 兼容回退旧格式
            savedMeta = daImagesRoot[ctx.buttonIndex] as SavedImageMeta;
        }

        if (!savedMeta) return;

        let imageDataStr: string | null = null;
        let mime = savedMeta.mime || 'image/png';

        // 1. 新规范：从 IndexedDB 按 UUID 获取图像
        if (savedMeta.uuid) {
            const record = await getImageFromDB(savedMeta.uuid);
            if (record) {
                imageDataStr = record.data;
                mime = record.mime || mime;
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
            renderImageToMessage(ctx.imageSlot, imageDataStr, mime);
            setButtonState(ctx, 'done');
        }
    } catch (err) {
        logger.warn('恢复历史图像失败', err);
    }
}

// ─── 事件绑定 ─────────────────────────────────────────────────────────────────

function bindButtonEvents(
    ctx: FloorButtonContext,
    taskManager: TaskManager,
    driver: ImageDriver,
    settings: DrawAssistantSettings
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

        // 开始生图
        logger.info(`用户触发楼层生图: messageIndex=${ctx.messageIndex}, prompt="${ctx.promptText.slice(0, 50)}..."`);
        setButtonState(ctx, 'loading');

        try {
            const params = buildGenerateParams(ctx.promptText, settings);
            const taskId = await taskManager.submit(params, driver, ctx.messageIndex);
            ctx.currentTaskId = taskId;
            setButtonState(ctx, 'progress');

            // 若之前已有残留监听器，优先触发安全清理
            if (ctx.cleanupTaskListeners) {
                ctx.cleanupTaskListeners();
                ctx.cleanupTaskListeners = undefined;
            }

            // 订阅任务事件与注册清理例程
            const cleanup = () => {
                taskManager.off('progress', onProgress);
                taskManager.off('complete', onComplete);
                taskManager.off('error', onError);
                taskManager.off('cancelled', onCancelled);
                if (ctx.cleanupTaskListeners === cleanup) {
                    ctx.cleanupTaskListeners = undefined;
                }
            };
            ctx.cleanupTaskListeners = cleanup;

            const onProgress = (tid: string, percent: number, msg?: string, previewUrl?: string) => {
                if (tid !== taskId) return;
                updateProgress(ctx, percent, msg);
                if (previewUrl) {
                    renderPreviewToMessage(ctx.imageSlot, previewUrl);
                }
            };

            const onComplete = (tid: string, result: import('../drivers/types').GenerateResult) => {
                if (tid !== taskId) return;
                cleanup();

                logger.info(`楼层生图任务完成: messageIndex=${ctx.messageIndex}, taskId=${taskId}`);
                clearPreview(ctx.imageSlot);
                renderImageToMessage(ctx.imageSlot, result.imageData, result.mimeType);
                setButtonState(ctx, 'done');
                ctx.currentTaskId = null;

                // 持久化保存图像到聊天记录 extra 字段（若已启用）
                void persistImageToChat(ctx, result.imageData, result.mimeType, settings);
            };

            const onError = (tid: string, error: Error) => {
                if (tid !== taskId) return;
                cleanup();

                logger.error(`楼层生图任务失败: messageIndex=${ctx.messageIndex}, taskId=${taskId}`, error);
                clearPreview(ctx.imageSlot);
                setButtonState(ctx, 'error');
                ctx.buttonEl.title = `错误：${error.message}`;
                ctx.currentTaskId = null;

                logger.error('楼层生图触发渲染错误', error);
                showToastError(error.message);
            };

            const onCancelled = (tid: string) => {
                if (tid !== taskId) return;
                cleanup();

                clearPreview(ctx.imageSlot);
                setButtonState(ctx, 'default');
                ctx.currentTaskId = null;
            };

            taskManager.on('progress', onProgress);
            taskManager.on('complete', onComplete);
            taskManager.on('error', onError);
            taskManager.on('cancelled', onCancelled);

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.error('提交楼层生图任务失败', err);
            setButtonState(ctx, 'error');
            ctx.currentTaskId = null;
            showToastError(errorMsg);
        }
    });
}

/** 辅助函数：显示 ST 全局 Toast 错误弹窗 */
function showToastError(message: string): void {
    const win = window as unknown as { toastr?: { error: (msg: string, title?: string) => void } };
    if (win.toastr && typeof win.toastr.error === 'function') {
        win.toastr.error(message, '绘画助手 生图失败');
    }
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
    settings: DrawAssistantSettings
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

        // 1. 始终存入 IndexedDB（独立高效且防止聊天记录膨胀）
        const uuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const params = buildGenerateParams(ctx.promptText, settings);
        const fullPositivePrompt = params.prompt;
        const fullNegativePrompt = params.negativePrompt;

        const metadata = {
            provider: settings.provider ?? 'comfyui',
            ckptName: settings.ckptName,
            samplerName: settings.samplerName,
            steps: settings.steps,
            cfgScale: settings.cfgScale,
            width: settings.width,
            height: settings.height,
            negativePrompt: fullNegativePrompt,
        };

        await saveImageToDB(uuid, imageData, mimeType, fullPositivePrompt, metadata);

        // 2. msg.extra.da_images 中保存 UUID 引用（以及可选的额外 Base64 副本）
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

        const saveFn = stCtx.saveChatConditional ?? (window as unknown as { saveChatConditional?: () => void }).saveChatConditional;
        if (typeof saveFn === 'function') {
            saveFn();
        }
    } catch (err) {
        logger.warn('持久化图片引用到聊天记录失败（若 saveImageToDB 已成功，图像数据在 IndexedDB 中仍存在，但 chat 引用丢失，下次会话可能无法通过 UUID 恢复图像）', err);
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

// ─── 参数构建 ─────────────────────────────────────────────────────────────────

function buildGenerateParams(
    promptText: string,
    settings: DrawAssistantSettings
): import('../drivers/types').GenerateOptions {
    let positive = promptText;
    let negativeFromPrompt = '';

    if (promptText.includes('|')) {
        const parts = promptText.split('|');
        positive = parts[0].trim();
        negativeFromPrompt = parts.slice(1).join('|').trim();
    }

    const loraSuffix = (settings.loras && settings.loras.length > 0)
        ? settings.loras.filter(l => l.name).map(l => `<lora:${l.name}:${l.weight}>`).join(', ')
        : '';

    const fullPositive = [
        settings.checkpointPositivePrefix,
        settings.promptPrefix,
        positive,
        settings.promptSuffix,
        loraSuffix
    ].map(s => (s ?? '').trim()).filter(Boolean).join(', ');

    const injectedPositive = injectCharacterPlaceholders(fullPositive, promptText);

    const fullNegative = [
        settings.checkpointNegativePrefix,
        settings.negativePrefix,
        negativeFromPrompt
    ].map(s => (s ?? '').trim()).filter(Boolean).join(', ');

    return {
        prompt: injectedPositive,
        negativePrompt: fullNegative,
        ckptName: settings.ckptName,
        clipName: settings.clipName,
        vaeName: settings.vaeName,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        cfgScale: settings.cfgScale,
        samplerName: settings.samplerName,
        scheduler: settings.scheduler,
        seed: -1, // 随机种子
    };
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 构建占位符正则，兼容 `#` 和 HTML 实体转义符 `&#35;` / `&num;`
 */
function buildPlaceholderRegex(start: string, end: string): RegExp {
    const startPattern = escapeRegex(start).replace(/#/g, '(?:#|&#35;|&num;)');
    const endPattern = escapeRegex(end).replace(/#/g, '(?:#|&#35;|&num;)');
    return new RegExp(`${startPattern}([\\s\\S]*?)${endPattern}`, 'gi');
}

function truncateText(text: string, maxLen: number): string {
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}
