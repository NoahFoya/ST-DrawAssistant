/**
 * @module ui/components/modals
 * @description 扩展统一 UI 模态弹窗组件库 (Consolidated Modals)
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
    message: string;
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
 * 弹出确认操作对话框 (非阻塞 DOM 模态框)
 */
export declare function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean>;
/**
 * 弹出文本输入对话框 (替代原生 prompt)
 */
export declare function showPromptDialog(options: PromptDialogOptions): Promise<string | null>;
/**
 * 弹出全屏 Lightbox 大图预览模态框
 */
export declare function openLightboxModal(imgSrc: string): void;
/**
 * 弹出图像元数据详情展示面板
 */
export declare function openImageInfoPanel(metadata: Record<string, any>, imageSrc?: string): void;
//# sourceMappingURL=modals.d.ts.map