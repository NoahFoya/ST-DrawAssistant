/**
 * @module ui/foundation/overlay-host
 * @description 统一浮层与气泡宿主管理器 (OverlayHost)
 * 解决节点游离挂载到 document.body 导致脱离主题 Token 继承的反模式，提供统一的视口防遮挡计算与生命周期管理
 */
import { IDisposable } from '../../core/foundation/disposable';
export interface OverlayPositionOptions {
    /** 锚点参考元素 */
    anchorEl: HTMLElement;
    /** 浮层内容元素 */
    overlayEl: HTMLElement;
    /** 垂直偏移量 (px，默认 6) */
    offsetY?: number;
    /** 水平偏移量 (px，默认 0) */
    offsetX?: number;
}
/**
 * 统一浮层宿主管理器
 */
export declare class OverlayHost implements IDisposable {
    private static _instance;
    private _container;
    private _activeBubbleCleanup;
    /**
     * 获取全局或当前激活的 OverlayHost 实例
     */
    static getInstance(): OverlayHost;
    /**
     * 绑定宿主根容器 (通常为 .da-modal-backdrop 或 .st-da-root)
     */
    mount(rootEl: HTMLElement): void;
    /**
     * 呈现说明气泡 (HelpBubble)，自动计算防遮挡坐标与点击外部注销
     *
     * @param anchorEl 触发锚点（如 ❓ 按钮）
     * @param text 详细说明文本
     * @returns 包含手动关闭能力的 IDisposable
     */
    showHelpBubble(anchorEl: HTMLElement, text: string): IDisposable;
    /**
     * 关闭当前所有活动的浮层与气泡
     */
    dismissAll(): void;
    /**
     * 释放宿主容器与所有挂载内容
     */
    dispose(): void;
}
//# sourceMappingURL=overlay-host.d.ts.map