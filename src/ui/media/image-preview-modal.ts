/**
 * 大图全屏预览弹窗
 * 提供全屏原图查看、居中呈现与 Esc 快捷关闭
 */

import { ThemeService } from '../foundation/theme-service';
import { ModalService } from '../layout/modal-service';
import { FeedbackService } from '../feedback/feedback';
import { IDisposable } from '../../types';

/**
 * 弹出大图全屏预览弹窗（由 ModalService 统一管理层级与 Esc 退出）
 *
 * @param imgSrc 图像 Base64 数据串、DataURL 或 ObjectURL
 * @returns 销毁关闭句柄
 */
export function openImagePreviewModal(imgSrc: string): IDisposable {
    if (typeof document === 'undefined') return { dispose: () => {} };

    const backdrop = document.createElement('div');
    backdrop.className = 'da-image-preview-backdrop st-da-root';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const img = document.createElement('img');
    img.className = 'da-image-preview-img';
    img.src = imgSrc.startsWith('data:') || imgSrc.startsWith('blob:') || imgSrc.startsWith('http')
        ? imgSrc
        : `data:image/png;base64,${imgSrc}`;

    const closeBadge = document.createElement('div');
    closeBadge.className = 'da-image-preview-close';
    closeBadge.textContent = '✕';
    closeBadge.title = '关闭大图预览 (Esc)';

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

// 向全局 FeedbackService 注册大图全屏预览处理函数
FeedbackService.registerImagePreviewHandler(openImagePreviewModal);
