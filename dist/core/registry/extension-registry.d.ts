/**
 * @module core/registry/extension-registry
 * @description 独立扩展插件注册与生命周期管理 (IExtension, IExtensionRegistry)
 */
import { IDisposable } from '../foundation/disposable';
/** 扩展插件接口定义 */
export interface IExtension {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    /** 激活生命周期 (挂载 Tab 插槽、注册拦截钩子、加载专属预设) */
    activate(context: any): void | Promise<void>;
    /** 停用生命周期 (清理资源与事件监听) */
    deactivate?(): void | Promise<void>;
}
export interface IExtensionRegistry extends IDisposable {
    register(extension: IExtension): IDisposable;
    get(id: string): IExtension | undefined;
    getAll(): readonly IExtension[];
    activateAll(context: any): Promise<void>;
    deactivateAll(): Promise<void>;
}
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