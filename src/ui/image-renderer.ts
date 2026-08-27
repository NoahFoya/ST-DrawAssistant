/**
 * @module ui/image-renderer
 * @description 图像 DOM 渲染器模块
 *
 * 职责：
 * - 将生成的 Base64/Object URL 图像数据渲染到聊天消息 DOM 节点中
 * - 读取设置中的 imageDisplay 样式配置应用布局对齐、缩放与圆角
 * - 区分单击 (Lightbox 大图) 与长按/右键 (快捷操作面板) 手势
 * - 渲染低质量实时生成预览图，并在状态更新时及时释放旧 Object URL 资源
 */

import { loadSettings } from '../settings/manager';
import { logger } from '../core/logger';
import { openImageActionPanel, type ImageActionCallbacks } from './components/controls';

export type { ImageActionCallbacks };

/**
 * 渲染图像到指定按钮的专属图像 Slot
 *
 * @param containerSlot 按钮关联的图像 Slot 节点 (.da-floor-btn-img-slot)
 * @param base64Data base64 图像编码
 * @param mimeType 图像 MIME 类型
 * @param actionCallbacks 快捷操作面板回调（可选）
 */
export function renderImageToMessage(
    containerSlot: HTMLElement,
    base64Data: string,
    mimeType: string = 'image/png',
    actionCallbacks?: ImageActionCallbacks
): HTMLElement {
    if (!containerSlot) return containerSlot;

    const settings = loadSettings();
    const display = settings.imageDisplay ?? {
        align: 'left',
        objectFit: 'contain',
        maxHeight: 0,
        maxWidthPct: 100,
        rounded: true,
    };

    // 1. 设置 Slot 容器的对齐样式
    containerSlot.style.display = 'flex';
    containerSlot.style.width = '100%';

    if (display.align === 'center') {
        containerSlot.style.justifyContent = 'center';
    } else if (display.align === 'right') {
        containerSlot.style.justifyContent = 'flex-end';
    } else {
        containerSlot.style.justifyContent = 'flex-start';
    }

    // 销毁旧的 Object URL（若有）
    const oldImg = containerSlot.querySelector<HTMLImageElement>('.da-generated-img');
    if (oldImg?.src?.startsWith('blob:')) {
        URL.revokeObjectURL(oldImg.src);
    }

    // 创建新图像节点
    const srcUrl = base64Data.startsWith('data:') || base64Data.startsWith('http') || base64Data.startsWith('blob:')
        ? base64Data
        : `data:${mimeType};base64,${base64Data}`;

    const img = document.createElement('img');
    img.className = 'da-generated-img';
    img.src = srcUrl;
    img.alt = 'AI 生成图像';
    img.loading = 'lazy';

    // 2. 应用 CSS 显示样式
    img.style.objectFit = display.objectFit || 'contain';
    img.style.maxWidth = `${display.maxWidthPct ?? 100}%`;

    if (display.maxHeight && display.maxHeight > 0) {
        img.style.maxHeight = `${display.maxHeight}px`;
    } else {
        img.style.maxHeight = 'none';
    }

    if (display.rounded !== false) {
        img.style.borderRadius = '8px';
    } else {
        img.style.borderRadius = '0';
    }

    // 3. 手势绑定 (区分单击 Lightbox vs 长按/右键 操作面板)
    let longPressTimer: number | null = null;
    let isLongPressTriggered = false;

    if (settings.enableActionPanel !== false) {
        const triggerActionPanel = (e: MouseEvent | PointerEvent) => {
            isLongPressTriggered = true;
            const cb: ImageActionCallbacks = {
                imageSrc: srcUrl,
                mimeType,
                promptText: actionCallbacks?.promptText || '',
                negativePrompt: actionCallbacks?.negativePrompt || '',
                onLightbox: () => openLightbox(srcUrl),
                ...actionCallbacks,
            };
            openImageActionPanel(e, cb);
        };

        // 3.1 长按 (pointerdown >= 500ms)
        img.addEventListener('pointerdown', (e) => {
            isLongPressTriggered = false;
            if (longPressTimer !== null) window.clearTimeout(longPressTimer);

            longPressTimer = window.setTimeout(() => {
                longPressTimer = null;
                triggerActionPanel(e);
            }, 500);
        });

        const cancelLongPress = () => {
            if (longPressTimer !== null) {
                window.clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        img.addEventListener('pointerup', cancelLongPress);
        img.addEventListener('pointercancel', cancelLongPress);
        img.addEventListener('pointerleave', cancelLongPress);

        // 3.2 右键菜单 (contextmenu)
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cancelLongPress();
            triggerActionPanel(e);
        });
    }

    // 3.3 单击全屏查看 Lightbox
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLongPressTriggered) {
            isLongPressTriggered = false;
            return;
        }
        if (settings.lightboxEnabled !== false) {
            logger.info('用户点击图像触发全屏 Lightbox 大图预览');
            openLightbox(srcUrl);
        }
    });

    containerSlot.innerHTML = '';
    containerSlot.appendChild(img);
    logger.info('生图结果已成功渲染至 DOM 楼层容器');

    return containerSlot;
}



/** 全屏查看器（支持背景点击与 Esc 键退出，防重复挂载与事件泄露） */
export function openLightbox(src: string): void {
    const existingOverlays = document.querySelectorAll('.da-image-lightbox-overlay');
    existingOverlays.forEach(el => {
        const cleanupFn = (el as HTMLElement & { _closeLightbox?: () => void })._closeLightbox;
        if (typeof cleanupFn === 'function') {
            cleanupFn();
        } else if (el.parentNode) {
            el.parentNode.removeChild(el);
        }
    });

    const overlay = document.createElement('div') as HTMLDivElement & { _closeLightbox?: () => void };
    overlay.className = 'da-image-lightbox-overlay';

    const innerDiv = document.createElement('div');
    innerDiv.className = 'da-lightbox-inner';

    const img = document.createElement('img');
    img.src = src;
    img.alt = '全屏查看';

    innerDiv.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    innerDiv.appendChild(img);
    overlay.appendChild(innerDiv);

    let isClosed = false;
    const closeLightbox = () => {
        if (isClosed) return;
        isClosed = true;
        window.removeEventListener('keydown', handleKeydown);
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    };

    overlay._closeLightbox = closeLightbox;

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            closeLightbox();
        }
    };

    overlay.addEventListener('click', closeLightbox);
    window.addEventListener('keydown', handleKeydown);
    document.body.appendChild(overlay);
}
