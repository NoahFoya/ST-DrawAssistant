/**
 * @module ui/media/image-renderer
 * @description 图像 DOM 渲染与交互手势分发器 (ImageRenderer)
 */

import { DrawAssistantSettings, ImageDisplayConfig } from '../../core';
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

    if (display.collapsed) {
        const alignSuffix = display.align === 'right' ? 'right' : display.align === 'center' ? 'center' : 'left';
        const collapseWrapper = document.createElement('div');
        collapseWrapper.className = `da-image-collapse-wrapper da-image-collapse-wrapper--${alignSuffix}`;

        const toggleBar = document.createElement('button');
        toggleBar.type = 'button';
        toggleBar.className = 'da-image-collapse-toggle da-btn da-btn--secondary';
        toggleBar.textContent = '展开生成图像';

        let isExpanded = false;
        img.style.display = 'none';

        toggleBar.onclick = (e) => {
            e.stopPropagation();
            isExpanded = !isExpanded;
            img.style.display = isExpanded ? 'block' : 'none';
            toggleBar.textContent = isExpanded ? '折叠图像' : '展开生成图像';
        };

        collapseWrapper.appendChild(toggleBar);
        collapseWrapper.appendChild(img);
        containerSlot.appendChild(collapseWrapper);
    } else {
        containerSlot.appendChild(img);
    }

    return img;
}

/**
 * 将原始图像 Blob 转码为目标格式（如 WebP / JPEG）并进行画质压缩
 *
 * @param blob 原始图像 Blob
 * @param format 目标转码格式 ('original' | 'webp' | 'jpeg')
 * @param quality 压缩质量比率 (0.5 ~ 1.0)
 * @returns 包含转码后 Blob 与对应 MIME 类型的 Promise
 */
export async function transcodeImage(
    blob: Blob,
    format?: 'original' | 'webp' | 'jpeg',
    quality = 0.85
): Promise<{ blob: Blob; mime: string }> {
    if (!format || format === 'original' || typeof window === 'undefined') {
        return { blob, mime: blob.type || 'image/png' };
    }

    const targetMime = format === 'webp' ? 'image/webp' : 'image/jpeg';
    if (blob.type === targetMime) {
        return { blob, mime: targetMime };
    }

    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        let isSettled = false;

        const cleanupAndResolve = (outResult: { blob: Blob; mime: string }) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                URL.revokeObjectURL(url);
                resolve(outResult);
            }
        };

        const timer = setTimeout(() => {
            cleanupAndResolve({ blob, mime: blob.type || 'image/png' });
        }, 5000);

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, img.naturalWidth || img.width);
                canvas.height = Math.max(1, img.naturalHeight || img.height);
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(
                        (outBlob) => {
                            if (outBlob) {
                                cleanupAndResolve({ blob: outBlob, mime: targetMime });
                            } else {
                                cleanupAndResolve({ blob, mime: blob.type || 'image/png' });
                            }
                        },
                        targetMime,
                        quality
                    );
                    return;
                }
            } catch {
                // 转码异常时自动降级为原始格式
            }
            cleanupAndResolve({ blob, mime: blob.type || 'image/png' });
        };

        img.onerror = () => {
            cleanupAndResolve({ blob, mime: blob.type || 'image/png' });
        };

        img.src = url;
    });
}

/**
 * 将 DataURL 转换为标准的二进制 Blob 对象
 */
export function dataURLtoBlob(dataURL: string): Blob {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}
