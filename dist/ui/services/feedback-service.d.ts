/**
 * @module ui/services/feedback-service
 * @description 统一用户交互反馈服务 (Toast 通知、模态对话框与未保存变更拦截)
 */
import { IModalService } from './modal-service';
export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
}
export interface PromptDialogOptions {
    title: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}
/**
 * 用户交互反馈服务接口
 */
export interface IFeedbackService {
    /** 弹出浮动 Toast 通知消息 */
    toast(message: string, title?: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
    /** 弹出确认模态对话框 */
    confirm(options: ConfirmDialogOptions): Promise<boolean>;
    /** 弹出文本输入模态对话框 */
    prompt(options: PromptDialogOptions): Promise<string | null>;
}
export declare class FeedbackService implements IFeedbackService {
    private readonly _modalService;
    constructor(modalService?: IModalService);
    toast(message: string, title?: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
    confirm(options: ConfirmDialogOptions): Promise<boolean>;
    prompt(options: PromptDialogOptions): Promise<string | null>;
}
//# sourceMappingURL=feedback-service.d.ts.map