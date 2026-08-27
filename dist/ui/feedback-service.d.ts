/**
 * @module ui/feedback-service
 * @description 统一 UI 用户交互反馈与弹窗提示服务 (FeedbackService)
 */
import { ConfirmDialogOptions, PromptDialogOptions } from './components/modals';
export declare class FeedbackService {
    /**
     * 弹出确认对话框
     */
    static confirm(options: ConfirmDialogOptions | string): Promise<boolean>;
    /**
     * 弹出输入对话框
     */
    static prompt(options: PromptDialogOptions | string): Promise<string | null>;
    /**
     * 弹出浮动 Toast 提示
     */
    static toast(message: string, isError?: boolean): void;
    /**
     * 弹出全屏大图预览
     */
    static lightbox(imgSrc: string): void;
    /**
     * 查看图像元数据详情
     */
    static showImageInfo(metadata: Record<string, any>, imageSrc?: string): void;
}
//# sourceMappingURL=feedback-service.d.ts.map