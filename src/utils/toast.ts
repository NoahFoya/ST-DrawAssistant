/**
 * @module utils/toast
 * @description SillyTavern 全局 Toastr 通知统一封装工具
 *
 * 职责：
 * - 集中处理与 SillyTavern 内置 toastr 系统的交互
 * - 当 toastr 可用时调用对应 API，无 toastr 时向 控制台/logger 输出降级日志
 */

import { logger } from '../core/logger';

export type ToastLevel = 'success' | 'error' | 'info' | 'warning';

interface ToastrApi {
    success?: (msg: string, title?: string) => void;
    error?: (msg: string, title?: string) => void;
    info?: (msg: string, title?: string) => void;
    warning?: (msg: string, title?: string) => void;
}

/**
 * 弹出 SillyTavern 全局 Toast 通知
 *
 * @param message 通知文本
 * @param title 通知标题，默认 'Starlight DrawAssistant'
 * @param isSuccess 是否为成功级别消息（兼容原 API 表达方式）
 */
export function showToastNotice(
    message: string,
    title = 'Starlight DrawAssistant',
    isSuccess = true
): void {
    const level: ToastLevel = isSuccess ? 'success' : 'error';
    showToast(message, level, title);
}

/**
 * 弹出指定等级的 Toast 通知
 *
 * @param message 通知文本内容
 * @param level Toast 等级 ('success' | 'error' | 'info' | 'warning')，默认为 'success'
 * @param title 通知标题，默认为 'Starlight DrawAssistant'
 */
export function showToast(
    message: string,
    level: ToastLevel = 'success',
    title = 'Starlight DrawAssistant'
): void {
    const win = window as unknown as { toastr?: ToastrApi };
    if (win.toastr) {
        const fn = win.toastr[level];
        if (typeof fn === 'function') {
            fn(message, title);
            return;
        }
    }
    // 降级控制台日志
    if (level === 'error') {
        logger.error(`[Toast Error - ${title}] ${message}`);
    } else {
        logger.info(`[Toast ${level} - ${title}] ${message}`);
    }
}

/**
 * 弹出错误提示 Toast
 *
 * @param message 错误描述信息
 * @param title 错误通知标题，默认 '绘画助手 生图失败'
 */
export function showToastError(message: string, title = '绘画助手 生图失败'): void {
    showToast(message, 'error', title);
}

/**
 * 弹出信息提示 Toast
 *
 * @param message 信息描述内容
 * @param title 通知标题，默认 'Starlight DrawAssistant'
 */
export function showToastInfo(message: string, title = 'Starlight DrawAssistant'): void {
    showToast(message, 'info', title);
}

/**
 * 弹出警告提示 Toast
 *
 * @param message 警告描述内容
 * @param title 通知标题，默认 'Starlight DrawAssistant'
 */
export function showToastWarning(message: string, title = 'Starlight DrawAssistant'): void {
    showToast(message, 'warning', title);
}
