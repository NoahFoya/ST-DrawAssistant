import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageUrlPool } from '../../../src/core/storage/image-url-pool';

describe('ImageUrlPool (Object URL 内存管理池)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Mock 全局 URL.createObjectURL 与 URL.revokeObjectURL
        let urlCounter = 1;
        globalThis.URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
            return `blob:http://localhost/mock-uuid-${urlCounter++}`;
        });
        globalThis.URL.revokeObjectURL = vi.fn();
    });

    it('首次 acquire 应当调用 blobProvider 并生成 Object URL，引用计数设为 1', async () => {
        const pool = new ImageUrlPool({ releaseDelayMs: 5000 });
        const mockBlob = new Blob(['mock binary image data'], { type: 'image/png' });
        const provider = vi.fn().mockResolvedValue(mockBlob);

        const url = await pool.acquire('img-001', provider);
        expect(url).toMatch(/^blob:http:\/\/localhost\/mock-uuid-\d+$/);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('多处重复 acquire 同一图片 ID 时应当复用已生成的 URL，不重复调用 provider', async () => {
        const pool = new ImageUrlPool({ releaseDelayMs: 5000 });
        const mockBlob = new Blob(['data']);
        const provider = vi.fn().mockResolvedValue(mockBlob);

        const url1 = await pool.acquire('img-001', provider);
        const url2 = await pool.acquire('img-001', provider);

        expect(url1).toBe(url2);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('引用计数归零后应启动 5 秒延时释放，超时后撤销 Object URL', async () => {
        const pool = new ImageUrlPool({ releaseDelayMs: 5000 });
        const mockBlob = new Blob(['data']);
        const provider = vi.fn().mockResolvedValue(mockBlob);

        const url = await pool.acquire('img-001', provider);
        expect(url).toBeTruthy();

        // 释放 1 次，引用计数归零
        pool.release('img-001');

        // 未到达 5 秒时不应撤销
        vi.advanceTimersByTime(4999);
        expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();

        // 达到 5 秒后执行撤销
        vi.advanceTimersByTime(2);
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(url);
    });

    it('在延时释放倒计时期间若再次 acquire，应取消倒计时并安全复用', async () => {
        const pool = new ImageUrlPool({ releaseDelayMs: 5000 });
        const mockBlob = new Blob(['data']);
        const provider = vi.fn().mockResolvedValue(mockBlob);

        const url1 = await pool.acquire('img-001', provider);
        pool.release('img-001');

        // 倒计时 3 秒后再次 acquire
        vi.advanceTimersByTime(3000);
        const url2 = await pool.acquire('img-001', provider);

        expect(url1).toBe(url2);

        // 再经过 3 秒（总共 6 秒），因为已复用，不应被释放
        vi.advanceTimersByTime(3000);
        expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('revokeAll 与 dispose 应立即撤销所有活跃中的 URL', async () => {
        const pool = new ImageUrlPool();
        const provider1 = vi.fn().mockResolvedValue(new Blob(['data1']));
        const provider2 = vi.fn().mockResolvedValue(new Blob(['data2']));

        const url1 = await pool.acquire('img-001', provider1);
        const url2 = await pool.acquire('img-002', provider2);

        pool.dispose();
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(url1);
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(url2);
    });
});
