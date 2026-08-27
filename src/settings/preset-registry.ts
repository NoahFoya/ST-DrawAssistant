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

import type {
    DrawAssistantSettings,
    PresetProfileItem,
    ModelProfileData,
    PromptProfileData,
    WorkflowProfileData,
    ThemeData,
} from './types';

import {
    DEFAULT_MODEL_PROFILES,
    DEFAULT_PROMPT_PROFILES,
    DEFAULT_TXT2IMG_WORKFLOW_PROFILES,
    DEFAULT_INPAINT_WORKFLOW_PROFILES,
    DEFAULT_THEME_PROFILES,
} from './defaults';

// ─── 接口定义 ─────────────────────────────────────────────────────────────────

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
    validateImport: (raw: unknown) => { valid: boolean; reason?: string };

    /**
     * 导入时对 raw JSON 的规范化处理（可选）
     * 若 raw 格式与 TData 不完全一致时使用（如裸 ComfyUI 节点图 → { json: string }）
     */
    normalizeImport?: (raw: unknown, rawContent: string) => TData;

    /** UI 显示名称，用于 toast / confirm 消息文案 */
    label: string;
}

// ─── 工作流 Schema 校验共用逻辑 ────────────────────────────────────────────────

function validateWorkflowImport(raw: unknown): { valid: boolean; reason?: string } {
    if (!raw || typeof raw !== 'object') {
        return { valid: false, reason: '工作流文件非有效 JSON 对象' };
    }
    const record = raw as Record<string, unknown>;

    // 支持两种格式：{ json: "..." } 包装 或 裸 API 节点图
    let nodeObj: Record<string, unknown> | null = null;
    if (typeof record.json === 'string') {
        try {
            nodeObj = JSON.parse(record.json);
        } catch {
            return { valid: false, reason: '工作流 json 字段包含无效 JSON 语法' };
        }
    } else {
        nodeObj = record;
    }

    if (!nodeObj || typeof nodeObj !== 'object') {
        return { valid: false, reason: '工作流文件非有效节点图对象' };
    }

    // ComfyUI API 格式：至少有一个含 class_type 或 inputs 的节点
    const values = Object.values(nodeObj);
    const hasApiNode = values.some(
        v => v && typeof v === 'object' && ('class_type' in v || 'inputs' in v)
    );
    if (!hasApiNode && !('json' in record)) {
        return { valid: false, reason: '缺少 ComfyUI API 节点结构（未找到含 class_type 的节点树）' };
    }
    return { valid: true };
}

function normalizeWorkflowImport(raw: unknown, rawContent: string): WorkflowProfileData {
    const record = raw as Record<string, unknown>;
    if (typeof record.json === 'string') {
        return { json: record.json };
    }
    // 裸节点图 → 包装为 { json: string }
    return { json: rawContent };
}

// ─── PRESET_REGISTRY ──────────────────────────────────────────────────────────

/**
 * 预设类别注册表
 *
 * 所有 settings 节点内的预设类别均在此统一注册。
 * 查表键（'model' | 'prompt' | 'workflow' | 'inpaint' | 'theme'）即为 ProfileCategory。
 *
 * character / outfit / enable-scheme 存储于 localStorage，由 character-manager 独立管理，不在此注册。
 */
export const PRESET_REGISTRY = {

    model: {
        listKey:     'comfyModelProfiles'   as keyof DrawAssistantSettings,
        activeIdKey: 'comfyModelProfileId'  as keyof DrawAssistantSettings,
        getBuiltIns: () => DEFAULT_MODEL_PROFILES,
        applyToSettings: (d: ModelProfileData): Partial<DrawAssistantSettings> => {
            const patch: Partial<DrawAssistantSettings> = {};
            if (d.ckptName              !== undefined) patch.ckptName              = d.ckptName;
            if (d.clipName              !== undefined) patch.clipName              = d.clipName;
            if (d.vaeName               !== undefined) patch.vaeName               = d.vaeName;
            if (d.width                 !== undefined) patch.width                 = d.width;
            if (d.height                !== undefined) patch.height                = d.height;
            if (d.steps                 !== undefined) patch.steps                 = d.steps;
            if (d.cfgScale              !== undefined) patch.cfgScale              = d.cfgScale;
            if (d.samplerName           !== undefined) patch.samplerName           = d.samplerName;
            if (d.scheduler             !== undefined) patch.scheduler             = d.scheduler;
            if (d.checkpointPositivePrefix !== undefined) patch.checkpointPositivePrefix = d.checkpointPositivePrefix;
            if (d.checkpointNegativePrefix !== undefined) patch.checkpointNegativePrefix = d.checkpointNegativePrefix;
            if (d.inpaintDenoise        !== undefined) patch.inpaintDenoise        = d.inpaintDenoise;
            if (d.inpaintMaskBlur       !== undefined) patch.inpaintMaskBlur       = d.inpaintMaskBlur;
            if (d.inpaintGrowMask       !== undefined) patch.inpaintGrowMask       = d.inpaintGrowMask;
            return patch;
        },
        validateImport: (raw: unknown): { valid: boolean; reason?: string } => {
            if (!raw || typeof raw !== 'object') {
                return { valid: false, reason: '导入文件非合法 JSON 对象' };
            }
            const r = raw as Record<string, unknown>;
            const hasField = r.ckptName !== undefined || r.width !== undefined || r.steps !== undefined;
            if (!hasField) {
                return { valid: false, reason: '该 JSON 不符合【模型生图参数方案】结构要求' };
            }
            return { valid: true };
        },
        label: '模型生图参数方案',
    } satisfies PresetCategoryDef<ModelProfileData>,

    prompt: {
        listKey:     'comfyPromptProfiles'   as keyof DrawAssistantSettings,
        activeIdKey: 'comfyPromptProfileId'  as keyof DrawAssistantSettings,
        getBuiltIns: () => DEFAULT_PROMPT_PROFILES,
        applyToSettings: (d: PromptProfileData): Partial<DrawAssistantSettings> => {
            const patch: Partial<DrawAssistantSettings> = {};
            if (d.promptPrefix  !== undefined) patch.promptPrefix  = d.promptPrefix;
            if (d.negativePrefix !== undefined) patch.negativePrefix = d.negativePrefix;
            if (d.promptSuffix  !== undefined) patch.promptSuffix  = d.promptSuffix;
            if (d.loras         !== undefined) patch.loras         = d.loras;
            return patch;
        },
        validateImport: (raw: unknown): { valid: boolean; reason?: string } => {
            if (!raw || typeof raw !== 'object') {
                return { valid: false, reason: '导入文件非合法 JSON 对象' };
            }
            const r = raw as Record<string, unknown>;
            const hasField = r.promptPrefix !== undefined || r.negativePrefix !== undefined || r.loras !== undefined;
            if (!hasField) {
                return { valid: false, reason: '该 JSON 不符合【提示词方案】结构要求' };
            }
            return { valid: true };
        },
        label: '提示词方案',
    } satisfies PresetCategoryDef<PromptProfileData>,

    workflow: {
        listKey:     'comfyTxt2ImgWorkflows'    as keyof DrawAssistantSettings,
        activeIdKey: 'comfyTxt2ImgWorkflowId'   as keyof DrawAssistantSettings,
        getBuiltIns: () => DEFAULT_TXT2IMG_WORKFLOW_PROFILES,
        applyToSettings: (d: WorkflowProfileData): Partial<DrawAssistantSettings> => ({
            workflowJson: d.json ?? '',
        }),
        validateImport: validateWorkflowImport,
        normalizeImport: normalizeWorkflowImport,
        label: '文生图工作流',
    } satisfies PresetCategoryDef<WorkflowProfileData>,

    inpaint: {
        listKey:     'comfyInpaintWorkflows'    as keyof DrawAssistantSettings,
        activeIdKey: 'comfyInpaintWorkflowId'   as keyof DrawAssistantSettings,
        getBuiltIns: () => DEFAULT_INPAINT_WORKFLOW_PROFILES,
        applyToSettings: (d: WorkflowProfileData): Partial<DrawAssistantSettings> => ({
            inpaintWorkflowJson: d.json ?? '',
        }),
        validateImport: validateWorkflowImport,
        normalizeImport: normalizeWorkflowImport,
        label: '局部重绘工作流',
    } satisfies PresetCategoryDef<WorkflowProfileData>,

    theme: {
        listKey:     'customThemes'  as keyof DrawAssistantSettings,
        activeIdKey: 'themePreset'   as keyof DrawAssistantSettings,
        getBuiltIns: () => DEFAULT_THEME_PROFILES,
        /**
         * theme 的视觉应用由 theme-tab 的 applySchemeCSSVariables 完成（草稿机制）。
         * 此处仅返回空对象，由调用方决定是否额外触发 CSS 变量注入。
         */
        applyToSettings: (_d: ThemeData): Partial<DrawAssistantSettings> => ({}),
        validateImport: (raw: unknown): { valid: boolean; reason?: string } => {
            if (!raw || typeof raw !== 'object') {
                return { valid: false, reason: '导入文件非合法 JSON 对象' };
            }
            const r = raw as Record<string, unknown>;

            // 支持两种格式：
            // 1. 新格式 PresetProfileItem<ThemeData>: { id, name, data: { bgPrimary, ... } }
            // 2. 旧格式 (向前兼容一次): 扁平对象 { id, name, bgPrimary, ... }
            const dataObj = (r.data && typeof r.data === 'object')
                ? r.data as Record<string, unknown>
                : r;

            if (typeof r.id !== 'string' || typeof r.name !== 'string') {
                return { valid: false, reason: '缺失主题基础元信息 (id / name)' };
            }
            if (!dataObj.bgPrimary || !dataObj.accentColor) {
                return { valid: false, reason: '缺少必要主题颜色字段 (bgPrimary / accentColor)' };
            }
            return { valid: true };
        },
        normalizeImport: (raw: unknown, _rawContent: string): ThemeData => {
            const r = raw as Record<string, unknown>;
            // 若是旧格式扁平对象，提取颜色字段作为 data
            if (r.data && typeof r.data === 'object') {
                return r.data as ThemeData;
            }
            // 旧格式：从扁平对象提取颜色字段
            const { id: _id, name: _name, isBuiltIn: _isBuiltIn, ...colorFields } = r;
            return colorFields as unknown as ThemeData;
        },
        label: '外观主题',
    } satisfies PresetCategoryDef<ThemeData>,

} as const;

/** 注册表中所有 settings 内预设类别的键名联合类型 */
export type RegistryCategory = keyof typeof PRESET_REGISTRY;
