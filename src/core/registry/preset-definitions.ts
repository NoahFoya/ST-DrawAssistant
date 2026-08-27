/**
 * @module core/presets/preset-definitions
 * @description 预设方案分类定义与状态映射配置
 */

import type {
    DrawAssistantSettings,
    ModelProfileData,
    PromptProfileData,
    WorkflowProfileData,
    ThemeData
} from '../state/store-types';

/**
 * 预设分类与全局配置字段的静态映射表
 */
export interface PresetCategoryMap {
    model: {
        listKey: 'comfyModelProfiles';
        activeIdKey: 'comfyModelProfileId';
        dataType: ModelProfileData;
    };
    prompt: {
        listKey: 'comfyPromptProfiles';
        activeIdKey: 'comfyPromptProfileId';
        dataType: PromptProfileData;
    };
    txt2imgWorkflow: {
        listKey: 'comfyTxt2ImgWorkflows';
        activeIdKey: 'comfyTxt2ImgWorkflowId';
        dataType: WorkflowProfileData;
    };
    inpaintWorkflow: {
        listKey: 'comfyInpaintWorkflows';
        activeIdKey: 'comfyInpaintWorkflowId';
        dataType: WorkflowProfileData;
    };
    sdProfile: {
        listKey: 'sdProfiles';
        activeIdKey: 'sdProfileId';
        dataType: Record<string, unknown>;
    };
    theme: {
        listKey: 'customThemes';
        activeIdKey: 'themePreset';
        dataType: ThemeData;
    };
}

/** 核心支持的预设方案分类类型 */
export type RegistryCategory = keyof PresetCategoryMap;

/**
 * 预设分类定义接口
 */
export interface PresetCategoryDef<K extends RegistryCategory = RegistryCategory> {
    /** 全局设置中存储该分类预设列表的属性名 */
    readonly listKey: PresetCategoryMap[K]['listKey'];
    /** 全局设置中记录当前选中的预设 ID 的属性名 */
    readonly activeIdKey: PresetCategoryMap[K]['activeIdKey'];
    /** 将预设数据转换为全局设置字段更新对象的适配函数 */
    readonly applyToSettings: (data: PresetCategoryMap[K]['dataType']) => Partial<DrawAssistantSettings>;
    /** 导入预设文件时的数据校验函数 */
    readonly validateImport: (raw: unknown) => { valid: boolean; reason?: string };
    /** 导入预设数据时的格式规范化函数 (可选) */
    readonly normalizeImport?: (raw: unknown, rawContent: string) => PresetCategoryMap[K]['dataType'];
    /** 分类中文显示名称 */
    readonly label: string;
}

/**
 * 预设方案导出数据包结构（包含元数据与方案数据）
 */
export interface PresetExportPackage<T = unknown> {
    schemaVersion: 1;
    category: RegistryCategory;
    name: string;
    data: T;
    exportedAt: number;
}

/**
 * 各类预设方案的映射规则与校验规则状态绑定元数据字典
 */
export const PRESET_SCHEMA_BINDINGS: { [K in RegistryCategory]: PresetCategoryDef<K> } = {
    model: {
        listKey: 'comfyModelProfiles',
        activeIdKey: 'comfyModelProfileId',
        applyToSettings: (d: ModelProfileData): Partial<DrawAssistantSettings> => {
            const patch: Partial<DrawAssistantSettings> = {};
            if (d.ckptName !== undefined) patch.ckptName = d.ckptName;
            if (d.clipName !== undefined) patch.clipName = d.clipName;
            if (d.vaeName !== undefined) patch.vaeName = d.vaeName;
            if (d.width !== undefined) patch.width = d.width;
            if (d.height !== undefined) patch.height = d.height;
            if (d.steps !== undefined) patch.steps = d.steps;
            if (d.cfgScale !== undefined) patch.cfgScale = d.cfgScale;
            if (d.samplerName !== undefined) patch.samplerName = d.samplerName;
            if (d.scheduler !== undefined) patch.scheduler = d.scheduler;
            if (d.checkpointPositivePrefix !== undefined) patch.checkpointPositivePrefix = d.checkpointPositivePrefix;
            if (d.checkpointNegativePrefix !== undefined) patch.checkpointNegativePrefix = d.checkpointNegativePrefix;
            return patch;
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '导入文件非合法 JSON 对象' };
            const r = raw as Record<string, unknown>;
            if (r.ckptName === undefined && r.width === undefined && r.steps === undefined) {
                return { valid: false, reason: '该 JSON 不符合【ComfyUI 模型生图参数方案】结构规范' };
            }
            return { valid: true };
        },
        label: '模型与生图参数'
    },
    prompt: {
        listKey: 'comfyPromptProfiles',
        activeIdKey: 'comfyPromptProfileId',
        applyToSettings: (d: PromptProfileData): Partial<DrawAssistantSettings> => {
            const patch: Partial<DrawAssistantSettings> = {};
            if (d.promptPrefix !== undefined) patch.promptPrefix = d.promptPrefix;
            if (d.negativePrefix !== undefined) patch.negativePrefix = d.negativePrefix;
            if (d.promptSuffix !== undefined) patch.promptSuffix = d.promptSuffix;
            if (d.loras !== undefined) patch.loras = d.loras;
            return patch;
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '导入文件非合法 JSON 对象' };
            const r = raw as Record<string, unknown>;
            if (r.promptPrefix === undefined && r.negativePrefix === undefined) {
                return { valid: false, reason: '该 JSON 不符合【ComfyUI 提示词方案】结构规范' };
            }
            return { valid: true };
        },
        label: '提示词方案'
    },
    txt2imgWorkflow: {
        listKey: 'comfyTxt2ImgWorkflows',
        activeIdKey: 'comfyTxt2ImgWorkflowId',
        applyToSettings: (d: WorkflowProfileData): Partial<DrawAssistantSettings> => {
            return { workflowJson: d.json };
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '工作流文件格式非合法 JSON' };
            return { valid: true };
        },
        normalizeImport: (raw: unknown, rawContent: string): WorkflowProfileData => {
            const r = raw as Record<string, unknown>;
            if (typeof r.json === 'string') return { json: r.json };
            return { json: rawContent };
        },
        label: '文生图工作流'
    },
    inpaintWorkflow: {
        listKey: 'comfyInpaintWorkflows',
        activeIdKey: 'comfyInpaintWorkflowId',
        applyToSettings: (d: WorkflowProfileData): Partial<DrawAssistantSettings> => {
            return { inpaintWorkflowJson: d.json };
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '工作流文件格式非合法 JSON' };
            return { valid: true };
        },
        normalizeImport: (raw: unknown, rawContent: string): WorkflowProfileData => {
            const r = raw as Record<string, unknown>;
            if (typeof r.json === 'string') return { json: r.json };
            return { json: rawContent };
        },
        label: '重绘工作流'
    },
    sdProfile: {
        listKey: 'sdProfiles',
        activeIdKey: 'sdProfileId',
        applyToSettings: (d: Record<string, unknown>): Partial<DrawAssistantSettings> => {
            const patch: Partial<DrawAssistantSettings> = {};
            if (d.sdModelCheckpoint !== undefined) patch.sdModelCheckpoint = String(d.sdModelCheckpoint);
            if (d.sdSamplerName !== undefined) patch.sdSamplerName = String(d.sdSamplerName);
            if (typeof d.sdSteps === 'number') patch.sdSteps = d.sdSteps;
            if (typeof d.sdCfgScale === 'number') patch.sdCfgScale = d.sdCfgScale;
            if (typeof d.sdWidth === 'number') patch.sdWidth = d.sdWidth;
            if (typeof d.sdHeight === 'number') patch.sdHeight = d.sdHeight;
            if (typeof d.sdClipSkip === 'number') patch.sdClipSkip = d.sdClipSkip;
            if (typeof d.sdEnableHires === 'boolean') patch.sdEnableHires = d.sdEnableHires;
            if (d.sdHiresUpscaler !== undefined) patch.sdHiresUpscaler = String(d.sdHiresUpscaler);
            if (typeof d.sdHiresDenoise === 'number') patch.sdHiresDenoise = d.sdHiresDenoise;
            if (typeof d.sdHiresUpscaleBy === 'number') patch.sdHiresUpscaleBy = d.sdHiresUpscaleBy;
            if (d.sdPromptPrefix !== undefined) patch.sdPromptPrefix = String(d.sdPromptPrefix);
            if (d.sdNegativePrefix !== undefined) patch.sdNegativePrefix = String(d.sdNegativePrefix);
            if (d.sdPromptSuffix !== undefined) patch.sdPromptSuffix = String(d.sdPromptSuffix);
            if (Array.isArray(d.loras)) patch.loras = d.loras as any;
            return patch;
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '导入文件非合法 JSON 对象' };
            return { valid: true };
        },
        label: 'SD-WebUI 方案'
    },
    theme: {
        listKey: 'customThemes',
        activeIdKey: 'themePreset',
        applyToSettings: (): Partial<DrawAssistantSettings> => {
            return {};
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '主题文件非合法 JSON 对象' };
            const r = raw as Record<string, unknown>;
            if (!r.bgPrimary || !r.accentColor) {
                return { valid: false, reason: '该 JSON 缺少 bgPrimary 或 accentColor 必要色彩属性' };
            }
            return { valid: true };
        },
        label: '主题方案'
    }
};

