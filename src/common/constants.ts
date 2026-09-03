/**
 * @file src/common/constants.ts
 * @description 跨端共享公共常量 (纯净无 DOM/Node.js 运行时依赖)
 */

/** 扩展唯一标识与显示名称 */
export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_VERSION = '0.1.2';

/** 服务端插件标识与 API 端点契约 */
export const PLUGIN_ID = 'st-drawassistant';
export const SERVER_API_BASE = `/api/plugins/${PLUGIN_ID}`;
export const SERVER_PROXY_ENDPOINT = `${SERVER_API_BASE}/proxy`;

/** 安全本地回环主机地址列表 (享受安全上下文豁免) */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'] as const;
