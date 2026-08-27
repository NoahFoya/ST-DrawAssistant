/**
 * @module ui/components/modals
 * @description 扩展统一 UI 模态弹窗组件库 (Consolidated Modals)
 *
 * 职责：
 * - BLOCK 1: 通用对话框 (showConfirmDialog, showPromptDialog, showTripleChoiceDialog)
 * - BLOCK 2: 图像详细元数据查看面板 (openImageInfoPanel)
 * - BLOCK 3: 悬浮球自定义图标裁剪弹窗 (openImageCropperModal)
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
 * 弹出确认操作对话框
 *
 * @param options 对话框配置
 * @returns 确认返回 true，取消返回 false 的 Promise
 */
export declare function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean>;
/**
 * 弹出文本输入对话框
 *
 * @param options 对话框配置
 * @returns 确认返回输入的文本，取消返回 null 的 Promise
 */
export declare function showPromptDialog(options: PromptDialogOptions): Promise<string | null>;
/**
 * 弹出三按钮选择对话框（用于未保存草稿确认提示）
 *
 * @param options 对话框配置
 * @returns 用户选择类型 Promise：'save' | 'discard' | 'cancel'
 */
export declare function showTripleChoiceDialog(options: TripleChoiceDialogOptions): Promise<TripleChoiceResult>;
export interface ImageMetadata {
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    model?: string;
    samplerName?: string;
    scheduler?: string;
    timestamp?: number;
    [key: string]: unknown;
}
/**
 * 弹出全屏 Lightbox 图像放大全景查看器
 *
 * @param imgSrc 图像 Base64 数据串或 DataURL/URL
 */
export declare function openLightboxModal(imgSrc: string): void;
/**
 * 弹出图像元数据详情展示面板
 *
 * @param imageId 图片 ID 或 StoredImageRecord 实体
 * @param meta 图像包含的元数据结构体或回调挂载对象
 */
export declare function openImageInfoPanel(imageIdOrMeta: any, meta?: any): Promise<void>;
export interface ImageCropperOptions {
    imageSrc: string;
    aspectRatio?: number;
    onCrop?: (croppedBase64: string) => void;
    onConfirm?: (croppedBase64: string) => void;
    onCancel?: () => void;
}
/**
 * 弹出图像裁剪与图标预览模态框
 *
 * @param options 包含图片 Base64 / URL、目标比例和裁剪回调的配置项
 */
export declare function openImageCropperModal(options: ImageCropperOptions): void;
//# sourceMappingURL=modals.d.ts.map