/**
 * @module core/presets/preset-definitions
 * @description 预设方案分类定义与状态映射配置
 */
import type { DrawAssistantSettings, ModelProfileData, PromptProfileData, WorkflowProfileData, ThemeData } from '../state/store-types';
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
    readonly validateImport: (raw: unknown) => {
        valid: boolean;
        reason?: string;
    };
    /** 导入预设数据时的格式规范化函数 (可选) */
    readonly normalizeImport?: (raw: unknown, rawContent: string) => PresetCategoryMap[K]['dataType'];
    /** 分类中文显示名称 */
    readonly label: string;
}
/**
 * 各类预设方案的映射规则与校验规则定义字典
 */
export declare const PRESET_REGISTRY: {
    [K in RegistryCategory]: PresetCategoryDef<K>;
};
//# sourceMappingURL=preset-definitions.d.ts.map