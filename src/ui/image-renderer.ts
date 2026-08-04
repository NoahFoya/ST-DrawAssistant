/**
 * 图像渲染器
 *
 * 职责：将生成的 base64 图像数据渲染到聊天消息 DOM 中
 *
 * P0 策略：
 * - 图像以 Object URL 形式临时展示（刷新后消失）
 * - P1 阶段补充 IndexedDB 持久化
 */

/**
 * 渲染图像到指定按钮的专属图像 Slot
 *
 * @param containerSlot 按钮关联的图像 Slot 节点 (.da-floor-btn-img-slot)
 * @param base64Data base64 图像编码
 * @param mimeType 图像 MIME 类型
 */
export function renderImageToMessage(
    containerSlot: HTMLElement,
    base64Data: string,
    mimeType: string = 'image/png'
): HTMLElement {
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

    // 点击全屏查看
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(srcUrl);
    });

    containerSlot.innerHTML = '';
    containerSlot.appendChild(img);

    return containerSlot;
}

/** 渲染预览图（低质量，用于生成过程中的实时预览） */
export function renderPreviewToMessage(
    containerSlot: HTMLElement,
    previewUrl: string
): void {
    let previewEl = containerSlot.querySelector<HTMLImageElement>('.da-preview-img');
    if (!previewEl) {
        previewEl = document.createElement('img');
        previewEl.className = 'da-preview-img';
        previewEl.alt = '生成预览';
        containerSlot.appendChild(previewEl);
    }

    // 撤销旧 Object URL
    if (previewEl.src?.startsWith('blob:') && previewEl.src !== previewUrl) {
        URL.revokeObjectURL(previewEl.src);
    }

    previewEl.src = previewUrl;
}

/** 清除预览图 */
export function clearPreview(containerSlot: HTMLElement): void {
    const previewEl = containerSlot.querySelector<HTMLImageElement>('.da-preview-img');
    if (previewEl) {
        if (previewEl.src?.startsWith('blob:')) {
            URL.revokeObjectURL(previewEl.src);
        }
        previewEl.remove();
    }
}

/** 简单的全屏查看器 */
function openLightbox(src: string): void {
    const overlay = document.createElement('div');
    overlay.className = 'da-lightbox-overlay';
    overlay.innerHTML = `<div class="da-lightbox-inner"><img src="${src}" alt="全屏查看" /></div>`;
    overlay.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
}
