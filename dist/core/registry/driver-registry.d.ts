/**
 * @module core/registry/driver-registry
 * @description 生图引擎驱动注册中心 (IDriverRegistry)
 */
import { IDisposable } from '../foundation/disposable';
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
export declare class DriverRegistry<T extends IDrawDriverContract = IDrawDriverContract> implements IDriverRegistry<T> {
    private readonly _drivers;
    private readonly _logger;
    private _isDisposed;
    register(driver: T): IDisposable;
    get(id: string): T | undefined;
    getAll(): readonly T[];
    dispose(): void;
}
//# sourceMappingURL=driver-registry.d.ts.map