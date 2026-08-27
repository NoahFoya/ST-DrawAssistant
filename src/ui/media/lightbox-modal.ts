/**
 * @module ui/media/lightbox-modal
 * @description 全屏大图全景查看器 (Lightbox)
 */

import { ThemeService } from '../foundation/theme-service';

/**
 * 弹出全屏 Lightbox 图像放大全景查看器
 *
 * @param imgSrc 图像 Base64 数据串、DataURL 或 ObjectURL
 */
export function openLightboxModal(imgSrc: string): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'da-lightbox-backdrop st-da-root';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const img = document.createElement('img');
    img.className = 'da-lightbox-img';
    img.src = imgSrc.startsWith('data:') || imgSrc.startsWith('blob:') || imgSrc.startsWith('http')
        ? imgSrc
        : `data:image/png;base64,${imgSrc}`;

    const closeBadge = document.createElement('div');
    closeBadge.className = 'da-lightbox-close';
    closeBadge.textContent = '✕';

    backdrop.appendChild(img);
    backdrop.appendChild(closeBadge);
    backdrop.onclick = () => backdrop.remove();
    document.body.appendChild(backdrop);
}
