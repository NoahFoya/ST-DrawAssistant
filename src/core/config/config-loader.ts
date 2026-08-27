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

import { EXTENSION_DISPLAY_NAME, VERSION } from '../constants';
import aboutJson from '../../../config/about.json';
import changelogJson from '../../../config/changelog.json';
import macroVariablesJson from '../../../config/macro-variables.json';
import {
    PresetProfileItem,
    ThemeData,
    ModelProfileData,
    PromptProfileData,
    WorkflowProfileData
} from '../state/store-types';
import { IPresetRegistry, PresetRegistry } from '../registry/preset-registry';

// ── Section B: Webpack / Vite 上下文初始化 ─────────────────────────────────

declare const require: {
    context: (directory: string, useSubdirectories?: boolean, regExp?: RegExp) => {
        keys(): string[];
        (id: string): any;
    };
};

let _webpackContext: any = null;
try {
    _webpackContext = require.context('../../../config/presets', true, /\.json$/);
} catch {}

const _viteGlob =
    typeof import.meta !== 'undefined' && (import.meta as any).glob
        ? (import.meta as any).glob('../../../config/presets/**/*.json', { eager: true })
        : null;

// ── Section A: 插件元数据 ───────────────────────────────────────────────────

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
    license?: string;
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
export function getAboutConfig(): AboutConfig {
    const raw = (aboutJson || {}) as Partial<AboutConfig>;
    return {
        name: EXTENSION_DISPLAY_NAME,
        version: VERSION,
        license: raw.license || 'GPL-3.0',
        description: raw.description || 'SillyTavern 全功能 AI 绘画增强助手',
        highlights: Array.isArray(raw.highlights) ? raw.highlights : [],
        author: raw.author || 'NoahFoya with AICode',
        copyright: raw.copyright || `Copyright © 2026 ${EXTENSION_DISPLAY_NAME}. Released under GPL-3.0 License.`,
        communityLinks: Array.isArray(raw.communityLinks) ? raw.communityLinks : []
    };
}

/**
 * 获取完整的版本更新履历数据
 */
export function getChangelog(): ChangelogEntry[] {
    if (!Array.isArray(changelogJson)) {
        return [];
    }
    return changelogJson as ChangelogEntry[];
}

// ── Section B: 预设文件加载 ─────────────────────────────────────────────────

/**
 * 从相对文件路径解析预设的驱动类型、分类名与唯一标识
 *
 * @example
 * - "themes/blue-sky.json" -> { driver: 'common', category: 'themes', id: 'blue-sky' }
 * - "comfyui/workflows-txt2img/weilin-txt2img.json" -> { driver: 'comfyui', category: 'workflows-txt2img', id: 'weilin-txt2img' }
 */
export function parsePresetPath(rawPath: string): { driver: string; category: string; id: string } | null {
    if (!rawPath) return null;

    const normalized = rawPath
        .replace(/\\/g, '/')
        .replace(/^(\.\.?\/)+/, '')
        .replace(/^config\/presets\//, '')
        .replace(/^presets\//, '')
        .replace(/\.json$/, '');

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    if (parts[0] === 'themes' && parts.length === 2) {
        return { driver: 'common', category: 'themes', id: parts[1] };
    }

    if (parts.length >= 3) {
        return {
            driver: parts[0],
            category: parts[1],
            id: parts.slice(2).join('/')
        };
    }

    if (parts.length === 2) {
        return { driver: parts[0], category: 'default', id: parts[1] };
    }

    return null;
}

/**
 * 将任意 JSON 预设数据规范化为统一的 PresetProfileItem 结构
 */
export function normalizePresetObject<T>(raw: any, fallbackId: string): PresetProfileItem<T> {
    if (!raw || typeof raw !== 'object') {
        return { id: fallbackId, name: fallbackId, data: {} as T };
    }

    if (raw.metadata && typeof raw.metadata === 'object') {
        return {
            id: raw.metadata.id || raw.id || fallbackId,
            name: raw.metadata.name || raw.name || raw.metadata.id || fallbackId,
            data: raw.data !== undefined ? raw.data : raw
        } as PresetProfileItem<T>;
    }

    if (raw.id && raw.data !== undefined) {
        return {
            id: raw.id,
            name: raw.name || raw.id,
            data: raw.data
        } as PresetProfileItem<T>;
    }

    return {
        id: fallbackId,
        name: raw.name || fallbackId,
        data: raw as T
    };
}

/**
 * 自动扫描 config/presets/ 目录下的所有预设文件并注册至 PresetRegistry
 *
 * @param registry 预设注册中心实例
 */
export function loadAllPresetsToRegistry(registry: IPresetRegistry): void {
    if (_webpackContext && typeof _webpackContext.keys === 'function') {
        const keys = _webpackContext.keys();
        for (const key of keys) {
            const parsed = parsePresetPath(key);
            if (!parsed) continue;

            const raw = _webpackContext(key);
            const mod = raw?.default !== undefined ? raw.default : raw;
            const normalized = normalizePresetObject<any>(mod, parsed.id);

            registry.register({
                metadata: {
                    id: normalized.id,
                    name: normalized.name,
                    driver: parsed.driver,
                    category: parsed.category
                },
                data: normalized.data,
                isBuiltIn: true
            });
        }
        return;
    }

    if (_viteGlob && typeof _viteGlob === 'object') {
        for (const [pathKey, raw] of Object.entries(_viteGlob)) {
            const parsed = parsePresetPath(pathKey);
            if (!parsed) continue;

            const mod = (raw as any)?.default !== undefined ? (raw as any).default : raw;
            const normalized = normalizePresetObject<any>(mod, parsed.id);

            registry.register({
                metadata: {
                    id: normalized.id,
                    name: normalized.name,
                    driver: parsed.driver,
                    category: parsed.category
                },
                data: normalized.data,
                isBuiltIn: true
            });
        }
    }
}

let _sharedRegistry: IPresetRegistry | null = null;

/** 获取全局共享预设注册中心单例 (无状态查询场景) */
export function getSharedPresetRegistry(): IPresetRegistry {
    if (!_sharedRegistry) {
        _sharedRegistry = new PresetRegistry();
        loadAllPresetsToRegistry(_sharedRegistry);
    }
    return _sharedRegistry;
}

/** 从预设注册中心查询指定分类的预设列表 */
export function getPresetListFromRegistry<T>(
    registry: IPresetRegistry | undefined,
    driver: string,
    category: string
): PresetProfileItem<T>[] {
    const reg = registry || getSharedPresetRegistry();
    const items = reg.list(driver, category);
    return items.map((item) => ({
        id: item.metadata.id,
        name: item.metadata.name,
        data: item.data as T
    }));
}

/** 获取内置主题预设列表 */
export async function fetchThemes(reg?: IPresetRegistry): Promise<PresetProfileItem<ThemeData>[]> {
    return getPresetListFromRegistry<ThemeData>(reg, 'common', 'themes');
}

/** 获取内置 ComfyUI 模型参数预设列表 */
export async function fetchComfyUIModels(reg?: IPresetRegistry): Promise<PresetProfileItem<ModelProfileData>[]> {
    return getPresetListFromRegistry<ModelProfileData>(reg, 'comfyui', 'models');
}

/** 获取内置 ComfyUI 提示词预设列表 */
export async function fetchComfyUIPrompts(reg?: IPresetRegistry): Promise<PresetProfileItem<PromptProfileData>[]> {
    return getPresetListFromRegistry<PromptProfileData>(reg, 'comfyui', 'prompts');
}

/** 获取内置 ComfyUI 文生图工作流列表 */
export async function fetchComfyUITxt2ImgWorkflows(reg?: IPresetRegistry): Promise<PresetProfileItem<WorkflowProfileData>[]> {
    return getPresetListFromRegistry<WorkflowProfileData>(reg, 'comfyui', 'workflows-txt2img');
}

/** 获取内置 ComfyUI 重绘工作流列表 */
export async function fetchComfyUIInpaintWorkflows(reg?: IPresetRegistry): Promise<PresetProfileItem<WorkflowProfileData>[]> {
    return getPresetListFromRegistry<WorkflowProfileData>(reg, 'comfyui', 'workflows-inpaint');
}

/** 获取内置 SD-WebUI 方案预设列表 */
export async function fetchSDWebUIModels(reg?: IPresetRegistry): Promise<PresetProfileItem<any>[]> {
    return getPresetListFromRegistry<any>(reg, 'sdwebui', 'models');
}

// ── Section C: 宏变量配置 ───────────────────────────────────────────────────

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

/**
 * 获取工作流宏变量完整配置列表
 *
 * 数据来源为 config/macro-variables.json，新增宏变量只需编辑该 JSON 文件，无需改动任何代码逻辑。
 */
export function getMacroVariables(): readonly MacroVariableDef[] {
    return macroVariablesJson as MacroVariableDef[];
}

