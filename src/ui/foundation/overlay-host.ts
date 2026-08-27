/**
 * @module ui/foundation/overlay-host
 * @description 统一浮层与气泡宿主管理器 (OverlayHost)
 * 解决节点游离挂载到 document.body 导致脱离主题 Token 继承的反模式，提供统一的视口防遮挡计算与生命周期管理
 */

import { IDisposable, toDisposable } from '../../core/foundation/disposable';

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
export class OverlayHost implements IDisposable {
    private static _instance: OverlayHost | null = null;

    private _container: HTMLElement | null = null;
    private _activeBubbleCleanup: (() => void) | null = null;

    /**
     * 获取全局或当前激活的 OverlayHost 实例
     */
    public static getInstance(): OverlayHost {
        if (!OverlayHost._instance) {
            OverlayHost._instance = new OverlayHost();
        }
        return OverlayHost._instance;
    }

    /**
     * 绑定宿主根容器 (通常为 .da-modal-backdrop 或 .st-da-root)
     */
    public mount(rootEl: HTMLElement): void {
        if (this._container && this._container.parentElement) {
            this._container.remove();
        }

        const host = document.createElement('div');
        host.className = 'da-portal-host';
        host.style.position = 'fixed';
        host.style.top = '0';
        host.style.left = '0';
        host.style.width = '100vw';
        host.style.height = '100vh';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '100050';

        rootEl.appendChild(host);
        this._container = host;
    }

    /**
     * 呈现说明气泡 (HelpBubble)，自动计算防遮挡坐标与点击外部注销
     *
     * @param anchorEl 触发锚点（如 ❓ 按钮）
     * @param text 详细说明文本
     * @returns 包含手动关闭能力的 IDisposable
     */
    public showHelpBubble(anchorEl: HTMLElement, text: string): IDisposable {
        // 1. 清理前一个活动的气泡 (单例互斥)
        if (this._activeBubbleCleanup) {
            this._activeBubbleCleanup();
        }

        // 2. 构建气泡节点
        const bubble = document.createElement('div');
        bubble.className = 'da-help-bubble';
        bubble.textContent = text;
        bubble.style.pointerEvents = 'auto';

        const parentHost = this._container || document.body;
        parentHost.appendChild(bubble);

        // 3. 视口防遮挡坐标计算
        const rect = anchorEl.getBoundingClientRect();
        const bubbleWidth = 280;
        const left = Math.max(10, Math.min(window.innerWidth - bubbleWidth - 10, rect.left - 10));
        const top = rect.bottom + 6;

        bubble.style.position = 'fixed';
        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;

        // 4. 点击外部自动注销
        const onOutsideClick = (evt: MouseEvent) => {
            if (bubble && !bubble.contains(evt.target as Node) && evt.target !== anchorEl) {
                cleanup();
            }
        };

        const cleanup = () => {
            if (bubble.parentElement) {
                bubble.remove();
            }
            document.removeEventListener('click', onOutsideClick);
            if (this._activeBubbleCleanup === cleanup) {
                this._activeBubbleCleanup = null;
            }
        };

        this._activeBubbleCleanup = cleanup;
        setTimeout(() => {
            document.addEventListener('click', onOutsideClick);
        }, 0);

        return toDisposable(cleanup);
    }

    /**
     * 关闭当前所有活动的浮层与气泡
     */
    public dismissAll(): void {
        if (this._activeBubbleCleanup) {
            this._activeBubbleCleanup();
            this._activeBubbleCleanup = null;
        }
    }

    /**
     * 释放宿主容器与所有挂载内容
     */
    public dispose(): void {
        this.dismissAll();
        if (this._container && this._container.parentElement) {
            this._container.remove();
            this._container = null;
        }
        if (OverlayHost._instance === this) {
            OverlayHost._instance = null;
        }
    }
}
