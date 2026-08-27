/**
 * @module core/registry/preset-registry
 * @description 预设方案注册中心 (支持按驱动类型与分类检索)
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

export interface IPresetRegistry extends IDisposable {
    /** 注册预设项并返回用于注销的清理句柄 */
    register<T>(preset: PresetItem<T>): IDisposable;
    /** 精确查询单个预设项 */
    get<T>(driver: string, category: string, id: string): PresetItem<T> | undefined;
    /** 按照驱动类型或分类筛选预设项列表 */
    list(driver?: string, category?: string): PresetItem[];
}

/** 预设注册中心实现 */
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
            if (driver && item.metadata.driver !== driver) {
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
