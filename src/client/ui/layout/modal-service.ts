/**
 * @module ui/layout/modal-service
 * @description 全局多层模态弹窗堆栈调度服务 (ModalService)
 *
 * 核心设计：
 * 1. 采用后进先出 (LIFO) 栈式管理多层弹窗（如主设置面板 -> 蓝图编辑弹窗 -> 确认对话框）；
 * 2. 动态自增计算 `zIndex`（基准 10000，每层步进 +10），保证后打开的弹窗始终置于上层；
 * 3. 统一拦截全局 Escape 键盘事件，确保只关闭最顶层活动弹窗；
 * 4. 返回标准 `IDisposable` 关闭句柄，支持外部与内部幂等注销。
 */

import { IDisposable, toDisposable } from '../../core';
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
     * 响应规则：当按下 Escape 键且存在打开的弹窗时，严格按后进先出 (LIFO) 顺序仅关闭最顶层弹窗
     */
    private setupKeyboardListener(): void {
        if (typeof window === 'undefined') return;

        this._onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._stack.length > 0) {
                const top = this._stack[this._stack.length - 1];
                if (top.options?.closeOnEscape !== false) {
                    top.dispose();
                }
            }
        };

        window.addEventListener('keydown', this._onKeyDown);
    }

    /**
     * 打开并挂载一个模态弹窗到 DOM 中
     *
     * 处理时序：
     * 1. 根据当前堆栈深度动态计算 `zIndex`（保证后开的层级更高）；
     * 2. 注入全局主题变量并将节点挂载到 `document.body`；
     * 3. 注册遮罩点击关闭监听与受管注销闭包；
     * 4. 压入堆栈并返回 `IDisposable` 句柄。
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
        };

        if (options?.closeOnBackdrop !== false) {
            element.addEventListener('click', (e) => {
                if (e.target === element) {
                    close();
                }
            });
        }

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
     * 销毁服务并强制清理所有当前打开的弹窗与键盘监听
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
