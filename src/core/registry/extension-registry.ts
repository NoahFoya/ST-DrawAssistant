/**
 * @module core/registry/extension-registry
 * @description 独立扩展模块注册与生命周期管理中心 (IExtension, IExtensionRegistry)
 */

import { IDisposable, toDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';

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
                this._logger.error(`激活扩展 [${ext.id}] 发生致命异常:`, err);
            }
        }
    }

    public async deactivateAll(): Promise<void> {
        for (const extId of Array.from(this._activeExtensions)) {
            const ext = this._extensions.get(extId);
            if (ext) {
                try {
                    await ext.deactivate?.();
                } catch (err) {
                    this._logger.error(`停用扩展 [${extId}] 异常:`, err);
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
