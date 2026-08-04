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
export declare function loadSettings(): DrawAssistantSettings;
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
export declare function saveSettings(settings: DrawAssistantSettings): void;
/**
 * 更新部分设置字段（便捷方法）
 *
 * @param patch 要更新的字段（Partial<DrawAssistantSettings>）
 * @returns 更新后的完整设置对象
 *
 * @example
 * updateSettings({ provider: 'comfyui', serverUrl: 'http://127.0.0.1:8188' });
 */
export declare function updateSettings(patch: Partial<DrawAssistantSettings>): DrawAssistantSettings;
/**
 * 重置设置为默认值
 *
 * @returns 默认设置对象
 */
export declare function resetSettings(): DrawAssistantSettings;
//# sourceMappingURL=manager.d.ts.map