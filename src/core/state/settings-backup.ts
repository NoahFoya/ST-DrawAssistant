/**
 * @module core/state/settings-backup
 * @description 插件完整配置安全备份导出与导入迁移服务
 */

import { ObservableStore } from './store';
import { DrawAssistantSettings } from './store-types';
import { migrateSettings } from './schema-migrator';
import { VERSION, EXTENSION_NAME } from '../constants';

export interface SettingsBackupPackage {
    plugin: string;
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

export const SENSITIVE_SETTING_KEYS = [
    'apiKey',
    'serverUrl',
    'sdWebUrl',
    'naiApiKey',
    'naiUrl',
    'openaiApiKey',
    'openaiBaseUrl'
] as const;

/**
 * 将当前配置序列化为标准备份 JSON 字符串
 * @param store 配置 Store
 * @param sanitize 是否脱敏（移除 API 密钥与私有端点地址）
 */
export function exportSettingsPackage(
    store: ObservableStore<DrawAssistantSettings>,
    sanitize = false
): string {
    const raw = store.getState();
    const settings = { ...raw };

    if (sanitize) {
        for (const key of SENSITIVE_SETTING_KEYS) {
            (settings as any)[key] = '';
        }
    }

    const pkg: SettingsBackupPackage = {
        plugin: EXTENSION_NAME,
        version: VERSION,
        exportedAt: Date.now(),
        sanitized: sanitize,
        settings
    };

    return JSON.stringify(pkg, null, 2);
}

/**
 * 触发浏览器文件下载导出备份 JSON
 */
export function downloadSettingsFile(
    store: ObservableStore<DrawAssistantSettings>,
    sanitize = false
): void {
    if (typeof document === 'undefined') return;
    const json = exportSettingsPackage(store, sanitize);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `st-drawassistant-config-${dateStr}${sanitize ? '-sanitized' : ''}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 从 JSON 文本中安全导入配置并热更新 Store
 */
export function importSettingsPackage(
    jsonStr: string,
    store: ObservableStore<DrawAssistantSettings>
): ImportResult {
    try {
        if (!jsonStr || !jsonStr.trim()) {
            return { success: false, message: '导入内容为空' };
        }

        const raw = JSON.parse(jsonStr);
        let settingsToMigrate: any = raw;

        let isPackage = false;
        let pkgVersion = VERSION;
        let isSanitized = false;

        if (raw && typeof raw === 'object' && (raw.plugin === EXTENSION_NAME || raw.plugin === 'st-drawassistant') && raw.settings) {
            isPackage = true;
            settingsToMigrate = raw.settings;
            pkgVersion = raw.version || VERSION;
            isSanitized = Boolean(raw.sanitized);
        }

        // 使用 migrateSettings 执行配置结构版本迁移与字段校验清洗
        const cleanSettings = migrateSettings(settingsToMigrate);

        // 如果导入的是脱敏配置，保留原有的密钥和私有端点不被覆盖清空
        if (isSanitized) {
            const current = store.getState();
            for (const key of SENSITIVE_SETTING_KEYS) {
                if ((current as any)[key] && !(cleanSettings as any)[key]) {
                    (cleanSettings as any)[key] = (current as any)[key];
                }
            }
        }

        // 全量热更新 Store
        store.reset(cleanSettings);

        return {
            success: true,
            message: `成功导入配置${isPackage ? ` (来源版本: v${pkgVersion})` : ''}`,
            importedVersion: pkgVersion,
            sanitized: isSanitized
        };
    } catch (err: any) {
        return {
            success: false,
            message: `解析配置文件失败: ${err.message || 'JSON 格式非法'}`
        };
    }
}
