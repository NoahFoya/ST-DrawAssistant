/**
 * @file src/common/constants.ts
 * @description 跨端共享公共常量 (纯净无 DOM/Node.js 运行时依赖)
 */

/** 扩展唯一标识与显示名称 */
export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_VERSION = '0.1.4';

/** 服务端插件标识与 API 路由地址 */
export const PLUGIN_ID = 'st-drawassistant';
export const SERVER_API_BASE = `/api/plugins/${PLUGIN_ID}`;
export const SERVER_PROXY_ENDPOINT = `${SERVER_API_BASE}/proxy`;

/** 本地回环地址列表 (浏览器视为安全来源，不受 Mixed Content 限制) */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'] as const;
