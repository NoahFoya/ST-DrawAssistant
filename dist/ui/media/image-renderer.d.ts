/**
 * @module ui/media/image-renderer
 * @description 图像 DOM 渲染与交互手势分发器 (ImageRenderer)
 */
import { DrawAssistantSettings } from '../../core/state/store-types';
import { ImageActionCallbacks } from './image-action-panel';
export type { ImageActionCallbacks };
/**
 * 将生成的图像数据渲染到楼层消息插槽中，并绑定交互手势
 */
export declare function renderImageToMessage(containerSlot: HTMLElement, imageData: string | Blob, settings: DrawAssistantSettings, actionCallbacks?: ImageActionCallbacks): HTMLImageElement;
//# sourceMappingURL=image-renderer.d.ts.map