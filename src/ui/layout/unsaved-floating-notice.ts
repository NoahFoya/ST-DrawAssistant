/**
 * 顶置居中独立浮动未保存提示通知条 (UnsavedFloatingNotice)
 *
 * 核心机制：
 * 1. 订阅 unsavedStateManager 状态机变更，收集处于脏状态（Dirty）的预设适配器；
 * 2. 当存在未保存改动时展示高显眼度的警示通知条，汇总提示发生变更的 Tab 列表；
 * 3. 提供一键“保存修改”与一键“放弃改动”；
 * 4. 自身实现 IDisposable，随弹窗关闭自动注销全局状态订阅并移除 DOM 节点。
 */

import { IDisposable } from '../../types';
import { unsavedStateManager, FeedbackService } from '../feedback/feedback';

/**
 * 浮动未保存提示组件句柄
 */
export interface FloatingNoticeComponent extends IDisposable {
    /** 浮层根 DOM 节点 */
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

        const names = dirtyList.map((p) => `【${p.tabName}】`).join('、');
        notice.innerHTML = `
            <div class="da-floating-notice-left">
                <span class="da-floating-notice-icon">⚠️</span>
                <span class="da-floating-notice-text">检测到 ${names} 存在未保存修改 <span class="da-floating-notice-sub">(切出将丢弃)</span></span>
            </div>
            <div class="da-floating-notice-actions">
                <button type="button" class="da-btn da-btn--primary da-btn--sm" id="da-floating-save-btn">保存修改</button>
                <button type="button" class="da-btn da-btn--secondary da-btn--sm" id="da-floating-discard-btn">放弃改动</button>
            </div>
        `;

        const saveBtn = notice.querySelector<HTMLButtonElement>('#da-floating-save-btn');
        saveBtn?.addEventListener('click', async () => {
            saveBtn.disabled = true;
            try {
                for (const provider of dirtyList) {
                    await provider.saveChanges();
                }
                FeedbackService.toastSuccess('所有未保存修改已成功保存');
            } catch (err: any) {
                FeedbackService.toastError(`保存方案失败: ${err?.message || err}`);
            }
        });

        const discardBtn = notice.querySelector<HTMLButtonElement>('#da-floating-discard-btn');
        discardBtn?.addEventListener('click', () => {
            for (const provider of dirtyList) {
                provider.discardChanges();
            }
            FeedbackService.toastInfo('已放弃未保存的修改');
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
