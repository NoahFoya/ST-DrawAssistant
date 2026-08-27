/**
 * @module ui/components/inpaint-canvas-modal
 * @description 局部重绘 (Inpaint) 画布蒙版涂抹模态框
 *
 * 职责：
 * - 在 Canvas 画板上加载原图并提供半透明遮罩涂抹功能
 * - 支持调整笔刷粗细、橡皮擦擦除与一键清空遮罩
 * - 确认提交时合成生成原图 Base64 与黑白二值化遮罩图 Mask Base64
 */
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
 *
 * @param options 包含源图 URL、初始提示词和提交/取消回调的配置项
 */
export declare function openInpaintCanvasModal(options: InpaintModalOptions): void;
//# sourceMappingURL=inpaint-canvas-modal.d.ts.map