/**
 * @file tests/client/ui/modal-feedback.test.ts
 * @description ModalService 与 FeedbackService 交互测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalService } from '../../../src/client/ui/layout/modal-service';
import { FeedbackService, unsavedStateManager } from '../../../src/client/ui/feedback/feedback';

describe('ModalService & FeedbackService', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        ModalService.getInstance().dispose();
    });

    describe('ModalService', () => {
        it('应按 LIFO 栈管理多个弹窗并正确计算 zIndex', () => {
            const modalService = ModalService.getInstance();

            const el1 = document.createElement('div');
            const el2 = document.createElement('div');

            const handle1 = modalService.open(el1);
            expect(el1.style.zIndex).toBe('10000');
            expect(modalService.getOpenCount()).toBe(1);

            const handle2 = modalService.open(el2);
            expect(el2.style.zIndex).toBe('10010');
            expect(modalService.getOpenCount()).toBe(2);

            // 关闭顶层
            expect(modalService.closeTop()).toBe(true);
            expect(modalService.getOpenCount()).toBe(1);

            handle1.dispose();
            expect(modalService.getOpenCount()).toBe(0);
        });

        it('点击 backdrop 应该关闭对应弹窗', () => {
            const modalService = ModalService.getInstance();
            const el = document.createElement('div');
            const onClose = vi.fn();

            modalService.open(el, { closeOnBackdrop: true, onClose });
            expect(modalService.getOpenCount()).toBe(1);

            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(modalService.getOpenCount()).toBe(0);
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('FeedbackService & UnsavedStateManager', () => {
        it('UnsavedStateManager 应能正确收集脏状态提供者', () => {
            let isDirty = false;
            unsavedStateManager.registerProvider({
                tabId: 'test-tab',
                tabName: '测试Tab',
                hasUnsavedChanges: () => isDirty,
                saveChanges: vi.fn(),
                discardChanges: vi.fn()
            });

            expect(unsavedStateManager.getDirtyProviders().length).toBe(0);

            isDirty = true;
            expect(unsavedStateManager.getDirtyProviders().length).toBe(1);
            expect(unsavedStateManager.getDirtyProviders()[0].tabName).toBe('测试Tab');

            unsavedStateManager.unregisterProvider('test-tab');
            expect(unsavedStateManager.getDirtyProviders().length).toBe(0);
        });

        it('FeedbackService.toast 不应抛出异常', () => {
            expect(() => {
                FeedbackService.toast('测试通知', 'info');
                FeedbackService.toastSuccess('成功提示');
                FeedbackService.toastWarn('警告提示');
                FeedbackService.toastError('错误提示');
            }).not.toThrow();
        });
    });
});
