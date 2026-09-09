/**
 * 全局多层模态弹窗堆栈调度服务 (ModalService)
 * 采用后进先出 (LIFO) 栈式管理主设置面板、工作流编辑器与各类对话框。
 * 依据当前压栈深度动态递增计算 z-index，保证新打开的弹窗始终置于上层。
 * 统一拦截 Escape 键盘事件以优先注销顶层活动弹窗，并提供 IDisposable 句柄支持幂等关闭。
 */

import { IDisposable, toDisposable } from '../../types';
import { ThemeService } from '../foundation/theme-service';

/**
 * 模态弹窗打开配置项
 */
export interface ModalOptions {
    /** 弹窗唯一标识 (缺省时自动生成时间戳 ID) */
    id?: string;
    /** 按下 Escape 键时是否自动关闭该弹窗 (默认 true) */
    closeOnEscape?: boolean;
    /** 点击遮罩空白处时是否自动关闭该弹窗 (默认 true) */
    closeOnBackdrop?: boolean;
    /** 弹窗注销关闭时的回调钩子 */
    onClose?: () => void;
}

/**
 * 模态弹窗调度服务接口
 */
export interface IModalService extends IDisposable {
    /** 打开并挂载一个模态弹窗节点，返回其关闭句柄 */
    open(element: HTMLElement, options?: ModalOptions): IDisposable;
    /** 根据 ID 主动关闭指定弹窗 */
    close(modalId: string): void;
    /** 仅关闭当前处于最顶层的活动弹窗 */
    closeTop(): boolean;
    /** 获取当前处于打开状态的弹窗数量 */
    getOpenCount(): number;
    /** 获取当前所有打开弹窗的 DOM 节点列表 */
    getOpenElements(): HTMLElement[];
}

/**
 * 全局模态弹窗堆栈调度服务实现
 */
export class ModalService implements IModalService {
    private static _instance: ModalService | null = null;

    /** 获取全局模态框调度服务单例 */
    public static getInstance(): ModalService {
        if (!ModalService._instance || ModalService._instance._isDisposed) {
            ModalService._instance = new ModalService();
        }
        return ModalService._instance;
    }

    private readonly _stack: Array<{ id: string; element: HTMLElement; options?: ModalOptions; dispose: () => void }> = [];
    private _baseZIndex = 10000;
    private _isDisposed = false;
    private _onKeyDown?: (e: KeyboardEvent) => void;

    constructor() {
        ModalService._instance = this;
        this.setupKeyboardListener();
    }

    /**
     * 监听全局键盘事件
     * 响应规则：
     * 1. 当按下 Escape 键且存在打开的弹窗时，严格按 LIFO 栈顺序仅关闭顶层活动弹窗；
     * 2. 当按下 Tab 键时，在当前顶层弹窗内部执行轻量级循环导航，防止焦点穿透至背景宿主聊天输入框。
     */
    private setupKeyboardListener(): void {
        if (typeof window === 'undefined') return;

        this._onKeyDown = (e: KeyboardEvent) => {
            if (this._stack.length === 0) return;
            const top = this._stack[this._stack.length - 1];

            if (e.key === 'Escape') {
                if (top.options?.closeOnEscape !== false) {
                    top.dispose();
                }
                return;
            }

            if (e.key === 'Tab') {
                this.handleTabKey(e, top.element);
            }
        };

        window.addEventListener('keydown', this._onKeyDown);
    }

    /**
     * 弹窗内部 Tab 键轻量级循环聚焦控制
     * 仅在弹窗自身作用域内寻找首尾可交互元素，避免全局硬拦截破坏宿主环境原生热键
     */
    private handleTabKey(e: KeyboardEvent, modalElement: HTMLElement): void {
        const focusableSelectors = [
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            'a[href]',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', ');

        const focusables = Array.from(
            modalElement.querySelectorAll<HTMLElement>(focusableSelectors)
        ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);

        if (focusables.length === 0) {
            e.preventDefault();
            modalElement.focus();
            return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

        if (e.shiftKey) {
            // 向前逆序导航：当焦点在第一个项或脱离弹窗时，跳至末项
            if (!current || current === first || !modalElement.contains(current)) {
                e.preventDefault();
                last.focus();
            }
        } else {
            // 向后顺序导航：当焦点在最后一个项或脱离弹窗时，跳至首项
            if (!current || current === last || !modalElement.contains(current)) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    /**
     * 打开并挂载一个模态弹窗到 DOM 中
     * 根据当前堆栈深度动态递增 z-index，设置无障碍属性与主题，压栈并返回标准注销句柄。
     * 弹窗打开时记录当前活跃节点，并在关闭时平稳复原焦点。
     *
     * @param element 弹窗遮罩根 DOM 元素
     * @param options 弹窗配置项
     * @returns 弹窗关闭注销句柄
     */
    public open(element: HTMLElement, options?: ModalOptions): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});

        const id = options?.id || `modal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // 动态层级：基准 10000，每压栈一层递增 10
        const zIndex = this._baseZIndex + this._stack.length * 10;

        element.style.zIndex = String(zIndex);
        element.setAttribute('role', 'dialog');
        element.setAttribute('aria-modal', 'true');
        if (!element.hasAttribute('tabindex')) {
            element.tabIndex = -1;
        }

        const previousActiveElement = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

        ThemeService.applyCurrentThemeToNode(element);
        document.body.appendChild(element);

        let isClosed = false;
        const close = () => {
            if (isClosed) return;
            isClosed = true;

            const idx = this._stack.findIndex((m) => m.id === id);
            if (idx >= 0) {
                this._stack.splice(idx, 1);
            }

            element.remove();
            options?.onClose?.();

            // 焦点还原：将焦点平稳还给触发打开此弹窗的原节点，防止焦点遗失在 body 上
            if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
                try {
                    previousActiveElement.focus();
                } catch {
                    // 忽略目标元素已被销毁或从 DOM 移除时的聚焦异常
                }
            }
        };

        if (options?.closeOnBackdrop !== false) {
            element.addEventListener('click', (e) => {
                if (e.target === element) {
                    close();
                }
            });
        }

        // 延迟微任务将初始焦点移入弹窗首个可交互项或弹窗根节点，避免焦点停留在已遮盖的底层元素
        setTimeout(() => {
            if (isClosed || !element.isConnected) return;
            const firstFocusable = element.querySelector<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (firstFocusable) {
                firstFocusable.focus();
            } else {
                element.focus();
            }
        }, 0);

        this._stack.push({ id, element, options, dispose: close });
        return toDisposable(close);
    }

    /**
     * 根据弹窗唯一标识主动关闭弹窗
     * @param modalId 弹窗唯一标识
     */
    public close(modalId: string): void {
        const entry = this._stack.find((m) => m.id === modalId);
        entry?.dispose();
    }

    /**
     * 仅关闭当前处于最顶层的活动弹窗
     * @returns 是否成功关闭顶层弹窗
     */
    public closeTop(): boolean {
        if (this._stack.length === 0) return false;
        const top = this._stack[this._stack.length - 1];
        top.dispose();
        return true;
    }

    /**
     * 获取当前处于打开状态的弹窗数量
     */
    public getOpenCount(): number {
        return this._stack.length;
    }

    /**
     * 获取当前处于打开状态的所有弹窗根 DOM 节点列表
     */
    public getOpenElements(): HTMLElement[] {
        return this._stack.map((m) => m.element);
    }

    /**
     * 销毁服务并清理所有当前打开的弹窗与键盘监听
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        if (typeof window !== 'undefined' && this._onKeyDown) {
            window.removeEventListener('keydown', this._onKeyDown);
            this._onKeyDown = undefined;
        }
        if (ModalService._instance === this) {
            ModalService._instance = null;
        }
        while (this._stack.length > 0) {
            const m = this._stack.pop();
            m?.dispose();
        }
    }
}
