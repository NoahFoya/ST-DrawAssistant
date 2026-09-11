/**
 * 统一交互与反馈服务
 * 提供确认弹窗、Toast 浮层提示与配置未保存状态追踪
 */

import { ThemeService } from '../foundation/theme-service';
import { ModalService } from '../layout/modal-service';

export interface ConfirmDialogOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
}

export interface PromptDialogOptions {
    title?: string;
    message?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}

export interface TripleChoiceDialogOptions {
    title?: string;
    message: string;
    saveText?: string;
    discardText?: string;
    cancelText?: string;
}

export type TripleChoiceResult = 'save' | 'discard' | 'cancel';

/**
 * 弹出确认模态对话框
 */
export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-dialog-backdrop st-da-root';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) e.stopPropagation();
        });

        const dialog = document.createElement('div');
        dialog.className = 'da-dialog-panel';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const title = document.createElement('div');
        title.className = 'da-dialog-title';
        title.textContent = options.title || '确认操作';

        const message = document.createElement('div');
        message.className = 'da-dialog-message';
        message.textContent = options.message;

        const actions = document.createElement('div');
        actions.className = 'da-dialog-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'da-btn da-btn--secondary';
        cancelBtn.textContent = options.cancelText || '取消';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = options.isDangerous ? 'da-btn da-btn--danger' : 'da-btn da-btn--primary';
        confirmBtn.textContent = options.confirmText || '确定';

        let isSettled = false;
        const modalHandle = ModalService.getInstance().open(backdrop, {
            closeOnBackdrop: true,
            closeOnEscape: true,
            onClose: () => {
                if (!isSettled) {
                    isSettled = true;
                    resolve(false);
                }
            }
        });

        const finish = (res: boolean) => {
            if (!isSettled) {
                isSettled = true;
                resolve(res);
                modalHandle.dispose();
            }
        };

        cancelBtn.onclick = () => finish(false);
        confirmBtn.onclick = () => finish(true);

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialog.appendChild(title);
        dialog.appendChild(message);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);
        confirmBtn.focus();
    });
}

/**
 * 弹出单行文本输入模态对话框
 */
export function showPromptDialog(options: PromptDialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-dialog-backdrop st-da-root';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) e.stopPropagation();
        });

        const dialog = document.createElement('div');
        dialog.className = 'da-dialog-panel';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const title = document.createElement('div');
        title.className = 'da-dialog-title';
        title.textContent = options.title || '请输入';

        const message = document.createElement('div');
        message.className = 'da-dialog-message';
        message.textContent = options.message || '';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'da-input';
        input.value = options.defaultValue || '';
        input.placeholder = options.placeholder || '';

        const actions = document.createElement('div');
        actions.className = 'da-dialog-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'da-btn da-btn--secondary';
        cancelBtn.textContent = options.cancelText || '取消';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'da-btn da-btn--primary';
        confirmBtn.textContent = options.confirmText || '确定';

        let isSettled = false;
        const modalHandle = ModalService.getInstance().open(backdrop, {
            closeOnBackdrop: true,
            closeOnEscape: true,
            onClose: () => {
                if (!isSettled) {
                    isSettled = true;
                    resolve(null);
                }
            }
        });

        const finish = (val: string | null) => {
            if (!isSettled) {
                isSettled = true;
                resolve(val);
                modalHandle.dispose();
            }
        };

        cancelBtn.onclick = () => finish(null);
        confirmBtn.onclick = () => finish(input.value.trim());

        input.onkeydown = (e) => {
            if (e.key === 'Enter') finish(input.value.trim());
            if (e.key === 'Escape') finish(null);
        };

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialog.appendChild(title);
        if (options.message) dialog.appendChild(message);
        dialog.appendChild(input);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);
        input.focus();
        input.select();
    });
}

/**
 * 弹出三选一模态对话框 (保存/放弃/取消)
 */
export function showTripleChoiceDialog(options: TripleChoiceDialogOptions): Promise<TripleChoiceResult> {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-dialog-backdrop st-da-root';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) e.stopPropagation();
        });

        const dialog = document.createElement('div');
        dialog.className = 'da-dialog-panel';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const title = document.createElement('div');
        title.className = 'da-dialog-title';
        title.textContent = options.title || '提示';

        const message = document.createElement('div');
        message.className = 'da-dialog-message';
        message.textContent = options.message;

        const actions = document.createElement('div');
        actions.className = 'da-dialog-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'da-btn da-btn--secondary';
        cancelBtn.textContent = options.cancelText || '取消';

        const discardBtn = document.createElement('button');
        discardBtn.className = 'da-btn da-btn--danger';
        discardBtn.textContent = options.discardText || '放弃修改';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'da-btn da-btn--primary';
        saveBtn.textContent = options.saveText || '保存修改';

        let isSettled = false;
        const modalHandle = ModalService.getInstance().open(backdrop, {
            closeOnBackdrop: true,
            closeOnEscape: true,
            onClose: () => {
                if (!isSettled) {
                    isSettled = true;
                    resolve('cancel');
                }
            }
        });

        const finish = (res: TripleChoiceResult) => {
            if (!isSettled) {
                isSettled = true;
                resolve(res);
                modalHandle.dispose();
            }
        };

        cancelBtn.onclick = () => finish('cancel');
        discardBtn.onclick = () => finish('discard');
        saveBtn.onclick = () => finish('save');

        actions.appendChild(cancelBtn);
        actions.appendChild(discardBtn);
        actions.appendChild(saveBtn);

        dialog.appendChild(title);
        dialog.appendChild(message);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);
        saveBtn.focus();
    });
}

interface ToastrApi {
    success?: (msg: string, title?: string) => void;
    error?: (msg: string, title?: string) => void;
    info?: (msg: string, title?: string) => void;
    warning?: (msg: string, title?: string) => void;
}

let _imagePreviewHandler: ((imageUrl: string, prompt?: string, info?: any) => void) | null = null;

export function registerImagePreviewHandler(handler: (imageUrl: string, prompt?: string, info?: any) => void): void {
    _imagePreviewHandler = handler;
}

/**
 * 统一交互反馈与提示通知服务 (FeedbackService)
 */
export class FeedbackService {
    constructor(_modalService?: unknown) {}

    public static async confirm(options: ConfirmDialogOptions | string): Promise<boolean> {
        const opts: ConfirmDialogOptions = typeof options === 'string' ? { message: options } : options;
        return showConfirmDialog(opts);
    }

    public static async prompt(options: PromptDialogOptions | string): Promise<string | null> {
        const opts: PromptDialogOptions = typeof options === 'string' ? { message: options } : options;
        return showPromptDialog(opts);
    }

    public static async tripleChoice(options: TripleChoiceDialogOptions): Promise<TripleChoiceResult> {
        return showTripleChoiceDialog(options);
    }

    private static _showFallbackToast(message: string, type: string): void {
        const toast = document.createElement('div');
        toast.className = `da-toast da-toast-${type} st-da-root`;
        toast.textContent = message;
        ThemeService.applyCurrentThemeToNode(toast);
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'da-fade-out 0.2s ease forwards';
            setTimeout(() => toast.remove(), 200);
        }, 2500);
    }

    public static toast(message: string, typeOrIsError: boolean | 'success' | 'error' | 'warn' | 'info' = 'info'): void {
        if (typeOrIsError === true) {
            FeedbackService.toastError(message);
            return;
        }
        if (typeOrIsError === false) {
            FeedbackService.toastInfo(message);
            return;
        }
        switch (typeOrIsError) {
            case 'success':
                FeedbackService.toastSuccess(message);
                break;
            case 'error':
                FeedbackService.toastError(message);
                break;
            case 'warn':
                FeedbackService.toastWarn(message);
                break;
            default:
                FeedbackService.toastInfo(message);
                break;
        }
    }

    public static toastSuccess(message: string, title = 'ST-DrawAssistant'): void {
        const toastr = typeof window !== 'undefined' ? ((window as any).toastr as ToastrApi | undefined) : undefined;
        if (toastr?.success) {
            toastr.success(message, title);
        } else if (typeof document !== 'undefined') {
            FeedbackService._showFallbackToast(`🟢 ${message}`, 'success');
        }
    }

    public static toastError(message: string, title = 'ST-DrawAssistant'): void {
        const toastr = typeof window !== 'undefined' ? ((window as any).toastr as ToastrApi | undefined) : undefined;
        if (toastr?.error) {
            toastr.error(message, title);
        } else if (typeof document !== 'undefined') {
            FeedbackService._showFallbackToast(`🔴 ${message}`, 'error');
        }
    }

    public static toastWarn(message: string, title = 'ST-DrawAssistant'): void {
        const toastr = typeof window !== 'undefined' ? ((window as any).toastr as ToastrApi | undefined) : undefined;
        if (toastr?.warning) {
            toastr.warning(message, title);
        } else if (typeof document !== 'undefined') {
            FeedbackService._showFallbackToast(`🟡 ${message}`, 'warn');
        }
    }

    public static toastWarning(message: string, title = 'ST-DrawAssistant'): void {
        FeedbackService.toastWarn(message, title);
    }

    public static toastInfo(message: string, title = 'ST-DrawAssistant'): void {
        const toastr = typeof window !== 'undefined' ? ((window as any).toastr as ToastrApi | undefined) : undefined;
        if (toastr?.info) {
            toastr.info(message, title);
        } else if (typeof document !== 'undefined') {
            FeedbackService._showFallbackToast(`ℹ️ ${message}`, 'info');
        }
    }

    public static registerImagePreviewHandler(handler: (imageUrl: string, prompt?: string, info?: any) => void): void {
        registerImagePreviewHandler(handler);
    }

    public static previewImage(imageUrl: string, prompt?: string, info?: any): void {
        if (_imagePreviewHandler) {
            _imagePreviewHandler(imageUrl, prompt, info);
        } else if (typeof window !== 'undefined') {
            window.open(imageUrl, '_blank');
        }
    }

    public static showExportModeDialog(options?: { title?: string; message?: string }): Promise<ExportModeChoice> {
        return showExportModeDialog(options);
    }
}

export type ExportModeChoice = 'sanitized' | 'private' | null;

/**
 * 弹出导出模式选择对话框 (脱敏公开导出 vs 完整私密导出)
 */
export function showExportModeDialog(options?: {
    title?: string;
    message?: string;
}): Promise<ExportModeChoice> {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-dialog-backdrop st-da-root';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) e.stopPropagation();
        });

        const dialog = document.createElement('div');
        dialog.className = 'da-dialog-panel';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const title = document.createElement('div');
        title.className = 'da-dialog-title';
        title.textContent = options?.title || '导出插件配置与预设方案';

        const message = document.createElement('div');
        message.className = 'da-dialog-message';
        message.textContent = options?.message || '请选择导出模式。若需在社区或与他人分享方案，建议选择脱敏导出以保护您的 API 访问密钥安全：';

        const actions = document.createElement('div');
        actions.className = 'da-dialog-actions';
        actions.style.flexWrap = 'wrap';
        actions.style.gap = '8px';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'da-btn da-btn--secondary';
        cancelBtn.textContent = '取消';

        const privateBtn = document.createElement('button');
        privateBtn.className = 'da-btn da-btn--secondary';
        privateBtn.textContent = '完整导出 (包含私有密钥)';

        const sanitizedBtn = document.createElement('button');
        sanitizedBtn.className = 'da-btn da-btn--primary';
        sanitizedBtn.textContent = '脱敏导出 (供公开分享)';

        let isSettled = false;
        const modalHandle = ModalService.getInstance().open(backdrop, {
            closeOnBackdrop: true,
            closeOnEscape: true,
            onClose: () => {
                if (!isSettled) {
                    isSettled = true;
                    resolve(null);
                }
            }
        });

        const finish = (choice: ExportModeChoice) => {
            if (!isSettled) {
                isSettled = true;
                resolve(choice);
                modalHandle.dispose();
            }
        };

        cancelBtn.onclick = () => finish(null);
        privateBtn.onclick = () => finish('private');
        sanitizedBtn.onclick = () => finish('sanitized');

        actions.appendChild(cancelBtn);
        actions.appendChild(privateBtn);
        actions.appendChild(sanitizedBtn);

        dialog.appendChild(title);
        dialog.appendChild(message);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);
        sanitizedBtn.focus();
    });
}
