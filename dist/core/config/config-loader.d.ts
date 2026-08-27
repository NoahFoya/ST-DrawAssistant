/**
 * @module core/config/config-loader
 * @description 插件全局静态配置统一读取服务
 *
 * 设计意图：
 * - 统一管理所有 config/ 目录下的静态配置文件读取，避免随配置类型增长而分裂代码目录；
 * - 后续新增配置文件类型，只需在本文件追加对应的 Section 与导出函数，无需新建目录或文件。
 *
 * Section A — 插件元数据：读取 config/about.json 与 config/changelog.json
 * Section B — 预设文件加载：扫描 config/presets/ 并填充 PresetRegistry
 * Section C — 宏变量配置：读取 config/macro-variables.json 提供工作流宏变量清单
 */
import { PresetProfileItem, ThemeData, ModelProfileData, PromptProfileData, WorkflowProfileData } from '../state/store-types';
import { IPresetRegistry } from '../registry/preset-registry';
/** 社区链接卡片配置接口 */
export interface CommunityLinkItem {
    icon: string;
    title: string;
    subtitle: string;
    href: string;
    themeClass: string;
}
/** 插件关于页面元数据接口 */
export interface AboutConfig {
    name: string;
    version: string;
    description: string;
    highlights: string[];
    author: string;
    copyright: string;
    communityLinks: CommunityLinkItem[];
}
/** 单个版本变更履历条目接口 */
export interface ChangelogEntry {
    version: string;
    date: string;
    title?: string;
    items: string[];
}
/**
 * 获取关于页面元数据配置
 */
export declare function getAboutConfig(): AboutConfig;
/**
 * 获取完整的版本更新履历数据
 */
export declare function getChangelog(): ChangelogEntry[];
/**
 * 从相对文件路径解析预设的驱动类型、分类名与唯一标识
 *
 * @example
 * - "themes/blue-sky.json" -> { driver: 'common', category: 'themes', id: 'blue-sky' }
 * - "comfyui/workflows-txt2img/weilin-txt2img.json" -> { driver: 'comfyui', category: 'workflows-txt2img', id: 'weilin-txt2img' }
 */
export declare function parsePresetPath(rawPath: string): {
    driver: string;
    category: string;
    id: string;
} | null;
/**
 * 将任意 JSON 预设数据规范化为统一的 PresetProfileItem 结构
 */
export declare function normalizePresetObject<T>(raw: any, fallbackId: string): PresetProfileItem<T>;
/**
 * 自动扫描 config/presets/ 目录下的所有预设文件并注册至 PresetRegistry
 *
 * @param registry 预设注册中心实例
 */
export declare function loadAllPresetsToRegistry(registry: IPresetRegistry): void;
/** 获取全局共享预设注册中心单例 (无状态查询场景) */
export declare function getSharedPresetRegistry(): IPresetRegistry;
/** 从预设注册中心查询指定分类的预设列表 */
export declare function getPresetListFromRegistry<T>(registry: IPresetRegistry | undefined, driver: string, category: string): PresetProfileItem<T>[];
/** 获取内置主题预设列表 */
export declare function fetchThemes(reg?: IPresetRegistry): Promise<PresetProfileItem<ThemeData>[]>;
/** 获取内置 ComfyUI 模型参数预设列表 */
export declare function fetchComfyUIModels(reg?: IPresetRegistry): Promise<PresetProfileItem<ModelProfileData>[]>;
/** 获取内置 ComfyUI 提示词预设列表 */
export declare function fetchComfyUIPrompts(reg?: IPresetRegistry): Promise<PresetProfileItem<PromptProfileData>[]>;
/** 获取内置 ComfyUI 文生图工作流列表 */
export declare function fetchComfyUITxt2ImgWorkflows(reg?: IPresetRegistry): Promise<PresetProfileItem<WorkflowProfileData>[]>;
/** 获取内置 ComfyUI 重绘工作流列表 */
export declare function fetchComfyUIInpaintWorkflows(reg?: IPresetRegistry): Promise<PresetProfileItem<WorkflowProfileData>[]>;
/** 获取内置 SD-WebUI 方案预设列表 */
export declare function fetchSDWebUIModels(reg?: IPresetRegistry): Promise<PresetProfileItem<any>[]>;
/**
 * 工作流宏变量标准定义接口
 *
 * 数据来源：config/macro-variables.json
 * 类型定义保留在 TypeScript 代码中，以便各消费方获得编译期类型约束。
 */
export interface MacroVariableDef {
    /** 占位符标识 (如 '%prompt%') */
    variable: string;
    /** 中文显示标签 */
    label: string;
    /** 参数所属分类 */
    category: 'prompt' | 'model' | 'sampler' | 'resolution' | 'inpaint' | 'other';
    /** 数据类型 */
    type: 'string' | 'number';
    /** 兼容历史或变体别名列表 */
    aliases?: string[];
    /** ComfyUI 工作流节点输入字段特征匹配键名 */
    matchKeys: string[];
    /** 提示与用途说明 */
    tip: string;
}
/** 兼容历史接口定义别名 */
export type WorkflowMacroVariableDef = MacroVariableDef;
/**
 * 获取工作流宏变量完整配置列表
 *
 * 数据来源为 config/macro-variables.json，新增宏变量只需编辑该 JSON 文件，无需改动任何代码逻辑。
 */
export declare function getMacroVariables(): readonly MacroVariableDef[];
//# sourceMappingURL=config-loader.d.ts.map