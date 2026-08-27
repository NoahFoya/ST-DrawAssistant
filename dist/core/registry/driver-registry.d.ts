/**
 * @module core/registry/driver-registry
 * @description 生图后端驱动注册中心 (IDriverRegistry)
 */
import { IDisposable } from '../foundation/disposable';
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
export declare class DriverRegistry implements IDriverRegistry {
    private readonly _drivers;
    private readonly _logger;
    private _isDisposed;
    register(driver: any): IDisposable;
    get(id: string): any;
    getAll(): readonly any[];
    dispose(): void;
}
//# sourceMappingURL=driver-registry.d.ts.map