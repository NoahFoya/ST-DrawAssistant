/**
 * @module ui/media/image-renderer
 * @description 图像 DOM 渲染与交互手势分发器 (ImageRenderer)
 */

import { DrawAssistantSettings, ImageDisplayConfig } from '../../core/state/store-types';
import { openImageActionPanel, ImageActionCallbacks } from './image-action-panel';
import { openLightboxModal } from './lightbox-modal';

export type { ImageActionCallbacks };

/**
 * 将生成的图像数据渲染到楼层消息插槽中，并绑定交互手势
 */
export function renderImageToMessage(
    containerSlot: HTMLElement,
    imageData: string | Blob,
    settings: DrawAssistantSettings,
    actionCallbacks?: ImageActionCallbacks
): HTMLImageElement {
    if (!containerSlot) return containerSlot as any;

    const display: ImageDisplayConfig = settings.imageDisplay || {
        align: 'left',
        objectFit: 'contain',
        maxHeight: 0,
        maxWidthPct: 100,
        rounded: true
    };

    containerSlot.style.display = 'flex';
    containerSlot.style.width = '100%';
    if (display.align === 'center') {
        containerSlot.style.justifyContent = 'center';
    } else if (display.align === 'right') {
        containerSlot.style.justifyContent = 'flex-end';
    } else {
        containerSlot.style.justifyContent = 'flex-start';
    }

    const oldImg = containerSlot.querySelector<HTMLImageElement>('.da-generated-img');
    if (oldImg?.src?.startsWith('blob:')) {
        URL.revokeObjectURL(oldImg.src);
    }

    let srcUrl: string;
    if (imageData instanceof Blob) {
        srcUrl = URL.createObjectURL(imageData);
    } else if (imageData.startsWith('data:') || imageData.startsWith('http') || imageData.startsWith('blob:')) {
        srcUrl = imageData;
    } else {
        srcUrl = `data:${settings.imageFormat === 'webp' ? 'image/webp' : 'image/png'};base64,${imageData}`;
    }

    const img = document.createElement('img');
    img.className = 'da-generated-img';
    img.src = srcUrl;
    img.alt = 'AI 生成图像';
    img.loading = 'lazy';

    img.style.objectFit = display.objectFit || 'contain';
    img.style.maxWidth = `${display.maxWidthPct ?? 100}%`;
    img.style.maxHeight = display.maxHeight && display.maxHeight > 0 ? `${display.maxHeight}px` : 'none';
    img.style.borderRadius = display.rounded !== false ? '8px' : '0px';
    img.style.cursor = 'pointer';
    img.style.boxShadow = 'var(--da-shadow-sm)';

    let longPressTimer: number | null = null;
    let isLongPressTriggered = false;

    if (settings.enableActionPanel !== false) {
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

        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cancelLongPress();
            triggerActionPanel(e);
        });
    }

    img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLongPressTriggered) {
            isLongPressTriggered = false;
            return;
        }
        if (settings.lightboxEnabled !== false) {
            openLightboxModal(srcUrl);
        }
    });

    containerSlot.innerHTML = '';
    containerSlot.appendChild(img);
    return img;
}
