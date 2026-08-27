/**
 * @module ui/image-renderer
 * @description 图像 DOM 渲染器模块
 *
 * 职责：
 * - 将生成的 Base64/Object URL 图像数据渲染到聊天消息 DOM 节点中
 * - 读取设置中的 imageDisplay 样式配置应用布局对齐、缩放与圆角
 * - 区分单击 (Lightbox 大图) 与长按/右键 (快捷操作面板) 手势
 * - 渲染低质量实时生成预览图，并在状态更新时及时释放旧 Object URL 资源
 */
import { type ImageActionCallbacks } from './components/controls';
export type { ImageActionCallbacks };
/**
 * 渲染图像到指定按钮的专属图像 Slot
 *
 * @param containerSlot 按钮关联的图像 Slot 节点 (.da-floor-btn-img-slot)
 * @param base64Data base64 图像编码
 * @param mimeType 图像 MIME 类型
 * @param actionCallbacks 快捷操作面板回调（可选）
 */
export declare function renderImageToMessage(containerSlot: HTMLElement, base64Data: string, mimeType?: string, actionCallbacks?: ImageActionCallbacks): HTMLElement;
/** 全屏查看器（支持背景点击与 Esc 键退出，防重复挂载与事件泄露） */
export declare function openLightbox(src: string): void;
//# sourceMappingURL=image-renderer.d.ts.map