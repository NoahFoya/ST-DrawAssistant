/**
 * 默认静态预设文件运行时异步加载器 (StaticPresetLoader)。
 *
 * @remarks
 * 保持构建产物 `dist/index.js` 零内嵌预设与词库数据：
 * 1. 浏览器宿主环境（`http:` / `https:`）：基于扩展脚本自身 `import.meta.url` 解析 `../config/presets/*.json` 并通过 `fetch` 异步读取；
 * 2. Node 单元测试环境（`file:` 且未显式注入自定义 `fetcher`）：通过动态加载 `node:fs/promises` 读取本地静态 JSON 文件，不干扰业务侧对全局 `fetch` 的模拟桩；
 * 3. 返回深拷贝快照，防止调用方修改污染内存缓存。
 */

import type {
    PresetItem,
    PresetSettings,
    DrawingPresetData,
    PromptPresetData,
    WorkflowPresetData,
    ThemePresetData,
    CharacterPresetData,
    OutfitPresetData,
    MaterialActivationPresetData,
    MaterialExtractionPresetData,
    MaterialFormatPresetData,
    PromptChannelPresetData,
} from '@types';

/**
 * 默认静态预设加载异常。
 */
export class StaticPresetLoadError extends Error {
    public constructor(
        public readonly fileName: string,
        message: string,
        public readonly cause?: unknown
    ) {
        super(`[StaticPresetLoader] 静态预设文件 ${fileName} 加载失败: ${message}`);
        this.name = 'StaticPresetLoadError';
    }
}

/** 静态预设加载可选参数 */
export interface LoadStaticPresetsOptions {
    /** 自定义基准脚本 URL（缺省使用当前模块 import.meta.url） */
    readonly baseUrl?: string;
    /** 自定义 HTTP 请求函数（用于单元测试校验网络加载行为） */
    readonly fetcher?: typeof fetch;
    /** 是否跳过内存缓存强制重新读取 */
    readonly forceReload?: boolean;
}

interface PromptChannelsStaticFile {
    prompt_story?: PresetItem<PromptChannelPresetData>[];
    prompt_character?: PresetItem<PromptChannelPresetData>[];
    prompt_material?: PresetItem<PromptChannelPresetData>[];
}

interface NodeFsPromisesLike {
    readFile(path: URL, encoding: 'utf-8'): Promise<string>;
}

const STATIC_PRESET_FILES = {
    drawing: 'drawing.json',
    prompts: 'prompts.json',
    workflows: 'workflows.json',
    themes: 'themes.json',
    characters: 'characters.json',
    outfits: 'outfits.json',
    materialActivations: 'material-activations.json',
    materialExtractions: 'material-extractions.json',
    materialFormats: 'material-formats.json',
    promptChannels: 'prompt-channels.json',
    vocabGuidance: 'vocab-guidance.json',
} as const;

let cachedOfficialPresets: PresetSettings | null = null;

/**
 * 构建空的预设池结构。
 */
export function createEmptyPresetSettings(): PresetSettings {
    return {
        themes: [],
        prompts: {
            comfyui: [],
            sdwebui: [],
            novelai: [],
            openai: [],
        },
        workflows: [],
        drawing: {
            comfyui: [],
            sdwebui: [],
            novelai: [],
            openai: [],
        },
        characters: [],
        outfits: [],
        material_activations: [],
        material_extractions: [],
        material_formats: [],
        prompt_story: [],
        prompt_character: [],
        prompt_vocab: [],
        prompt_material: [],
    };
}

/**
 * 根据模块所在路径推导 `config/presets/` 的相对路径前缀。
 *
 * @remarks
 * 打包产物位于 `dist/index.js`（距根目录 1 层），源码测试位于 `src/store/*.ts`（距根目录 2 层）。
 */
export function resolveStaticPresetUrl(fileName: string, baseUrl?: string): URL {
    const anchorUrl = baseUrl || import.meta.url;
    const normalized = anchorUrl.replace(/\\/g, '/');
    const relativePrefix = /\/src\/store\/[^/]+$/i.test(normalized)
        ? '../../config/presets/'
        : '../config/presets/';
    return new URL(`${relativePrefix}${fileName}`, anchorUrl);
}

async function readSingleStaticJson<T>(
    fileName: string,
    options?: LoadStaticPresetsOptions
): Promise<T> {
    const targetUrl = resolveStaticPresetUrl(fileName, options?.baseUrl);
    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);

    if (!options?.fetcher && targetUrl.protocol === 'file:') {
        if (!isNode) {
            throw new StaticPresetLoadError(
                fileName,
                '浏览器环境中无法通过 file: 协议读取预设文件，请检查扩展加载环境'
            );
        }

        try {
            const nodeFsModuleId = 'node:fs/promises';
            const fsPromises = (await import(
                /* webpackIgnore: true */ nodeFsModuleId
            )) as unknown as NodeFsPromisesLike;
            const rawText = await fsPromises.readFile(targetUrl, 'utf-8');
            return JSON.parse(rawText) as T;
        } catch (err) {
            throw new StaticPresetLoadError(
                fileName,
                err instanceof Error ? err.message : String(err),
                err
            );
        }
    }

    const fetchFn = options?.fetcher ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        throw new StaticPresetLoadError(fileName, '当前环境缺少 fetch 实现');
    }

    let response: Response;
    try {
        response = await fetchFn(targetUrl.href, { cache: 'no-cache' });
    } catch (err) {
        throw new StaticPresetLoadError(
            fileName,
            `网络请求异常: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }

    if (!response.ok) {
        throw new StaticPresetLoadError(fileName, `HTTP ${response.status} ${response.statusText}`);
    }

    try {
        return (await response.json()) as T;
    } catch (err) {
        throw new StaticPresetLoadError(
            fileName,
            `JSON 解析异常: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }
}

/**
 * 异步加载 `config/presets/` 下的全套默认静态预设文件。
 */
export async function loadOfficialStaticPresets(
    options?: LoadStaticPresetsOptions
): Promise<PresetSettings> {
    const canUseCache = !options?.forceReload && !options?.fetcher && !options?.baseUrl;
    if (canUseCache && cachedOfficialPresets) {
        return structuredClone(cachedOfficialPresets);
    }

    const [
        drawingData,
        promptsData,
        workflowsData,
        themesData,
        charactersData,
        outfitsData,
        materialActivationsData,
        materialExtractionsData,
        materialFormatsData,
        promptChannelsData,
        vocabGuidanceData,
    ] = await Promise.all([
        readSingleStaticJson<Record<string, PresetItem<DrawingPresetData>[]>>(
            STATIC_PRESET_FILES.drawing,
            options
        ),
        readSingleStaticJson<Record<string, PresetItem<PromptPresetData>[]>>(
            STATIC_PRESET_FILES.prompts,
            options
        ),
        readSingleStaticJson<PresetItem<WorkflowPresetData>[]>(
            STATIC_PRESET_FILES.workflows,
            options
        ),
        readSingleStaticJson<PresetItem<ThemePresetData>[]>(
            STATIC_PRESET_FILES.themes,
            options
        ),
        readSingleStaticJson<PresetItem<CharacterPresetData>[]>(
            STATIC_PRESET_FILES.characters,
            options
        ),
        readSingleStaticJson<PresetItem<OutfitPresetData>[]>(
            STATIC_PRESET_FILES.outfits,
            options
        ),
        readSingleStaticJson<PresetItem<MaterialActivationPresetData>[]>(
            STATIC_PRESET_FILES.materialActivations,
            options
        ),
        readSingleStaticJson<PresetItem<MaterialExtractionPresetData>[]>(
            STATIC_PRESET_FILES.materialExtractions,
            options
        ),
        readSingleStaticJson<PresetItem<MaterialFormatPresetData>[]>(
            STATIC_PRESET_FILES.materialFormats,
            options
        ),
        readSingleStaticJson<PromptChannelsStaticFile>(
            STATIC_PRESET_FILES.promptChannels,
            options
        ),
        readSingleStaticJson<PresetItem<PromptChannelPresetData>[]>(
            STATIC_PRESET_FILES.vocabGuidance,
            options
        ),
    ]);

    const empty = createEmptyPresetSettings();

    const assembled: PresetSettings = {
        drawing: drawingData && typeof drawingData === 'object' ? drawingData : empty.drawing,
        prompts: promptsData && typeof promptsData === 'object' ? promptsData : empty.prompts,
        workflows: Array.isArray(workflowsData) ? workflowsData : [],
        themes: Array.isArray(themesData) ? themesData : [],
        characters: Array.isArray(charactersData) ? charactersData : [],
        outfits: Array.isArray(outfitsData) ? outfitsData : [],
        material_activations: Array.isArray(materialActivationsData) ? materialActivationsData : [],
        material_extractions: Array.isArray(materialExtractionsData) ? materialExtractionsData : [],
        material_formats: Array.isArray(materialFormatsData) ? materialFormatsData : [],
        prompt_story: Array.isArray(promptChannelsData?.prompt_story)
            ? promptChannelsData.prompt_story
            : [],
        prompt_character: Array.isArray(promptChannelsData?.prompt_character)
            ? promptChannelsData.prompt_character
            : [],
        prompt_vocab: Array.isArray(vocabGuidanceData) ? vocabGuidanceData : [],
        prompt_material: Array.isArray(promptChannelsData?.prompt_material)
            ? promptChannelsData.prompt_material
            : [],
    };

    if (canUseCache) {
        cachedOfficialPresets = structuredClone(assembled);
    }

    return structuredClone(assembled);
}
