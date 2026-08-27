/**
 * @module core/registry/preset-registry
 * @description 预设与规则方案索引注册中心 (PresetMetadata, PresetItem, IPresetRegistry)
 */
import { IDisposable } from '../foundation/disposable';
export interface PresetMetadata {
    id: string;
    name: string;
    driver: 'comfyui' | 'sdwebui' | 'common' | string;
    category: 'workflows-txt2img' | 'workflows-inpaint' | 'params-txt2img' | 'params-inpaint' | 'models' | 'prompts' | 'themes' | string;
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
export declare class PresetRegistry implements IPresetRegistry {
    private readonly _presets;
    private readonly _logger;
    private _isDisposed;
    private getCompositeKey;
    register<T>(preset: PresetItem<T>): IDisposable;
    get<T>(driver: string, category: string, id: string): PresetItem<T> | undefined;
    list(driver?: string, category?: string): PresetItem[];
    dispose(): void;
}
//# sourceMappingURL=preset-registry.d.ts.map