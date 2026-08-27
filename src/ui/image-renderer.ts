/**
 * @module ui/image-renderer
 * @description 图像 DOM 渲染器模块
 *
 * 职责：
 * - 将生成的 Base64/Object URL 图像数据渲染到聊天消息 DOM 节点中
 * - 渲染低质量实时生成预览图，并在状态更新时及时释放旧 Object URL 资源
 * - 绑定全屏 Lightbox 大图预览交互
 *
 * 规范参考：
 * - .agents/Skills/browser-storage/SKILL.md §4 (Blob / Object URL 内存防泄漏)
 */


import { loadSettings } from '../settings/manager';
import { logger } from '../core/logger';

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
    if (!containerSlot) return containerSlot;

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

    // 点击全屏查看 (校验 lightboxEnabled 开关)
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        const settings = loadSettings();
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

/** 渲染预览图（低质量，用于生成过程中的实时预览） */
export function renderPreviewToMessage(
    containerSlot: HTMLElement,
    previewUrl: string
): void {
    if (!containerSlot) return;

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
    if (!containerSlot) return;

    const previewEl = containerSlot.querySelector<HTMLImageElement>('.da-preview-img');
    if (previewEl) {
        if (previewEl.src?.startsWith('blob:')) {
            URL.revokeObjectURL(previewEl.src);
        }
        previewEl.remove();
    }
}

/** 全屏查看器（支持背景点击与 Esc 键退出，防重复挂载） */
export function openLightbox(src: string): void {
    // 防重复：若当前已有大图弹窗，先移除
    const existingOverlays = document.querySelectorAll('.da-image-lightbox-overlay');
    existingOverlays.forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'da-image-lightbox-overlay';

    const innerDiv = document.createElement('div');
    innerDiv.className = 'da-lightbox-inner';

    const img = document.createElement('img');
    img.src = src;
    img.alt = '全屏查看';

    // 阻止大图内容区点击冒泡，避免点击大图触发背景关闭
    innerDiv.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    innerDiv.appendChild(img);
    overlay.appendChild(innerDiv);

    const closeLightbox = () => {
        window.removeEventListener('keydown', handleKeydown);
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    };

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            closeLightbox();
        }
    };

    // 点击背景遮罩关闭
    overlay.addEventListener('click', closeLightbox);
    window.addEventListener('keydown', handleKeydown);
    document.body.appendChild(overlay);
}
