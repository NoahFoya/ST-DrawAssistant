/**
 * @module domain/drivers/adapter-registry
 * @description 生图引擎适配器注册表
 *
 * 1. 统一管理各生图后端适配器实例；
 * 2. 支持根据引擎标识获取适配器。
 */

import { IDisposable, toDisposable } from '../../../common';
import { ImageEngineAdapter } from '../types';

/**
 * 生图引擎适配器注册表
 */
export class AdapterRegistry implements IDisposable {
    private readonly _adapters = new Map<string, ImageEngineAdapter>();

    /**
     * 注册适配器实例
     *
     * @param adapter 适配器实例
     * @returns 注销句柄
     */
    public register(adapter: ImageEngineAdapter): IDisposable {
        const id = adapter.id.toLowerCase();
        if (this._adapters.has(id)) {
            const existing = this._adapters.get(id);
            if (existing !== adapter) {
                existing?.dispose?.();
            }
        }
        this._adapters.set(id, adapter);

        return toDisposable(() => {
            this.unregister(id);
        });
    }

    /**
     * 注销指定适配器
     *
     * @param id 适配器标识
     */
    public unregister(id: string): void {
        const key = id.toLowerCase();
        const adapter = this._adapters.get(key);
        if (adapter) {
            this._adapters.delete(key);
            adapter.dispose?.();
        }
    }

    /**
     * 获取指定适配器实例
     *
     * @param id 适配器标识
     */
    public get(id: string): ImageEngineAdapter | undefined {
        return this._adapters.get(id.toLowerCase());
    }

    /**
     * 检查是否已注册指定适配器
     *
     * @param id 适配器标识
     */
    public has(id: string): boolean {
        return this._adapters.has(id.toLowerCase());
    }

    /**
     * 获取所有已注册的适配器列表
     */
    public getAll(): ImageEngineAdapter[] {
        return Array.from(this._adapters.values());
    }

    /**
     * 获取所有已注册的适配器标识列表
     */
    public getIds(): string[] {
        return Array.from(this._adapters.keys());
    }

    /**
     * 销毁注册表并清理所有已注册适配器
     */
    public dispose(): void {
        for (const adapter of this._adapters.values()) {
            adapter.dispose?.();
        }
        this._adapters.clear();
    }
}
