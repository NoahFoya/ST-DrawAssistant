/**
 * @module settings/manager
 * @description 设置管理器 (Settings Manager)
 *
 * 职责：
 * - 绑定 `extension_settings[MODULE_NAME]` 宿主全局配置节点
 * - 确保设置修改后直接更新宿主反序列化对象
 * - 调用宿主 `saveSettingsDebounced()` 将配置自动保存至服务器
 * - 提供基于 PRESET_REGISTRY 的通用预设 CRUD 服务（ProfileService）
 *
 * extension_settings 持久化约束：
 * SillyTavern 规范要求扩展不得直接执行部分写，必须将所有设置
 * 写入 extensionSettings[MODULE_NAME] 对象，由宿主统一序列化和持久化。
 * 设置修改后必须调用 saveSettingsDebounced() 触发实际保存，
 * 直接修改 extensionSettings 对象属性不会自动持久化。
 */

import { getContext } from '../core/context';
import { MODULE_NAME } from '../core/constants';
import {
    DEFAULT_SETTINGS,
    DEFAULT_TXT2IMG_WORKFLOW_PROFILES,
    DEFAULT_INPAINT_WORKFLOW_PROFILES,
    mergeBuiltInPresets,
} from './defaults';
import type { BuiltInPresetBundle } from './defaults';
import type {
    PresetProfileItem,
    DrawAssistantSettings,
} from './types';
import { logger } from '../core/logger';
import { PRESET_REGISTRY } from './preset-registry';
import type { RegistryCategory } from './preset-registry';

// 重新导出供外部模块使用
export type { RegistryCategory };
export type ProfileCategory = RegistryCategory | 'character' | 'outfit' | 'enable-scheme';

// ─── 基础设置 CRUD ─────────────────────────────────────────────────────────────

/**
 * 获取扩展配置对象
 *
 * 直接读取并绑定宿主 extensionSettings 节点，若缺失字段会自动使用默认配置补全并防抖保存。
 *
 * @returns 完整的扩展设置对象
 */
export function loadSettings(): DrawAssistantSettings {
    let ctx;
    try {
        ctx = getContext();
    } catch {
        return { ...DEFAULT_SETTINGS };
    }

    if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') {
        return { ...DEFAULT_SETTINGS };
    }

    if (!ctx.extensionSettings[MODULE_NAME] || typeof ctx.extensionSettings[MODULE_NAME] !== 'object') {
        ctx.extensionSettings[MODULE_NAME] = {};
    }

    const settingsNode = ctx.extensionSettings[MODULE_NAME] as Record<string, unknown>;

    // 检查并使用默认配置补全缺失字段（保持对象引用不变）
    let needsSave = false;
    for (const [key, defaultVal] of Object.entries(DEFAULT_SETTINGS)) {
        if (settingsNode[key] === undefined && defaultVal !== undefined) {
            if (typeof defaultVal === 'object' && defaultVal !== null) {
                settingsNode[key] = JSON.parse(JSON.stringify(defaultVal));
            } else {
                settingsNode[key] = defaultVal;
            }
            needsSave = true;
        }
    }

    // 嵌套与数组防护补全
    if (!settingsNode['workflowInjection'] || typeof settingsNode['workflowInjection'] !== 'object') {
        if (DEFAULT_SETTINGS && DEFAULT_SETTINGS.workflowInjection) {
            settingsNode['workflowInjection'] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.workflowInjection));
            needsSave = true;
        }
    }

    const arrayProfileDefaults: Record<string, unknown[]> = {
        comfyModelProfiles:    (DEFAULT_SETTINGS && DEFAULT_SETTINGS.comfyModelProfiles)    || [],
        comfyPromptProfiles:   (DEFAULT_SETTINGS && DEFAULT_SETTINGS.comfyPromptProfiles)   || [],
        comfyTxt2ImgWorkflows: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.comfyTxt2ImgWorkflows) || [],
        comfyInpaintWorkflows: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.comfyInpaintWorkflows) || [],
        customThemes:          (DEFAULT_SETTINGS && DEFAULT_SETTINGS.customThemes)          || [],
    };

    // 存量数据平滑迁移 1: 若存在旧键 comfyWorkflowProfileId，自动迁移赋值至 comfyTxt2ImgWorkflowId
    if (settingsNode['comfyWorkflowProfileId']) {
        if (!settingsNode['comfyTxt2ImgWorkflowId']) {
            settingsNode['comfyTxt2ImgWorkflowId'] = settingsNode['comfyWorkflowProfileId'];
        }
        delete settingsNode['comfyWorkflowProfileId'];
        needsSave = true;
    }

    // 存量数据平滑迁移 2: 若存在旧版 comfyWorkflows 数组，自动向后分类迁移写入新字段并安全移除旧键
    if (Array.isArray(settingsNode['comfyWorkflows'])) {
        const legacy = settingsNode['comfyWorkflows'] as PresetProfileItem<{ json?: string }>[];
        if (legacy.length > 0) {
            const txt2imgItems = legacy.filter(w => !w.id?.includes('inpaint') && !w.name?.includes('重绘'));
            const inpaintItems = legacy.filter(w => w.id?.includes('inpaint') || w.name?.includes('重绘'));
            if (txt2imgItems.length > 0 && (!Array.isArray(settingsNode['comfyTxt2ImgWorkflows']) || (settingsNode['comfyTxt2ImgWorkflows'] as any[]).length === 0)) {
                settingsNode['comfyTxt2ImgWorkflows'] = JSON.parse(JSON.stringify(txt2imgItems));
            }
            if (inpaintItems.length > 0 && (!Array.isArray(settingsNode['comfyInpaintWorkflows']) || (settingsNode['comfyInpaintWorkflows'] as any[]).length === 0)) {
                settingsNode['comfyInpaintWorkflows'] = JSON.parse(JSON.stringify(inpaintItems));
            }
        }
        delete settingsNode['comfyWorkflows'];
        needsSave = true;
    }

    for (const [arrKey, defaultArr] of Object.entries(arrayProfileDefaults)) {
        if (!Array.isArray(settingsNode[arrKey])) {
            settingsNode[arrKey] = JSON.parse(JSON.stringify(defaultArr));
            needsSave = true;
        }
    }

    // 首次运行或缺省字段补全时自动调用官方 API 保存
    if (needsSave) {
        if (typeof ctx.saveSettingsDebounced !== 'function') {
            throw new Error('[ST-DrawAssistant] 宿主 API 契约破坏：saveSettingsDebounced 未就绪');
        }
        ctx.saveSettingsDebounced();
    }

    const settings = settingsNode as unknown as DrawAssistantSettings;
    if (settings.logLevel && logger.getLogLevel() !== settings.logLevel) {
        logger.setLogLevel(settings.logLevel);
    }

    return settings;
}

/**
 * 触发宿主保存配置 API 并发送全屏设置变更通知
 */
function triggerSaveAndNotify(): void {
    const ctx = getContext();
    if (typeof ctx.saveSettingsDebounced !== 'function') {
        throw new Error('[ST-DrawAssistant] 宿主 API 契约破坏：saveSettingsDebounced 未就绪，无法保存配置');
    }

    ctx.saveSettingsDebounced();

    // 广播插件专属设置更新事件，解耦内部修改与宿主全局同步回路
    if (ctx.eventSource && typeof ctx.eventSource.emit === 'function') {
        ctx.eventSource.emit('ST_DRAW_ASSISTANT_SETTINGS_CHANGED', { moduleName: MODULE_NAME });
    }
}

/**
 * 官方标准：将设置对象持久化并安全保存
 */
export function saveSettings(settings: DrawAssistantSettings): void {
    const node = loadSettings();
    Object.assign(node, settings);
    logger.info('全量配置保存 (saveSettings)', { totalFields: Object.keys(settings).length });
    triggerSaveAndNotify();
}

/**
 * 底层配置字段更新与磁盘持久化函数
 *
 * 合并增量修改至宿主配置对象并保存；UI 组件应用层推荐使用 state/app-store 中的 patchSettings。
 *
 * @param patch 包含增量修改字段的对象
 * @returns 更新后的宿主配置对象
 */
export function updateSettings(patch: Partial<DrawAssistantSettings>): DrawAssistantSettings {
    const node = loadSettings();

    if (patch.workflowInjection) {
        patch.workflowInjection = {
            ...node.workflowInjection,
            ...patch.workflowInjection,
        };
    }

    // 直接更新宿主真实节点
    Object.assign(node, patch);
    logger.info('配置更新 (updateSettings)', { updatedFields: Object.keys(patch), patch });

    // 触发宿主保存 API 与广播
    triggerSaveAndNotify();

    return node;
}

/**
 * 重置设置到默认值
 *
 * 使用 mergeBuiltInPresets('reset') 替换所有 isBuiltIn=true 的旧预设为模块级最新数据，
 * 同时保留用户自定义预设。workflowJson/inpaintWorkflowJson 也同步重置为首个工作流的 JSON。
 */
export function resetSettings(): DrawAssistantSettings {
    const node = loadSettings();
    const nodeRecord = node as unknown as Record<string, unknown>;
    Object.keys(nodeRecord).forEach(key => delete nodeRecord[key]);

    // 应用基础默认值（不含预设数组，避免用旧快照覆盖）
    const defaultCopy = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>;
    // 清空数组字段，由 mergeBuiltInPresets 负责填充
    defaultCopy.customThemes = [];
    defaultCopy.comfyModelProfiles = [];
    defaultCopy.comfyPromptProfiles = [];
    defaultCopy.comfyTxt2ImgWorkflows = [];
    defaultCopy.comfyInpaintWorkflows = [];
    Object.assign(nodeRecord, defaultCopy);

    // 用模块级最新数组以 reset 模式融合写入（替换内置预设，保留用户自定义）
    const bundle: BuiltInPresetBundle = {
        themes:           [...PRESET_REGISTRY.theme.getBuiltIns()],
        models:           [...PRESET_REGISTRY.model.getBuiltIns()],
        prompts:          [...PRESET_REGISTRY.prompt.getBuiltIns()],
        txt2imgWorkflows: [...PRESET_REGISTRY.workflow.getBuiltIns()],
        inpaintWorkflows: [...PRESET_REGISTRY.inpaint.getBuiltIns()],
    };
    mergeBuiltInPresets(nodeRecord, bundle, 'reset');

    // 同步重置 workflowJson / inpaintWorkflowJson 为首个工作流配置文件中的 JSON
    nodeRecord['workflowJson'] = DEFAULT_TXT2IMG_WORKFLOW_PROFILES[0]?.data?.json ?? '';
    nodeRecord['inpaintWorkflowJson'] = DEFAULT_INPAINT_WORKFLOW_PROFILES[0]?.data?.json ?? '';

    logger.warn('配置已全量重置为最新默认物理预设树 (resetSettings)');
    triggerSaveAndNotify();
    return node;
}

/**
 * 导出当前完整设置的 JSON 字符串
 */
export function exportSettingsJson(): string {
    const settings = loadSettings();
    logger.info('配置导出 JSON 成功');
    return JSON.stringify(settings, null, 2);
}

/**
 * 导入设置 JSON 字符串并安全保存并更新应用配置
 */
export function importSettingsJson(jsonStr: string): boolean {
    try {
        const parsed = JSON.parse(jsonStr) as Partial<DrawAssistantSettings>;
        if (typeof parsed !== 'object' || parsed === null) {
            logger.warn('导入设置 JSON 格式非法: 解析结果非对象');
            return false;
        }
        updateSettings(parsed);
        logger.info('配置 JSON 导入成功', { fields: Object.keys(parsed) });
        return true;
    } catch (err) {
        logger.error('导入设置 JSON 失败', err);
        return false;
    }
}

// ─── 通用预设工具函数（基于 PRESET_REGISTRY）────────────────────────────────────

/**
 * 获取生效的预设列表
 *
 * 若 settings 中对应数组为空，回退至内置默认预设（内存临时，不写盘）。
 *
 * @param category 预设类别键
 * @returns 生效的预设数组
 */
export function getEffectiveList<T = Record<string, unknown>>(
    category: RegistryCategory
): PresetProfileItem<T>[] {
    const def = PRESET_REGISTRY[category];
    const settings = loadSettings();
    const list = settings[def.listKey] as PresetProfileItem<T>[] | undefined;
    return list && list.length > 0 ? list : def.getBuiltIns() as PresetProfileItem<T>[];
}

/**
 * 将选中的预设数据展平应用至 settings 根字段（一次 patchSettings，无双重触发）
 *
 * @param category 预设类别键
 * @param id 要应用的预设 ID
 */
export function applyProfileData(category: RegistryCategory, id: string): void {
    const def = PRESET_REGISTRY[category];
    const list = getEffectiveList(category);
    const item = list.find(p => p.id === id) ?? list[0];
    if (!item) return;

    // 合并活跃 ID + 数据展开，一次 patch 完成
    const activeIdPatch: Partial<DrawAssistantSettings> = { [def.activeIdKey]: item.id } as Partial<DrawAssistantSettings>;
    const dataPatch = def.applyToSettings(item.data as any);
    updateSettings({ ...activeIdPatch, ...dataPatch });
}

/**
 * 将指定类别的预设列表重置为内置默认，并应用第一个预设的数据
 *
 * @param category 预设类别键
 */
export function resetCategoryToDefault(category: RegistryCategory): void {
    const def = PRESET_REGISTRY[category];
    const builtIns: PresetProfileItem<any>[] = JSON.parse(JSON.stringify(def.getBuiltIns()));
    const firstItem = builtIns[0];
    const activeIdPatch: Partial<DrawAssistantSettings> = {
        [def.listKey]: builtIns,
        [def.activeIdKey]: firstItem?.id ?? '',
    } as Partial<DrawAssistantSettings>;
    const dataPatch = firstItem ? def.applyToSettings(firstItem.data) : {};
    updateSettings({ ...activeIdPatch, ...dataPatch });
    logger.info(`预设类别 [${category}] 已重置为初始默认预设`);
}



// ─── 预设方案服务 (ProfileService) ────────────────────────────────────────────

/**
 * 预设方案高层 CRUD 门面服务 (ProfileService)
 *
 * 完全基于 PRESET_REGISTRY 驱动，消除所有 if/else 分支。
 * 所有 settings 节点内的 5 类预设（model/prompt/workflow/inpaint/theme）统一走此路径。
 */
export class ProfileService {
    /**
     * 新建指定类别的预设方案
     *
     * @param category 预设类别键
     * @param name 方案名称（调用方提前确认非空）
     * @param data 初始数据（当前表单值快照）
     * @returns 新建预设的 ID
     */
    static createProfile<T = Record<string, unknown>>(
        category: RegistryCategory,
        name: string,
        data: T
    ): string {
        const def = PRESET_REGISTRY[category];
        const settings = loadSettings();
        const trimmedName = name.trim();
        const newId = `${category}_${Date.now()}`;
        const list = [...((settings[def.listKey] as PresetProfileItem<T>[] | undefined) ?? [])];
        list.push({ id: newId, name: trimmedName, data });
        updateSettings({
            [def.listKey]: list,
            [def.activeIdKey]: newId,
        } as Partial<DrawAssistantSettings>);
        logger.info(`新建预设 [${category}] ID=${newId} name="${trimmedName}"`);
        return newId;
    }

    /**
     * 覆盖保存当前数据至指定预设（更新 data 字段，不改名）
     *
     * @param category 预设类别键
     * @param id 要保存的预设 ID
     * @param data 新数据
     * @returns 是否找到并成功保存
     */
    static saveProfile<T = Record<string, unknown>>(
        category: RegistryCategory,
        id: string,
        data: T
    ): boolean {
        const def = PRESET_REGISTRY[category];
        const settings = loadSettings();
        const list = [...((settings[def.listKey] as PresetProfileItem<T>[] | undefined) ?? [])];
        const idx = list.findIndex(p => p.id === id);
        if (idx < 0) {
            logger.warn(`saveProfile: 预设 [${category}] ID=${id} 不存在`);
            return false;
        }
        list[idx] = { ...list[idx], data };
        updateSettings({ [def.listKey]: list } as Partial<DrawAssistantSettings>);
        return true;
    }

    /**
     * 重命名指定预设方案
     *
     * @returns 是否成功（找不到 ID 时返回 false，不创建幽灵条目）
     */
    static renameProfile(category: RegistryCategory, id: string, newName: string): boolean {
        const def = PRESET_REGISTRY[category];
        const settings = loadSettings();
        const list = [...((settings[def.listKey] as PresetProfileItem<any>[] | undefined) ?? [])];
        const idx = list.findIndex(p => p.id === id);
        if (idx < 0) {
            logger.warn(`renameProfile: 预设 [${category}] ID=${id} 不存在`);
            return false;
        }
        list[idx] = { ...list[idx], name: newName.trim() };
        updateSettings({ [def.listKey]: list } as Partial<DrawAssistantSettings>);
        return true;
    }

    /**
     * 删除指定预设方案
     *
     * @returns 删除后回退选中的 fallback 预设 ID
     */
    static deleteProfile(category: RegistryCategory, id: string): string {
        const def = PRESET_REGISTRY[category];
        const settings = loadSettings();
        const list = ((settings[def.listKey] as PresetProfileItem<any>[] | undefined) ?? [])
            .filter(p => p.id !== id);
        const fallbackId = list[0]?.id ?? def.getBuiltIns()[0]?.id ?? '';
        updateSettings({
            [def.listKey]: list,
            [def.activeIdKey]: fallbackId,
        } as Partial<DrawAssistantSettings>);
        logger.info(`删除预设 [${category}] ID=${id}，回退至 fallback=${fallbackId}`);
        return fallbackId;
    }

    /**
     * 导入 JSON 文件为新预设方案
     * 含 Schema 校验、数据规范化、自动追加并设为活跃
     *
     * @returns 新建预设 ID（成功），或 null（失败，reason 字段含说明）
     */
    static importProfile(
        category: RegistryCategory,
        content: string,
        fileName: string
    ): string | null {
        const def = PRESET_REGISTRY[category];
        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            logger.warn('importProfile: JSON 语法错误');
            return null;
        }

        const check = def.validateImport(parsed);
        if (!check.valid) {
            logger.warn(`importProfile: 校验失败 - ${check.reason}`);
            return null;
        }

        const defAny = def as unknown as import('./preset-registry').PresetCategoryDef<unknown>;
        const data = defAny.normalizeImport
            ? defAny.normalizeImport(parsed, content)
            : parsed as Record<string, unknown>;

        const profileName = fileName.replace(/\.json$/i, '');
        const newId = ProfileService.createProfile(category, profileName, data);
        return newId;
    }

    /**
     * 导出预设方案为 JSON 文件并触发浏览器下载
     *
     * @param category 预设类别键
     * @param id 要导出的预设 ID
     * @param getData 获取导出数据的闭包（通常是当前表单数据）
     */
    static exportProfileJSON(
        category: RegistryCategory,
        id: string,
        getData: () => unknown
    ): void {
        const data = getData();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st-da-${category}-${id}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// ─── 兼容性重置函数（保持向后兼容）──────────────────────────────────────────────

/** @deprecated 使用 resetCategoryToDefault('model') 代替 */
export function resetModelProfilesToDefault(): DrawAssistantSettings {
    resetCategoryToDefault('model');
    return loadSettings();
}

/** @deprecated 使用 resetCategoryToDefault('prompt') 代替 */
export function resetPromptProfilesToDefault(): DrawAssistantSettings {
    resetCategoryToDefault('prompt');
    return loadSettings();
}

/** @deprecated 使用 resetCategoryToDefault('workflow') + resetCategoryToDefault('inpaint') 代替 */
export function resetWorkflowProfilesToDefault(): DrawAssistantSettings {
    resetCategoryToDefault('workflow');
    resetCategoryToDefault('inpaint');
    return loadSettings();
}
