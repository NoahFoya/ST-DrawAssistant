/**
 * @module settings/defaults
 * @description 设置默认值与预设模板注册表
 *
 * 职责：
 * - 定义全量扩展设置项的默认值
 * - 提供默认内置的 Wai 工作流 JSON 模版与通用预设方案
 *
 * 规范参考：
 * - .agents/Skills/sillytavern-extension-host/SKILL.md §7 (扩展设置默认结构)
 *
 * 核心原则：
 * 1. 消除任何死编码文件名引入，使用 require.context 按文件夹路径通配扫描
 * 2. 默认主题与预设由扫描得到的第一个配置文件动态决定
 */
import type { DrawAssistantSettings, PresetProfileItem, ModelProfileData, PromptProfileData, WorkflowProfileData, GlobalProfileData, CustomThemeScheme } from './types';
export declare const DEFAULT_THEME_PROFILES: CustomThemeScheme[];
export declare const DEFAULT_GLOBAL_PROFILES: PresetProfileItem<GlobalProfileData>[];
export declare const DEFAULT_MODEL_PROFILES: PresetProfileItem<ModelProfileData>[];
export declare const DEFAULT_PROMPT_PROFILES: PresetProfileItem<PromptProfileData>[];
export declare const DEFAULT_WAI_WORKFLOW_JSON: string;
export declare const DEFAULT_WORKFLOW_PROFILES: PresetProfileItem<WorkflowProfileData>[];
export declare const DEFAULT_SETTINGS: DrawAssistantSettings;
//# sourceMappingURL=defaults.d.ts.map