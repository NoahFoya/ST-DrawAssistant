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

    const actualSrc = imgSrc.startsWith('data:') || imgSrc.startsWith('blob:') || imgSrc.startsWith('http')
        ? imgSrc
        : `data:image/png;base64,${imgSrc}`;

    const img = document.createElement('img');
    img.className = 'da-image-preview-img';
    img.src = actualSrc;
    img.title = '双击切换原始尺寸 / 适屏缩放';

    let isZoomed = false;
    const toggleZoom = () => {
        isZoomed = !isZoomed;
        backdrop.classList.toggle('is-zoomed', isZoomed);
        zoomBtn.innerHTML = isZoomed
            ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>`
            : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6m-1 1-6 6M9 21H3v-6m1-1 6-6"></path></svg>`;
        zoomBtn.title = isZoomed ? '适应屏幕 (双击)' : '放大原图 (双击)';
        if (isZoomed) {
            img.scrollIntoView({ block: 'center', inline: 'center' });
        }
    };

    img.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        toggleZoom();
    });

    // 单击图片本身阻止冒泡，避免触发背景点击退出
    img.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // 顶部悬浮工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'da-image-preview-toolbar';
    toolbar.addEventListener('click', (e) => e.stopPropagation());

    // 缩放切换按钮
    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'da-image-preview-btn';
    zoomBtn.title = '放大原图 (双击)';
    zoomBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6m-1 1-6 6M9 21H3v-6m1-1 6-6"></path></svg>`;
    zoomBtn.onclick = () => toggleZoom();

    // 下载原图按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'da-image-preview-btn';
    downloadBtn.title = '下载原图到本地';
    downloadBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    downloadBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = actualSrc;
        link.download = `st-draw-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        FeedbackService.toastSuccess('已开始下载原图');
    };

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-image-preview-btn';
    closeBtn.title = '关闭大图预览 (Esc)';
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

    toolbar.appendChild(zoomBtn);
    toolbar.appendChild(downloadBtn);
    toolbar.appendChild(closeBtn);

    backdrop.appendChild(img);
    backdrop.appendChild(toolbar);

    const modalHandle = ModalService.getInstance().open(backdrop, {
        closeOnBackdrop: true,
        closeOnEscape: true
    });

    closeBtn.onclick = (e) => {
        e.stopPropagation();
        modalHandle.dispose();
    };

    return modalHandle;
}

// 向全局 FeedbackService 注册大图全屏预览处理函数
FeedbackService.registerImagePreviewHandler(openImagePreviewModal);
