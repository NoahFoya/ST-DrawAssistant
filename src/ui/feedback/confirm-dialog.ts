/**
 * ST-DrawAssistant 模态确认对话框。
 *
 * @remarks
 * 提供基于 Promise 的异步阻断确认交互，遵循 .da-dialog-backdrop 与 .da-dialog-panel 样式规范。
 * 支持键盘快捷键 (Enter 确认，Escape 取消) 与点击背景遮罩退出。
 */

export interface ConfirmDialogOptions {
    /** 对话框标题 */
    title: string;
    /** 对话框提示内容 */
    message: string;
    /** 确认按钮文案 (默认 "确认") */
    confirmText?: string;
    /** 取消按钮文案 (默认 "取消") */
    cancelText?: string;
    /** 是否为高风险操作 (应用红色危险强调样式) */
    danger?: boolean;
}

export class ConfirmDialog {
    /**
     * 弹出确认对话框并等待用户交互选择
     * @param options 对话框配置项
     * @returns Promise<boolean> 用户点击确认返回 true，取消或关闭返回 false
     */
    public static show(options: ConfirmDialogOptions): Promise<boolean> {
        if (typeof document === 'undefined' || !document.body) {
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.classList.add('da-dialog-backdrop');

            const panel = document.createElement('div');
            panel.classList.add('da-dialog-panel');

            const title = document.createElement('h3');
            title.classList.add('da-dialog-title');
            title.textContent = options.title;
            panel.appendChild(title);

            const message = document.createElement('div');
            message.classList.add('da-dialog-message');
            message.textContent = options.message;
            panel.appendChild(message);

            const actions = document.createElement('div');
            actions.classList.add('da-dialog-actions');

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.classList.add('da-btn', 'da-btn--secondary');
            cancelBtn.textContent = options.cancelText || '取消';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.classList.add('da-btn', options.danger ? 'da-btn--danger' : 'da-btn--primary');
            confirmBtn.textContent = options.confirmText || '确认';

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);
            panel.appendChild(actions);
            backdrop.appendChild(panel);

            let isClosed = false;
            const cleanup = (result: boolean) => {
                if (isClosed) return;
                isClosed = true;

                document.removeEventListener('keydown', keydownHandler);
                cancelBtn.removeEventListener('click', onCancel);
                confirmBtn.removeEventListener('click', onConfirm);
                backdrop.removeEventListener('click', onBackdropClick);

                if (backdrop.parentElement) {
                    backdrop.parentElement.removeChild(backdrop);
                }

                resolve(result);
            };

            const onCancel = () => cleanup(false);
            const onConfirm = () => cleanup(true);

            const onBackdropClick = (e: MouseEvent) => {
                if (e.target === backdrop) {
                    cleanup(false);
                }
            };

            const keydownHandler = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    cleanup(false);
                } else if (e.key === 'Enter') {
                    if (document.activeElement !== cancelBtn) {
                        cleanup(true);
                    }
                }
            };

            cancelBtn.addEventListener('click', onCancel);
            confirmBtn.addEventListener('click', onConfirm);
            backdrop.addEventListener('click', onBackdropClick);
            document.addEventListener('keydown', keydownHandler);

            document.body.appendChild(backdrop);
            confirmBtn.focus();
        });
    }
}
