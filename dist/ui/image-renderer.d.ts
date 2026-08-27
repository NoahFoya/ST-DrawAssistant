/**
 * @module ui/image-renderer
 * @description 图像 DOM 渲染与交互组件 (ImageRenderer)
 */
import { DrawAssistantSettings } from '../core/state/store-types';
/**
 * 图像操作菜单交互回调接口
 */
export interface ImageActionCallbacks {
    /** 图像提示词文本 */
    promptText?: string;
    /** 触发局部重绘回调 */
    onInpaint?: () => void;
    /** 触发删除图像回调 */
    onDelete?: () => void;
}
/**
 * 将生成的图像 Blob 渲染到楼层消息插槽中，并绑定悬浮工具栏与大图预览
 *
 * @param containerSlot 目标图像挂载容器 DOM
 * @param blob 图像二进制数据
 * @param settings 全局配置项快照
 * @param callbacks 图像交互操作回调
 * @returns 渲染生成的 HTMLImageElement 实例
 */
export declare function renderImageToMessage(containerSlot: HTMLElement, blob: Blob, settings: DrawAssistantSettings, callbacks?: ImageActionCallbacks): HTMLImageElement;
//# sourceMappingURL=image-renderer.d.ts.map