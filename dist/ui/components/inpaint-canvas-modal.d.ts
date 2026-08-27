/**
 * @module ui/components/inpaint-canvas-modal
 * @description 局部重绘 (Inpaint) 画布蒙版涂抹模态框
 */
/**
 * 局部重绘模态框初始化参数选项
 */
export interface InpaintModalOptions {
    /** 待重绘的底图 DataURL 或 ObjectURL 引用 */
    imageSrc: string;
    /** 初始提示词文本 */
    initialPrompt: string;
    /** 确认提交重绘时的回调函数 */
    onConfirm: (result: {
        initImage: string;
        maskImage: string;
        prompt: string;
        initBlob?: Blob;
        maskBlob?: Blob;
    }) => void;
    /** 取消重绘时的回调函数 */
    onCancel?: () => void;
}
/**
 * 打开局部重绘 Canvas 画布涂抹模态框
 *
 * @param options 重绘模态框参数配置
 */
export declare function openInpaintCanvasModal(options: InpaintModalOptions): void;
//# sourceMappingURL=inpaint-canvas-modal.d.ts.map