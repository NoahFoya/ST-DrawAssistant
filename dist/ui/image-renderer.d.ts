/**
 * @module ui/image-renderer
 * @description 图像 DOM 渲染器模块
 *
 * 职责：
 * - 将生成的 Base64/Object URL 图像数据渲染到聊天消息 DOM 节点中
 * - 渲染低质量实时生成预览图，并在状态更新时及时释放旧 Object URL 资源
 * - 绑定全屏 Lightbox 大图预览交互
 *
 * 规范参考：
 * - .agents/Skills/browser-storage/SKILL.md §4 (Blob / Object URL 内存防泄漏)
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
/** 全屏查看器（支持背景点击与 Esc 键退出，防重复挂载） */
export declare function openLightbox(src: string): void;
//# sourceMappingURL=image-renderer.d.ts.map