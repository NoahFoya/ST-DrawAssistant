/**
 * @module core/presets/preset-definitions
 * @description 预设方案分类定义与字段映射规则 (PresetCategoryDefinitions)
 */

import {
    DrawAssistantSettings,
    ModelProfileData,
    PromptProfileData,
    WorkflowProfileData
} from '../state/store-types';

export interface PresetCategoryDef<TData = Record<string, unknown>> {
    listKey: keyof DrawAssistantSettings;
    activeIdKey: keyof DrawAssistantSettings;
    applyToSettings: (data: TData) => Partial<DrawAssistantSettings>;
    validateImport: (raw: unknown) => { valid: boolean; reason?: string };
    normalizeImport?: (raw: unknown, rawContent: string) => TData;
    label: string;
}

export const PRESET_REGISTRY = {
    model: {
        listKey: 'comfyModelProfiles' as keyof DrawAssistantSettings,
        activeIdKey: 'comfyModelProfileId' as keyof DrawAssistantSettings,
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
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '导入文件非合法 JSON' };
            const r = raw as Record<string, unknown>;
            if (r.ckptName === undefined && r.width === undefined && r.steps === undefined) {
                return { valid: false, reason: '该 JSON 不符合【模型生图参数方案】结构要求' };
            }
            return { valid: true };
        },
        label: '模型与生图参数'
    },
    prompt: {
        listKey: 'comfyPromptProfiles' as keyof DrawAssistantSettings,
        activeIdKey: 'comfyPromptProfileId' as keyof DrawAssistantSettings,
        applyToSettings: (d: PromptProfileData): Partial<DrawAssistantSettings> => {
            const patch: Partial<DrawAssistantSettings> = {};
            if (d.promptPrefix !== undefined) patch.promptPrefix = d.promptPrefix;
            if (d.negativePrefix !== undefined) patch.negativePrefix = d.negativePrefix;
            if (d.promptSuffix !== undefined) patch.promptSuffix = d.promptSuffix;
            if (d.loras !== undefined) patch.loras = d.loras;
            return patch;
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '导入文件非合法 JSON' };
            const r = raw as Record<string, unknown>;
            if (r.promptPrefix === undefined && r.negativePrefix === undefined) {
                return { valid: false, reason: '该 JSON 不符合【提示词方案】结构要求' };
            }
            return { valid: true };
        },
        label: '提示词方案'
    },
    txt2imgWorkflow: {
        listKey: 'txt2imgWorkflowProfiles' as keyof DrawAssistantSettings,
        activeIdKey: 'txt2imgWorkflowProfileId' as keyof DrawAssistantSettings,
        applyToSettings: (d: WorkflowProfileData): Partial<DrawAssistantSettings> => {
            return { workflowJson: d.json };
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '工作流文件格式错误' };
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
        listKey: 'inpaintWorkflowProfiles' as keyof DrawAssistantSettings,
        activeIdKey: 'inpaintWorkflowProfileId' as keyof DrawAssistantSettings,
        applyToSettings: (d: WorkflowProfileData): Partial<DrawAssistantSettings> => {
            return { inpaintWorkflowJson: d.json };
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '工作流文件格式错误' };
            return { valid: true };
        },
        normalizeImport: (raw: unknown, rawContent: string): WorkflowProfileData => {
            const r = raw as Record<string, unknown>;
            if (typeof r.json === 'string') return { json: r.json };
            return { json: rawContent };
        },
        label: '重绘工作流'
    },
    theme: {
        listKey: 'customThemes' as keyof DrawAssistantSettings,
        activeIdKey: 'themePreset' as keyof DrawAssistantSettings,
        applyToSettings: (): Partial<DrawAssistantSettings> => {
            return {};
        },
        validateImport: (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return { valid: false, reason: '主题文件非合法 JSON' };
            const r = raw as Record<string, unknown>;
            if (!r.bgPrimary || !r.accentColor) {
                return { valid: false, reason: '该 JSON 缺少 bgPrimary 或 accentColor 必要色彩属性' };
            }
            return { valid: true };
        },
        label: '外观主题'
    }
} as const;

export type RegistryCategory = keyof typeof PRESET_REGISTRY;
