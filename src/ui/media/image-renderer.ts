/**
 * 图像 DOM 渲染与手势处理 (ImageRenderer)
 * 渲染楼层中的生成图片，支持对齐、尺寸限制、长按操作栏唤起与全屏大图预览
 */

import { DrawAssistantSettings } from '../../types';
import { openImageActionPanel, ImageActionCallbacks } from './image-action-panel';
import { openImagePreviewModal } from './image-preview-modal';

export type { ImageActionCallbacks };

export interface ImageDisplayOptions {
    align?: 'left' | 'center' | 'right';
    objectFit?: 'contain' | 'cover' | 'fill' | 'none';
    maxHeight?: number;
    maxWidthPct?: number;
    rounded?: boolean;
    collapsed?: boolean;
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
        rounded: true,
        collapsed: false
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

    let isLongPressTriggered = false;
    const showActionPanel = settings?.enableActionPanel !== false;
    let cornerTrigger: HTMLButtonElement | null = null;

    if (showActionPanel) {
        let longPressTimer: number | null = null;
        let startX = 0;
        let startY = 0;

        const triggerActionPanel = (e: MouseEvent | PointerEvent) => {
            isLongPressTriggered = true;
            const cb: ImageActionCallbacks = {
                imageSrc: srcUrl,
                promptText: actionCallbacks?.promptText || '',
                negativePrompt: actionCallbacks?.negativePrompt || '',
                onPreview: () => openImagePreviewModal(srcUrl),
                ...actionCallbacks
            };
            openImageActionPanel(e, cb);
        };

        // 快捷悬浮操作按钮
        cornerTrigger = document.createElement('button');
        cornerTrigger.type = 'button';
        cornerTrigger.className = 'da-image-corner-trigger';
        cornerTrigger.title = '图像操作栏 (重绘/复制/重新生成)';
        cornerTrigger.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"></path></svg>';
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
                    // 部分浏览器在未产生用户手势或无权限时会拒绝触发震动
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
    }

    img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLongPressTriggered) {
            isLongPressTriggered = false;
            return;
        }
        if (settings?.imagePreviewEnabled !== false) {
            openImagePreviewModal(srcUrl);
        }
    });

    containerSlot.innerHTML = '';
    const alignSuffix = display.align === 'right' ? 'right' : display.align === 'center' ? 'center' : 'left';
    containerSlot.classList.remove('da-floor-btn-img-slot--left', 'da-floor-btn-img-slot--center', 'da-floor-btn-img-slot--right');
    containerSlot.classList.add(`da-floor-btn-img-slot--${alignSuffix}`);
    containerSlot.style.display = 'flex';
    containerSlot.style.width = '100%';
    containerSlot.style.justifyContent = alignSuffix === 'center' ? 'center' : alignSuffix === 'right' ? 'flex-end' : 'flex-start';

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'da-image-wrapper';
    imgWrapper.style.position = 'relative';
    imgWrapper.style.display = 'inline-block';
    imgWrapper.appendChild(img);
    if (cornerTrigger) {
        imgWrapper.appendChild(cornerTrigger);
    }

    if (display.collapsed) {
        const collapseWrapper = document.createElement('div');
        collapseWrapper.className = `da-image-collapse-wrapper da-image-collapse-wrapper--${alignSuffix}`;

        const toggleBar = document.createElement('button');
        toggleBar.type = 'button';
        toggleBar.className = 'da-image-collapse-toggle da-btn da-btn--secondary';
        toggleBar.textContent = '展开生成图像';

        let isExpanded = false;
        imgWrapper.style.display = 'none';

        toggleBar.onclick = (e) => {
            e.stopPropagation();
            isExpanded = !isExpanded;
            imgWrapper.style.display = isExpanded ? 'inline-block' : 'none';
            toggleBar.textContent = isExpanded ? '折叠图像' : '展开生成图像';
        };

        collapseWrapper.appendChild(toggleBar);
        collapseWrapper.appendChild(imgWrapper);
        containerSlot.appendChild(collapseWrapper);
    } else {
        containerSlot.appendChild(imgWrapper);
    }

    return img;
}

