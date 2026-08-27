/**
 * @module core/registry/driver-registry
 * @description 生图后端驱动注册中心 (IDriverRegistry)
 */

import { IDisposable, toDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';

/**
 * 生图后端驱动注册中心接口
 */
export interface IDriverRegistry extends IDisposable {
    /** 注册一个生图引擎后端驱动 */
    register(driver: any): IDisposable;
    /** 根据 ID 获取已注册的生图驱动 */
    get(id: string): any;
    /** 获取所有已注册的生图驱动列表 */
    getAll(): readonly any[];
}

export class DriverRegistry implements IDriverRegistry {
    private readonly _drivers = new Map<string, any>();
    private readonly _logger = new Logger('DriverRegistry');
    private _isDisposed = false;

    public register(driver: any): IDisposable {
        if (this._drivers.has(driver.id)) {
            this._logger.warn(`生图驱动 [${driver.id}] 已存在，覆盖注册`);
        }
        this._drivers.set(driver.id, driver);
        this._logger.info(`注册生图驱动: ${driver.name} [${driver.id}]`);

        return toDisposable(() => {
            this._drivers.delete(driver.id);
        });
    }

    public get(id: string): any {
        return this._drivers.get(id);
    }

    public getAll(): readonly any[] {
        return Array.from(this._drivers.values());
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._drivers.clear();
    }
}
