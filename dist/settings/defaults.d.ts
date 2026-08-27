/**
 * @module settings/defaults
 * @description 扩展默认配置与预设数据初始化模块
 *
 * 职责：
 * - 声明扩展全局默认设置 (DEFAULT_SETTINGS)
 * - 管理内置主题、提示词与工作流预设配置的装载与合并
 * - 提供预设的异步装载 (initPresetsFromDistAsync) 与融合逻辑
 */
import type { DrawAssistantSettings, PresetProfileItem, ModelProfileData, PromptProfileData, WorkflowProfileData, ThemeData } from './types';
/** 预设配置文件相对路径常量定义 */
export declare const PRESET_FOLDERS: {
    readonly THEMES: "../config/presets/themes";
    readonly MODELS: "../config/presets/models";
    readonly PROMPTS: "../config/presets/prompts";
    readonly WORKFLOWS_TXT2IMG: "../config/presets/workflows-txt2img";
    readonly WORKFLOWS_INPAINT: "../config/presets/workflows-inpaint";
};
/**
 * 内置预设包：封装从 dist/presets/ 或编译期内嵌加载的全量内置预设数据
 *
 * 由 fetchBuiltInPresets() 返回，传入 mergeBuiltInPresets() 进行融合写入。
 */
export interface BuiltInPresetBundle {
    themes: PresetProfileItem<ThemeData>[];
    models: PresetProfileItem<ModelProfileData>[];
    prompts: PresetProfileItem<PromptProfileData>[];
    txt2imgWorkflows: PresetProfileItem<WorkflowProfileData>[];
    inpaintWorkflows: PresetProfileItem<WorkflowProfileData>[];
}
/** 内置主题预设清单（统一 PresetProfileItem<ThemeData> 格式） */
export declare const DEFAULT_THEME_PROFILES: PresetProfileItem<ThemeData>[];
/** 内置模型参数预设清单 */
export declare const DEFAULT_MODEL_PROFILES: PresetProfileItem<ModelProfileData>[];
/** 内置提示词预设清单 */
export declare const DEFAULT_PROMPT_PROFILES: PresetProfileItem<PromptProfileData>[];
/** 内置文生图工作流预设清单 */
export declare const DEFAULT_TXT2IMG_WORKFLOW_PROFILES: PresetProfileItem<WorkflowProfileData>[];
/** 内置局部重绘工作流预设清单 */
export declare const DEFAULT_INPAINT_WORKFLOW_PROFILES: PresetProfileItem<WorkflowProfileData>[];
export declare const DEFAULT_WAI_WORKFLOW_JSON: string;
export declare const DEFAULT_WAI_INPAINT_WORKFLOW_JSON: string;
/**
 * DrawAssistant 全量扩展设置默认值 (由扫描推导派生)
 */
export declare const DEFAULT_SETTINGS: DrawAssistantSettings;
/**
 * 将内置预设包融合写入指定 settings 节点
 *
 * @param settingsNode 目标配置节点（宿主 extensionSettings[MODULE_NAME]）
 * @param bundle 内置预设包（来自 fetchBuiltInPresets 或模块级数组快照）
 * @param mode
 *   - 'init'：仅补充缺失的内置预设 id；不覆盖用户已有同 id 数据
 *   - 'reset'：移除所有 isBuiltIn=true 的旧项，用 bundle 最新内容完整替换；保留用户自定义项
 * @returns 是否发生了配置树变更
 */
export declare function mergeBuiltInPresets(settingsNode: Record<string, unknown>, bundle: BuiltInPresetBundle, mode: 'init' | 'reset'): boolean;
/**
 * 从 dist/presets/ 重新 fetch 最新内置预设包（每次调用均重新请求，不缓存）
 *
 * 典型使用场景：重置操作（确保拿到磁盘上最新版本的内置预设文件）
 * 降级策略：若 fetch 失败则返回模块级编译期内嵌数据快照
 *
 * @returns 完整内置预设包
 */
export declare function fetchBuiltInPresets(): Promise<BuiltInPresetBundle>;
/**
 * 异步从 dist/presets/ 加载全量内置预设，并以 'init' 模式融合写入当前 settings
 * （浏览器运行时 Phase 2 初始化，在 APP_READY → init() 流程中调用一次）
 *
 * - 使用 fetchBuiltInPresets() 获取最新预设数据
 * - 刷新模块级数组（兼容直接引用这些数组的代码）
 * - 直接操作 extensionSettings 节点融合写入，无需经过 manager.ts（避免循环依赖）
 */
export declare function initPresetsFromDistAsync(): Promise<void>;
//# sourceMappingURL=defaults.d.ts.map