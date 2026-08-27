/**
 * @module ui/feedback-service
 * @description 统一 UI 用户交互反馈与弹窗提示服务 (FeedbackService)
 */

import {
    showConfirmDialog,
    showPromptDialog,
    openLightboxModal,
    openImageInfoPanel,
    ConfirmDialogOptions,
    PromptDialogOptions
} from './components/modals';

export class FeedbackService {
    /**
     * 弹出确认对话框
     */
    public static async confirm(options: ConfirmDialogOptions | string): Promise<boolean> {
        const opts: ConfirmDialogOptions = typeof options === 'string' ? { message: options } : options;
        return showConfirmDialog(opts);
    }

    /**
     * 弹出输入对话框
     */
    public static async prompt(options: PromptDialogOptions | string): Promise<string | null> {
        const opts: PromptDialogOptions = typeof options === 'string' ? { message: options } : options;
        return showPromptDialog(opts);
    }

    /**
     * 弹出浮动 Toast 提示
     */
    public static toast(message: string, isError = false): void {
        const toastEl = document.createElement('div');
        toastEl.className = `da-toast ${isError ? 'error' : 'success'}`;
        toastEl.style.position = 'fixed';
        toastEl.style.top = '24px';
        toastEl.style.right = '24px';
        toastEl.style.zIndex = '100200';
        toastEl.style.padding = '12px 20px';
        toastEl.style.borderRadius = 'var(--da-radius-small, 8px)';
        toastEl.style.background = isError ? 'var(--da-color-error)' : 'var(--da-accent-color)';
        toastEl.style.color = 'var(--da-text-on-accent, #ffffff)';
        toastEl.style.boxShadow = 'var(--da-shadow-md)';
        toastEl.style.fontWeight = 'bold';
        toastEl.style.fontSize = '0.92em';
        toastEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        toastEl.textContent = message;

        document.body.appendChild(toastEl);

        setTimeout(() => {
            toastEl.style.opacity = '0';
            toastEl.style.transform = 'translateY(-10px)';
            setTimeout(() => toastEl.remove(), 300);
        }, 3000);
    }

    /**
     * 弹出全屏大图预览
     */
    public static lightbox(imgSrc: string): void {
        openLightboxModal(imgSrc);
    }

    /**
     * 查看图像元数据详情
     */
    public static showImageInfo(metadata: Record<string, any>, imageSrc?: string): void {
        openImageInfoPanel(metadata, imageSrc);
    }
}
