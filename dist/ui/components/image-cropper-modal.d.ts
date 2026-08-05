/**
 * @module ui/components/image-cropper-modal
 * @description 交互式圆形图片裁剪模态框
 *
 * 职责：
 * - 接收用户选择的图片 DataURL
 * - 提供 Canvas 圆形视口遮罩
 * - 支持鼠标/触控拖拽平移与无级缩放 (100% ~ 300%)
 * - 点击确认输出 128x128 高清圆形 PNG Base64
 */
export interface CropperOptions {
    imageSrc: string;
    onConfirm: (croppedBase64: string) => void;
    onCancel?: () => void;
}
/**
 * 弹出圆形图片裁剪模态框
 */
export declare function openImageCropperModal(options: CropperOptions): void;
//# sourceMappingURL=image-cropper-modal.d.ts.map