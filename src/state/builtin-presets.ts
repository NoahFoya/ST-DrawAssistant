/**
 * 出厂初始模板配置聚合管理 (Builtin Presets)
 * 从 config/presets/ 静态装配初始预设快照（编译期保底），
 * 并提供 reloadPresetsFromDisk() 在用户重置时重新拉取本地磁盘修改后的初始模板。
 */

import { PresetsArchiveData, PresetItem } from '../types';
import { Logger } from '../utils/logger';

import workflowCheckpointStandard from '../../config/presets/workflows/comfyui_checkpoint_standard.json';
import workflowSplitStandard from '../../config/presets/workflows/comfyui_split_standard.json';
import workflowCheckpointWeilin from '../../config/presets/workflows/comfyui_checkpoint_weilin.json';
import workflowSplitWeilin from '../../config/presets/workflows/comfyui_split_weilin.json';

import builtinThemesJson from '../../config/presets/themes.json';
import builtinPromptsJson from '../../config/presets/prompts.json';
import builtinDrawingJson from '../../config/presets/drawing.json';

const logger = new Logger('BuiltinPresets');

/** 4 套原生 ComfyUI API 初始工作流方案 */
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

export const BUILTIN_PRESET_THEMES: PresetItem[] = builtinThemesJson as unknown as PresetItem[];
export const BUILTIN_PROMPTS: PresetItem[] = builtinPromptsJson as unknown as PresetItem[];
export const BUILTIN_DRAWING: Record<string, PresetItem[]> = builtinDrawingJson as unknown as Record<string, PresetItem[]>;

/** 完整的静态出厂初始模板聚合对象 (编译期保底) */
export const BUILTIN_PRESETS: PresetsArchiveData = {
    themes: BUILTIN_PRESET_THEMES,
    prompts: BUILTIN_PROMPTS,
    workflows: BUILTIN_WORKFLOWS as unknown as PresetItem[],
    drawing: BUILTIN_DRAWING
};

/**
 * 从本地磁盘重新载入初始模板配置
 * 在浏览器环境下优先通过 fetch 读取 /scripts/extensions/third-party/ST-DrawAssistant/config/presets/，
 * 保证用户/整合包作者在本地磁盘修改了模板 JSON 后，点击“重置出厂设置”能立即载入最新模板；
 * 若处于离线或单测等无宿主 HTTP 服务环境，则优雅回退至静态编译期快照。
 */
export async function reloadPresetsFromDisk(): Promise<PresetsArchiveData> {
    if (
        typeof window === 'undefined' ||
        typeof window.fetch !== 'function' ||
        (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')
    ) {
        return JSON.parse(JSON.stringify(BUILTIN_PRESETS));
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
                // 忽略单个文件拉取失败，交由保底逻辑补齐
            }
            return null;
        };

        const [themes, prompts, drawing, wfCkptStd, wfSplitStd, wfCkptWl, wfSplitWl] = await Promise.all([
            fetchJson<PresetItem[]>(`${basePath}/themes.json`),
            fetchJson<PresetItem[]>(`${basePath}/prompts.json`),
            fetchJson<Record<string, PresetItem[]>>(`${basePath}/drawing.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_checkpoint_standard.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_split_standard.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_checkpoint_weilin.json`),
            fetchJson<Record<string, unknown>>(`${basePath}/workflows/comfyui_split_weilin.json`)
        ]);

        const reloadedWorkflows: PresetItem<{ json: string }>[] = [
            {
                id: 'comfyui_checkpoint_standard',
                name: '标准大模型工作流',
                isBuiltin: true,
                data: {
                    json: JSON.stringify(wfCkptStd || workflowCheckpointStandard, null, 2)
                }
            },
            {
                id: 'comfyui_split_standard',
                name: '标准分立模型工作流',
                isBuiltin: true,
                data: {
                    json: JSON.stringify(wfSplitStd || workflowSplitStandard, null, 2)
                }
            },
            {
                id: 'comfyui_checkpoint_weilin',
                name: 'WeiLin 大模型工作流',
                isBuiltin: true,
                data: {
                    json: JSON.stringify(wfCkptWl || workflowCheckpointWeilin, null, 2)
                }
            },
            {
                id: 'comfyui_split_weilin',
                name: 'WeiLin 分立模型工作流',
                isBuiltin: true,
                data: {
                    json: JSON.stringify(wfSplitWl || workflowSplitWeilin, null, 2)
                }
            }
        ];

        logger.info('成功从本地磁盘重载最新初始模板配置');
        return {
            themes: themes || BUILTIN_PRESET_THEMES,
            prompts: prompts || BUILTIN_PROMPTS,
            workflows: reloadedWorkflows as unknown as PresetItem[],
            drawing: drawing || BUILTIN_DRAWING
        };
    } catch (err) {
        logger.warn('从磁盘重载初始预设失败，使用编译期保底模板:', err);
        return JSON.parse(JSON.stringify(BUILTIN_PRESETS));
    }
}
