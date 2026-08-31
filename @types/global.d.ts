/**
 * 全局 Window 对象与第三方辅助库扩展声明
 */

import type { SillyTavernContext } from './st/context';

export interface ToastrNotification {
    info(message: string, title?: string, options?: Record<string, unknown>): void;
    success(message: string, title?: string, options?: Record<string, unknown>): void;
    warning(message: string, title?: string, options?: Record<string, unknown>): void;
    error(message: string, title?: string, options?: Record<string, unknown>): void;
    clear(): void;
}

export interface DOMPurifyStatic {
    sanitize(dirty: string, config?: Record<string, unknown>): string;
}

declare global {
    interface Window {
        /** SillyTavern 宿主全局入口命名空间 */
        SillyTavern?: {
            getContext(): SillyTavernContext;
            [key: string]: unknown;
        };
        /** 宿主提供的轻量气泡通知库 */
        toastr?: ToastrNotification;
        /** 宿主提供的 HTML 净化库 */
        DOMPurify?: DOMPurifyStatic;
    }

    /** 允许直接访问宿主暴露的全局 toastr 实例 */
    const toastr: ToastrNotification | undefined;
    /** 允许直接访问宿主暴露的全局 DOMPurify 实例 */
    const DOMPurify: DOMPurifyStatic | undefined;
}

export {};
