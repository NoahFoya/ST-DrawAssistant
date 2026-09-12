/**
 * 图像临时访问链接 (Object URL) 内存生命周期池
 * 职责：管理由 Blob 生成的临时展示链接，提供并发请求合并、5 秒延时防抖回收与会话批量释放。
 */

import { IDisposable } from '../util/event-bus';
import { DEFAULT_URL_RELEASE_DELAY_MS } from '../constants';

/** 单个临时 URL 内存池缓存条目 */
interface UrlPoolEntry {
    url: string;
    refCount: number;
    cleanupTimer: ReturnType<typeof setTimeout> | null;
}

export interface ImageUrlPoolOptions {
    releaseDelayMs?: number;
}

export class ImageUrlPool implements IDisposable {
    private readonly _cache = new Map<string, UrlPoolEntry>();
    private readonly _pendingLoads = new Map<string, Promise<string | null>>();
    private readonly _releaseDelayMs: number;
    private _isDisposed = false;

    constructor(options?: ImageUrlPoolOptions) {
        this._releaseDelayMs = options?.releaseDelayMs ?? DEFAULT_URL_RELEASE_DELAY_MS;
    }

    /**
     * 借出或生成图片的临时访问链接 (Object URL)，递增引用计数
     * 合并同一资产的并发异步读取请求，复用已生成的 Object URL。
     */
    public async acquire(
        imageId: string,
        blobProvider: () => Promise<Blob | null>
    ): Promise<string | null> {
        if (this._isDisposed || !imageId) return null;

        // 1. 已有内存缓存
        const existingEntry = this._cache.get(imageId);
        if (existingEntry) {
            if (existingEntry.cleanupTimer) {
                clearTimeout(existingEntry.cleanupTimer);
                existingEntry.cleanupTimer = null;
            }
            existingEntry.refCount += 1;
            return existingEntry.url;
        }

        // 2. 正在并发加载中：合并 Promise 并复用返回的链接
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

        // 3. 全新异步加载并创建 Object URL
        const loadPromise = (async () => {
            try {
                const blob = await blobProvider();
                if (!blob || this._isDisposed) return null;

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
            } catch {
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
     * 引用计数归零后保留 5 秒延时窗口，为消息分支滑动或快速滚屏提供复用缓冲，超时未再被引用才真正释放内存。
     */
    public release(imageId: string): void {
        if (this._isDisposed || !imageId) return;

        const entry = this._cache.get(imageId);
        if (!entry) return;

        entry.refCount = Math.max(0, entry.refCount - 1);

        if (entry.refCount === 0 && !entry.cleanupTimer) {
            entry.cleanupTimer = setTimeout(() => {
                this._destroyEntry(imageId);
            }, this._releaseDelayMs);
        }
    }

    /**
     * 立即撤销指定资产的临时 URL 并释放内存
     */
    public revoke(imageId: string): void {
        this._destroyEntry(imageId);
    }

    /**
     * 会话切换批量释放
     * 在会话变更时回收当前会话产生的全部临时 URL，释放浏览器内存。
     */
    public revokeAll(): void {
        for (const imageId of Array.from(this._cache.keys())) {
            this._destroyEntry(imageId);
        }
        this._pendingLoads.clear();
    }

    /**
     * 获取当前池中受管理的临时 URL 数量
     */
    public getActiveCount(): number {
        return this._cache.size;
    }

    /**
     * 销毁单个缓存条目，调用底层 URL.revokeObjectURL 释放内存
     */
    private _destroyEntry(imageId: string): void {
        const entry = this._cache.get(imageId);
        if (!entry) return;

        if (entry.cleanupTimer) {
            clearTimeout(entry.cleanupTimer);
            entry.cleanupTimer = null;
        }

        try {
            if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(entry.url);
            }
        } catch {
            // Object URL 可能已被提前撤销或失效，revokeObjectURL 抛出不应中断清理流程
        }

        this._cache.delete(imageId);
    }

    /**
     * 销毁引用池
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.revokeAll();
    }
}
