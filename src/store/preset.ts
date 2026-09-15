/**
 * 预设模板方案管理
 *
 * 功能：
 * 1. 管理 workflows, prompts, themes, drawing 四大类预设方案；
 * 2. 保护出厂内置预设（只读保护，禁止非法覆盖或删除）；
 * 3. 支持自定义预设的增删改查、排序与持久化；
 * 4. 提供预设归档包的独立导入、导出、版本合并与出厂重置。
 *
 * Tips：
 * 1. 内置项隔离：出厂内置预设打上 isBuiltin: true 标记，UI 层面禁用删除与重命名；
 * 2. 导入校验：导入预设归档包时校验数据结构合法性，阻断异常脏数据。
 */

import type { PresetItem, PresetsArchiveData, PresetCategory, PromptPresetData } from '@types';
import { deepClone, isPlainObject } from '@util/object';
import { SettingsStore } from './settings';
import { normalizePromptPresetData } from './normalizer';

import workflowCheckpointStandard from '@config/presets/workflows/comfyui_checkpoint_standard.json';
import workflowSplitStandard from '@config/presets/workflows/comfyui_split_standard.json';
import workflowCheckpointWeilin from '@config/presets/workflows/comfyui_checkpoint_weilin.json';
import workflowSplitWeilin from '@config/presets/workflows/comfyui_split_weilin.json';

import builtinThemesJson from '@config/presets/themes.json';
import builtinPromptsJson from '@config/presets/prompts.json';
import builtinDrawingJson from '@config/presets/drawing.json';

/** 4 套原生 ComfyUI API 出厂内置工作流方案 */
export const BUILTIN_WORKFLOWS: PresetItem<{ json: string }>[] = [
    {
        id: 'comfyui_checkpoint_standard',
        name: '标准大模型工作流',
        isBuiltin: true,
        data: { json: JSON.stringify(workflowCheckpointStandard, null, 2) }
    },
    {
        id: 'comfyui_split_standard',
        name: '标准分立模型工作流',
        isBuiltin: true,
        data: { json: JSON.stringify(workflowSplitStandard, null, 2) }
    },
    {
        id: 'comfyui_checkpoint_weilin',
        name: 'WeiLin 大模型工作流',
        isBuiltin: true,
        data: { json: JSON.stringify(workflowCheckpointWeilin, null, 2) }
    },
    {
        id: 'comfyui_split_weilin',
        name: 'WeiLin 分立模型工作流',
        isBuiltin: true,
        data: { json: JSON.stringify(workflowSplitWeilin, null, 2) }
    }
];

export const BUILTIN_THEMES: PresetItem[] = builtinThemesJson as unknown as PresetItem[];
export const BUILTIN_PROMPTS: PresetItem<PromptPresetData>[] = (builtinPromptsJson as unknown as PresetItem<PromptPresetData>[]).map(item => ({
    ...item,
    data: item.data ? normalizePromptPresetData(item.data) : undefined
}));
export const BUILTIN_DRAWING: Record<string, PresetItem[]> = builtinDrawingJson as unknown as Record<string, PresetItem[]>;

/** 完整的出厂内置预设模板快照 */
export const BUILTIN_PRESETS: PresetsArchiveData = {
    themes: deepClone(BUILTIN_THEMES),
    prompts: deepClone(BUILTIN_PROMPTS),
    workflows: deepClone(BUILTIN_WORKFLOWS),
    drawing: deepClone(BUILTIN_DRAWING)
};

/**
 * 从本地磁盘重新拉取最新初始模板配置
 * 用户或整合包作者在本地磁盘修改静态模板 JSON 后，通过此函数重载最新文件；非浏览器或测试环境回退至静态快照。
 */
export async function reloadPresetsFromDisk(): Promise<PresetsArchiveData> {
    if (
        typeof window === 'undefined' ||
        typeof window.fetch !== 'function' ||
        (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')
    ) {
        return deepClone(BUILTIN_PRESETS);
    }

    const basePath = '/scripts/extensions/third-party/ST-DrawAssistant/config/presets';

    try {
        const fetchJson = async <T>(url: string): Promise<T | null> => {
            try {
                const res = await fetch(`${url}?_t=${Date.now()}`);
                if (res.ok) {
                    return (await res.json()) as T;
                }
            } catch {
                // 单文件拉取失败时返回 null 由后续逻辑回退
            }
            return null;
        };

        const [themes, prompts, drawing, wfCkptStd, wfSplitStd, wfCkptWl, wfSplitWl] = await Promise.all([
            fetchJson<PresetItem[]>(`${basePath}/themes.json`),
            fetchJson<PresetItem<PromptPresetData>[]>(`${basePath}/prompts.json`),
            fetchJson<Record<string, PresetItem[]>>(`${basePath}/drawing.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_checkpoint_standard.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_split_standard.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_checkpoint_weilin.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_split_weilin.json`)
        ]);

        const diskWorkflows: PresetItem<{ json: string }>[] = [];
        const pushWf = (id: string, name: string, dataObj: Record<string, unknown> | null, fallback: PresetItem<{ json: string }>) => {
            if (dataObj) {
                diskWorkflows.push({ id, name, isBuiltin: true, data: { json: JSON.stringify(dataObj, null, 2) } });
            } else {
                diskWorkflows.push(fallback);
            }
        };

        pushWf('comfyui_checkpoint_standard', '标准大模型工作流', wfCkptStd, BUILTIN_WORKFLOWS[0]);
        pushWf('comfyui_split_standard', '标准分立模型工作流', wfSplitStd, BUILTIN_WORKFLOWS[1]);
        pushWf('comfyui_checkpoint_weilin', 'WeiLin 大模型工作流', wfCkptWl, BUILTIN_WORKFLOWS[2]);
        pushWf('comfyui_split_weilin', 'WeiLin 分立模型工作流', wfSplitWl, BUILTIN_WORKFLOWS[3]);

        const normalizedPrompts = prompts
            ? prompts.map(item => ({ ...item, data: item.data ? normalizePromptPresetData(item.data) : undefined }))
            : undefined;

        return {
            themes: themes || deepClone(BUILTIN_THEMES),
            prompts: normalizedPrompts || deepClone(BUILTIN_PROMPTS),
            workflows: diskWorkflows,
            drawing: drawing || deepClone(BUILTIN_DRAWING)
        };
    } catch {
        return deepClone(BUILTIN_PRESETS);
    }
}

export class PresetManager {
    private readonly _store: SettingsStore;

    constructor(store: SettingsStore) {
        this._store = store;
    }

    /** 获取指定分类的出厂内置预设列表 */
    private _getBuiltinList(category: string, subCategory?: string): PresetItem[] {
        if (category === 'workflows') return BUILTIN_WORKFLOWS;
        if (category === 'themes') return BUILTIN_THEMES;
        if (category === 'prompts') return BUILTIN_PROMPTS;
        if (category === 'drawing' && subCategory) return BUILTIN_DRAWING[subCategory] || [];
        return [];
    }

    /**
     * 获取指定分类下的预设方案列表
     * 合并出厂内置模板与用户自定义预设。
     */
    public list<T = any>(category: PresetCategory | string, subCategory?: string): PresetItem<T>[] {
        const presets = (this._store.get('presets') || {}) as PresetsArchiveData;
        const builtinList = this._getBuiltinList(category, subCategory);

        let customList: PresetItem<T>[] = [];
        if (category === 'drawing' && subCategory) {
            customList = (presets.drawing?.[subCategory] || []) as PresetItem<T>[];
        } else if (category === 'themes') {
            customList = (presets.themes || []) as PresetItem<T>[];
        } else if (category === 'prompts') {
            customList = (presets.prompts || []) as PresetItem<T>[];
        } else if (category === 'workflows') {
            customList = (presets.workflows || []) as PresetItem<T>[];
        } else {
            customList = ((presets as Record<string, unknown>)[category] as PresetItem<T>[]) || [];
        }

        const result: PresetItem<T>[] = [];
        const seenIds = new Set<string>();

        // 优先加载出厂内置模板
        for (const item of builtinList) {
            result.push(deepClone(item) as PresetItem<T>);
            seenIds.add(item.id);
        }

        // 补充用户自定义模板
        for (const item of customList) {
            if (!seenIds.has(item.id)) {
                result.push(deepClone(item));
                seenIds.add(item.id);
            }
        }

        return result;
    }

    /**
     * 根据 ID 获取单个预设详情
     */
    public get<T = any>(category: string, id: string, subCategory?: string): PresetItem<T> | undefined {
        const list = this.list<T>(category, subCategory);
        return list.find(item => item.id === id);
    }

    /**
     * 保存或更新预设方案
     * 出厂内置预设受 isBuiltin 标识保护，写操作仅对自定义预设生效，避免内置模板被破坏。
     */
    public save<T = any>(
        category: PresetCategory | string,
        item: PresetItem<T>,
        subCategory?: string
    ): boolean {
        if (!item || !item.id) return false;

        // 内置预设只读保护：禁止破坏性覆写内置预设
        const builtinList = this._getBuiltinList(category, subCategory);
        const isBuiltinTarget = builtinList.some(b => b.id === item.id);
        if (isBuiltinTarget && !item.isBuiltin) {
            return false;
        }

        const presets: PresetsArchiveData = deepClone(this._store.get('presets') || {});
        let targetList: PresetItem<T>[];

        if (category === 'drawing' && subCategory) {
            if (!presets.drawing) presets.drawing = {};
            if (!Array.isArray(presets.drawing[subCategory])) {
                presets.drawing[subCategory] = [];
            }
            targetList = presets.drawing[subCategory] as PresetItem<T>[];
        } else if (category === 'themes') {
            if (!Array.isArray(presets.themes)) presets.themes = [];
            targetList = presets.themes as PresetItem<T>[];
        } else if (category === 'prompts') {
            if (!Array.isArray(presets.prompts)) presets.prompts = [];
            targetList = presets.prompts as PresetItem<T>[];
        } else if (category === 'workflows') {
            if (!Array.isArray(presets.workflows)) presets.workflows = [];
            targetList = presets.workflows as PresetItem<T>[];
        } else {
            const extPresets = presets as Record<string, unknown>;
            if (!Array.isArray(extPresets[category])) {
                extPresets[category] = [];
            }
            targetList = extPresets[category] as PresetItem<T>[];
        }

        let processedItem = item;
        if (category === 'prompts' && item.data) {
            processedItem = {
                ...item,
                data: normalizePromptPresetData(item.data) as unknown as T
            };
        }

        const existingIndex = targetList.findIndex(i => i.id === item.id);
        if (existingIndex >= 0) {
            targetList[existingIndex] = deepClone(processedItem);
        } else {
            targetList.push(deepClone(processedItem));
        }

        this._store.set('presets', presets);
        return true;
    }

    /**
     * 删除指定预设方案
     * 出厂内置预设由系统维护，不支持删除操作，仅允许重置或克隆自定义项。
     */
    public delete(category: PresetCategory | string, id: string, subCategory?: string): boolean {
        if (!id) return false;

        // 内置预设受保护，不支持删除
        const builtinList = this._getBuiltinList(category, subCategory);
        if (builtinList.some(b => b.id === id)) {
            return false;
        }

        const presets: PresetsArchiveData = deepClone(this._store.get('presets') || {});
        let targetList: PresetItem[] | undefined;

        if (category === 'drawing' && subCategory) {
            targetList = presets.drawing?.[subCategory];
        } else if (category === 'themes') {
            targetList = presets.themes;
        } else if (category === 'prompts') {
            targetList = presets.prompts;
        } else if (category === 'workflows') {
            targetList = presets.workflows;
        } else {
            targetList = (presets as Record<string, unknown>)[category] as PresetItem[] | undefined;
        }

        if (!Array.isArray(targetList)) return false;
        const existing = targetList.find(i => i.id === id);
        if (!existing) return false;

        const filtered = targetList.filter(i => i.id !== id);
        if (category === 'drawing' && subCategory) {
            if (presets.drawing) presets.drawing[subCategory] = filtered;
        } else if (category === 'themes') {
            presets.themes = filtered;
        } else if (category === 'prompts') {
            presets.prompts = filtered as PresetItem<PromptPresetData>[];
        } else if (category === 'workflows') {
            presets.workflows = filtered as PresetItem<{ json: string }>[];
        } else {
            (presets as Record<string, unknown>)[category] = filtered;
        }

        this._store.set('presets', presets);
        return true;
    }

    /**
     * 重置指定分类为出厂快照状态
     */
    public resetCategory(category: PresetCategory | string, subCategory?: string): void {
        const presets: PresetsArchiveData = deepClone(this._store.get('presets') || {});

        if (category === 'drawing' && subCategory) {
            if (!presets.drawing) presets.drawing = {};
            presets.drawing[subCategory] = deepClone(BUILTIN_DRAWING[subCategory] || []);
        } else if (category === 'workflows') {
            presets.workflows = deepClone(BUILTIN_WORKFLOWS);
        } else if (category === 'themes') {
            presets.themes = deepClone(BUILTIN_THEMES);
        } else if (category === 'prompts') {
            presets.prompts = deepClone(BUILTIN_PROMPTS);
        }

        this._store.set('presets', presets);
    }

    /**
     * 恢复全量出厂预设
     */
    public resetDefaults(sourceData?: PresetsArchiveData): void {
        const source = sourceData ? deepClone(sourceData) : deepClone(BUILTIN_PRESETS);
        this._store.set('presets', source);
    }

    /**
     * 导出全量预设方案为归档对象
     */
    public exportArchive(): PresetsArchiveData {
        return {
            themes: this.list('themes'),
            prompts: this.list('prompts'),
            workflows: this.list('workflows'),
            drawing: {
                comfyui: this.list('drawing', 'comfyui'),
                sdwebui: this.list('drawing', 'sdwebui'),
                novelai: this.list('drawing', 'novelai'),
                openai: this.list('drawing', 'openai')
            }
        };
    }

    /**
     * 批量导入预设归档包并合并入配置
     */
    public importArchive(
        archive: PresetsArchiveData
    ): { success: boolean; importedCount: number; error?: string } {
        if (!isPlainObject(archive)) {
            return { success: false, importedCount: 0, error: '预设归档数据格式非法' };
        }

        let count = 0;

        const mergeList = (category: string, incoming: PresetItem[] | undefined, subCat?: string) => {
            if (!Array.isArray(incoming)) return;
            for (const item of incoming) {
                if (!item || !item.id || !item.name) continue;
                // 自定义导入不标记为内置
                const cleanItem = { ...item, isBuiltin: false };
                this.save(category, cleanItem, subCat);
                count++;
            }
        };

        if (Array.isArray(archive.themes)) mergeList('themes', archive.themes);
        if (Array.isArray(archive.prompts)) mergeList('prompts', archive.prompts);
        if (Array.isArray(archive.workflows)) mergeList('workflows', archive.workflows);
        if (isPlainObject(archive.drawing)) {
            for (const [engine, list] of Object.entries(archive.drawing)) {
                if (Array.isArray(list)) {
                    mergeList('drawing', list, engine);
                }
            }
        }

        return { success: true, importedCount: count };
    }
}
