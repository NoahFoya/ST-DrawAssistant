/**
 * @module core/constants
 * @description 核心基础设施层全局常量定义
 */

/** 扩展唯一标识与显示名称 */
export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_VERSION = '0.1.1';

/** 服务端插件标识与 API 端点 */
export const PLUGIN_ID = 'st-drawassistant';
export const SERVER_API_BASE = `/api/plugins/${PLUGIN_ID}`;
export const SERVER_PROXY_ENDPOINT = `${SERVER_API_BASE}/proxy`;
export const SERVER_CONFIG_SYNC_ENDPOINT = `${SERVER_API_BASE}/config`;

/** 本地 IndexedDB 数据库与存储表名 */
export const DB_NAME = 'ST-DrawAssistant';
export const DB_STORE_NAME = 'image_assets';

/** 运行时时间与超时配置 (毫秒) */
export const DEFAULT_SAVE_DEBOUNCE_MS = 300;
export const DEFAULT_URL_RELEASE_DELAY_MS = 5000;
export const DEFAULT_HOST_TIMEOUT_MS = 30000;
export const DEFAULT_DIRECT_TIMEOUT_MS = 60000;
export const DEFAULT_HOST_READY_TIMEOUT_MS = 4000;
export const DEFAULT_HOST_READY_POLL_INTERVAL_MS = 100;
