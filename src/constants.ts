/**
 * 插件内部常量定义
 * 职责：收纳内部协议定义、默认超时、模块标识与存储对象名称，不污染用户可配置项。
 */

/** 扩展插件在 SillyTavern 宿主 extensionSettings 中的唯一标识键 */
export const MODULE_NAME = 'ST-DrawAssistant';

/** 插件发行版本号 */
export const EXTENSION_VERSION = '0.2.0';

/** 本地 IndexedDB 数据库名称 */
export const DB_NAME = 'ST-DrawAssistant';

/** 本地 IndexedDB 图像资产对象仓库名称 */
export const DB_STORE_NAME = 'generated_images';

/** 默认任务执行超时强断阈值 (毫秒) */
export const DEFAULT_TASK_TIMEOUT_MS = 180000;

/** 临时 Object URL 引用计数归零后的延时销毁缓冲时间 (毫秒) */
export const DEFAULT_URL_RELEASE_DELAY_MS = 5000;

/** 设置项防抖持久化存储延时 (毫秒) */
export const DEFAULT_SAVE_DEBOUNCE_MS = 500;

/** 消息正文占位符前缀内部解析标记 */
export const DEFAULT_PLACEHOLDER_START = 'image###';

/** 消息正文占位符后缀内部解析标记 */
export const DEFAULT_PLACEHOLDER_END = '###';
