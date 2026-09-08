/**
 * 预设方案数据契约
 */

export type PresetCategory = 'themes' | 'prompts' | 'workflows' | 'drawing';

export interface PresetItem<T = any> {
    id: string;
    name: string;
    data?: T;
    isBuiltin?: boolean;
}

export interface PresetSummaryItem {
    id: string;
    name: string;
    isBuiltin?: boolean;
}

export interface PresetsArchiveData {
    themes: PresetItem[];
    prompts: PresetItem[];
    workflows: PresetItem[];
    drawing: Record<string, PresetItem[]>;
}
