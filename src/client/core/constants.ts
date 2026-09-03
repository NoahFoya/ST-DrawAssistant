/**
 * @module core/constants
 * @description 核心基础设施层全局配置常量与内置安全主题
 */

export {
    EXTENSION_NAME,
    EXTENSION_VERSION,
    PLUGIN_ID,
    SERVER_API_BASE,
    SERVER_PROXY_ENDPOINT,
    LOOPBACK_HOSTS
} from '../../common';

/** 本地 IndexedDB 数据库与存储表名 */
export const DB_NAME = 'ST-DrawAssistant';
export const DB_STORE_NAME = 'image_assets';

/** 运行时时间与超时配置常量 (毫秒) */
export const DEFAULT_SAVE_DEBOUNCE_MS = 300;
export const DEFAULT_URL_RELEASE_DELAY_MS = 5000;
export const DEFAULT_HOST_TIMEOUT_MS = 30000;
export const DEFAULT_DIRECT_TIMEOUT_MS = 60000;
export const DEFAULT_PROXY_TIMEOUT_MS = 180000;
export const DEFAULT_HOST_READY_TIMEOUT_MS = 4000;
export const DEFAULT_HOST_READY_POLL_INTERVAL_MS = 100;

/** 主题元数据与 CSS Token 定义 */
export interface ThemeDefinition {
    id: string;
    name: string;
    isDark: boolean;
    tokens: Record<string, string>;
}

/** 内置日间模式安全常量主题 */
export const BUILTIN_THEME_LIGHT: ThemeDefinition = Object.freeze({
    id: 'light',
    name: '明亮日间',
    isDark: false,
    tokens: Object.freeze({
        '--da-primary': '#2563eb',
        '--da-bg-base': '#ffffff',
        '--da-bg-surface': '#f8fafc',
        '--da-text-base': '#0f172a',
        '--da-text-muted': '#64748b',
        '--da-border': '#e2e8f0'
    })
});

/** 内置夜间模式安全常量主题 (出厂默认) */
export const BUILTIN_THEME_DARK: ThemeDefinition = Object.freeze({
    id: 'dark',
    name: '深色夜间',
    isDark: true,
    tokens: Object.freeze({
        '--da-primary': '#3b82f6',
        '--da-bg-base': '#0f172a',
        '--da-bg-surface': '#1e293b',
        '--da-text-base': '#f8fafc',
        '--da-text-muted': '#94a3b8',
        '--da-border': '#334155'
    })
});

/** 内置安全常量主题集合 (默认样式回退，避免样式缺失) */
export const BUILTIN_THEMES: readonly ThemeDefinition[] = Object.freeze([
    BUILTIN_THEME_DARK,
    BUILTIN_THEME_LIGHT
]);
