/**
 * @module ui/media/image-editor
 * @description 图像编辑器：局部重绘画布与图像正方形裁剪器 (Media & Editor Domain)
 */
export interface ImageCropperOptions {
    imageSrc: string;
    aspectRatio?: number;
    onCrop?: (croppedBase64: string) => void;
    onConfirm?: (croppedBase64: string) => void;
    onCancel?: () => void;
}
/**
 * 弹出图像裁剪与图标预览模态框
 */
export declare function openImageCropperModal(options: ImageCropperOptions): void;
export interface InpaintModalOptions {
    imageSrc: string;
    initialPrompt: string;
    onConfirm: (result: {
        initImage: string;
        maskImage: string;
        prompt: string;
    }) => void;
    onCancel?: () => void;
}
/**
 * 打开局部重绘 Canvas 画布涂抹模态框
 */
export declare function openInpaintCanvasModal(options: InpaintModalOptions): void;
//# sourceMappingURL=image-editor.d.ts.map