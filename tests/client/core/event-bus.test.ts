import { describe, it, expect, vi } from 'vitest';
import { TypedEventBus } from '../../../src/client/core/event-bus';

interface TestEvents {
    'user:login': { username: string; timestamp: number };
    'count:updated': number;
    'empty:event': void;
}

describe('TypedEventBus', () => {
    it('正常注册与触发事件监听器', () => {
        const bus = new TypedEventBus<TestEvents>();
        const handler = vi.fn();

        bus.on('user:login', handler);
        bus.emit('user:login', { username: 'alice', timestamp: 123456 });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ username: 'alice', timestamp: 123456 });
    });

    it('通过返回的 IDisposable 实例安全注销监听', () => {
        const bus = new TypedEventBus<TestEvents>();
        const handler = vi.fn();

        const disposable = bus.on('count:updated', handler);
        bus.emit('count:updated', 1);
        expect(handler).toHaveBeenCalledTimes(1);

        disposable.dispose();
        bus.emit('count:updated', 2);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('单个监听器执行抛出异常时不应影响其他监听器的正常执行', () => {
        const bus = new TypedEventBus<TestEvents>();
        const brokenHandler = vi.fn().mockImplementation(() => {
            throw new Error('意料之外的错误');
        });
        const healthyHandler = vi.fn();

        bus.on('count:updated', brokenHandler);
        bus.on('count:updated', healthyHandler);

        expect(() => {
            bus.emit('count:updated', 42);
        }).not.toThrow();

        expect(brokenHandler).toHaveBeenCalledTimes(1);
        expect(healthyHandler).toHaveBeenCalledTimes(1);
        expect(healthyHandler).toHaveBeenCalledWith(42);
    });

    it('dispose 后不再响应任何后续事件派发', () => {
        const bus = new TypedEventBus<TestEvents>();
        const handler = vi.fn();

        bus.on('empty:event', handler);
        bus.dispose();

        bus.emit('empty:event', undefined);
        expect(handler).not.toHaveBeenCalled();
    });
});
