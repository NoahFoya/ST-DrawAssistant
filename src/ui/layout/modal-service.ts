/**
 * @module ui/layout/modal-service
 * @description 模态框生命周期与层级调度服务 (ModalService)
 */

import { IDisposable, toDisposable } from '../../core';
import { ThemeService } from '../foundation/theme-service';

export interface ModalOptions {
    id?: string;
    closeOnEscape?: boolean;
    closeOnBackdrop?: boolean;
    onClose?: () => void;
}

export interface IModalService extends IDisposable {
    open(element: HTMLElement, options?: ModalOptions): IDisposable;
    close(modalId: string): void;
    closeTop(): boolean;
    getOpenCount(): number;
    getOpenElements(): HTMLElement[];
}

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

    public open(element: HTMLElement, options?: ModalOptions): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});

        const id = options?.id || `modal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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

    public close(modalId: string): void {
        const entry = this._stack.find((m) => m.id === modalId);
        entry?.dispose();
    }

    public closeTop(): boolean {
        if (this._stack.length === 0) return false;
        const top = this._stack[this._stack.length - 1];
        top.dispose();
        return true;
    }

    public getOpenCount(): number {
        return this._stack.length;
    }

    public getOpenElements(): HTMLElement[] {
        return this._stack.map((m) => m.element);
    }

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
