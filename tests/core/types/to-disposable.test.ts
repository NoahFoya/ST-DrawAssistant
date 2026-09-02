import { describe, it, expect, vi } from 'vitest';
import { toDisposable } from '../../../src/core/types';

describe('toDisposable', () => {
    it('多次调用 dispose() 时应保证幂等，只执行一次清理回调', () => {
        const cleanupFn = vi.fn();
        const disposable = toDisposable(cleanupFn);

        disposable.dispose();
        disposable.dispose();
        disposable.dispose();

        expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('清理函数抛出异常时应被捕获，不中断执行流程', () => {
        const brokenCleanup = vi.fn().mockImplementation(() => {
            throw new Error('清理异常');
        });
        const disposable = toDisposable(brokenCleanup);

        expect(() => {
            disposable.dispose();
        }).not.toThrow();

        expect(brokenCleanup).toHaveBeenCalledTimes(1);
    });
});
