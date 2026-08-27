/**
 * 设置管理器
 *
 * 负责从 SillyTavern extension_settings 读取、合并默认值、持久化设置。
 *
 * 生命周期：
 *   APP_READY → loadSettings() → 用户交互 → saveSettings() → 落盘
 *
 * 参考：.agents/Skills/sillytavern-extension-host/SKILL.md §7
 */

import { getContext } from '../core/context';
import { MODULE_NAME } from '../core/constants';
import { DEFAULT_SETTINGS } from './defaults';
import type { DrawAssistantSettings } from './types';

/**
 * 从 extension_settings 加载设置，与默认值合并后返回
 *
 * 合并策略：以持久化设置为优先，缺失字段由默认值补全。
 * 这确保扩展升级新增字段时，老用户不会因缺少字段而崩溃。
 *
 * ⚠️ 必须在 APP_READY 后调用（依赖 getContext()）
 *
 * @returns 合并后的完整设置对象
 */
export function loadSettings(): DrawAssistantSettings {
    const ctx = getContext();

    // 获取 extension_settings：
    //   优先使用 ctx.extension_settings（新版 ST getContext() 暂露）
    //   回退到 window.extension_settings（ST 全局变量，必须显式迺过 window）
    const win = window as unknown as Record<string, unknown>;
    const extSettings: Record<string, unknown> | undefined =
        (ctx.extension_settings as Record<string, unknown> | undefined) ??
        (win['extension_settings'] as Record<string, unknown> | undefined);

    if (!extSettings) {
        console.warn(`[${MODULE_NAME}] extension_settings not available, returning defaults`);
        return { ...DEFAULT_SETTINGS };
    }

    // 若此模块的设置命名空间不存在，初始化为空对象
    if (!extSettings[MODULE_NAME]) {
        extSettings[MODULE_NAME] = {};
    }

    const persisted = extSettings[MODULE_NAME] as Partial<DrawAssistantSettings>;

    // 将默认值与持久化设置合并（持久化设置优先）
    // workflowInjection 是嵌套对象，需要深合并
    const merged: DrawAssistantSettings = {
        ...DEFAULT_SETTINGS,
        ...persisted,
        workflowInjection: {
            ...DEFAULT_SETTINGS.workflowInjection,
            ...(persisted.workflowInjection ?? {}),
        },
    };

    // 将合并结果写回（确保新字段的默认值被持久化）
    extSettings[MODULE_NAME] = merged;

    return merged;
}




/**
 * 将设置对象写入 extension_settings 并触发防抖持久化
 *
 * @param settings 要持久化的完整设置对象
 *
 * @example
 * const settings = loadSettings();
 * settings.provider = 'webui';
 * saveSettings(settings);
 */
export function saveSettings(settings: DrawAssistantSettings): void {
    const ctx = getContext();
    ctx.extension_settings[MODULE_NAME] = settings;
    ctx.saveSettingsDebounced();
}

/**
 * 更新部分设置字段（便捷方法）
 *
 * @param patch 要更新的字段（Partial<DrawAssistantSettings>）
 * @returns 更新后的完整设置对象
 *
 * @example
 * updateSettings({ provider: 'comfyui', serverUrl: 'http://127.0.0.1:8188' });
 */
export function updateSettings(patch: Partial<DrawAssistantSettings>): DrawAssistantSettings {
    const current = loadSettings();
    const updated = { ...current, ...patch };
    saveSettings(updated);
    return updated;
}

/**
 * 重置设置为默认值
 *
 * @returns 默认设置对象
 */
export function resetSettings(): DrawAssistantSettings {
    saveSettings({ ...DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS };
}
