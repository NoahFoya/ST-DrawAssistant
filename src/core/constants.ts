/**
 * @module core/constants
 * @description ST-DrawAssistant 扩展全局常量定义模块
 *
 * 职责：
 * - 为全库提供唯一真实来源，避免各模块散落硬编码字符串
 * - 声明扩展名称、命名空间、路径及版本号
 *
 * 宿主契约要求：
 * - MODULE_NAME、EXTENSION_NAME、VERSION 必须与扩展目录名及 manifest.json 保持完全一致
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
export const VERSION = '0.3.0' as const;

