/**
 * @module settings/manager
 * @description 设置管理器 (Settings Manager)
 *
 * 职责：
 * - 绑定 `extension_settings[MODULE_NAME]` 宿主全局配置节点
 * - 确保设置修改后直接更新宿主反序列化对象
 * - 调用宿主 `saveSettingsDebounced()` 将配置自动保存至服务器
 *
 * 规范参考：
 * - .agents/Skills/sillytavern-extension-host/SKILL.md §7 (extension_settings 持久化规范)
 */


import { getContext } from '../core/context';
import { MODULE_NAME } from '../core/constants';
import { DEFAULT_SETTINGS } from './defaults';
import { logger } from '../core/logger';
import type { DrawAssistantSettings } from './types';

/**
 * 官方规范：获取扩展设置对象引用（直接绑定宿主 extensionSettings[MODULE_NAME] 指针）
 *
 * 遵循 SillyTavern 官方规范 SKILL §2.2 & §7.1
 */
export function loadSettings(): DrawAssistantSettings {
    const ctx = getContext();

    // 1. 严格校验宿主 extensionSettings 节点
    if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') {
        throw new Error('[ST-DrawAssistant] 宿主契约破坏：getContext().extensionSettings 为空或无效');
    }

    // 2. 绑定官方唯一命名空间节点
    if (!ctx.extensionSettings[MODULE_NAME] || typeof ctx.extensionSettings[MODULE_NAME] !== 'object') {
        ctx.extensionSettings[MODULE_NAME] = {};
    }

    const settingsNode = ctx.extensionSettings[MODULE_NAME] as Record<string, unknown>;

    // 3. 官方规范：深拷贝补全缺省属性（保持对象指针不变）
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
        globalProfiles: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.globalProfiles) || [],
        comfyModelProfiles: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.comfyModelProfiles) || [],
        comfyPromptProfiles: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.comfyPromptProfiles) || [],
        comfyWorkflows: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.comfyWorkflows) || [],
        customThemes: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.customThemes) || [],
    };

    for (const [arrKey, defaultArr] of Object.entries(arrayProfileDefaults)) {
        if (!Array.isArray(settingsNode[arrKey])) {
            settingsNode[arrKey] = JSON.parse(JSON.stringify(defaultArr));
            needsSave = true;
        }
    }

    // 4. 首次运行或缺省字段补全时自动调用官方 API 保存
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

/** 兼容导出 ensureExtensionSettings */
export const ensureExtensionSettings = loadSettings;
export const getExtensionSettingsNode = loadSettings as unknown as () => Record<string, unknown>;

/**
 * 触发宿主保存配置 API 并发送全屏设置变更通知
 */
function triggerSaveAndNotify(): void {
    const ctx = getContext();
    if (typeof ctx.saveSettingsDebounced !== 'function') {
        throw new Error('[ST-DrawAssistant] 宿主 API 契约破坏：saveSettingsDebounced 未就绪，无法保存配置');
    }

    ctx.saveSettingsDebounced();

    // 广播设置更新事件
    if (ctx.eventSource && typeof ctx.eventSource.emit === 'function') {
        ctx.eventSource.emit('EXTENSION_SETTINGS_UPDATED', { moduleName: MODULE_NAME });
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
 * 官方标准：更新部分设置字段并保存
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
 */
export function resetSettings(): DrawAssistantSettings {
    const node = loadSettings();
    const nodeRecord = node as unknown as Record<string, unknown>;
    Object.keys(nodeRecord).forEach(key => delete nodeRecord[key]);

    const defaultCopy = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>;
    Object.assign(nodeRecord, defaultCopy);

    logger.warn('配置已重置为默认值 (resetSettings)');
    saveSettings(node);
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

