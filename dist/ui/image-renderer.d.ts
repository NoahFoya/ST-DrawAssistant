/**
 * 图像渲染器
 *
 * 职责：将生成的 base64 图像数据渲染到聊天消息 DOM 中
 *
 * P0 策略：
 * - 图像以 Object URL 形式临时展示（刷新后消失）
 * - P1 阶段补充 IndexedDB 持久化
 */
/**
 * 渲染图像到指定按钮的专属图像 Slot
 *
 * @param containerSlot 按钮关联的图像 Slot 节点 (.da-floor-btn-img-slot)
 * @param base64Data base64 图像编码
 * @param mimeType 图像 MIME 类型
 */
export declare function renderImageToMessage(containerSlot: HTMLElement, base64Data: string, mimeType?: string): HTMLElement;
/** 渲染预览图（低质量，用于生成过程中的实时预览） */
export declare function renderPreviewToMessage(containerSlot: HTMLElement, previewUrl: string): void;
/** 清除预览图 */
export declare function clearPreview(containerSlot: HTMLElement): void;
//# sourceMappingURL=image-renderer.d.ts.map