/**
 * @module core/registry/extension-registry
 * @description 独立扩展模块注册与生命周期管理中心 (IExtension, IExtensionRegistry)
 */
import { IDisposable } from '../foundation/disposable';
/**
 * 独立扩展模块标准化接口
 */
export interface IExtension {
    /** 扩展唯一 ID (如 'character-manager') */
    readonly id: string;
    /** 扩展可读名称 */
    readonly name: string;
    /** 语义化版本号 */
    readonly version: string;
    /**
     * 激活扩展
     * 在此生命周期内向 Context 注册专属 Tab、挂载拦截钩子与加载预设
     */
    activate(context: any): void | Promise<void>;
    /**
     * 停用扩展
     * 在此生命周期内完成资源清理与事件注销
     */
    deactivate?(): void | Promise<void>;
}
/**
 * 扩展注册中心接口
 */
export interface IExtensionRegistry extends IDisposable {
    register(extension: IExtension): IDisposable;
    get(id: string): IExtension | undefined;
    getAll(): readonly IExtension[];
    activateAll(context: any): Promise<void>;
    deactivateAll(): Promise<void>;
}
/**
 * 扩展注册中心实现类
 */
export declare class ExtensionRegistry implements IExtensionRegistry {
    private readonly _extensions;
    private readonly _activeExtensions;
    private readonly _logger;
    private _isDisposed;
    register(extension: IExtension): IDisposable;
    get(id: string): IExtension | undefined;
    getAll(): readonly IExtension[];
    activateAll(context: any): Promise<void>;
    deactivateAll(): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=extension-registry.d.ts.map