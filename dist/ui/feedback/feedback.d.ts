/**
 * @module ui/feedback/feedback
 * @description 核心交互与反馈域：统一模态对话框、Toast 通知与未保存状态拦截中枢 (Feedback Domain)
 */
export interface ConfirmDialogOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
}
export interface PromptDialogOptions {
    title?: string;
    message?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}
export interface TripleChoiceDialogOptions {
    title?: string;
    message: string;
    saveText?: string;
    discardText?: string;
    cancelText?: string;
}
export type TripleChoiceResult = 'save' | 'discard' | 'cancel';
/**
 * 弹出确认模态对话框
 */
export declare function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean>;
/**
 * 弹出单行文本输入模态对话框
 */
export declare function showPromptDialog(options: PromptDialogOptions): Promise<string | null>;
/**
 * 弹出三选一模态对话框 (保存/放弃/取消)
 */
export declare function showTripleChoiceDialog(options: TripleChoiceDialogOptions): Promise<TripleChoiceResult>;
/**
 * Tab 选项卡未保存状态提供者接口
 */
export interface UnsavedProvider {
    tabId: string;
    tabName: string;
    hasUnsavedChanges: () => boolean;
    saveChanges: () => Promise<void> | void;
    discardChanges: () => void;
}
/**
 * 全局未保存修改状态管理器
 */
export declare class UnsavedStateManager {
    private readonly _providers;
    private readonly _listeners;
    registerProvider(provider: UnsavedProvider): void;
    unregisterProvider(tabId: string): void;
    subscribeStateChange(listener: () => void): () => void;
    notifyStateChange(): void;
    getDirtyProviders(): UnsavedProvider[];
    checkUnsavedBeforeAction(actionDesc?: string): Promise<'proceed' | 'cancel'>;
}
export declare const unsavedStateManager: UnsavedStateManager;
/**
 * 统一交互反馈与通知中枢 (FeedbackService)
 */
export declare class FeedbackService {
    static readonly unsavedStateManager: UnsavedStateManager;
    constructor(_modalService?: unknown);
    static confirm(options: ConfirmDialogOptions | string): Promise<boolean>;
    static prompt(options: PromptDialogOptions | string): Promise<string | null>;
    static tripleChoice(options: TripleChoiceDialogOptions): Promise<TripleChoiceResult>;
    private static _showFallbackToast;
    static toast(message: string, typeOrIsError?: boolean | 'success' | 'error' | 'warn' | 'info'): void;
    static toastSuccess(message: string, title?: string): void;
    static toastError(message: string, title?: string): void;
    static toastWarn(message: string, title?: string): void;
    static toastWarning(message: string, title?: string): void;
    static toastInfo(message: string, title?: string): void;
    static lightbox(imageUrl: string, prompt?: string, info?: any): void;
}
//# sourceMappingURL=feedback.d.ts.map