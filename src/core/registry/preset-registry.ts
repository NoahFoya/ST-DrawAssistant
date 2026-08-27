/**
 * @module core/registry/preset-registry
 * @description 预设与规则方案索引注册中心 (PresetMetadata, PresetItem, IPresetRegistry)
 */

import { IDisposable, toDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';

export interface PresetMetadata {
    id: string;
    name: string;
    driver: 'comfyui' | 'sdwebui' | 'common' | string;
    category:
        | 'workflows-txt2img'
        | 'workflows-inpaint'
        | 'params-txt2img'
        | 'params-inpaint'
        | 'models'
        | 'prompts'
        | 'themes'
        | string;
    version?: string;
    description?: string;
}

export interface PresetItem<T = unknown> {
    metadata: PresetMetadata;
    data: T;
    isBuiltIn?: boolean;
}

/**
 * 预设与规则方案索引注册中心接口
 */
export interface IPresetRegistry extends IDisposable {
    /** 注册一个预设方案项 */
    register<T>(preset: PresetItem<T>): IDisposable;
    /** 根据引擎标识、分类和 ID 精确获取预设方案 */
    get<T>(driver: string, category: string, id: string): PresetItem<T> | undefined;
    /** 根据引擎标识与分类筛选枚举预设方案列表 */
    list(driver?: string, category?: string): PresetItem[];
}

export class PresetRegistry implements IPresetRegistry {
    private readonly _presets = new Map<string, PresetItem<any>>();
    private readonly _logger = new Logger('PresetRegistry');
    private _isDisposed = false;

    private getCompositeKey(driver: string, category: string, id: string): string {
        return `${driver}::${category}::${id}`;
    }

    public register<T>(preset: PresetItem<T>): IDisposable {
        const key = this.getCompositeKey(preset.metadata.driver, preset.metadata.category, preset.metadata.id);
        this._presets.set(key, preset);
        this._logger.info(`注册预设 [${key}] - ${preset.metadata.name}`);

        return toDisposable(() => {
            this._presets.delete(key);
        });
    }

    public get<T>(driver: string, category: string, id: string): PresetItem<T> | undefined {
        const key = this.getCompositeKey(driver, category, id);
        return this._presets.get(key) as PresetItem<T> | undefined;
    }

    public list(driver?: string, category?: string): PresetItem[] {
        const results: PresetItem[] = [];
        for (const item of this._presets.values()) {
            if (driver && item.metadata.driver !== driver && item.metadata.driver !== 'common') {
                continue;
            }
            if (category && item.metadata.category !== category) {
                continue;
            }
            results.push(item);
        }
        return results;
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._presets.clear();
    }
}
