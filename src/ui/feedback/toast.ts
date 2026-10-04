/**
 * 全局浮动通知提示服务 (ToastService)。
 *
 * @remarks
 * 架构规范与交互反馈设计：
 * 1. 非模态浮动提示：基于 CSS 类 `.da-toast` 渲染浮动提示气泡，固定于视口底部中央，不阻断底层页面交互；
 * 2. 自动淡出与单例管理：通过 dismissTimer 自动定时清理，新气泡产生时自动移除旧节点，规避 DOM 节点堆积；
 * 3. 无头测试环境容错：在无 DOM 或 Node 测试环境中将通知记录为 logger.debug，避免 DOM 操作报错。
 */

import type { Disposable } from '../types';
import { logger } from '../../util/logger';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
    level?: ToastLevel;
    duration?: number;
}

export class ToastService implements Disposable {
    private currentToastEl: HTMLElement | null = null;
    private dismissTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 呈现全局轻量通知气泡。
     *
     * @param message 提示文本
     * @param options 提示级别与存活时长 (毫秒)
     */
    public show(message: string, options: ToastOptions = {}): void {
        const level = options.level ?? 'info';
        const duration = options.duration ?? 2500;

        // 非浏览器 DOM 环境（如 Node.js 单元测试）仅记录调试日志，不执行 DOM 操作
        if (typeof document === 'undefined' || !document.body) {
            logger.debug(`[Toast][${level.toUpperCase()}] ${message}`);
            return;
        }


        // 清理上一个活跃的 Toast 节点与定时器
        this.clearCurrentToast();

        const toastEl = document.createElement('div');
        const levelClass = level === 'warning' ? 'warn' : level;
        toastEl.className = `da-toast da-toast--${levelClass}`;

        const iconEl = document.createElement('span');
        iconEl.className = 'da-toast__icon';
        switch (level) {
            case 'success':
                iconEl.textContent = '✓';
                break;
            case 'warning':
                iconEl.textContent = '⚠️';
                break;
            case 'error':
                iconEl.textContent = '✕';
                break;
            case 'info':
            default:
                iconEl.textContent = 'ℹ️';
                break;
        }
        toastEl.appendChild(iconEl);

        const textEl = document.createElement('span');
        textEl.className = 'da-toast__text';
        textEl.textContent = message;
        toastEl.appendChild(textEl);

        document.body.appendChild(toastEl);
        this.currentToastEl = toastEl;

        if (duration > 0) {
            this.dismissTimer = setTimeout(() => {
                this.clearCurrentToast();
            }, duration);
        }
    }

    public info(message: string, duration?: number): void {
        this.show(message, { level: 'info', duration });
    }

    public success(message: string, duration?: number): void {
        this.show(message, { level: 'success', duration });
    }

    public warning(message: string, duration?: number): void {
        this.show(message, { level: 'warning', duration });
    }

    public error(message: string, duration?: number): void {
        this.show(message, { level: 'error', duration });
    }

    /**
     * 清理当前正在展示的 Toast 元素与定时器。
     */
    private clearCurrentToast(): void {
        if (this.dismissTimer !== null) {
            clearTimeout(this.dismissTimer);
            this.dismissTimer = null;
        }
        if (this.currentToastEl) {
            if (this.currentToastEl.parentNode) {
                this.currentToastEl.parentNode.removeChild(this.currentToastEl);
            }
            this.currentToastEl = null;
        }
    }

    /**
     * 释放所有资源并清除活动节点。
     */
    public dispose(): void {
        this.clearCurrentToast();
    }
}

export const toastService = new ToastService();

/** 便捷静态 Toast 提示门面 */
export const Toast = {
    info: (message: string, duration?: number): void => toastService.info(message, duration),
    success: (message: string, duration?: number): void => toastService.success(message, duration),
    warning: (message: string, duration?: number): void => toastService.warning(message, duration),
    error: (message: string, duration?: number): void => toastService.error(message, duration),
    show: (message: string, options?: ToastOptions): void => toastService.show(message, options),
};
