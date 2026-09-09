/**
 * 统一浮层与帮助说明气泡宿主管理器 (OverlayHost)
 * 管理提示气泡等浮动 DOM 节点的挂载、定位与生命周期。
 * 节点挂载于主弹窗或指定宿主内以继承主题 Token 与 z-index 堆叠上下文，
 * 采用边界碰撞检测实现视口边缘自适应翻转，并通过单例互斥与外部点击监听防残留。
 */

import { IDisposable, toDisposable } from '../../types';

/**
 * 浮层相对锚点定位参数
 */
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

export interface HelpBubbleOptions {
    title?: string;
    text: string;
}

/**
 * 统一浮层宿主管理器单例
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
     * @param anchorEl 触发锚点（如提示按钮或锚点元素）
     * @param content 详细说明文本或带标题的气泡配置项
     * @returns 包含手动关闭能力的 IDisposable
     */
    public showHelpBubble(anchorEl: HTMLElement, content: string | HelpBubbleOptions): IDisposable {
        // 清理前一个活动的气泡，保持单例互斥
        if (this._activeBubbleCleanup) {
            this._activeBubbleCleanup();
        }

        // 构建气泡 DOM 节点
        const bubble = document.createElement('div');
        bubble.className = 'da-help-bubble';
        bubble.style.pointerEvents = 'auto';

        const title = typeof content === 'object' ? content.title : undefined;
        const text = typeof content === 'object' ? content.text : content;

        if (title) {
            const headerEl = document.createElement('div');
            headerEl.className = 'da-help-bubble-header';
            headerEl.textContent = title;
            bubble.appendChild(headerEl);

            const bodyEl = document.createElement('div');
            bodyEl.className = 'da-help-bubble-body';
            bodyEl.textContent = text;
            bubble.appendChild(bodyEl);
        } else {
            bubble.textContent = text;
        }

        const rootMode = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-da-mode') : null;
        if (rootMode) {
            bubble.setAttribute('data-da-mode', rootMode);
        }

        // 拦截气泡内部的指针与点击事件，防止冒泡触发外部模态框遮罩的关闭回调
        bubble.addEventListener('pointerdown', (e) => e.stopPropagation());
        bubble.addEventListener('click', (e) => e.stopPropagation());

        const parentHost = this._container || document.body;
        parentHost.appendChild(bubble);

        // 视口防遮挡计算与自适应翻转
        const rect = anchorEl.getBoundingClientRect();
        const bubbleWidth = 280;
        const left = Math.max(10, Math.min(window.innerWidth - bubbleWidth - 10, rect.left - 10));

        // 测量气泡实际渲染高度（若尚未布局则取 90px 作为安全高度预估）
        const bubbleHeight = bubble.offsetHeight || 90;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        let top: number;
        // 若下方空间不足以容纳气泡且上方空间更宽裕，则向上翻转弹出
        if (spaceBelow < bubbleHeight + 12 && spaceAbove > bubbleHeight + 12) {
            top = Math.max(10, rect.top - bubbleHeight - 6);
            bubble.classList.add('da-help-bubble--top');
        } else {
            top = Math.min(window.innerHeight - bubbleHeight - 10, rect.bottom + 6);
            bubble.classList.remove('da-help-bubble--top');
        }

        bubble.style.position = 'fixed';
        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;

        // 捕获阶段注册外部点击与 Escape 快捷注销监听
        const onOutsidePointerDown = (evt: PointerEvent | MouseEvent) => {
            const targetNode = evt.target as Node | null;
            if (bubble && targetNode && !bubble.contains(targetNode) && !anchorEl.contains(targetNode)) {
                cleanup();
            }
        };

        const onKeydown = (evt: KeyboardEvent) => {
            if (evt.key === 'Escape') {
                // 阻断 Escape 事件向外传播，防止误关闭底层设置弹窗
                evt.stopPropagation();
                evt.stopImmediatePropagation();
                cleanup();
            }
        };

        let mountTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (mountTimer !== null) {
                clearTimeout(mountTimer);
                mountTimer = null;
            }
            if (bubble.parentElement) {
                bubble.remove();
            }
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            window.removeEventListener('keydown', onKeydown, true);
            if (this._activeBubbleCleanup === cleanup) {
                this._activeBubbleCleanup = null;
            }
        };

        this._activeBubbleCleanup = cleanup;
        // 延迟至微任务执行后挂载，避免当前点击事件立即触发关闭
        mountTimer = setTimeout(() => {
            mountTimer = null;
            window.addEventListener('pointerdown', onOutsidePointerDown, true);
            window.addEventListener('keydown', onKeydown, true);
        }, 10);

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
