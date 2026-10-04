/**
 * Object URL 内存生命周期管理池 (UrlPool)。
 *
 * @remarks
 * 浏览器内存管理与防泄漏机制：
 * 1. 内存驻留机理：浏览器中通过 `URL.createObjectURL(blob)` 创建的地址，会在底层创建对 Blob 二进制数据的
 *    强引用常驻内存。该引用不会被垃圾回收器 (GC) 自动回收，直到文档被完全关闭或显式调用 `URL.revokeObjectURL`；
 * 2. SPA 内存泄漏防范：SillyTavern 属于长时间不刷新的单页应用，若频繁生图而不主动释放 Object URL，
 *    会导致浏览器内存占用单调暴增，最终引发页面崩溃；
 * 3. 自动化回收策略：
 *    - 同 key 重写：createUrl 时若已存在旧 key 映射，自动先触发 revokeUrl 释放旧资源；
 *    - 会话联动：在 session-lifecycle 监听到 CHAT_CHANGED 会话切换时，全量调用 revokeAll 批量回收脱离视图的临时引用。
 */

import type { ImageUrlPool } from '@types';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';

/**
 * 图像 Object URL 生命周期管理池。
 */
export class UrlPool implements ImageUrlPool {
    private readonly _urls = new Map<string, string>();

    /**
     * 为指定的 Blob 二进制数据创建并记录 Object URL。
     *
     * @remarks
     * 若已存在同名 key，会自动调用 URL.revokeObjectURL 释放旧资源，避免内存泄漏。
     * @param key 资产唯一标识或展示定位 key
     * @param blob 待引用的图像二进制 Blob
     * @returns 生成的 Object URL 地址
     */
    public createUrl(key: string, blob: Blob): string {
        if (!blob) {
            logger.error(`创建 Object URL 失败: 传入的 Blob 为空 (key: ${key})`);
            throw new Error(`[UrlPool] 创建 Object URL 失败: Blob 不能为空 (key: ${key})`);
        }

        this.revokeUrl(key);

        try {
            const url = URL.createObjectURL(blob);
            this._urls.set(key, url);
            return url;
        } catch (err) {
            logger.error(`创建 Object URL 异常 (key: ${key}):`, err);
            throw err;
        }
    }

    /**
     * 根据 key 获取当前生效的 Object URL。
     * @param key 资产唯一标识或展示定位 key
     */
    public getUrl(key: string): string | undefined {
        return this._urls.get(key);
    }

    /**
     * 释放并销毁指定 key 关联的 Object URL。
     * @param key 资产唯一标识或展示定位 key
     */
    public revokeUrl(key: string): boolean {
        const existing = this._urls.get(key);
        if (!existing) {
            return false;
        }

        this._urls.delete(key);
        try {
            URL.revokeObjectURL(existing);
        } catch (err) {
            logger.warn(`释放 Object URL 异常 (key: ${key}):`, err);
        }

        eventBus.emit('url:revoked', { key });
        return true;
    }

    /**
     * 释放管理池中记录的所有 Object URL。
     *
     * @remarks
     * 通常在会话切换、画廊卸载或插件退出时调用。
     */
    public revokeAll(): void {
        if (this._urls.size === 0) {
            return;
        }

        for (const [key, url] of this._urls.entries()) {
            try {
                URL.revokeObjectURL(url);
            } catch (err) {
                logger.warn(`批量释放 Object URL 异常 (key: ${key}):`, err);
            }
            eventBus.emit('url:revoked', { key });
        }

        this._urls.clear();
    }

    /** 当前活跃的 Object URL 数量 */
    public get size(): number {
        return this._urls.size;
    }
}

/** 全局默认单例 Object URL 管理池 */
export const urlPool = new UrlPool();
