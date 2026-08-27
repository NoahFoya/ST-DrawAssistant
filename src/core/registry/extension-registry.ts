/**
 * @module core/registry/extension-registry
 * @description 独立扩展插件注册与生命周期管理 (IExtension, IExtensionRegistry)
 */

import { IDisposable, toDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';

/** 扩展插件接口定义 */
export interface IExtension {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    /** 激活生命周期 (挂载 Tab 插槽、注册拦截钩子、加载专属预设) */
    activate(context: any): void | Promise<void>;
    /** 停用生命周期 (清理资源与事件监听) */
    deactivate?(): void | Promise<void>;
}

export interface IExtensionRegistry extends IDisposable {
    register(extension: IExtension): IDisposable;
    get(id: string): IExtension | undefined;
    has(id: string): boolean;
    getAll(): readonly IExtension[];
    activateAll(context: any): Promise<void>;
    deactivateAll(): Promise<void>;
}

export class ExtensionRegistry implements IExtensionRegistry {
    private readonly _extensions = new Map<string, IExtension>();
    private readonly _activeExtensions = new Set<string>();
    private readonly _logger = new Logger('ExtensionRegistry');
    private _isDisposed = false;

    public register(extension: IExtension): IDisposable {
        if (this._extensions.has(extension.id)) {
            this._logger.warn(`扩展 [${extension.id}] 已存在，覆盖注册`);
        }
        this._extensions.set(extension.id, extension);
        this._logger.info(`注册扩展: ${extension.name} (v${extension.version}) [${extension.id}]`);

        return toDisposable(() => {
            if (this._activeExtensions.has(extension.id)) {
                try {
                    extension.deactivate?.();
                } catch (e) {
                    this._logger.error(`卸载扩展 [${extension.id}] 失败:`, e);
                }
                this._activeExtensions.delete(extension.id);
            }
            this._extensions.delete(extension.id);
        });
    }

    public get(id: string): IExtension | undefined {
        return this._extensions.get(id);
    }

    public has(id: string): boolean {
        return this._extensions.has(id);
    }

    public getAll(): readonly IExtension[] {
        return Array.from(this._extensions.values());
    }

    public async activateAll(context: any): Promise<void> {
        for (const ext of this._extensions.values()) {
            if (this._activeExtensions.has(ext.id)) continue;

            try {
                this._logger.info(`正在激活扩展: ${ext.name} [${ext.id}]`);
                await ext.activate(context);
                this._activeExtensions.add(ext.id);
            } catch (err) {
                this._logger.error(`激活扩展 [${ext.id}] 发生异常:`, err);
            }
        }
    }

    public async deactivateAll(): Promise<void> {
        for (const extId of Array.from(this._activeExtensions)) {
            const ext = this._extensions.get(extId);
            if (ext) {
                try {
                    await ext.deactivate?.();
                } catch (e) {
                    this._logger.error(`停用扩展 [${extId}] 发生异常:`, e);
                }
            }
        }
        this._activeExtensions.clear();
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.deactivateAll();
        this._extensions.clear();
    }
}
