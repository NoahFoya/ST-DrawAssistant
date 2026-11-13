/**
 * 全局 Window 对象与宿主第三方辅助库类型声明。
 *
 * @remarks
 * 扩展全局 Window 接口，声明 `window.SillyTavern` 宿主全局入口，
 * 以及宿主提供的 `toastr` 气泡通知与 `DOMPurify` HTML 净化工具类型。
 * 宿主环境中的 `window.SillyTavern` 在脚本加载极早期可能尚未完成挂载，建议使用可选链安全访问。
 */

import type { SillyTavernContext } from './st/context';

export interface ToastrNotification {
    /** 弹出信息通知 */
    info(message: string, title?: string, options?: Record<string, unknown>): void;
    /** 弹出成功通知 */
    success(message: string, title?: string, options?: Record<string, unknown>): void;
    /** 弹出警告通知 */
    warning(message: string, title?: string, options?: Record<string, unknown>): void;
    /** 弹出错误通知 */
    error(message: string, title?: string, options?: Record<string, unknown>): void;
    /** 清除所有当前显示的气泡通知 */
    clear(): void;
}

export interface DOMPurifyStatic {
    /** 净化 HTML 字符串，过滤潜在恶意脚本 */
    sanitize(dirty: string, config?: Record<string, unknown>): string;
}

declare global {
    interface Window {
        /** SillyTavern 宿主全局入口命名空间 */
        SillyTavern?: {
            /** 获取宿主当前运行上下文 (只读冻结对象) */
            getContext(): SillyTavernContext;
            readonly [key: string]: unknown;
        };
        /** 宿主提供的轻量气泡通知库 */
        toastr?: ToastrNotification;
        /** 宿主提供的 HTML 净化库 */
        DOMPurify?: DOMPurifyStatic;
        /** SillyTavern 宿主全局提供的宏替换函数 */
        substituteParams?: (text: string) => string;
    }

    /** 允许直接访问宿主全局暴露的 toastr 实例 */
    const toastr: ToastrNotification | undefined;
    /** 允许直接访问宿主全局暴露的 DOMPurify 实例 */
    const DOMPurify: DOMPurifyStatic | undefined;
}

export {};
