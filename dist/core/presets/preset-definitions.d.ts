/**
 * @module core/presets/preset-definitions
 * @description 预设方案分类定义与字段映射规则 (PresetCategoryDefinitions)
 */
import { DrawAssistantSettings, ModelProfileData, PromptProfileData, WorkflowProfileData } from '../state/store-types';
export interface PresetCategoryDef<TData = Record<string, unknown>> {
    listKey: keyof DrawAssistantSettings;
    activeIdKey: keyof DrawAssistantSettings;
    applyToSettings: (data: TData) => Partial<DrawAssistantSettings>;
    validateImport: (raw: unknown) => {
        valid: boolean;
        reason?: string;
    };
    normalizeImport?: (raw: unknown, rawContent: string) => TData;
    label: string;
}
export declare const PRESET_REGISTRY: {
    readonly model: {
        readonly listKey: keyof DrawAssistantSettings;
        readonly activeIdKey: keyof DrawAssistantSettings;
        readonly applyToSettings: (d: ModelProfileData) => Partial<DrawAssistantSettings>;
        readonly validateImport: (raw: unknown) => {
            valid: boolean;
            reason: string;
        } | {
            valid: boolean;
            reason?: undefined;
        };
        readonly label: "模型与生图参数";
    };
    readonly prompt: {
        readonly listKey: keyof DrawAssistantSettings;
        readonly activeIdKey: keyof DrawAssistantSettings;
        readonly applyToSettings: (d: PromptProfileData) => Partial<DrawAssistantSettings>;
        readonly validateImport: (raw: unknown) => {
            valid: boolean;
            reason: string;
        } | {
            valid: boolean;
            reason?: undefined;
        };
        readonly label: "提示词方案";
    };
    readonly txt2imgWorkflow: {
        readonly listKey: keyof DrawAssistantSettings;
        readonly activeIdKey: keyof DrawAssistantSettings;
        readonly applyToSettings: (d: WorkflowProfileData) => Partial<DrawAssistantSettings>;
        readonly validateImport: (raw: unknown) => {
            valid: boolean;
            reason: string;
        } | {
            valid: boolean;
            reason?: undefined;
        };
        readonly normalizeImport: (raw: unknown, rawContent: string) => WorkflowProfileData;
        readonly label: "文生图工作流";
    };
    readonly inpaintWorkflow: {
        readonly listKey: keyof DrawAssistantSettings;
        readonly activeIdKey: keyof DrawAssistantSettings;
        readonly applyToSettings: (d: WorkflowProfileData) => Partial<DrawAssistantSettings>;
        readonly validateImport: (raw: unknown) => {
            valid: boolean;
            reason: string;
        } | {
            valid: boolean;
            reason?: undefined;
        };
        readonly normalizeImport: (raw: unknown, rawContent: string) => WorkflowProfileData;
        readonly label: "重绘工作流";
    };
    readonly theme: {
        readonly listKey: keyof DrawAssistantSettings;
        readonly activeIdKey: keyof DrawAssistantSettings;
        readonly applyToSettings: () => Partial<DrawAssistantSettings>;
        readonly validateImport: (raw: unknown) => {
            valid: boolean;
            reason: string;
        } | {
            valid: boolean;
            reason?: undefined;
        };
        readonly label: "外观主题";
    };
};
export type RegistryCategory = keyof typeof PRESET_REGISTRY;
//# sourceMappingURL=preset-definitions.d.ts.map