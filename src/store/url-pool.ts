/**
 * Object URL 内存与显存管理池实现。
 *
 * @remarks
 * 为本地 Blob 生成的临时 Object URL 提供统一的记录与释放机制。
 * 避免图像频繁生成或预览导致浏览器内存与显存占用持续上涨。
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
     * 若已存在相同 key 的历史 URL，会自动调用 URL.revokeObjectURL 释放旧资源，防止内存与显存泄漏。
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
