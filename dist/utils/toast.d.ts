/**
 * @module utils/toast
 * @description SillyTavern 全局 Toastr 通知统一封装工具
 *
 * 职责：
 * - 集中处理与 SillyTavern 内置 toastr 系统的交互
 * - 当 toastr 可用时调用对应 API，无 toastr 时向 控制台/logger 输出降级日志
 */
export type ToastLevel = 'success' | 'error' | 'info' | 'warning';
/**
 * 弹出 SillyTavern 全局 Toast 通知
 *
 * @param message 通知文本
 * @param title 通知标题，默认 'Starlight DrawAssistant'
 * @param isSuccess 是否为成功级别消息（兼容原 API 表达方式）
 */
export declare function showToastNotice(message: string, title?: string, isSuccess?: boolean): void;
/**
 * 弹出指定等级的 Toast 通知
 *
 * @param message 通知文本内容
 * @param level Toast 等级 ('success' | 'error' | 'info' | 'warning')，默认为 'success'
 * @param title 通知标题，默认为 'Starlight DrawAssistant'
 */
export declare function showToast(message: string, level?: ToastLevel, title?: string): void;
/**
 * 弹出错误提示 Toast
 *
 * @param message 错误描述信息
 * @param title 错误通知标题，默认 '绘画助手 生图失败'
 */
export declare function showToastError(message: string, title?: string): void;
/**
 * 弹出信息提示 Toast
 *
 * @param message 信息描述内容
 * @param title 通知标题，默认 'Starlight DrawAssistant'
 */
export declare function showToastInfo(message: string, title?: string): void;
/**
 * 弹出警告提示 Toast
 *
 * @param message 警告描述内容
 * @param title 通知标题，默认 'Starlight DrawAssistant'
 */
export declare function showToastWarning(message: string, title?: string): void;
//# sourceMappingURL=toast.d.ts.map