/**
 * @module core/constants
 * @description 系统全局常量与配置约束
 */

/** 插件基础元数据 (与 manifest.json name/version 保持一致) */
export const VERSION = '0.5.0';
export const DEFAULT_BRANCH = 'dev';
export const FULL_VERSION_STRING = `${DEFAULT_BRANCH}_V${VERSION}`;
export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_DISPLAY_NAME = 'Starlight DrawAssistant';
export const GITHUB_REPO = 'NoahFoya/ST-DrawAssistant';

/** 存储键名 */
export const STORAGE_KEY = 'st_drawassistant_settings';
export const INSTALLED_COMMIT_SHA_KEY = 'st_da_installed_commit_sha';
export const DB_NAME = 'ST_DRAWASSISTANT_DB';

/** 默认生图服务地址 */
export const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';
export const DEFAULT_SDWEBUI_URL = 'http://127.0.0.1:7860';
export const DEFAULT_NOVELAI_URL = 'https://image.novelai.net';
export const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';

/** 默认网络超时与并发约束 */
export const DEFAULT_HTTP_TIMEOUT_MS = 5000;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 30000;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
export const DEFAULT_TASK_TIMEOUT_MS = 120000;
export const DEFAULT_MAX_CONCURRENT = 1;
export const DEFAULT_IMAGE_RETENTION_DAYS = 0;

/** 生图指令起止占位符 */
export const DEFAULT_PLACEHOLDER_START = 'image###';
export const DEFAULT_PLACEHOLDER_END = '###';

/** 生图后端类型 */
export const PROVIDERS = Object.freeze({
    COMFYUI: 'comfyui',
    SDWEBUI: 'sdwebui',
    NOVELAI: 'novelai',
    OPENAI: 'openai'
} as const);

/** 网络通信模式 */
export const REQUEST_MODES = Object.freeze({
    BROWSER: 'browser',
    SERVER: 'server'
} as const);

/** 内置 Tab 标识 */
export const CORE_TAB_IDS = Object.freeze({
    GENERAL: 'general',
    COMFYUI: 'comfyui',
    SDWEBUI: 'sdwebui',
    NOVELAI: 'novelai',
    OPENAI: 'openai',
    THEME: 'theme',
    GALLERY: 'gallery',
    FAB_SETTINGS: 'fab-settings',
    DIAGNOSTICS: 'diagnostics',
    ABOUT: 'about'
} as const);

/** 任务超时控制区间 (秒/毫秒) */
export const TASK_TIMEOUT_LIMITS = Object.freeze({
    MIN_SEC: 10,
    MAX_SEC: 600,
    DEFAULT_SEC: 120,
    DEFAULT_MS: 120000
});

/** 并发任务门限 */
export const CONCURRENCY_LIMITS = Object.freeze({
    MIN: 1,
    MAX: 10,
    DEFAULT: 1
});

/** 图像渲染样式默认约束 */
export const IMAGE_DISPLAY_DEFAULTS = Object.freeze({
    ALIGN: 'center' as const,
    OBJECT_FIT: 'contain' as const,
    MAX_HEIGHT: 600,
    MAX_WIDTH_PCT: 100,
    ROUNDED: true,
    COLLAPSED: false,
    MAX_HEIGHT_LIMIT: 2000,
    MIN_WIDTH_PCT: 10,
    MAX_WIDTH_PCT_LIMIT: 100
});

/** 默认主题视觉变量兜底 */
export const DEFAULT_THEME_DATA = Object.freeze({
    accentColor: '#00f2fe',
    bgPrimary: '#0f1014',
    bgSecondary: '#1a1d24',
    bgGradientEnd: '#161920',
    bgGradientAngle: 135,
    bgOpacity: 0.95,
    textPrimary: '#f2f2f7',
    textSecondary: '#8e8e93',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 14,
    blurRadius: 20
});

/** ComfyUI 分辨率预设（以 SDXL/Flux 为基准，'WxH' 格式） */
export const COMFYUI_SIZE_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    { label: '方图 1024 × 1024', value: '1024x1024' },
    { label: '竖图 832 × 1216', value: '832x1216' },
    { label: '竖图 1024 × 1344', value: '1024x1344' },
    { label: '横图 1216 × 832', value: '1216x832' },
    { label: '横图 1344 × 1024', value: '1344x1024' },
    { label: '超竖 768 × 1344', value: '768x1344' },
    { label: '超横 1344 × 768', value: '1344x768' }
] as const;

/** SD-WebUI 分辨率预设（兼顾 SD1.5 与 SDXL 两代） */
export const SDWEBUI_SIZE_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    { label: '方图 512 × 512 (SD 1.5)', value: '512x512' },
    { label: '竖图 512 × 768 (SD 1.5)', value: '512x768' },
    { label: '横图 768 × 512 (SD 1.5)', value: '768x512' },
    { label: '方图 1024 × 1024 (SDXL)', value: '1024x1024' },
    { label: '竖图 832 × 1216 (SDXL)', value: '832x1216' },
    { label: '横图 1216 × 832 (SDXL)', value: '1216x832' }
] as const;

/** NovelAI 分辨率预设（NAI V4 官方推荐尺寸） */
export const NOVELAI_SIZE_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    { label: '竖图 832 × 1216', value: '832x1216' },
    { label: '横图 1216 × 832', value: '1216x832' },
    { label: '方图 1024 × 1024', value: '1024x1024' },
    { label: '竖图 512 × 768', value: '512x768' },
    { label: '横图 768 × 512', value: '768x512' }
] as const;

