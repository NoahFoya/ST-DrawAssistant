/**
 * @module ui/media/lightbox-modal
 * @description 全屏大图全景查看器 (Lightbox)
 */

import { ThemeService } from '../foundation/theme-service';
import { ModalService } from '../layout/modal-service';
import { IDisposable } from '../../core';

/**
 * 弹出全屏 Lightbox 图像放大全景查看器（由 ModalService 统一管理 Z-Index 与 ESC 退出）
 *
 * @param imgSrc 图像 Base64 数据串、DataURL 或 ObjectURL
 * @returns 销毁关闭句柄
 */
export function openLightboxModal(imgSrc: string): IDisposable {
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

    const modalHandle = ModalService.getInstance().open(backdrop, {
        closeOnBackdrop: true,
        closeOnEscape: true
    });

    closeBadge.onclick = (e) => {
        e.stopPropagation();
        modalHandle.dispose();
    };

    return modalHandle;
}
