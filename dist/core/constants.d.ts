/**
 * @module core/constants
 * @description 插件全局常量集中定义 (单一事实来源，严禁在业务代码中硬编码常量与版本号)
 */
/** 当前插件系统版本号 (全系统单一事实来源) */
export declare const VERSION = "0.3.5";
/** 插件模块名称与唯一标识 */
export declare const MODULE_NAME = "st-drawassistant";
export declare const EXTENSION_KEY = "st-drawassistant";
/** 扩展设置持久化键名 */
export declare const STORAGE_KEY = "st_drawassistant_settings";
/** 本地图库 IndexedDB 数据库名称 */
export declare const DB_NAME = "ST_DRAWASSISTANT_DB";
/** 默认服务地址 */
export declare const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
export declare const DEFAULT_SDWEBUI_URL = "http://127.0.0.1:7860";
/** 默认生图与请求控制门限 */
export declare const DEFAULT_TIMEOUT_MS = 120000;
export declare const DEFAULT_MAX_CONCURRENT = 1;
/** 默认生图指令起止占位符 */
export declare const DEFAULT_PLACEHOLDER_START = "image###";
export declare const DEFAULT_PLACEHOLDER_END = "###";
//# sourceMappingURL=constants.d.ts.map