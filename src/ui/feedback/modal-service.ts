/**
 * @module ui/feedback/modal-service
 * @description 全局模态框生命周期与 Z-Index 栈调度中心 (ModalService)
 */

import { IDisposable, toDisposable } from '../../core/foundation/disposable';

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
}

export class ModalService implements IModalService {
    private readonly _stack: Array<{ id: string; element: HTMLElement; options?: ModalOptions; dispose: () => void }> = [];
    private _baseZIndex = 100000;
    private _isDisposed = false;

    constructor() {
        this.setupKeyboardListener();
    }

    private setupKeyboardListener(): void {
        if (typeof window === 'undefined') return;

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._stack.length > 0) {
                const top = this._stack[this._stack.length - 1];
                if (top.options?.closeOnEscape !== false) {
                    top.dispose();
                }
            }
        });
    }

    public open(element: HTMLElement, options?: ModalOptions): IDisposable {
        if (this._isDisposed) return toDisposable(() => {});

        const id = options?.id || `modal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const zIndex = this._baseZIndex + this._stack.length * 10;

        element.style.zIndex = String(zIndex);
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

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        while (this._stack.length > 0) {
            const m = this._stack.pop();
            m?.dispose();
        }
    }
}
