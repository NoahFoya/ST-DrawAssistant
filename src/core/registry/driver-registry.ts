/**
 * @module core/registry/driver-registry
 * @description 生图引擎驱动注册中心 (IDriverRegistry)
 */

import { IDisposable, toDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';
import { IDrawDriverContract } from '../contracts';

/** 生图后端驱动注册中心强类型接口 */
export interface IDriverRegistry<T extends IDrawDriverContract = IDrawDriverContract> extends IDisposable {
    /** 注册生图驱动实例 */
    register(driver: T): IDisposable;
    /** 获取指定 ID 的驱动实例 */
    get(id: string): T | undefined;
    /** 获取全部已注册驱动实例列表 */
    getAll(): readonly T[];
}

export class DriverRegistry<T extends IDrawDriverContract = IDrawDriverContract> implements IDriverRegistry<T> {
    private readonly _drivers = new Map<string, T>();
    private readonly _logger = new Logger('DriverRegistry');
    private _isDisposed = false;

    public register(driver: T): IDisposable {
        if (this._drivers.has(driver.id)) {
            this._logger.warn(`生图驱动 [${driver.id}] 已存在，覆盖注册`);
        }
        this._drivers.set(driver.id, driver);
        this._logger.info(`注册生图驱动: ${driver.name} [${driver.id}]`);

        return toDisposable(() => {
            this._drivers.delete(driver.id);
        });
    }

    public get(id: string): T | undefined {
        return this._drivers.get(id);
    }

    public getAll(): readonly T[] {
        return Array.from(this._drivers.values());
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._drivers.clear();
    }
}
