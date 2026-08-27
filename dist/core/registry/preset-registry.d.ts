/**
 * @module core/registry/preset-registry
 * @description 预设方案注册中心 (支持按驱动类型与分类检索)
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
export interface IPresetRegistry extends IDisposable {
    /** 注册预设项并返回用于注销的清理句柄 */
    register<T>(preset: PresetItem<T>): IDisposable;
    /** 精确查询单个预设项 */
    get<T>(driver: string, category: string, id: string): PresetItem<T> | undefined;
    /** 按照驱动类型或分类筛选预设项列表 */
    list(driver?: string, category?: string): PresetItem[];
}
/** 预设注册中心实现 */
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