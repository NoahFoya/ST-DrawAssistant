/**
 * @module settings/defaults
 * @description 扩展默认配置与预设数据初始化模块
 *
 * 职责：
 * - 声明扩展全局默认设置 (DEFAULT_SETTINGS)
 * - 管理内置主题、提示词与工作流预设配置的装载与合并
 * - 提供预设的异步装载 (initPresetsFromDistAsync) 与融合逻辑
 */

import type {
    DrawAssistantSettings,
    WorkflowInjectionConfig,
    PresetProfileItem,
    ModelProfileData,
    PromptProfileData,
    WorkflowProfileData,
    ThemeData
} from './types';

import { logger } from '../core/logger';
import { EXTENSION_PATH, MODULE_NAME } from '../core/constants';
import { getContext } from '../core/context';

/** 预设配置文件相对路径常量定义 */
export const PRESET_FOLDERS = {
    THEMES: '../config/presets/themes',
    MODELS: '../config/presets/models',
    PROMPTS: '../config/presets/prompts',
    WORKFLOWS_TXT2IMG: '../config/presets/workflows-txt2img',
    WORKFLOWS_INPAINT: '../config/presets/workflows-inpaint',
} as const;

// ─── 内置预设包接口 ─────────────────────────────────────────────────────────────

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

// ─── Webpack 编译期内嵌扫描器 ─────────────────────────────────────────────────

/**
 * 通用通配符扫描加载器（支持 Webpack 静态构建与 Node/Vitest 测试环境双向盲扫描）
 *
 * 核心解耦原则：静态提取 require.context 模块上下文，按文件夹盲扫描全量 JSON 方案。
 */
function loadPresetsFromContext<T>(
    webpackCtx: any,
    folderRelativePath: string
): T[] {
    if (webpackCtx && typeof webpackCtx.keys === 'function') {
        try {
            return webpackCtx.keys().map((key: string) => {
                const mod = webpackCtx(key);
                return (mod && mod.default ? mod.default : mod) as T;
            });
        } catch (err) {
            logger.error(`Webpack require.context 提取预设 [${folderRelativePath}] 失败`, err);
        }
    }

    // Node / Vitest 环境测试处理：盲扫描对应文件夹下所有 .json 文件
    try {
        if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            const nodeReq = typeof eval !== 'undefined' ? eval('require') : null;
            if (nodeReq) {
                const path = nodeReq('path');
                const fs = nodeReq('fs');
                const targetDir = path.resolve(__dirname, folderRelativePath);
                if (fs.existsSync(targetDir)) {
                    const files = fs.readdirSync(targetDir);
                    return files
                        .filter((f: string) => f.endsWith('.json'))
                        .map((f: string) => {
                            const content = fs.readFileSync(path.join(targetDir, f), 'utf-8');
                            return JSON.parse(content) as T;
                        });
                }
            }
        }
    } catch (err) {
        logger.error(`盲扫描预设文件夹 [${folderRelativePath}] 失败`, err);
    }

    return [];
}

// 静态字面量声明 require.context，确保 Webpack 打包阶段能静态提取全量 JSON 预设文件
// @ts-ignore
const themeCtx = typeof require !== 'undefined' && typeof require.context === 'function' ? require.context('../config/presets/themes', false, /\.json$/) : null;
// @ts-ignore
const modelCtx = typeof require !== 'undefined' && typeof require.context === 'function' ? require.context('../config/presets/models', false, /\.json$/) : null;
// @ts-ignore
const promptCtx = typeof require !== 'undefined' && typeof require.context === 'function' ? require.context('../config/presets/prompts', false, /\.json$/) : null;
// @ts-ignore
const txt2imgWorkflowCtx = typeof require !== 'undefined' && typeof require.context === 'function' ? require.context('../config/presets/workflows-txt2img', false, /\.json$/) : null;
// @ts-ignore
const inpaintWorkflowCtx = typeof require !== 'undefined' && typeof require.context === 'function' ? require.context('../config/presets/workflows-inpaint', false, /\.json$/) : null;

// 模块级数组：编译期内嵌初始值，由 initPresetsFromDistAsync() 运行时刷新
/** 内置主题预设清单（统一 PresetProfileItem<ThemeData> 格式） */
export const DEFAULT_THEME_PROFILES: PresetProfileItem<ThemeData>[] =
    loadPresetsFromContext<PresetProfileItem<ThemeData>>(themeCtx, PRESET_FOLDERS.THEMES);

/** 内置模型参数预设清单 */
export const DEFAULT_MODEL_PROFILES: PresetProfileItem<ModelProfileData>[] =
    loadPresetsFromContext<PresetProfileItem<ModelProfileData>>(modelCtx, PRESET_FOLDERS.MODELS);

/** 内置提示词预设清单 */
export const DEFAULT_PROMPT_PROFILES: PresetProfileItem<PromptProfileData>[] =
    loadPresetsFromContext<PresetProfileItem<PromptProfileData>>(promptCtx, PRESET_FOLDERS.PROMPTS);

/** 内置文生图工作流预设清单 */
export const DEFAULT_TXT2IMG_WORKFLOW_PROFILES: PresetProfileItem<WorkflowProfileData>[] =
    loadPresetsFromContext<PresetProfileItem<WorkflowProfileData>>(txt2imgWorkflowCtx, PRESET_FOLDERS.WORKFLOWS_TXT2IMG);

/** 内置局部重绘工作流预设清单 */
export const DEFAULT_INPAINT_WORKFLOW_PROFILES: PresetProfileItem<WorkflowProfileData>[] =
    loadPresetsFromContext<PresetProfileItem<WorkflowProfileData>>(inpaintWorkflowCtx, PRESET_FOLDERS.WORKFLOWS_INPAINT);

const defaultModelData = DEFAULT_MODEL_PROFILES[0]?.data ?? {};
const defaultPromptData = DEFAULT_PROMPT_PROFILES[0]?.data ?? {};

export const DEFAULT_WAI_WORKFLOW_JSON = DEFAULT_TXT2IMG_WORKFLOW_PROFILES[0]?.data?.json ?? '';
export const DEFAULT_WAI_INPAINT_WORKFLOW_JSON = DEFAULT_INPAINT_WORKFLOW_PROFILES[0]?.data?.json ?? DEFAULT_WAI_WORKFLOW_JSON;

const DEFAULT_WORKFLOW_INJECTION: WorkflowInjectionConfig = {
    positiveNodeId: '113',
    positiveField: 'positive',
    negativeNodeId: '12',
    negativeField: 'text',
    widthNodeId: '119',
    widthField: 'value',
    heightNodeId: '118',
    heightField: 'value',
    kSamplerNodeId: '63',
    saveImageNodeId: '99',
};

/**
 * DrawAssistant 全量扩展设置默认值 (由扫描推导派生)
 */
export const DEFAULT_SETTINGS: DrawAssistantSettings = {
    // 扩展基础状态
    enabled: true,
    showHelp: true,
    autoCleanupOnChatDelete: false,
    logLevel: 'WARN',

    // 后端配置
    provider: 'comfyui',
    requestMode: 'browser',
    serverUrl: 'http://127.0.0.1:8188',
    apiKey: '',

    // Workflow 工作流配置与节点注入映射
    workflowJson: DEFAULT_WAI_WORKFLOW_JSON,
    inpaintWorkflowJson: DEFAULT_WAI_INPAINT_WORKFLOW_JSON,
    workflowInjection: { ...DEFAULT_WORKFLOW_INJECTION },

    // 占位符配置
    placeholderStart: 'image###',
    placeholderEnd: '###',

    // 基础图像生成参数默认值 (由扫描到的首个模型预设动态派生)
    ckptName: defaultModelData.ckptName ?? '',
    clipName: defaultModelData.clipName ?? '',
    vaeName: defaultModelData.vaeName ?? '',
    width: defaultModelData.width ?? 1024,
    height: defaultModelData.height ?? 1344,
    steps: defaultModelData.steps ?? 18,
    cfgScale: defaultModelData.cfgScale ?? 6,
    samplerName: defaultModelData.samplerName ?? 'euler_ancestral',
    scheduler: defaultModelData.scheduler ?? 'normal',

    // 提示词配置 (由扫描到的首个提示词预设动态派生)
    promptPrefix: defaultPromptData.promptPrefix ?? '',
    negativePrefix: defaultPromptData.negativePrefix ?? '',
    promptSuffix: defaultPromptData.promptSuffix ?? '',
    loras: defaultPromptData.loras ?? [],
    cleanExtraSpacesAndLines: true,

    // 扩展启用状态注册表
    extensions: {},

    // 行为配置
    enableActionPanel: true,
    inpaintDenoise: 0.75,
    inpaintMaskBlur: 8,
    inpaintGrowMask: 6,
    autoGenerate: false,
    lightboxEnabled: true,
    persistToChat: true,
    extraSaveToChat: false,
    imageFormat: 'original',
    imageQuality: 0.85,
    imageDisplay: {
        align: 'left',
        objectFit: 'contain',
        maxHeight: 0,
        maxWidthPct: 50,
        rounded: true,
    },
    maxConcurrent: 1,
    requestTimeout: 120000,

    // 主题：默认为动态扫描得到的第一个主题方案 ID
    themePreset: DEFAULT_THEME_PROFILES[0]?.id ?? '',
    customThemes: [...DEFAULT_THEME_PROFILES] as PresetProfileItem<ThemeData>[],

    // 悬浮窗默认值
    fabVisible: true,
    fabOpacity: 0.9,
    fabIcon: 'palette',
    fabPosition: null,

    // ComfyUI 预设默认值 (由预设文件扫描推导)
    comfyModelProfileId: DEFAULT_MODEL_PROFILES[0]?.id ?? '',
    comfyPromptProfileId: DEFAULT_PROMPT_PROFILES[0]?.id ?? '',
    comfyTxt2ImgWorkflowId: DEFAULT_TXT2IMG_WORKFLOW_PROFILES[0]?.id ?? '',
    comfyInpaintWorkflowId: DEFAULT_INPAINT_WORKFLOW_PROFILES[0]?.id ?? '',
    checkpointPositivePrefix: defaultModelData.checkpointPositivePrefix ?? '',
    checkpointNegativePrefix: defaultModelData.checkpointNegativePrefix ?? '',
    comfyModelProfiles: [...DEFAULT_MODEL_PROFILES],
    comfyPromptProfiles: [...DEFAULT_PROMPT_PROFILES],
    comfyTxt2ImgWorkflows: [...DEFAULT_TXT2IMG_WORKFLOW_PROFILES],
    comfyInpaintWorkflows: [...DEFAULT_INPAINT_WORKFLOW_PROFILES],
};

// ─── 内置预设融合工具 ─────────────────────────────────────────────────────────

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
export function mergeBuiltInPresets(
    settingsNode: Record<string, unknown>,
    bundle: BuiltInPresetBundle,
    mode: 'init' | 'reset'
): boolean {
    let modified = false;

    /**
     * 单分类融合辅助函数
     *
     * @param arrKey       settings 节点中的数组字段名
     * @param bundleItems  bundle 对应分类的内置预设列表
     * @param activeIdKey  主选中 ID 字段名（可选）
     * @param inpaintIdKey 重绘专用选中 ID 字段名（仅 workflow 分类使用）
     */
    const mergeCategory = <T extends { id: string; isBuiltIn?: boolean }>(
        arrKey: string,
        bundleItems: T[],
        activeIdKey?: string,
        inpaintIdKey?: string
    ): void => {
        if (bundleItems.length === 0) return;

        /** 从列表中找到最合适的 inpaint 工作流 id（优先含 'inpaint' 关键字，否则取首项） */
        const findInpaintId = (items: T[]): string =>
            (items.find(w => (w as any).id?.includes('inpaint')) ?? items[0])?.id ?? '';

        // 数组字段不存在或为空 → 直接用 bundle 初始化
        if (!Array.isArray(settingsNode[arrKey]) || (settingsNode[arrKey] as T[]).length === 0) {
            settingsNode[arrKey] = JSON.parse(JSON.stringify(bundleItems));
            if (activeIdKey) settingsNode[activeIdKey] = bundleItems[0]?.id ?? '';
            if (inpaintIdKey) settingsNode[inpaintIdKey] = findInpaintId(bundleItems);
            modified = true;
            return;
        }

        const existingArr = settingsNode[arrKey] as T[];

        if (mode === 'reset') {
            // 保留用户自定义项（isBuiltIn 不为 true），替换全部内置项为 bundle 最新内容
            const userItems = existingArr.filter(item => !item.isBuiltIn);
            settingsNode[arrKey] = [...(JSON.parse(JSON.stringify(bundleItems)) as T[]), ...userItems];
            // 重置活跃 ID 指向 bundle 首项
            if (activeIdKey) settingsNode[activeIdKey] = bundleItems[0]?.id ?? '';
            if (inpaintIdKey) settingsNode[inpaintIdKey] = findInpaintId(bundleItems);
            modified = true;
        } else {
            // 'init': 仅补充缺失 id 的内置预设（不覆盖已有同 id 数据）
            const existingIds = new Set(existingArr.map(item => item?.id).filter(Boolean));
            bundleItems.forEach(item => {
                if (item?.id && !existingIds.has(item.id)) {
                    existingArr.push(JSON.parse(JSON.stringify(item)));
                    existingIds.add(item.id);
                    modified = true;
                }
            });

            // 修正悬空的活跃 ID（已选 id 不存在于当前列表时，回退到第一项）
            const currentArr = settingsNode[arrKey] as T[];
            if (activeIdKey) {
                const activeId = settingsNode[activeIdKey];
                if (!activeId || !currentArr.some(p => p.id === activeId)) {
                    settingsNode[activeIdKey] = currentArr[0]?.id ?? '';
                    modified = true;
                }
            }
            if (inpaintIdKey) {
                const inpaintId = settingsNode[inpaintIdKey];
                if (!inpaintId || !currentArr.some(p => p.id === inpaintId)) {
                    settingsNode[inpaintIdKey] = findInpaintId(currentArr);
                    modified = true;
                }
            }
        }
    };

    mergeCategory('customThemes',          bundle.themes,            'themePreset');
    mergeCategory('comfyModelProfiles',    bundle.models,            'comfyModelProfileId');
    mergeCategory('comfyPromptProfiles',   bundle.prompts,           'comfyPromptProfileId');
    mergeCategory('comfyTxt2ImgWorkflows', bundle.txt2imgWorkflows, 'comfyTxt2ImgWorkflowId');
    mergeCategory('comfyInpaintWorkflows', bundle.inpaintWorkflows, 'comfyInpaintWorkflowId');

    return modified;
}

// ─── fetchBuiltInPresets ──────────────────────────────────────────────────────

/**
 * 从 dist/presets/ 重新 fetch 最新内置预设包（每次调用均重新请求，不缓存）
 *
 * 典型使用场景：重置操作（确保拿到磁盘上最新版本的内置预设文件）
 * 降级策略：若 fetch 失败则返回模块级编译期内嵌数据快照
 *
 * @returns 完整内置预设包
 */
export async function fetchBuiltInPresets(): Promise<BuiltInPresetBundle> {
    try {
        const root = EXTENSION_PATH ? `scripts/extensions/${EXTENSION_PATH}` : '.';
        const baseUrl = `${root}/dist/config/presets`;
        const manifestRes = await fetch(`${baseUrl}/manifest.json`);
        if (!manifestRes.ok) throw new Error(`manifest HTTP ${manifestRes.status}`);

        const manifest = await manifestRes.json() as Record<string, string[]>;

        const fetchCategory = async <T>(key: string, subdir: string): Promise<T[]> => {
            const list: T[] = [];
            if (!Array.isArray(manifest[key])) return list;
            for (const f of manifest[key]) {
                try {
                    const res = await fetch(`${baseUrl}/${subdir}/${f}`);
                    if (res.ok) list.push(await res.json() as T);
                } catch { /* 单文件 fetch 失败，跳过继续 */ }
            }
            return list;
        };

        const txt2imgWorkflows = await fetchCategory<PresetProfileItem<WorkflowProfileData>>('workflows-txt2img', 'workflows-txt2img');
        const inpaintWorkflows = await fetchCategory<PresetProfileItem<WorkflowProfileData>>('workflows-inpaint', 'workflows-inpaint');

        const bundle: BuiltInPresetBundle = {
            themes:           await fetchCategory<PresetProfileItem<ThemeData>>('themes', 'themes'),
            models:           await fetchCategory<PresetProfileItem<ModelProfileData>>('models', 'models'),
            prompts:          await fetchCategory<PresetProfileItem<PromptProfileData>>('prompts', 'prompts'),
            txt2imgWorkflows,
            inpaintWorkflows,
        };

        // 至少有一个分类有数据才认为 fetch 有效
        if (bundle.themes.length > 0 || bundle.models.length > 0 || bundle.txt2imgWorkflows.length > 0 || bundle.inpaintWorkflows.length > 0) {
            return bundle;
        }
        throw new Error('所有预设分类均无数据，fetch 结果无效');
    } catch (err) {
        logger.debug('fetchBuiltInPresets: dist/presets/ fetch 失败，降级使用编译期内嵌数据', err);
    }

    // 降级：返回模块级编译期内嵌数组的当前快照
    return {
        themes:           [...DEFAULT_THEME_PROFILES],
        models:           [...DEFAULT_MODEL_PROFILES],
        prompts:          [...DEFAULT_PROMPT_PROFILES],
        txt2imgWorkflows: [...DEFAULT_TXT2IMG_WORKFLOW_PROFILES],
        inpaintWorkflows: [...DEFAULT_INPAINT_WORKFLOW_PROFILES],
    };
}

// ─── initPresetsFromDistAsync ──────────────────────────────────────────────────

/**
 * 异步从 dist/presets/ 加载全量内置预设，并以 'init' 模式融合写入当前 settings
 * （浏览器运行时 Phase 2 初始化，在 APP_READY → init() 流程中调用一次）
 *
 * - 使用 fetchBuiltInPresets() 获取最新预设数据
 * - 刷新模块级数组（兼容直接引用这些数组的代码）
 * - 直接操作 extensionSettings 节点融合写入，无需经过 manager.ts（避免循环依赖）
 */
export async function initPresetsFromDistAsync(): Promise<void> {
    try {
        const bundle = await fetchBuiltInPresets();

        // 刷新模块级数组，保持常量与 dist/ 最新数据同步
        const refreshModuleArr = <T>(target: T[], source: T[]): void => {
            if (source.length > 0) {
                target.length = 0;
                target.push(...source);
            }
        };
        refreshModuleArr(DEFAULT_THEME_PROFILES,               bundle.themes);
        refreshModuleArr(DEFAULT_MODEL_PROFILES              as any[], bundle.models           as any[]);
        refreshModuleArr(DEFAULT_PROMPT_PROFILES             as any[], bundle.prompts          as any[]);
        refreshModuleArr(DEFAULT_TXT2IMG_WORKFLOW_PROFILES    as any[], bundle.txt2imgWorkflows as any[]);
        refreshModuleArr(DEFAULT_INPAINT_WORKFLOW_PROFILES    as any[], bundle.inpaintWorkflows as any[]);

        // 直接融合写入 settings 节点（init 模式：仅补缺失 id，不覆盖已有数据）
        // 不经由 manager.ts 以避免循环依赖
        try {
            const ctx = getContext();
            const node = ctx?.extensionSettings?.[MODULE_NAME] as Record<string, unknown> | undefined;
            if (node && typeof node === 'object') {
                const modified = mergeBuiltInPresets(node, bundle, 'init');
                if (modified && typeof ctx.saveSettingsDebounced === 'function') {
                    ctx.saveSettingsDebounced();
                }
            }
        } catch (ctxErr) {
            logger.debug('initPresetsFromDistAsync: 无法获取 settings 节点，跳过融合写入', ctxErr);
        }

        logger.debug('成功从 dist/presets/ 动态加载物理预设清单并融合配置树');
    } catch (err) {
        logger.debug('initPresetsFromDistAsync: 预设初始化异常', err);
    }
}
