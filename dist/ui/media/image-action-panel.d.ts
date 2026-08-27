/**
 * @module ui/media/image-action-panel
 * @description 图像操作浮动面板 (ImageActionPanel)
 */
export interface ImageActionCallbacks {
    imageSrc?: string;
    mimeType?: string;
    promptText?: string;
    negativePrompt?: string;
    messageIndex?: number;
    buttonIndex?: number;
    uuid?: string;
    onConfirm?: (newPrompt: string, newNegativePrompt?: string) => void;
    onLightbox?: () => void;
    onRegen?: () => void;
    onRegenerate?: () => void;
    onInpaint?: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    onInfo?: () => void;
    [key: string]: unknown;
}
export declare function openImageActionPanel(_e: MouseEvent | PointerEvent, callbacks: ImageActionCallbacks): void;
//# sourceMappingURL=image-action-panel.d.ts.map