/**
 * @module settings/preset-registry
 * @description 预设方案类别注册表（单一事实源）
 *
 * 核心设计：
 * - 定义 PresetCategoryDef<T> 接口，描述每个类别的完整元信息
 * - 导出 PRESET_REGISTRY：所有预设类别的唯一映射表
 * - 业务代码（manager.ts、controls.ts）通过查表驱动，消除 if/else 分支
 *
 * 新增预设类别时，仅需在此文件的 PRESET_REGISTRY 中添加一条配置。
 */
import type { DrawAssistantSettings, PresetProfileItem, ModelProfileData, PromptProfileData, WorkflowProfileData, ThemeData } from './types';
/**
 * 预设类别元信息描述符
 *
 * @template TData 预设数据 Payload 类型（存储于 PresetProfileItem.data）
 */
export interface PresetCategoryDef<TData = Record<string, unknown>> {
    /**
     * 在 DrawAssistantSettings 中对应的预设列表字段名
     * e.g. 'comfyModelProfiles'
     */
    listKey: keyof DrawAssistantSettings;
    /**
     * 在 DrawAssistantSettings 中对应的活跃选中 ID 字段名
     * e.g. 'comfyModelProfileId'
     */
    activeIdKey: keyof DrawAssistantSettings;
    /**
     * 获取内置默认预设列表的惰性 Getter
     * 延迟求值确保 initPresetsFromDistAsync 完成后能拿到最新数据
     */
    getBuiltIns: () => PresetProfileItem<TData>[];
    /**
     * 将选中预设的 data 展平写回 settings 根字段
     *
     * 返回 Partial<DrawAssistantSettings> 由调用方统一通过 patchSettings 完成；
     * 一次调用，一次 patch，消除双重触发。
     * 若该类别无需写回根字段（如 theme），返回 {}。
     */
    applyToSettings: (data: TData) => Partial<DrawAssistantSettings>;
    /**
     * 导入 JSON 时的 Schema 校验
     * @returns { valid: true } 或 { valid: false, reason: '...' }
     */
    validateImport: (raw: unknown) => {
        valid: boolean;
        reason?: string;
    };
    /**
     * 导入时对 raw JSON 的规范化处理（可选）
     * 若 raw 格式与 TData 不完全一致时使用（如裸 ComfyUI 节点图 → { json: string }）
     */
    normalizeImport?: (raw: unknown, rawContent: string) => TData;
    /** UI 显示名称，用于 toast / confirm 消息文案 */
    label: string;
}
declare function validateWorkflowImport(raw: unknown): {
    valid: boolean;
    reason?: string;
};
declare function normalizeWorkflowImport(raw: unknown, rawContent: string): WorkflowProfileData;
/**
 * 预设类别注册表
 *
 * 所有 settings 节点内的预设类别均在此统一注册。
 * 查表键（'model' | 'prompt' | 'workflow' | 'inpaint' | 'theme'）即为 ProfileCategory。
 *
 * character / outfit / enable-scheme 存储于 localStorage，由 character-manager 独立管理，不在此注册。
 */
export declare const PRESET_REGISTRY: {
    readonly model: {
        listKey: keyof DrawAssistantSettings;
        activeIdKey: keyof DrawAssistantSettings;
        getBuiltIns: () => PresetProfileItem<ModelProfileData>[];
        applyToSettings: (d: ModelProfileData) => Partial<DrawAssistantSettings>;
        validateImport: (raw: unknown) => {
            valid: boolean;
            reason?: string;
        };
        label: string;
    };
    readonly prompt: {
        listKey: keyof DrawAssistantSettings;
        activeIdKey: keyof DrawAssistantSettings;
        getBuiltIns: () => PresetProfileItem<PromptProfileData>[];
        applyToSettings: (d: PromptProfileData) => Partial<DrawAssistantSettings>;
        validateImport: (raw: unknown) => {
            valid: boolean;
            reason?: string;
        };
        label: string;
    };
    readonly workflow: {
        listKey: keyof DrawAssistantSettings;
        activeIdKey: keyof DrawAssistantSettings;
        getBuiltIns: () => PresetProfileItem<WorkflowProfileData>[];
        applyToSettings: (d: WorkflowProfileData) => Partial<DrawAssistantSettings>;
        validateImport: typeof validateWorkflowImport;
        normalizeImport: typeof normalizeWorkflowImport;
        label: string;
    };
    readonly inpaint: {
        listKey: keyof DrawAssistantSettings;
        activeIdKey: keyof DrawAssistantSettings;
        getBuiltIns: () => PresetProfileItem<WorkflowProfileData>[];
        applyToSettings: (d: WorkflowProfileData) => Partial<DrawAssistantSettings>;
        validateImport: typeof validateWorkflowImport;
        normalizeImport: typeof normalizeWorkflowImport;
        label: string;
    };
    readonly theme: {
        listKey: keyof DrawAssistantSettings;
        activeIdKey: keyof DrawAssistantSettings;
        getBuiltIns: () => PresetProfileItem<ThemeData>[];
        /**
         * theme 的视觉应用由 theme-tab 的 applySchemeCSSVariables 完成（草稿机制）。
         * 此处仅返回空对象，由调用方决定是否额外触发 CSS 变量注入。
         */
        applyToSettings: (_d: ThemeData) => Partial<DrawAssistantSettings>;
        validateImport: (raw: unknown) => {
            valid: boolean;
            reason?: string;
        };
        normalizeImport: (raw: unknown, _rawContent: string) => ThemeData;
        label: string;
    };
};
/** 注册表中所有 settings 内预设类别的键名联合类型 */
export type RegistryCategory = keyof typeof PRESET_REGISTRY;
export {};
//# sourceMappingURL=preset-registry.d.ts.map