/**
 * @module ui/feedback/feedback
 * @description 核心交互与反馈域：统一模态确认框、Toast 提示通知与脏数据未保存状态管理服务 (Feedback Domain)
 */

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
        backdrop.style.zIndex = '100500';

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

        const cleanup = (result: boolean) => {
            window.removeEventListener('keydown', onKeyDown);
            backdrop.remove();
            resolve(result);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                cleanup(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);

        cancelBtn.onclick = () => cleanup(false);
        confirmBtn.onclick = () => cleanup(true);
        backdrop.onclick = () => cleanup(false);

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialog.appendChild(title);
        dialog.appendChild(message);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
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
        backdrop.style.zIndex = '100500';

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

        const cleanup = (val: string | null) => {
            window.removeEventListener('keydown', onKeyDown);
            backdrop.remove();
            resolve(val);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                cleanup(null);
            }
        };
        window.addEventListener('keydown', onKeyDown);

        cancelBtn.onclick = () => cleanup(null);
        confirmBtn.onclick = () => cleanup(input.value.trim());
        backdrop.onclick = () => cleanup(null);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') cleanup(input.value.trim());
            if (e.key === 'Escape') cleanup(null);
        };

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialog.appendChild(title);
        if (options.message) dialog.appendChild(message);
        dialog.appendChild(input);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
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
        backdrop.style.zIndex = '100500';

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

        const cleanup = (result: TripleChoiceResult) => {
            window.removeEventListener('keydown', onKeyDown);
            backdrop.remove();
            resolve(result);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                cleanup('cancel');
            }
        };
        window.addEventListener('keydown', onKeyDown);

        cancelBtn.onclick = () => cleanup('cancel');
        discardBtn.onclick = () => cleanup('discard');
        saveBtn.onclick = () => cleanup('save');
        backdrop.onclick = () => cleanup('cancel');

        actions.appendChild(cancelBtn);
        actions.appendChild(discardBtn);
        actions.appendChild(saveBtn);

        dialog.appendChild(title);
        dialog.appendChild(message);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        saveBtn.focus();
    });
}

/**
 * Tab 选项卡未保存状态提供者接口
 */
export interface UnsavedProvider {
    tabId: string;
    tabName: string;
    hasUnsavedChanges: () => boolean;
    saveChanges: () => Promise<void> | void;
    discardChanges: () => void;
}

/**
 * 全局未保存修改状态管理器
 */
export class UnsavedStateManager {
    private readonly _providers = new Map<string, UnsavedProvider>();
    private readonly _listeners = new Set<() => void>();

    public registerProvider(provider: UnsavedProvider): void {
        this._providers.set(provider.tabId, provider);
        this.notifyStateChange();
    }

    public unregisterProvider(tabId: string): void {
        this._providers.delete(tabId);
        this.notifyStateChange();
    }

    public subscribeStateChange(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    public notifyStateChange(): void {
        this._listeners.forEach((l) => {
            try {
                l();
            } catch {}
        });
    }

    public getDirtyProviders(): UnsavedProvider[] {
        const dirty: UnsavedProvider[] = [];
        this._providers.forEach((p) => {
            try {
                if (p.hasUnsavedChanges()) dirty.push(p);
            } catch {}
        });
        return dirty;
    }

    public async checkUnsavedBeforeAction(actionDesc = '切出界面'): Promise<'proceed' | 'cancel'> {
        const dirtyList = this.getDirtyProviders();
        if (dirtyList.length === 0) return 'proceed';

        const names = dirtyList.map((p) => `【${p.tabName}】`).join('与');
        const message = `检测到 ${names} 存在未保存的修改！直接${actionDesc}将丢弃所有未保存改动，请选择操作：`;

        const choice = await showTripleChoiceDialog({
            title: '⚠️ 未保存修改提示',
            message,
            saveText: '保存修改',
            discardText: '放弃修改',
            cancelText: '取消'
        });

        if (choice === 'save') {
            for (const p of dirtyList) {
                await p.saveChanges();
            }
            return 'proceed';
        }

        if (choice === 'discard') {
            for (const p of dirtyList) {
                p.discardChanges();
            }
            return 'proceed';
        }

        return 'cancel';
    }
}

export const unsavedStateManager = new UnsavedStateManager();

interface ToastrApi {
    success?: (msg: string, title?: string) => void;
    error?: (msg: string, title?: string) => void;
    info?: (msg: string, title?: string) => void;
    warning?: (msg: string, title?: string) => void;
}

/**
 * 统一交互反馈与提示通知服务 (FeedbackService)
 */
export class FeedbackService {
    public static readonly unsavedStateManager = unsavedStateManager;

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
        toast.className = `da-toast da-toast-${type}`;
        toast.textContent = message;
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
        const toastr = (window as any).toastr as ToastrApi | undefined;
        if (toastr?.success) {
            toastr.success(message, title);
        } else {
            FeedbackService._showFallbackToast(`🟢 ${message}`, 'success');
        }
    }

    public static toastError(message: string, title = 'ST-DrawAssistant'): void {
        const toastr = (window as any).toastr as ToastrApi | undefined;
        if (toastr?.error) {
            toastr.error(message, title);
        } else {
            FeedbackService._showFallbackToast(`🔴 ${message}`, 'error');
        }
    }

    public static toastWarn(message: string, title = 'ST-DrawAssistant'): void {
        const toastr = (window as any).toastr as ToastrApi | undefined;
        if (toastr?.warning) {
            toastr.warning(message, title);
        } else {
            FeedbackService._showFallbackToast(`🟡 ${message}`, 'warn');
        }
    }

    public static toastWarning(message: string, title = 'ST-DrawAssistant'): void {
        FeedbackService.toastWarn(message, title);
    }

    public static toastInfo(message: string, title = 'ST-DrawAssistant'): void {
        const toastr = (window as any).toastr as ToastrApi | undefined;
        if (toastr?.info) {
            toastr.info(message, title);
        } else {
            FeedbackService._showFallbackToast(`ℹ️ ${message}`, 'info');
        }
    }

    public static lightbox(imageUrl: string, prompt?: string, info?: any): void {
        const { openLightboxModal } = require('../media/lightbox-modal');
        openLightboxModal(imageUrl, prompt, info);
    }
}
