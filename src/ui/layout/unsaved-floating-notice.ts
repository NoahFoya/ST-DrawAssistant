/**
 * @module ui/layout/unsaved-floating-notice
 * @description 顶置居中独立浮动未保存提示通知条 (UnsavedFloatingNotice)
 */

import { IDisposable } from '../../core';
import { unsavedStateManager, FeedbackService } from '../feedback/feedback';

export interface FloatingNoticeComponent extends IDisposable {
    readonly element: HTMLElement;
}

/**
 * 创建独立顶置未保存提示浮层组件
 */
export function createUnsavedFloatingNotice(): FloatingNoticeComponent {
    const notice = document.createElement('div');
    notice.className = 'da-floating-unsaved-notice';
    notice.id = 'da-floating-unsaved-notice';

    const updateView = () => {
        const dirtyList = unsavedStateManager.getDirtyProviders();
        if (dirtyList.length === 0) {
            notice.classList.remove('is-visible');
            notice.innerHTML = '';
            return;
        }

        const names = dirtyList.map((p) => `【${p.tabName}】`).join('与');
        notice.innerHTML = `
            <div class="da-floating-notice-left">
                <span class="da-floating-notice-icon">⚠️</span>
                <span class="da-floating-notice-text">检测到 ${names} 存在未保存修改 <span class="da-floating-notice-sub">(仅当前会话生效)</span></span>
            </div>
            <div class="da-floating-notice-actions">
                <button class="da-btn da-btn--primary da-btn--sm" id="da-floating-save-btn">保存修改</button>
                <button class="da-btn da-btn--secondary da-btn--sm" id="da-floating-discard-btn">放弃改动</button>
            </div>
        `;

        const saveBtn = notice.querySelector<HTMLButtonElement>('#da-floating-save-btn');
        saveBtn?.addEventListener('click', async () => {
            saveBtn.disabled = true;
            try {
                for (const provider of dirtyList) {
                    await provider.saveChanges();
                }
                FeedbackService.toastSuccess('所有方案修改已成功保存！');
            } catch (err: any) {
                FeedbackService.toastError(`保存方案失败: ${err?.message || err}`);
            }
        });

        const discardBtn = notice.querySelector<HTMLButtonElement>('#da-floating-discard-btn');
        discardBtn?.addEventListener('click', () => {
            for (const provider of dirtyList) {
                provider.discardChanges();
            }
            FeedbackService.toastInfo('已放弃未保存的草稿修改');
        });

        notice.classList.add('is-visible');
    };

    const unsubscribe = unsavedStateManager.subscribeStateChange(() => {
        updateView();
    });

    updateView();

    return {
        element: notice,
        dispose: () => {
            unsubscribe();
            notice.remove();
        }
    };
}
