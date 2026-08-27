/**
 * @module core/constants
 * @description ST-DrawAssistant 扩展全局常量定义模块
 *
 * 规范参考：
 * - .agents/Skills/sillytavern-extension-host/SKILL.md §2 (manifest.json 结构与路径规范)
 */

/** 用于 extension_settings 命名空间隔离 (存储 Key) */
export const MODULE_NAME = 'ST-DrawAssistant' as const;

/** 等于扩展文件夹名，必须与 manifest.json 的 name 字段和目录名 100% 完全一致 */
export const EXTENSION_NAME = 'ST-DrawAssistant' as const;

/** 第三方扩展相对宿主 scripts/extensions/ 的标准基准路径常量 */
export const EXTENSION_PATH = `third-party/${EXTENSION_NAME}` as const;

/** 扩展 UI 界面与模态框呈现名称，与 manifest.json 的 display_name 保持一致 */
export const EXTENSION_DISPLAY_NAME = 'Starlight DrawAssistant' as const;

/** 版本号，与 manifest.json 的 version 保持一致 */
export const VERSION = '0.2.0' as const;

