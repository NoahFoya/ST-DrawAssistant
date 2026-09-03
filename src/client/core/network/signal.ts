/**
 * @module core/network/signal
 * @description 多源取消信号与超时编排工具函数
 */

export interface TimeoutSignalResult {
    /** 合成后的 AbortSignal 实例 */
    signal: AbortSignal;
    /** 资源清理回调函数 (请求完成后在 finally 中调用) */
    cleanup: () => void;
    /** 是否因超时而中止 */
    isTimeout: () => boolean;
}

/**
 * 组合超时控制与外部取消信号
 *
 * @param timeoutMs 超时毫秒数
 * @param parentSignal 外部传入的父级 AbortSignal (可选)
 */
export function composeTimeoutSignal(
    timeoutMs: number,
    parentSignal?: AbortSignal | null
): TimeoutSignalResult {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`Operation timed out after ${timeoutMs}ms`));
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
