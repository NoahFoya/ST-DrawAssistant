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
import type { DrawAssistantSettings } from './types';
/**
 * 官方规范：获取扩展设置对象引用（直接绑定宿主 extensionSettings[MODULE_NAME] 指针）
 *
 * 遵循 SillyTavern 官方规范 SKILL §2.2 & §7.1
 */
export declare function loadSettings(): DrawAssistantSettings;
/** 兼容导出 ensureExtensionSettings */
export declare const ensureExtensionSettings: typeof loadSettings;
export declare const getExtensionSettingsNode: () => Record<string, unknown>;
/**
 * 官方标准：将设置对象持久化并安全保存
 */
export declare function saveSettings(settings: DrawAssistantSettings): void;
/**
 * 官方标准：更新部分设置字段并保存
 */
export declare function updateSettings(patch: Partial<DrawAssistantSettings>): DrawAssistantSettings;
/**
 * 重置设置到默认值
 */
export declare function resetSettings(): DrawAssistantSettings;
/**
 * 导出当前完整设置的 JSON 字符串
 */
export declare function exportSettingsJson(): string;
/**
 * 导入设置 JSON 字符串并安全保存并更新应用配置
 */
export declare function importSettingsJson(jsonStr: string): boolean;
//# sourceMappingURL=manager.d.ts.map