/**
 * 全局常量与内置主题
 */

export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_VERSION = '0.1.0';
export const PLUGIN_ID = 'st-drawassistant';

/** 酒馆宿主标准图库上传端点 */
export const HOST_API_IMAGES_UPLOAD = '/api/images/upload';

/** 本地回环地址。浏览器视为安全上下文，不受 Mixed Content 限制 */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'] as const;

/** 本地 IndexedDB 数据库与数据表名 */
export const DB_NAME = 'ST-DrawAssistant';
export const DB_STORE_NAME = 'image_assets';

/** 运行时时间与超时配置 (毫秒) */
export const DEFAULT_SAVE_DEBOUNCE_MS = 300;
export const DEFAULT_URL_RELEASE_DELAY_MS = 5000;
export const DEFAULT_HOST_TIMEOUT_MS = 30000;
export const DEFAULT_DIRECT_TIMEOUT_MS = 60000;
export const DEFAULT_HOST_READY_TIMEOUT_MS = 4000;
export const DEFAULT_HOST_READY_POLL_INTERVAL_MS = 100;

/** 主题元数据与 CSS Token 定义 */
export interface ThemeDefinition {
    id: string;
    name: string;
    isDark: boolean;
    tokens: Record<string, string>;
}

/** 内置明亮主题 */
export const BUILTIN_THEME_LIGHT: ThemeDefinition = Object.freeze({
    id: 'light',
    name: '明亮日间',
    isDark: false,
    tokens: Object.freeze({
        '--da-primary': '#2563eb',
        '--da-primary-hover': '#1d4ed8',
        '--da-bg-base': '#ffffff',
        '--da-bg-surface': '#f8fafc',
        '--da-surface-card': 'rgba(0, 0, 0, 0.04)',
        '--da-text-base': '#0f172a',
        '--da-text-muted': '#64748b',
        '--da-border': '#e2e8f0'
    })
});

/** 内置深色主题 (默认) */
export const BUILTIN_THEME_DARK: ThemeDefinition = Object.freeze({
    id: 'dark',
    name: '深色夜间',
    isDark: true,
    tokens: Object.freeze({
        '--da-primary': '#3b82f6',
        '--da-primary-hover': '#2563eb',
        '--da-bg-base': '#0f172a',
        '--da-bg-surface': '#1e293b',
        '--da-surface-card': 'rgba(255, 255, 255, 0.05)',
        '--da-text-base': '#f8fafc',
        '--da-text-muted': '#94a3b8',
        '--da-border': '#334155'
    })
});

/** 内置备用主题列表 */
export const BUILTIN_THEMES: readonly ThemeDefinition[] = Object.freeze([
    BUILTIN_THEME_DARK,
    BUILTIN_THEME_LIGHT
]);
