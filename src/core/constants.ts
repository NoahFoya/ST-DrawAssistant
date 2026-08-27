/**
 * @module core/constants
 * @description 系统全局常量与配置约束
 */

/** 插件版本号与扩展标识 */
export const VERSION = '0.3.5';
export const MODULE_NAME = 'st-drawassistant';
export const EXTENSION_KEY = 'st-drawassistant';
export const EXTENSION_DISPLAY_NAME = 'Starlight DrawAssistant';

/** 存储键名 */
export const STORAGE_KEY = 'st_drawassistant_settings';
export const DB_NAME = 'ST_DRAWASSISTANT_DB';

/** 默认生图服务地址 */
export const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';
export const DEFAULT_SDWEBUI_URL = 'http://127.0.0.1:7860';
export const DEFAULT_NOVELAI_URL = 'https://image.novelai.net';
export const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';

/** 默认超时与并发 */
export const DEFAULT_TIMEOUT_MS = 120000;
export const DEFAULT_MAX_CONCURRENT = 1;
export const DEFAULT_PROBE_TIMEOUT_MS = 4000;

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

/** 超时控制区间 (秒/毫秒) */
export const TIMEOUT_LIMITS = Object.freeze({
    MIN_SEC: 5,
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
    { label: '方图 1024 × 1024 (1:1)', value: '1024x1024' },
    { label: '竖图 832 × 1216 (2:3)', value: '832x1216' },
    { label: '竖图 1024 × 1344 (3:4)', value: '1024x1344' },
    { label: '横图 1216 × 832 (3:2)', value: '1216x832' },
    { label: '横图 1344 × 1024 (4:3)', value: '1344x1024' },
    { label: '超竖 768 × 1344 (4:7)', value: '768x1344' },
    { label: '超横 1344 × 768 (7:4)', value: '1344x768' }
] as const;

/** SD-WebUI 分辨率预设（兼顾 SD1.5 与 SDXL 两代） */
export const SDWEBUI_SIZE_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    { label: '方图 512 × 512 (SD1.5 1:1)', value: '512x512' },
    { label: '竖图 512 × 768 (SD1.5 2:3)', value: '512x768' },
    { label: '横图 768 × 512 (SD1.5 3:2)', value: '768x512' },
    { label: '方图 1024 × 1024 (SDXL 1:1)', value: '1024x1024' },
    { label: '竖图 832 × 1216 (SDXL 2:3)', value: '832x1216' },
    { label: '横图 1216 × 832 (SDXL 3:2)', value: '1216x832' }
] as const;

/** NovelAI 分辨率预设（NAI V4 官方推荐尺寸） */
export const NOVELAI_SIZE_PRESETS = [
    { label: '自定义尺寸', value: 'custom' },
    { label: '竖图 832 × 1216 (标准人像推荐)', value: '832x1216' },
    { label: '横图 1216 × 832 (标准壁纸推荐)', value: '1216x832' },
    { label: '方图 1024 × 1024 (正方形画幅)', value: '1024x1024' },
    { label: '竖图 512 × 768 (小尺寸快速试绘)', value: '512x768' },
    { label: '横图 768 × 512 (小尺寸横幅)', value: '768x512' }
] as const;

