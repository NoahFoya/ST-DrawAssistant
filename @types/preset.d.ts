/**
 * 预设条目与预设归档包数据模型 (@types/preset)
 *
 * 核心功能：
 * 1. 声明主题、提示词、工作流与生图参数等各分类预设的模型结构；
 * 2. 声明跨设备导入导出的预设归档包 (PresetPackage) 格式标准。
 *
 * 注意事项：
 * 1. 预设导入解析时需处理历史遗留别名字段（如 promptPrefix 与 prefix）的兼容映射；
 * 2. 预设包版本字段需严格对应语义化版本号，便于版本迁移。
 */

import type { LoraItemReference } from './engine-data';

/** 预设分类枚举联合体 */
export type PresetCategory = 'themes' | 'prompts' | 'workflows' | 'drawing';

/** 提示词预设数据模型 */
export interface PromptPresetData {
    /** 画风正向质量词前缀 */
    prefix?: string;
    /** 画风正向质量词后缀 */
    suffix?: string;
    /** 默认负向提示词 */
    defaultNegative?: string;
    /** 宏与外观标签替换字典 */
    macroReplacements?: Record<string, string>;
    /** 正则文本清洗规则 */
    regexRules?: unknown[];
    /** 绑定的 LoRA 列表 */
    loras?: LoraItemReference[];
}

/** 预设条目通用模型 */
export interface PresetItem<T = unknown> {
    id: string;
    name: string;
    isBuiltin?: boolean;
    data?: T;
    description?: string;
    engine?: string;
    category?: PresetCategory;
}

/** 预设归档包数据结构 */
export interface PresetsArchiveData {
    themes?: PresetItem[];
    prompts?: PresetItem<PromptPresetData>[];
    workflows?: PresetItem<{ json: string }>[];
    drawing?: Record<string, PresetItem[]>;
}
