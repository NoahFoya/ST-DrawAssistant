/**
 * @module ui/media/image-renderer
 * @description 图像 DOM 渲染与交互手势分发器 (ImageRenderer)
 */

import { DrawAssistantSettings } from '../../core';
import { openImageActionPanel, ImageActionCallbacks } from './image-action-panel';
import { openLightboxModal } from './lightbox-modal';

export type { ImageActionCallbacks };

export interface ImageDisplayOptions {
    align?: 'left' | 'center' | 'right';
    objectFit?: 'contain' | 'cover' | 'fill' | 'none';
    maxHeight?: number;
    maxWidthPct?: number;
    rounded?: boolean;
}

/**
 * 将生成的图像数据渲染到楼层消息插槽中，并绑定交互手势
 */
export function renderImageToMessage(
    containerSlot: HTMLElement,
    imageData: string | Blob,
    settings?: Partial<DrawAssistantSettings>,
    actionCallbacks?: ImageActionCallbacks
): HTMLImageElement {
    if (!containerSlot || typeof document === 'undefined') return containerSlot as any;

    const display: ImageDisplayOptions = (settings as any)?.imageDisplay || {
        align: 'left',
        objectFit: 'contain',
        maxHeight: 0,
        maxWidthPct: 100,
        rounded: true
    };

    containerSlot.classList.add('da-floor-btn-img-slot');
    containerSlot.classList.remove('da-floor-btn-img-slot--center', 'da-floor-btn-img-slot--right', 'da-floor-btn-img-slot--left');
    if (display.align === 'center') {
        containerSlot.classList.add('da-floor-btn-img-slot--center');
    } else if (display.align === 'right') {
        containerSlot.classList.add('da-floor-btn-img-slot--right');
    } else {
        containerSlot.classList.add('da-floor-btn-img-slot--left');
    }

    const oldImg = containerSlot.querySelector<HTMLImageElement>('.da-generated-img');
    if (oldImg?.dataset?.ownsBlob === 'true' && oldImg.src?.startsWith('blob:')) {
        URL.revokeObjectURL(oldImg.src);
    }

    let srcUrl: string;
    let isSelfCreatedBlob = false;
    if (imageData instanceof Blob) {
        srcUrl = URL.createObjectURL(imageData);
        isSelfCreatedBlob = true;
    } else if (imageData.startsWith('data:') || imageData.startsWith('http') || imageData.startsWith('blob:')) {
        srcUrl = imageData;
    } else {
        srcUrl = `data:image/png;base64,${imageData}`;
    }

    const img = document.createElement('img');
    img.className = 'da-generated-img';
    if (isSelfCreatedBlob) {
        img.dataset.ownsBlob = 'true';
    }
    if (display.rounded !== false) {
        img.classList.add('da-generated-img--rounded');
    }
    img.src = srcUrl;
    img.alt = 'AI 生成图像';
    img.loading = 'lazy';

    img.style.objectFit = display.objectFit || 'contain';
    img.style.maxWidth = `${display.maxWidthPct ?? 100}%`;
    img.style.maxHeight = display.maxHeight && display.maxHeight > 0 ? `${display.maxHeight}px` : 'none';

    let longPressTimer: number | null = null;
    let isLongPressTriggered = false;
    let startX = 0;
    let startY = 0;

    const triggerActionPanel = (e: MouseEvent | PointerEvent) => {
        isLongPressTriggered = true;
        const cb: ImageActionCallbacks = {
            imageSrc: srcUrl,
            promptText: actionCallbacks?.promptText || '',
            negativePrompt: actionCallbacks?.negativePrompt || '',
            onLightbox: () => openLightboxModal(srcUrl),
            ...actionCallbacks
        };
        openImageActionPanel(e, cb);
    };

    // 移动端 & 桌面端右上角快捷悬浮按钮
    const cornerTrigger = document.createElement('button');
    cornerTrigger.type = 'button';
    cornerTrigger.className = 'da-image-corner-trigger';
    cornerTrigger.title = '图像操作栏 (重绘/复制/重新生成)';
    cornerTrigger.textContent = '✨';
    cornerTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerActionPanel(e);
    });

    img.addEventListener('pointerdown', (e) => {
        isLongPressTriggered = false;
        startX = e.clientX;
        startY = e.clientY;
        if (longPressTimer !== null) window.clearTimeout(longPressTimer);

        longPressTimer = window.setTimeout(() => {
            longPressTimer = null;
            try {
                navigator.vibrate?.(35);
            } catch {}
            triggerActionPanel(e);
        }, 380);
    });

    const cancelLongPress = () => {
        if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

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

    img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelLongPress();
        triggerActionPanel(e);
    });

    img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLongPressTriggered) {
            isLongPressTriggered = false;
            return;
        }
        if (settings?.lightboxEnabled !== false) {
            openLightboxModal(srcUrl);
        }
    });

    containerSlot.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'da-image-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.appendChild(img);
    wrapper.appendChild(cornerTrigger);

    containerSlot.appendChild(wrapper);
    return img;
}

/**
 * 将 DataURL 转换为 Blob 二进制
 */
export function dataURLtoBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}
