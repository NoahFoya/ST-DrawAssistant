/**
 * @module common/constants
 * @description 共享公共常量
 */

/** 扩展唯一标识与语义化版本号 */
export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_VERSION = '0.1.4';

/** 服务端插件标识与 API 路由基地址 */
export const PLUGIN_ID = 'st-drawassistant';
export const SERVER_API_BASE = `/api/plugins/${PLUGIN_ID}`;
export const SERVER_PROXY_ENDPOINT = `${SERVER_API_BASE}/proxy`;

/** 本地回环地址列表 (浏览器视为安全源，不受 Mixed Content 限制) */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'] as const;
