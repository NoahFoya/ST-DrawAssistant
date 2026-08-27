/**
 * 全局常量定义
 *
 * MODULE_NAME：用于 extension_settings 命名空间隔离
 *   → extension_settings[MODULE_NAME] 存储本扩展的所有持久化设置
 *
 * EXTENSION_NAME：等于扩展文件夹名，用于 renderExtensionTemplateAsync 等 API
 *   → 必须与 manifest.json 的 name 字段和目录名完全一致
 */

export const MODULE_NAME = 'draw-assistant' as const;

export const EXTENSION_NAME = 'ST-DrawAssistant' as const;

export const EXTENSION_DISPLAY_NAME = 'ST DrawAssistant' as const;

export const VERSION = '0.1.0' as const;
