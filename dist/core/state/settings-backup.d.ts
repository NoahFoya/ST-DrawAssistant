/**
 * @module core/state/settings-backup
 * @description 插件完整配置安全备份导出与导入迁移服务
 */
import { ObservableStore } from './store';
import { DrawAssistantSettings } from './store-types';
export interface SettingsBackupPackage {
    plugin: 'st-drawassistant';
    version: string;
    exportedAt: number;
    sanitized: boolean;
    settings: DrawAssistantSettings;
}
export interface ImportResult {
    success: boolean;
    message: string;
    importedVersion?: string;
    sanitized?: boolean;
}
export declare const SENSITIVE_SETTING_KEYS: readonly ["apiKey", "serverUrl", "sdWebUrl", "naiApiKey", "naiUrl", "openaiApiKey", "openaiBaseUrl"];
/**
 * 将当前配置序列化为标准备份 JSON 字符串
 * @param store 配置 Store
 * @param sanitize 是否脱敏（移除 API 密钥与私有端点地址）
 */
export declare function exportSettingsPackage(store: ObservableStore<DrawAssistantSettings>, sanitize?: boolean): string;
/**
 * 触发浏览器文件下载导出备份 JSON
 */
export declare function downloadSettingsFile(store: ObservableStore<DrawAssistantSettings>, sanitize?: boolean): void;
/**
 * 从 JSON 文本中安全导入配置并热更新 Store
 */
export declare function importSettingsPackage(jsonStr: string, store: ObservableStore<DrawAssistantSettings>): ImportResult;
//# sourceMappingURL=settings-backup.d.ts.map