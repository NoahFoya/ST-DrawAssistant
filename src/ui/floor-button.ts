/**
 * 楼层生图按钮控制器
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
 * 参考：.agents/Skills/st-image-generation-patterns/SKILL.md §5
 */

import { TaskManager } from '../task/manager';
import type { ImageDriver } from '../drivers/types';
import type { DrawAssistantSettings } from '../settings/types';
import { renderImageToMessage, renderPreviewToMessage, clearPreview } from './image-renderer';
import { getContext } from '../core/context';

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
        console.debug(`[draw-assistant] injectFloorButtons[${messageIndex}]: .mes_text not found`, messageElement);
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
    console.debug(`[draw-assistant] injectFloorButtons[${messageIndex}]: scanning, pattern=${pattern.source}, html preview=${originalHtml.slice(0, 200).replace(/\n/g, '\\n')}`);

    let hasMatch = false;
    let matchIndex = 0;

    const newHtml = originalHtml.replace(pattern, (_fullMatch, capturedPrompt: string) => {
        hasMatch = true;
        // 清理 prompt 中可能的 HTML 标签（如 markdown 解析留下的 <br> 或 <p>）
        const cleanPrompt = capturedPrompt.replace(/<[^>]+>/g, ' ').trim();
        const btnId = `da-floor-btn-${messageIndex}-${matchIndex++}`;
        console.debug(`[draw-assistant] injectFloorButtons[${messageIndex}]: match found! prompt="${cleanPrompt.slice(0, 60)}"`);
        return `<span class="da-floor-btn-placeholder" id="${btnId}" data-prompt="${escapeHtmlAttr(cleanPrompt)}"></span>`;
    });

    if (!hasMatch) {
        return;
    }

    // 更新 DOM
    mesTextEl.innerHTML = newHtml;
    messageElement.setAttribute('data-da-injected', 'true');

    // 为每个占位符创建实际按钮
    const placeholders = mesTextEl.querySelectorAll<HTMLElement>('.da-floor-btn-placeholder');
    console.debug(`[draw-assistant] injectFloorButtons[${messageIndex}]: replacing ${placeholders.length} placeholder(s) with button(s)`);
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
    // 创建按钮外层包装
    const wrapperEl = document.createElement('span');
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

    // 创建该按钮专属的图像挂载 Slot
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

/** 尝试从聊天记录恢复历史生成的图像 */
function restoreSavedImage(ctx: FloorButtonContext): void {
    try {
        const stCtx = getContext();
        const msg = stCtx.chat?.[ctx.messageIndex];
        const swipeId = msg?.swipe_id ?? (msg?.extra?.swipe_id as number | undefined) ?? 0;

        const daImagesRoot = msg?.extra?.da_images as Record<string | number, unknown> | undefined;
        if (!daImagesRoot) return;

        let savedImg: { base64: string; mime?: string } | undefined;

        if (daImagesRoot[swipeId] && typeof daImagesRoot[swipeId] === 'object') {
            const swipeImages = daImagesRoot[swipeId] as Record<number, { base64: string; mime?: string }>;
            savedImg = swipeImages[ctx.buttonIndex];
        } else if (daImagesRoot[ctx.buttonIndex] && (daImagesRoot[ctx.buttonIndex] as { base64?: string }).base64) {
            // 兼容回退旧格式
            savedImg = daImagesRoot[ctx.buttonIndex] as { base64: string; mime?: string };
        }

        if (savedImg && savedImg.base64) {
            renderImageToMessage(ctx.imageSlot, savedImg.base64, savedImg.mime || 'image/png');
            setButtonState(ctx, 'done');
        }
    } catch (err) {
        console.warn('[ST-DrawAssistant] 恢复历史图像失败:', err);
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
            taskManager.cancelWithDriver(ctx.currentTaskId, driver);
            setButtonState(ctx, 'default');
            return;
        }

        // 开始生图
        setButtonState(ctx, 'loading');

        try {
            const params = buildGenerateParams(ctx.promptText, settings);
            const taskId = await taskManager.submit(params, driver, ctx.messageIndex);
            ctx.currentTaskId = taskId;
            setButtonState(ctx, 'progress');

            // 订阅任务事件
            const onProgress = (tid: string, percent: number, msg?: string, previewUrl?: string) => {
                if (tid !== taskId) return;
                updateProgress(ctx, percent, msg);
                if (previewUrl) {
                    renderPreviewToMessage(ctx.imageSlot, previewUrl);
                }
            };

            const onComplete = (tid: string, result: import('../drivers/types').GenerateResult) => {
                if (tid !== taskId) return;
                taskManager.off('progress', onProgress);
                taskManager.off('complete', onComplete);
                taskManager.off('error', onError);
                taskManager.off('cancelled', onCancelled);

                clearPreview(ctx.imageSlot);
                renderImageToMessage(ctx.imageSlot, result.imageData, result.mimeType);
                setButtonState(ctx, 'done');
                ctx.currentTaskId = null;

                // 持久化保存图像到聊天记录 extra 字段
                persistImageToChat(ctx, result.imageData, result.mimeType);
            };

            const onError = (tid: string, error: Error) => {
                if (tid !== taskId) return;
                taskManager.off('progress', onProgress);
                taskManager.off('complete', onComplete);
                taskManager.off('error', onError);
                taskManager.off('cancelled', onCancelled);

                clearPreview(ctx.imageSlot);
                setButtonState(ctx, 'error');
                ctx.buttonEl.title = `错误：${error.message}`;
                ctx.currentTaskId = null;

                console.error('[ST-DrawAssistant] 生图错误:', error);
            };

            const onCancelled = (tid: string) => {
                if (tid !== taskId) return;
                taskManager.off('progress', onProgress);
                taskManager.off('complete', onComplete);
                taskManager.off('error', onError);
                taskManager.off('cancelled', onCancelled);

                clearPreview(ctx.imageSlot);
                setButtonState(ctx, 'default');
                ctx.currentTaskId = null;
            };

            taskManager.on('progress', onProgress);
            taskManager.on('complete', onComplete);
            taskManager.on('error', onError);
            taskManager.on('cancelled', onCancelled);

        } catch (err) {
            console.error('[ST-DrawAssistant] 提交任务失败:', err);
            setButtonState(ctx, 'error');
            ctx.currentTaskId = null;
        }
    });
}

/** 持久化保存图片到 ST 聊天记录 extra (支持 swipe_id 分隔离区) */
function persistImageToChat(ctx: FloorButtonContext, imageData: string, mimeType: string): void {
    try {
        const stCtx = getContext();
        const msg = stCtx.chat?.[ctx.messageIndex];
        if (msg) {
            const swipeId = msg.swipe_id ?? (msg.extra?.swipe_id as number | undefined) ?? 0;
            const extra = { ...(msg.extra ?? {}) };
            const daImagesRoot = { ...(extra.da_images as Record<string | number, unknown> ?? {}) };
            
            const swipeImages = { ...(daImagesRoot[swipeId] as Record<number, unknown> ?? {}) };
            swipeImages[ctx.buttonIndex] = {
                base64: imageData,
                mime: mimeType,
                prompt: ctx.promptText,
                timestamp: Date.now(),
            };

            daImagesRoot[swipeId] = swipeImages;
            extra.da_images = daImagesRoot;
            msg.extra = extra; // 刷新对象引用，触发 ST 标记

            const saveFn = stCtx.saveChatConditional ?? window.saveChatConditional ?? (window as unknown as Record<string, () => void>)['saveChat'];
            if (typeof saveFn === 'function') {
                saveFn();
            } else {
                console.warn('[ST-DrawAssistant] saveChatConditional / saveChat 函数不可用');
            }
        }
    } catch (err) {
        console.warn('[ST-DrawAssistant] 无法持久化图片到聊天记录:', err);
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
    return {
        prompt: promptText,
        negativePrompt: settings.negativePrefix,
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

function escapeHtmlAttr(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncateText(text: string, maxLen: number): string {
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}
