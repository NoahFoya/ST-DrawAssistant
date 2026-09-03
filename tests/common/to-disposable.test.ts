import { describe, it, expect, vi } from 'vitest';
import { toDisposable } from '../../src/common';

describe('toDisposable', () => {
    it('多次调用 dispose() 时应保证幂等，只执行一次清理回调', () => {
        const cleanupFn = vi.fn();
        const disposable = toDisposable(cleanupFn);

        disposable.dispose();
        disposable.dispose();
        disposable.dispose();

        expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('清理函数抛出异常时应输出警告并安全捕获，不中断后续流程', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const brokenCleanup = vi.fn().mockImplementation(() => {
            throw new Error('清理异常');
        });
        const disposable = toDisposable(brokenCleanup);

        expect(() => {
            disposable.dispose();
        }).not.toThrow();

        expect(brokenCleanup).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[ST-DrawAssistant] 资源释放回调执行异常:'),
            expect.any(Error)
        );

        warnSpy.mockRestore();
    });
});
