/**
 * 插件内部常量定义
 *
 * 功能：
 * 1. 收纳模块名称、发行版本号、IndexedDB 数据库名及核心时间阈值常量。
 *
 * Tips：
 * 1. 本文件仅维护插件底层静态常量，用户可定制的动态配置项统一在 default-settings.json 中维护。
 */

/** 扩展插件在 SillyTavern 宿主 extensionSettings 中的唯一标识键 */
export const MODULE_NAME = 'ST-DrawAssistant';

/** 插件发行版本号 */
export const EXTENSION_VERSION = '0.2.0';

/** 本地 IndexedDB 数据库名称 */
export const DB_NAME = 'ST-DrawAssistant';

/** 本地 IndexedDB 图像资产对象仓库名称 */
export const DB_STORE_NAME = 'generated_images';

/** 任务执行超时强断阈值 (毫秒)，固定为 120 秒 */
export const DEFAULT_TASK_TIMEOUT_MS = 120000;

/** 最大并发生图任务数，固定为 3 */
export const DEFAULT_MAX_CONCURRENT_TASKS = 3;

/** 临时 Object URL 引用计数归零后的延时销毁缓冲时间 (毫秒) */
export const DEFAULT_URL_RELEASE_DELAY_MS = 5000;

/** 设置项防抖持久化存储延时 (毫秒) */
export const DEFAULT_SAVE_DEBOUNCE_MS = 500;

