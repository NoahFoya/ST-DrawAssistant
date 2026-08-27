/**
 * @module ui/services/feedback-service
 * @description 统一用户交互反馈服务 (Toast 通知、模态对话框与未保存变更拦截)
 */

import { IModalService, ModalService } from './modal-service';

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
}

export interface PromptDialogOptions {
    title: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}

/**
 * 用户交互反馈服务接口
 */
export interface IFeedbackService {
    /** 弹出浮动 Toast 通知消息 */
    toast(message: string, title?: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
    /** 弹出确认模态对话框 */
    confirm(options: ConfirmDialogOptions): Promise<boolean>;
    /** 弹出文本输入模态对话框 */
    prompt(options: PromptDialogOptions): Promise<string | null>;
}

export class FeedbackService implements IFeedbackService {
    private readonly _modalService: IModalService;

    constructor(modalService?: IModalService) {
        this._modalService = modalService || new ModalService();
    }

    public toast(message: string, title = '提示', type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
        const toastEl = document.createElement('div');
        toastEl.className = `da-toast da-toast--${type}`;
        toastEl.innerHTML = `
            <div class="da-toast-title">${title}</div>
            <div class="da-toast-message">${message}</div>
        `;
        document.body.appendChild(toastEl);

        setTimeout(() => {
            toastEl.classList.add('da-toast--show');
        }, 10);

        setTimeout(() => {
            toastEl.classList.remove('da-toast--show');
            setTimeout(() => toastEl.remove(), 300);
        }, 3000);
    }

    public confirm(options: ConfirmDialogOptions): Promise<boolean> {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'da-modal-backdrop';

            const panel = document.createElement('div');
            panel.className = 'da-dialog-panel';

            const title = document.createElement('div');
            title.className = 'da-dialog-title';
            title.textContent = options.title;
            panel.appendChild(title);

            const msg = document.createElement('div');
            msg.className = 'da-dialog-message';
            msg.textContent = options.message;
            panel.appendChild(msg);

            const actions = document.createElement('div');
            actions.className = 'da-dialog-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'da-btn secondary';
            cancelBtn.textContent = options.cancelText || '取消';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = options.isDangerous ? 'da-btn danger' : 'da-btn primary';
            confirmBtn.textContent = options.confirmText || '确认';

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);
            panel.appendChild(actions);
            backdrop.appendChild(panel);

            const modalHandle = this._modalService.open(backdrop, {
                closeOnBackdrop: false,
                onClose: () => resolve(false)
            });

            cancelBtn.onclick = () => {
                modalHandle.dispose();
                resolve(false);
            };

            confirmBtn.onclick = () => {
                modalHandle.dispose();
                resolve(true);
            };
        });
    }

    public prompt(options: PromptDialogOptions): Promise<string | null> {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'da-modal-backdrop';

            const panel = document.createElement('div');
            panel.className = 'da-dialog-panel';

            const title = document.createElement('div');
            title.className = 'da-dialog-title';
            title.textContent = options.title;
            panel.appendChild(title);

            const msg = document.createElement('div');
            msg.className = 'da-dialog-message';
            msg.textContent = options.message;
            panel.appendChild(msg);

            const input = document.createElement('input');
            input.className = 'da-input';
            input.style.width = '100%';
            input.style.marginBottom = '16px';
            input.value = options.defaultValue || '';
            if (options.placeholder) input.placeholder = options.placeholder;
            panel.appendChild(input);

            const actions = document.createElement('div');
            actions.className = 'da-dialog-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'da-btn secondary';
            cancelBtn.textContent = options.cancelText || '取消';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'da-btn primary';
            confirmBtn.textContent = options.confirmText || '确认';

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);
            panel.appendChild(actions);
            backdrop.appendChild(panel);

            const modalHandle = this._modalService.open(backdrop, {
                closeOnBackdrop: false,
                onClose: () => resolve(null)
            });

            setTimeout(() => input.focus(), 50);

            cancelBtn.onclick = () => {
                modalHandle.dispose();
                resolve(null);
            };

            confirmBtn.onclick = () => {
                const val = input.value;
                modalHandle.dispose();
                resolve(val);
            };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const val = input.value;
                    modalHandle.dispose();
                    resolve(val);
                }
            };
        });
    }
}
