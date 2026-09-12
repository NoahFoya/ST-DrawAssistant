/**
 * 预设条目与预设归档包数据模型
 */

/** 预设条目通用模型 */
export interface PresetItem<T = any> {
    id: string;
    name: string;
    isBuiltin?: boolean;
    data?: T;
    description?: string;
    engine?: string;
    category?: string;
}

/** 预设归档包数据结构 */
export interface PresetsArchiveData {
    themes?: PresetItem[];
    prompts?: PresetItem[];
    workflows?: PresetItem<{ json: string }>[];
    drawing?: Record<string, PresetItem[]>;
}
