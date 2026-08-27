/**
 * @module ui/feedback/modal-service
 * @description 全局模态框生命周期与 Z-Index 栈调度中心 (ModalService)
 */
import { IDisposable } from '../../core/foundation/disposable';
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
export declare class ModalService implements IModalService {
    private readonly _stack;
    private _baseZIndex;
    private _isDisposed;
    constructor();
    private setupKeyboardListener;
    open(element: HTMLElement, options?: ModalOptions): IDisposable;
    close(modalId: string): void;
    closeTop(): boolean;
    getOpenCount(): number;
    dispose(): void;
}
//# sourceMappingURL=modal-service.d.ts.map