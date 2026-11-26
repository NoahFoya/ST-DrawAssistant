/**
 * 领域层结构化异常体系与用户可读提示提取工具。
 *
 * @remarks
 * 用于区分输入/配置校验错误、网络传输故障与用户取消操作，
 * 避免上层反馈通过正则表达式猜测底层异常消息。
 */

export type AppErrorCode = 'VALIDATION_ERROR' | 'TRANSPORT_ERROR' | 'CANCELLED_ERROR';

/** 领域通用结构化异常基类 */
export class AppDomainError extends Error {
    public readonly code: AppErrorCode;

    public constructor(code: AppErrorCode, message: string) {
        super(message);
        this.name = new.target.name;
        this.code = code;
    }
}

/**
 * 面向用户的校验错误（显式携带安全可展示给用户的 `userMessage`）。
 */
export class AppValidationError extends AppDomainError {
    public readonly userMessage: string;
    public readonly detail?: string;

    public constructor(userMessage: string, detail?: string) {
        super('VALIDATION_ERROR', userMessage);
        this.userMessage = userMessage;
        this.detail = detail;
    }
}

/** 传输层故障错误（区分代理/配置边界故障与鉴权失败） */
export class AppTransportError extends AppDomainError {
    public readonly status?: number;
    public readonly isAuthError?: boolean;
    public readonly isTransportDiagnostic?: boolean;

    public constructor(
        message: string,
        options?: {
            readonly status?: number;
            readonly isAuthError?: boolean;
            readonly isTransportDiagnostic?: boolean;
        }
    ) {
        super('TRANSPORT_ERROR', message);
        this.status = options?.status;
        this.isAuthError = options?.isAuthError;
        this.isTransportDiagnostic = options?.isTransportDiagnostic;
    }
}

/** 操作中止/取消错误 */
export class AppCancelledError extends AppDomainError {
    public constructor(message = '操作已取消') {
        super('CANCELLED_ERROR', message);
    }
}

const DEFAULT_FALLBACK_ERROR_MESSAGE = '请检查文件格式或前往「日志与统计」查看详情';

/**
 * 从未知异常中提取安全面向用户的简短文案。
 * 仅透出显式声明为 {@link AppValidationError} 或 {@link AppCancelledError} 的提示，
 * 其余未知技术异常统一返回默认回退提示，防止将内部堆栈暴露在提示框中。
 */
export function extractUserFacingErrorMessage(
    errOrMsg: unknown,
    fallbackMessage: string = DEFAULT_FALLBACK_ERROR_MESSAGE
): string {
    if (errOrMsg instanceof AppValidationError) {
        return errOrMsg.userMessage || fallbackMessage;
    }
    if (errOrMsg instanceof AppCancelledError) {
        return errOrMsg.message || '操作已取消';
    }
    return fallbackMessage;
}
