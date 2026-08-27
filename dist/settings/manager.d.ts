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
import type { PresetProfileItem, DrawAssistantSettings } from './types';
import type { RegistryCategory } from './preset-registry';
export type { RegistryCategory };
export type ProfileCategory = RegistryCategory | 'character' | 'outfit' | 'enable-scheme';
/**
 * 获取扩展配置对象
 *
 * 直接读取并绑定宿主 extensionSettings 节点，若缺失字段会自动使用默认配置补全并防抖保存。
 *
 * @returns 完整的扩展设置对象
 */
export declare function loadSettings(): DrawAssistantSettings;
/**
 * 官方标准：将设置对象持久化并安全保存
 */
export declare function saveSettings(settings: DrawAssistantSettings): void;
/**
 * 底层配置字段更新与磁盘持久化函数
 *
 * 合并增量修改至宿主配置对象并保存；UI 组件应用层推荐使用 state/app-store 中的 patchSettings。
 *
 * @param patch 包含增量修改字段的对象
 * @returns 更新后的宿主配置对象
 */
export declare function updateSettings(patch: Partial<DrawAssistantSettings>): DrawAssistantSettings;
/**
 * 重置设置到默认值
 *
 * 使用 mergeBuiltInPresets('reset') 替换所有 isBuiltIn=true 的旧预设为模块级最新数据，
 * 同时保留用户自定义预设。workflowJson/inpaintWorkflowJson 也同步重置为首个工作流的 JSON。
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
/**
 * 获取生效的预设列表
 *
 * 若 settings 中对应数组为空，回退至内置默认预设（内存临时，不写盘）。
 *
 * @param category 预设类别键
 * @returns 生效的预设数组
 */
export declare function getEffectiveList<T = Record<string, unknown>>(category: RegistryCategory): PresetProfileItem<T>[];
/**
 * 将选中的预设数据展平应用至 settings 根字段（一次 patchSettings，无双重触发）
 *
 * @param category 预设类别键
 * @param id 要应用的预设 ID
 */
export declare function applyProfileData(category: RegistryCategory, id: string): void;
/**
 * 将指定类别的预设列表重置为内置默认，并应用第一个预设的数据
 *
 * @param category 预设类别键
 */
export declare function resetCategoryToDefault(category: RegistryCategory): void;
/**
 * 预设方案高层 CRUD 门面服务 (ProfileService)
 *
 * 完全基于 PRESET_REGISTRY 驱动，消除所有 if/else 分支。
 * 所有 settings 节点内的 5 类预设（model/prompt/workflow/inpaint/theme）统一走此路径。
 */
export declare class ProfileService {
    /**
     * 新建指定类别的预设方案
     *
     * @param category 预设类别键
     * @param name 方案名称（调用方提前确认非空）
     * @param data 初始数据（当前表单值快照）
     * @returns 新建预设的 ID
     */
    static createProfile<T = Record<string, unknown>>(category: RegistryCategory, name: string, data: T): string;
    /**
     * 覆盖保存当前数据至指定预设（更新 data 字段，不改名）
     *
     * @param category 预设类别键
     * @param id 要保存的预设 ID
     * @param data 新数据
     * @returns 是否找到并成功保存
     */
    static saveProfile<T = Record<string, unknown>>(category: RegistryCategory, id: string, data: T): boolean;
    /**
     * 重命名指定预设方案
     *
     * @returns 是否成功（找不到 ID 时返回 false，不创建幽灵条目）
     */
    static renameProfile(category: RegistryCategory, id: string, newName: string): boolean;
    /**
     * 删除指定预设方案
     *
     * @returns 删除后回退选中的 fallback 预设 ID
     */
    static deleteProfile(category: RegistryCategory, id: string): string;
    /**
     * 导入 JSON 文件为新预设方案
     * 含 Schema 校验、数据规范化、自动追加并设为活跃
     *
     * @returns 新建预设 ID（成功），或 null（失败，reason 字段含说明）
     */
    static importProfile(category: RegistryCategory, content: string, fileName: string): string | null;
    /**
     * 导出预设方案为 JSON 文件并触发浏览器下载
     *
     * @param category 预设类别键
     * @param id 要导出的预设 ID
     * @param getData 获取导出数据的闭包（通常是当前表单数据）
     */
    static exportProfileJSON(category: RegistryCategory, id: string, getData: () => unknown): void;
}
/** @deprecated 使用 resetCategoryToDefault('model') 代替 */
export declare function resetModelProfilesToDefault(): DrawAssistantSettings;
/** @deprecated 使用 resetCategoryToDefault('prompt') 代替 */
export declare function resetPromptProfilesToDefault(): DrawAssistantSettings;
/** @deprecated 使用 resetCategoryToDefault('workflow') + resetCategoryToDefault('inpaint') 代替 */
export declare function resetWorkflowProfilesToDefault(): DrawAssistantSettings;
//# sourceMappingURL=manager.d.ts.map