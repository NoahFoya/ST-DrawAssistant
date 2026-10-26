/**
 * ST-DrawAssistant 全局基础常量定义。
 */

import type { ThemePresetData } from '@types';

export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_TITLE = 'ST-DrawAssistant 绘画助手';
export const EXTENSION_VERSION = 'v0.1.0';

/**
 * 插件安全回退主题常数。
 *
 * @remarks
 * 仅用于配置异常或未初始化预设时的容错回退，不作为预设注入预设列表。
 */
export const SAFE_FALLBACK_THEME: Readonly<ThemePresetData> = Object.freeze({
    accentColor: '#3b82f6',
    accentCyan: '#06b6d4',
    bgPrimary: '#181b24',
    bgSecondary: '#202430',
    bgSidebar: '#13151c',
    bgCard: '#1f2430',
    bgCardHover: '#262c3a',
    bgInput: '#12141a',
    bgInputHover: '#1c202a',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderHighlight: 'rgba(59, 130, 246, 0.45)',
    borderRadius: 10,
    radiusModal: 12,
    radiusCard: 10,
    radiusInput: 6,
    blurModal: 18,
    blurPanel: 20,
});
