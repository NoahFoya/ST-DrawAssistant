/**
 * @module core/constants
 * @description 系统全局常量与配置约束
 */
/** 插件版本号与扩展标识 */
export declare const VERSION = "0.3.5";
export declare const MODULE_NAME = "st-drawassistant";
export declare const EXTENSION_KEY = "st-drawassistant";
export declare const EXTENSION_DISPLAY_NAME = "Starlight DrawAssistant";
/** 存储键名 */
export declare const STORAGE_KEY = "st_drawassistant_settings";
export declare const DB_NAME = "ST_DRAWASSISTANT_DB";
/** 默认生图服务地址 */
export declare const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
export declare const DEFAULT_SDWEBUI_URL = "http://127.0.0.1:7860";
export declare const DEFAULT_NOVELAI_URL = "https://image.novelai.net";
export declare const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
/** 默认超时与并发 */
export declare const DEFAULT_TIMEOUT_MS = 120000;
export declare const DEFAULT_MAX_CONCURRENT = 1;
export declare const DEFAULT_PROBE_TIMEOUT_MS = 4000;
/** 生图指令起止占位符 */
export declare const DEFAULT_PLACEHOLDER_START = "image###";
export declare const DEFAULT_PLACEHOLDER_END = "###";
/** 生图后端类型 */
export declare const PROVIDERS: Readonly<{
    readonly COMFYUI: "comfyui";
    readonly SDWEBUI: "sdwebui";
    readonly NOVELAI: "novelai";
    readonly OPENAI: "openai";
}>;
/** 网络通信模式 */
export declare const REQUEST_MODES: Readonly<{
    readonly BROWSER: "browser";
    readonly SERVER: "server";
}>;
/** 内置 Tab 标识 */
export declare const CORE_TAB_IDS: Readonly<{
    readonly GENERAL: "general";
    readonly COMFYUI: "comfyui";
    readonly SDWEBUI: "sdwebui";
    readonly NOVELAI: "novelai";
    readonly OPENAI: "openai";
    readonly THEME: "theme";
    readonly GALLERY: "gallery";
    readonly FAB_SETTINGS: "fab-settings";
    readonly DIAGNOSTICS: "diagnostics";
    readonly ABOUT: "about";
}>;
/** 超时控制区间 (秒/毫秒) */
export declare const TIMEOUT_LIMITS: Readonly<{
    MIN_SEC: 5;
    MAX_SEC: 600;
    DEFAULT_SEC: 120;
    DEFAULT_MS: 120000;
}>;
/** 并发任务门限 */
export declare const CONCURRENCY_LIMITS: Readonly<{
    MIN: 1;
    MAX: 10;
    DEFAULT: 1;
}>;
/** 图像渲染样式默认约束 */
export declare const IMAGE_DISPLAY_DEFAULTS: Readonly<{
    ALIGN: "center";
    OBJECT_FIT: "contain";
    MAX_HEIGHT: 600;
    MAX_WIDTH_PCT: 100;
    ROUNDED: true;
    MAX_HEIGHT_LIMIT: 2000;
    MIN_WIDTH_PCT: 10;
    MAX_WIDTH_PCT_LIMIT: 100;
}>;
/** 默认主题视觉变量兜底 */
export declare const DEFAULT_THEME_DATA: Readonly<{
    accentColor: "#00f2fe";
    bgPrimary: "#0f1014";
    bgSecondary: "#1a1d24";
    bgGradientEnd: "#161920";
    bgGradientAngle: 135;
    bgOpacity: 0.95;
    textPrimary: "#f2f2f7";
    textSecondary: "#8e8e93";
    borderColor: "rgba(255, 255, 255, 0.09)";
    borderRadius: 14;
    blurRadius: 20;
}>;
/** ComfyUI 分辨率预设（以 SDXL/Flux 为基准，'WxH' 格式） */
export declare const COMFYUI_SIZE_PRESETS: readonly [{
    readonly label: "自定义尺寸";
    readonly value: "custom";
}, {
    readonly label: "方图 1024 × 1024 (1:1)";
    readonly value: "1024x1024";
}, {
    readonly label: "竖图 832 × 1216 (2:3)";
    readonly value: "832x1216";
}, {
    readonly label: "竖图 1024 × 1344 (3:4)";
    readonly value: "1024x1344";
}, {
    readonly label: "横图 1216 × 832 (3:2)";
    readonly value: "1216x832";
}, {
    readonly label: "横图 1344 × 1024 (4:3)";
    readonly value: "1344x1024";
}, {
    readonly label: "超竖 768 × 1344 (4:7)";
    readonly value: "768x1344";
}, {
    readonly label: "超横 1344 × 768 (7:4)";
    readonly value: "1344x768";
}];
/** SD-WebUI 分辨率预设（兼顾 SD1.5 与 SDXL 两代） */
export declare const SDWEBUI_SIZE_PRESETS: readonly [{
    readonly label: "自定义尺寸";
    readonly value: "custom";
}, {
    readonly label: "方图 512 × 512 (SD1.5 1:1)";
    readonly value: "512x512";
}, {
    readonly label: "竖图 512 × 768 (SD1.5 2:3)";
    readonly value: "512x768";
}, {
    readonly label: "横图 768 × 512 (SD1.5 3:2)";
    readonly value: "768x512";
}, {
    readonly label: "方图 1024 × 1024 (SDXL 1:1)";
    readonly value: "1024x1024";
}, {
    readonly label: "竖图 832 × 1216 (SDXL 2:3)";
    readonly value: "832x1216";
}, {
    readonly label: "横图 1216 × 832 (SDXL 3:2)";
    readonly value: "1216x832";
}];
/** NovelAI 分辨率预设（NAI V4 官方推荐尺寸） */
export declare const NOVELAI_SIZE_PRESETS: readonly [{
    readonly label: "自定义尺寸";
    readonly value: "custom";
}, {
    readonly label: "竖图 832 × 1216 (标准人像推荐)";
    readonly value: "832x1216";
}, {
    readonly label: "横图 1216 × 832 (标准壁纸推荐)";
    readonly value: "1216x832";
}, {
    readonly label: "方图 1024 × 1024 (正方形画幅)";
    readonly value: "1024x1024";
}, {
    readonly label: "竖图 512 × 768 (小尺寸快速试绘)";
    readonly value: "512x768";
}, {
    readonly label: "横图 768 × 512 (小尺寸横幅)";
    readonly value: "768x512";
}];
//# sourceMappingURL=constants.d.ts.map