/**
 * 超时控制与请求取消信号管理
 */

export interface TimeoutSignalResult {
    signal: AbortSignal;
    /** 请求结束时在 finally 中调用，解除父信号的监听器，防止内存泄漏 */
    cleanup: () => void;
    /** 标识是否由内部定时器超时触发了中断 */
    isTimeout: () => boolean;
}

/**
 * 组合超时控制与外部取消信号。
 * 当任一条件满足（超时或外部中止）时立即中止控制器。
 */
export function composeTimeoutSignal(
    timeoutMs: number,
    parentSignal?: AbortSignal | null
): TimeoutSignalResult {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException(`Operation timed out after ${timeoutMs}ms`, 'AbortError'));
    }, timeoutMs);

    let onParentAbort: (() => void) | null = null;
    if (parentSignal) {
        if (parentSignal.aborted) {
            clearTimeout(timer);
            controller.abort(parentSignal.reason);
        } else {
            onParentAbort = () => {
                clearTimeout(timer);
                controller.abort(parentSignal.reason);
            };
            parentSignal.addEventListener('abort', onParentAbort, { once: true });
        }
    }

    const cleanup = () => {
        clearTimeout(timer);
        if (parentSignal && onParentAbort) {
            parentSignal.removeEventListener('abort', onParentAbort);
        }
    };

    return {
        signal: controller.signal,
        cleanup,
        isTimeout: () => timedOut
    };
}
