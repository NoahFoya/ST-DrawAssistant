/**
 * 全局模态确认对话框服务 (ConfirmDialogService)。
 *
 * @remarks
 * 基于 Promise 异步等待用户点击确认或取消决策，替代原生阻塞式 window.confirm。
 * 支持键盘 Enter 确认、Escape 取消与遮罩点击退出；在单测环境中支持代理至被 mock 的 window.confirm。
 */

import type { Disposable } from '../types';
import { overlayStack } from '../framework/overlay-stack';

export interface ConfirmDialogOptions {
    /** 对话框主标题，默认 '操作确认' */
    title?: string;
    /** 确认提示文本或说明内容 */
    message: string;
    /** 确认按钮文本，默认 '确定' */
    confirmText?: string;
    /** 取消按钮文本，默认 '取消'。若显式传入空字符串 '' 则不渲染取消按钮（用作单按钮提示/排查框） */
    cancelText?: string;
    /** 是否为破坏性高危操作（若为 true 渲染危险红色高亮按钮） */
    isDanger?: boolean;
    /** 可选的剪贴板复制文本内容（若提供则额外渲染“复制日志”辅助按钮） */
    copyText?: string;
}

export interface PromptDialogOptions {
    /** 对话框主标题，默认 '请输入' */
    title?: string;
    /** 输入提示或说明内容 */
    message?: string;
    /** 默认初始值 */
    defaultValue?: string;
    /** 输入提示文案 */
    placeholder?: string;
    /** 确认按钮文本，默认 '确定' */
    confirmText?: string;
    /** 取消按钮文本，默认 '取消' */
    cancelText?: string;
    /** 实时校验器：返回错误提示文本，返回 null 或空字符串表示校验通过 */
    validator?: (value: string) => string | null;
}

export class ConfirmDialogService implements Disposable {
    private activeCleanup: (() => void) | null = null;

    /**
     * 调起模态单按钮信息/排查详情对话框。
     *
     * @param options 提示文本或确认配置项
     * @returns 用户点击知道了或按 Escape 键关闭后 resolve(true)
     */
    public info(options: ConfirmDialogOptions | string): Promise<boolean> {
        const opts: ConfirmDialogOptions = typeof options === 'string'
            ? { message: options }
            : options;
        return this.confirm({
            title: opts.title ?? '提示',
            message: opts.message,
            confirmText: opts.confirmText ?? '知道了',
            cancelText: '',
            isDanger: opts.isDanger,
            copyText: opts.copyText,
        });
    }

    /**
     * 调起模态确认对话框并等待用户操作决策。
     *
     * @param options 确认配置项或提示文本
     * @returns 用户确认时 resolve(true)；点击取消、遮罩层或按 Escape 键 resolve(false)
     */
    public confirm(options: ConfirmDialogOptions | string): Promise<boolean> {
        const opts: ConfirmDialogOptions = typeof options === 'string'
            ? { message: options }
            : options;

        const title = opts.title ?? '操作确认';
        const message = opts.message;
        const confirmText = opts.confirmText ?? '确定';
        const cancelText = opts.cancelText ?? '取消';
        const isDanger = Boolean(opts.isDanger);

        // 非浏览器 DOM 环境（如 Node.js 单元测试）直接返回 false，避免未捕获异常
        if (typeof document === 'undefined' || !document.body) {
            return Promise.resolve(false);
        }

        // 若已有活跃对话框，先清理关闭旧对话框
        this.dispose();

        return new Promise<boolean>((resolve) => {
            let settled = false;

            const backdrop = document.createElement('div');
            backdrop.className = 'da-modal-backdrop da-dialog-backdrop st-da-root';

            const panel = document.createElement('div');
            panel.className = 'da-dialog-panel';
            panel.setAttribute('role', 'alertdialog');
            panel.setAttribute('aria-modal', 'true');

            // 1. 标题区
            const titleEl = document.createElement('h3');
            titleEl.className = 'da-dialog-title';
            titleEl.textContent = title;
            panel.appendChild(titleEl);

            // 2. 说明正文区
            const messageEl = document.createElement('div');
            messageEl.className = 'da-dialog-message';
            messageEl.textContent = message;
            panel.appendChild(messageEl);

            // 3. 底部操作按钮栏
            const actionsEl = document.createElement('div');
            actionsEl.className = 'da-dialog-actions';

            if (opts.copyText) {
                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.className = 'da-btn da-btn--secondary da-btn--sm da-dialog-btn--copy';
                copyBtn.textContent = '复制日志';
                copyBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await navigator.clipboard.writeText(opts.copyText!);
                        copyBtn.textContent = '已复制';
                        setTimeout(() => {
                            copyBtn.textContent = '复制日志';
                        }, 2000);
                    } catch {
                        // 剪贴板异常降级
                    }
                });
                actionsEl.appendChild(copyBtn);
            }

            let cancelBtn: HTMLButtonElement | null = null;
            if (cancelText !== '') {
                cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                cancelBtn.textContent = cancelText;
                actionsEl.appendChild(cancelBtn);
            }

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = `da-btn ${isDanger ? 'da-btn--danger' : 'da-btn--primary'} da-btn--sm`;
            confirmBtn.textContent = confirmText;
            actionsEl.appendChild(confirmBtn);

            panel.appendChild(actionsEl);
            backdrop.appendChild(panel);

            // 4. 清理注销逻辑
            const cleanup = (accepted: boolean) => {
                if (settled) return;
                settled = true;
                overlayStack.remove('confirm-dialog');
                window.removeEventListener('keydown', onKeyDown, true);
                backdrop.remove();
                if (this.activeCleanup) {
                    this.activeCleanup = null;
                }
                resolve(accepted);
            };
            this.activeCleanup = () => cleanup(false);

            const handleDecision = (accepted: boolean) => {
                cleanup(accepted);
            };

            // 5. 事件交互绑定
            confirmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleDecision(true);
            });

            if (cancelBtn) {
                cancelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleDecision(false);
                });
            }

            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) {
                    handleDecision(false);
                }
            });

            const onKeyDown = (e: KeyboardEvent) => {
                if (!overlayStack.isTop('confirm-dialog')) return;
                if (e.key === 'Enter') {
                    // 若焦点不在取消按钮上，回车默认触发确认
                    if (!cancelBtn || document.activeElement !== cancelBtn) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDecision(true);
                    }
                }
            };
            overlayStack.push('confirm-dialog', () => handleDecision(false));
            window.addEventListener('keydown', onKeyDown, true);

            // 6. 挂载 DOM 并聚焦按钮
            document.body.appendChild(backdrop);
            if (isDanger && cancelBtn) {
                // 高危破坏性操作默认聚焦取消按钮以防误触
                cancelBtn.focus();
            } else {
                confirmBtn.focus();
            }
        });
    }

    /**
     * 调起模态单行文本输入对话框并等待用户输入决策。
     *
     * @param options 输入框配置项或提示信息
     * @returns 用户确认时 resolve(string)；取消、关闭或按 Escape 时 resolve(null)
     */
    public prompt(options: PromptDialogOptions | string): Promise<string | null> {
        const opts: PromptDialogOptions = typeof options === 'string'
            ? { message: options }
            : options;

        const title = opts.title ?? '请输入';
        const message = opts.message ?? '';
        const defaultValue = opts.defaultValue ?? '';
        const placeholder = opts.placeholder ?? '';
        const confirmText = opts.confirmText ?? '确定';
        const cancelText = opts.cancelText ?? '取消';
        const validator = opts.validator;

        // 非浏览器 DOM 环境（如 Node.js 单元测试）直接返回 defaultValue 或 null
        if (typeof document === 'undefined' || !document.body) {
            return Promise.resolve(defaultValue ? defaultValue.trim() : null);
        }

        // 若已有活跃对话框，先清理关闭旧对话框
        this.dispose();

        return new Promise<string | null>((resolve) => {
            let settled = false;

            const backdrop = document.createElement('div');
            backdrop.className = 'da-modal-backdrop da-dialog-backdrop st-da-root';

            const panel = document.createElement('div');
            panel.className = 'da-dialog-panel da-dialog-panel--prompt';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');

            // 1. 标题区
            const titleEl = document.createElement('h3');
            titleEl.className = 'da-dialog-title';
            titleEl.textContent = title;
            panel.appendChild(titleEl);

            // 2. 说明正文区
            if (message) {
                const messageEl = document.createElement('div');
                messageEl.className = 'da-dialog-message';
                messageEl.textContent = message;
                panel.appendChild(messageEl);
            }

            // 3. 输入框区与即时校验提示
            const inputWrapper = document.createElement('div');
            inputWrapper.className = 'da-dialog-input-wrapper';

            const inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.className = 'da-input da-dialog-input';
            inputEl.value = defaultValue;
            if (placeholder) {
                inputEl.placeholder = placeholder;
            }

            const errorEl = document.createElement('div');
            errorEl.className = 'da-dialog-error';
            errorEl.style.display = 'none';

            inputWrapper.appendChild(inputEl);
            inputWrapper.appendChild(errorEl);
            panel.appendChild(inputWrapper);

            // 4. 底部操作按钮栏
            const actionsEl = document.createElement('div');
            actionsEl.className = 'da-dialog-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            cancelBtn.textContent = cancelText;

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 'da-btn da-btn--primary da-btn--sm';
            confirmBtn.textContent = confirmText;

            actionsEl.appendChild(cancelBtn);
            actionsEl.appendChild(confirmBtn);
            panel.appendChild(actionsEl);
            backdrop.appendChild(panel);

            // 5. 校验函数
            const validate = (val: string): boolean => {
                const trimmed = val.trim();
                let errMsg: string | null = null;
                if (!trimmed) {
                    errMsg = '名称不能为空';
                } else if (validator) {
                    errMsg = validator(trimmed);
                }

                if (errMsg) {
                    errorEl.textContent = errMsg;
                    errorEl.style.display = 'block';
                    inputEl.classList.add('is-invalid');
                    confirmBtn.disabled = true;
                    return false;
                } else {
                    errorEl.textContent = '';
                    errorEl.style.display = 'none';
                    inputEl.classList.remove('is-invalid');
                    confirmBtn.disabled = false;
                    return true;
                }
            };

            // 6. 清理注销逻辑
            const cleanup = (result: string | null) => {
                if (settled) return;
                settled = true;
                overlayStack.remove('confirm-dialog');
                window.removeEventListener('keydown', onKeyDown, true);
                backdrop.remove();
                if (this.activeCleanup) {
                    this.activeCleanup = null;
                }
                resolve(result);
            };
            this.activeCleanup = () => cleanup(null);

            // 7. 事件交互绑定
            inputEl.addEventListener('input', () => {
                validate(inputEl.value);
            });

            confirmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (validate(inputEl.value)) {
                    cleanup(inputEl.value.trim());
                }
            });

            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                cleanup(null);
            });

            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) {
                    cleanup(null);
                }
            });

            const onKeyDown = (e: KeyboardEvent) => {
                if (!overlayStack.isTop('confirm-dialog')) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (validate(inputEl.value)) {
                        cleanup(inputEl.value.trim());
                    }
                }
            };
            overlayStack.push('confirm-dialog', () => cleanup(null));
            window.addEventListener('keydown', onKeyDown, true);

            // 8. 挂载 DOM 并聚焦选中输入框
            document.body.appendChild(backdrop);
            validate(inputEl.value);
            inputEl.focus();
            inputEl.select();
        });
    }

    /**
     * 关闭当前可能处于激活状态的模态对话框。
     */
    public dispose(): void {
        if (this.activeCleanup) {
            this.activeCleanup();
            this.activeCleanup = null;
        }
    }
}

export const ConfirmDialog = new ConfirmDialogService();
