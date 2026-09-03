/**
 * @module core/storage/url-pool
 * @description 图片临时访问链接 (Object URL) 内存缓存池与引用计数管理
 */

import { IDisposable } from '../types';
import { Logger } from '../logger';
import { DEFAULT_URL_RELEASE_DELAY_MS } from '../constants';

interface UrlPoolEntry {
    url: string;
    refCount: number;
    cleanupTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * 图像临时访问链接内存管理池
 * 结合视图引用计数按需生成 Object URL，并在移出可视区域后延时释放内存
 */
export class ImageUrlPool implements IDisposable {
    private readonly _cache = new Map<string, UrlPoolEntry>();
    private readonly _pendingLoads = new Map<string, Promise<string | null>>();
    private readonly _logger = new Logger('ImageUrlPool');
    private readonly _releaseDelayMs: number;
    private _isDisposed = false;

    constructor(options?: { releaseDelayMs?: number }) {
        this._releaseDelayMs = options?.releaseDelayMs ?? DEFAULT_URL_RELEASE_DELAY_MS;
    }

    /**
     * 获取或生成图片的临时访问链接（Object URL），并递增引用计数
     *
     * 针对列表滚动或多处并发引用的场景，自动合并对同一图片的并发请求，
     * 复用已有链接，避免重复分配和内存泄漏。
     *
     * @param imageId 图片唯一标识
     * @param blobProvider 获取图片二进制数据的回调函数
     */
    public async acquire(imageId: string, blobProvider: () => Promise<Blob | null>): Promise<string | null> {
        if (this._isDisposed || !imageId) return null;

        const entry = this._cache.get(imageId);
        if (entry) {
            if (entry.cleanupTimer) {
                clearTimeout(entry.cleanupTimer);
                entry.cleanupTimer = null;
            }
            entry.refCount += 1;
            return entry.url;
        }

        const pending = this._pendingLoads.get(imageId);
        if (pending) {
            const url = await pending;
            const loadedEntry = this._cache.get(imageId);
            if (loadedEntry && url) {
                if (loadedEntry.cleanupTimer) {
                    clearTimeout(loadedEntry.cleanupTimer);
                    loadedEntry.cleanupTimer = null;
                }
                loadedEntry.refCount += 1;
            }
            return url;
        }

        const loadPromise = (async () => {
            try {
                const blob = await blobProvider();
                if (!blob || this._isDisposed) return null;

                // 若加载期间已被显式撤销，则跳过缓存写入
                if (!this._pendingLoads.has(imageId)) {
                    return null;
                }

                const url = URL.createObjectURL(blob);
                const newEntry: UrlPoolEntry = {
                    url,
                    refCount: 1,
                    cleanupTimer: null
                };
                this._cache.set(imageId, newEntry);
                return url;
            } catch (err) {
                this._logger.error(`创建图片临时访问链接失败 [${imageId}]`, err);
                return null;
            } finally {
                this._pendingLoads.delete(imageId);
            }
        })();

        this._pendingLoads.set(imageId, loadPromise);
        return await loadPromise;
    }

    /**
     * 释放指定图片的引用计数
     * 计数归零后启动延时定时器，超时未被复用则执行 URL.revokeObjectURL
     *
     * @param imageId 图片唯一 ID
     */
    public release(imageId: string): void {
        if (this._isDisposed || !imageId) return;

        const entry = this._cache.get(imageId);
        if (!entry) return;

        entry.refCount = Math.max(0, entry.refCount - 1);

        if (entry.refCount === 0 && !entry.cleanupTimer) {
            entry.cleanupTimer = setTimeout(() => {
                const current = this._cache.get(imageId);
                if (current && current.refCount === 0) {
                    URL.revokeObjectURL(current.url);
                    this._cache.delete(imageId);
                }
            }, this._releaseDelayMs);
        }
    }

    /**
     * 立即撤销指定图片的临时访问链接并从缓存中彻底移除
     *
     * @param imageId 图片唯一 ID
     */
    public revoke(imageId: string): void {
        if (!imageId) return;
        const entry = this._cache.get(imageId);
        if (entry) {
            if (entry.cleanupTimer) {
                clearTimeout(entry.cleanupTimer);
                entry.cleanupTimer = null;
            }
            URL.revokeObjectURL(entry.url);
            this._cache.delete(imageId);
        }
        this._pendingLoads.delete(imageId);
    }

    /** 撤销全部活跃的临时访问链接并清空缓存 */
    public revokeAll(): void {
        for (const entry of this._cache.values()) {
            if (entry.cleanupTimer) {
                clearTimeout(entry.cleanupTimer);
            }
            URL.revokeObjectURL(entry.url);
        }
        this._cache.clear();
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._pendingLoads.clear();
        this.revokeAll();
    }
}
