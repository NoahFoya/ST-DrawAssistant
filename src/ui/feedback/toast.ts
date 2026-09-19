/**
 * ST-DrawAssistant 全局非阻塞消息气泡提示服务 (Toast)。
 *
 * @remarks
 * 监听全局 eventBus 的 toast:show 事件，在视口底部中央呈现非阻塞浮动提示。
 * 遵循 .da-toast 样式体系与 pointer-events: none 规范。
 */

import { eventBus } from '../../util/event-bus';

export interface ToastOptions {
    type: 'info' | 'success' | 'warn' | 'error';
    message: string;
    duration?: number;
}

export class ToastService {
    private unbindListener: (() => void) | null = null;
    private currentElement: HTMLDivElement | null = null;
    private dismissTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.listenEvents();
    }

    private listenEvents(): void {
        this.unbindListener = eventBus.on(
            'toast:show',
            (options: { type: 'info' | 'success' | 'warn' | 'error'; message: string; duration?: number }) => {
                this.show(options);
            }
        );
    }

    /**
     * 弹出单条 Toast 提示
     */
    public show(options: ToastOptions): void {
        this.dismiss();

        if (typeof document === 'undefined' || !document.body) {
            return;
        }

        const toast = document.createElement('div');
        toast.classList.add('da-toast');

        // 图标前缀
        const iconSpan = document.createElement('span');
        if (options.type === 'success') {
            iconSpan.textContent = '✓';
        } else if (options.type === 'error') {
            iconSpan.textContent = '✕';
        } else if (options.type === 'warn') {
            iconSpan.textContent = '⚠';
        } else {
            iconSpan.textContent = 'ℹ';
        }
        toast.appendChild(iconSpan);

        const textSpan = document.createElement('span');
        textSpan.textContent = options.message;
        toast.appendChild(textSpan);

        document.body.appendChild(toast);
        this.currentElement = toast;

        const duration = options.duration ?? 2500;
        this.dismissTimer = setTimeout(() => {
            this.dismiss();
        }, duration);
    }

    /** 隐藏并移除当前 Toast */
    public dismiss(): void {
        if (this.dismissTimer) {
            clearTimeout(this.dismissTimer);
            this.dismissTimer = null;
        }
        if (this.currentElement) {
            if (this.currentElement.parentElement) {
                this.currentElement.parentElement.removeChild(this.currentElement);
            }
            this.currentElement = null;
        }
    }

    public dispose(): void {
        this.dismiss();
        if (this.unbindListener) {
            this.unbindListener();
            this.unbindListener = null;
        }
    }
}

/** 全局 Toast 服务单例 */
export const toastService = new ToastService();
