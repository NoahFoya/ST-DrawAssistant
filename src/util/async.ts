/**
 * 异步调度工具
 * 提供可中断的延时等待以及防抖执行控制器。
 */

/**
 * 延时等待指定毫秒数。
 *
 * @param ms 等待毫秒数
 * @param signal 可选的取消信号，触发时立即终止等待并拒绝 Promise
 */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            return;
        }

        const timer = setTimeout(() => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

export interface DebouncedFunction<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): void;
    /** 取消当前挂起的防抖调用并重置状态 */
    cancel(): void;
    /** 立即执行当前挂起的防抖调用并清除计时器 */
    flush(): void;
}

/**
 * 创建防抖函数。在连续触发时重置计时器，仅在调用停止经过指定延迟后执行最后一次调用。
 *
 * @param fn 目标执行函数
 * @param delayMs 等待延迟毫秒数
 * @returns 包装后的防抖函数，附带 cancel 与 flush 控制方法
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delayMs: number
): DebouncedFunction<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<T> | null = null;

    const debounced = function (...args: Parameters<T>): void {
        lastArgs = args;
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            if (lastArgs) {
                const callArgs = lastArgs;
                lastArgs = null;
                fn(...callArgs);
            }
        }, delayMs);
    };

    debounced.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        lastArgs = null;
    };

    debounced.flush = () => {
        if (timer && lastArgs) {
            clearTimeout(timer);
            timer = null;
            const callArgs = lastArgs;
            lastArgs = null;
            fn(...callArgs);
        }
    };

    return debounced;
}
