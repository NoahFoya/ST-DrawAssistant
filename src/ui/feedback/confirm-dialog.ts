/**
 * 全局模态确认对话框服务 (ConfirmDialogService)。
 *
 * @remarks
 * 基于 Promise 异步等待用户点击确认或取消决策，替代原生阻塞式 window.confirm。
 * 支持键盘 Enter 确认、Escape 取消与遮罩点击退出；非 DOM 环境下安全回退返回取消结果（false / null）。
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

export interface ChooseDialogOptions {
    /** 对话框主标题，默认 '操作确认' */
    title?: string;
    /** 提示正文内容 */
    message: string;
    /** 主确认按钮文案（例如「保存并关闭」） */
    primaryText: string;
    /** 次要动作按钮文案（例如「放弃修改」） */
    secondaryText: string;
    /** 取消按钮文案，默认 '取消' */
    cancelText?: string;
    /** 次要动作按钮是否为危险样式 */
    isSecondaryDanger?: boolean;
}

export class ConfirmDialogService implements Disposable {
    private activeCleanup: (() => void) | null = null;
    private dialogCounter = 0;

    private mountDialogShell<T>(config: {
        role: 'alertdialog' | 'dialog';
        title: string;
        message?: string;
        panelClass?: string;
        onCancel: () => T;
        renderBody: (ctx: {
            panel: HTMLElement;
            actionsEl: HTMLElement;
            finish: (value: T) => void;
            registerTimer: (timer: ReturnType<typeof setTimeout>) => void;
        }) => {
            initialFocus: HTMLElement | null;
            onEnter?: () => void;
        };
    }): Promise<T> {
        this.dispose();

        return new Promise<T>((resolve) => {
            let settled = false;
            const previousActive =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const timers = new Set<ReturnType<typeof setTimeout>>();

            const seq = ++this.dialogCounter;
            const titleId = `da-dialog-title-${seq}`;
            const messageId = `da-dialog-message-${seq}`;

            const backdrop = document.createElement('div');
            backdrop.className = 'da-modal-backdrop da-dialog-backdrop st-da-root';

            const panel = document.createElement('div');
            panel.className = config.panelClass
                ? `da-dialog-panel ${config.panelClass}`
                : 'da-dialog-panel';
            panel.setAttribute('role', config.role);
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-labelledby', titleId);

            const titleEl = document.createElement('h3');
            titleEl.id = titleId;
            titleEl.className = 'da-dialog-title';
            titleEl.textContent = config.title;
            panel.appendChild(titleEl);

            if (config.message) {
                const messageEl = document.createElement('div');
                messageEl.id = messageId;
                messageEl.className = 'da-dialog-message';
                messageEl.textContent = config.message;
                panel.setAttribute('aria-describedby', messageId);
                panel.appendChild(messageEl);
            }

            const actionsEl = document.createElement('div');
            actionsEl.className = 'da-dialog-actions';

            const cleanup = (result: T) => {
                if (settled) return;
                settled = true;
                for (const timer of timers) {
                    clearTimeout(timer);
                }
                timers.clear();
                overlayStack.remove('confirm-dialog');
                window.removeEventListener('keydown', onKeyDown, true);
                backdrop.remove();
                if (this.activeCleanup) {
                    this.activeCleanup = null;
                }
                if (previousActive && previousActive.isConnected) {
                    previousActive.focus();
                }
                resolve(result);
            };

            const cancelValue = () => cleanup(config.onCancel());
            this.activeCleanup = cancelValue;

            const bodySetup = config.renderBody({
                panel,
                actionsEl,
                finish: cleanup,
                registerTimer: (timer) => {
                    timers.add(timer);
                },
            });

            panel.appendChild(actionsEl);
            backdrop.appendChild(panel);

            let pointerDownOnBackdrop = false;
            backdrop.addEventListener('pointerdown', (e) => {
                pointerDownOnBackdrop = e.target === backdrop;
            });
            backdrop.addEventListener('click', (e) => {
                const shouldClose = pointerDownOnBackdrop && e.target === backdrop;
                pointerDownOnBackdrop = false;
                if (shouldClose) {
                    cancelValue();
                }
            });

            const getFocusable = (): HTMLElement[] =>
                Array.from(
                    panel.querySelectorAll<HTMLElement>(
                        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                    )
                ).filter((el) => el.offsetParent !== null || el === document.activeElement);

            const onKeyDown = (e: KeyboardEvent) => {
                if (!overlayStack.isTop('confirm-dialog')) return;
                if (e.key === 'Tab') {
                    const focusable = getFocusable();
                    if (focusable.length === 0) return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    const active = document.activeElement as HTMLElement | null;
                    if (e.shiftKey) {
                        if (!active || active === first || !panel.contains(active)) {
                            e.preventDefault();
                            last.focus();
                        }
                    } else if (!active || active === last || !panel.contains(active)) {
                        e.preventDefault();
                        first.focus();
                    }
                    return;
                }
                if (e.key === 'Enter' && bodySetup.onEnter) {
                    const active = document.activeElement;
                    if (active instanceof HTMLButtonElement && panel.contains(active)) {
                        // 允许焦点在其它按钮上时由浏览器触发该按钮自身点击
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    bodySetup.onEnter();
                }
            };

            overlayStack.push('confirm-dialog', cancelValue);
            window.addEventListener('keydown', onKeyDown, true);
            document.body.appendChild(backdrop);

            bodySetup.initialFocus?.focus();
            if (bodySetup.initialFocus instanceof HTMLInputElement) {
                bodySetup.initialFocus.select();
            }
        });
    }

    private createDialogButton(
        text: string,
        variantClass: string,
        onClick: () => void
    ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `da-btn ${variantClass} da-btn--sm`;
        btn.textContent = text;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

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

        return this.mountDialogShell<boolean>({
            role: 'alertdialog',
            title,
            message,
            onCancel: () => false,
            renderBody: ({ actionsEl, finish, registerTimer }) => {
                if (opts.copyText) {
                    const copyBtn = this.createDialogButton(
                        '复制日志',
                        'da-btn--secondary da-dialog-btn--copy',
                        async () => {
                            try {
                                await navigator.clipboard.writeText(opts.copyText!);
                                copyBtn.textContent = '已复制';
                                const timer = setTimeout(() => {
                                    copyBtn.textContent = '复制日志';
                                }, 2000);
                                registerTimer(timer);
                            } catch {
                                // 剪贴板异常降级
                            }
                        }
                    );
                    actionsEl.appendChild(copyBtn);
                }

                let cancelBtn: HTMLButtonElement | null = null;
                if (cancelText !== '') {
                    cancelBtn = this.createDialogButton(cancelText, 'da-btn--secondary', () =>
                        finish(false)
                    );
                    actionsEl.appendChild(cancelBtn);
                }

                const confirmBtn = this.createDialogButton(
                    confirmText,
                    isDanger ? 'da-btn--danger' : 'da-btn--primary',
                    () => finish(true)
                );
                actionsEl.appendChild(confirmBtn);

                return {
                    // 高危破坏性操作默认聚焦取消按钮以防误触
                    initialFocus: isDanger && cancelBtn ? cancelBtn : confirmBtn,
                    onEnter: () => finish(true),
                };
            },
        });
    }

    /**
     * 调起三选一模态对话框（主动作 / 次要动作 / 取消）。
     */
    public choose(options: ChooseDialogOptions): Promise<'primary' | 'secondary' | 'cancel'> {
        if (typeof document === 'undefined' || !document.body) {
            return Promise.resolve('cancel');
        }

        return this.mountDialogShell<'primary' | 'secondary' | 'cancel'>({
            role: 'alertdialog',
            title: options.title ?? '操作确认',
            message: options.message,
            onCancel: () => 'cancel',
            renderBody: ({ actionsEl, finish }) => {
                const cancelBtn = this.createDialogButton(
                    options.cancelText ?? '取消',
                    'da-btn--secondary',
                    () => finish('cancel')
                );
                const secondaryBtn = this.createDialogButton(
                    options.secondaryText,
                    options.isSecondaryDanger ? 'da-btn--danger' : 'da-btn--secondary',
                    () => finish('secondary')
                );
                const primaryBtn = this.createDialogButton(
                    options.primaryText,
                    'da-btn--primary',
                    () => finish('primary')
                );
                actionsEl.appendChild(cancelBtn);
                actionsEl.appendChild(secondaryBtn);
                actionsEl.appendChild(primaryBtn);

                return {
                    initialFocus: primaryBtn,
                    onEnter: () => finish('primary'),
                };
            },
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

        return this.mountDialogShell<string | null>({
            role: 'dialog',
            title,
            message: message || undefined,
            panelClass: 'da-dialog-panel--prompt',
            onCancel: () => null,
            renderBody: ({ panel, actionsEl, finish }) => {
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
                errorEl.setAttribute('role', 'alert');
                errorEl.style.display = 'none';

                inputWrapper.appendChild(inputEl);
                inputWrapper.appendChild(errorEl);
                panel.appendChild(inputWrapper);

                const confirmBtn = this.createDialogButton(confirmText, 'da-btn--primary', () => {
                    if (validate(inputEl.value)) {
                        finish(inputEl.value.trim());
                    }
                });
                const cancelBtn = this.createDialogButton(cancelText, 'da-btn--secondary', () =>
                    finish(null)
                );

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
                    }
                    errorEl.textContent = '';
                    errorEl.style.display = 'none';
                    inputEl.classList.remove('is-invalid');
                    confirmBtn.disabled = false;
                    return true;
                };

                inputEl.addEventListener('input', () => {
                    validate(inputEl.value);
                });

                actionsEl.appendChild(cancelBtn);
                actionsEl.appendChild(confirmBtn);
                validate(inputEl.value);

                return {
                    initialFocus: inputEl,
                    onEnter: () => {
                        if (validate(inputEl.value)) {
                            finish(inputEl.value.trim());
                        }
                    },
                };
            },
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
