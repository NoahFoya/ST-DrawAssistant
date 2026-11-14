/**
 * ST-DrawAssistant 全局基础常量定义。
 */

import type { ThemePresetData } from '@types';

export const EXTENSION_TITLE = 'ST-DrawAssistant 绘画助手';
export const EXTENSION_VERSION = '1.1.2';

/** 插件 GitHub 仓库与更新检测配置 */
export const GITHUB_REPO = 'NoahFoya/ST-DrawAssistant';
export const GITHUB_DEFAULT_BRANCH = 'dev';
export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
export const GITHUB_CDN_BASE = 'https://cdn.jsdelivr.net/gh';
export const UPDATE_CHECK_COOLDOWN_MS = 5 * 60 * 1000;
export const INSTALLED_COMMIT_SHA_KEY = 'st_da_installed_sha';

/**
 * 宿主消息全量扫描防抖延时（毫秒）。
 *
 * @remarks
 * 用于在会话切换、聊天载入或窗口就绪等批量事件触发时，防抖合并扫描流程。
 */
export const MESSAGE_SCAN_DEBOUNCE_DELAY_MS = 250;

/**
 * 插件安全回退主题常数。
 *
 * @remarks
 * 仅用于配置异常或未初始化预设时的容错回退，不作为预设注入预设列表。
 */
export const SAFE_FALLBACK_THEME: Readonly<ThemePresetData> = Object.freeze({
    // 1. 表面层级体系 (暗夜微光基准)
    bgCanvas: '#0c0d10',
    bgPrimary: '#141418',
    bgSecondary: '#101013',
    bgCard: '#1c1d25',
    bgCardHover: '#24252f',
    bgInput: '#0e0f13',
    bgInputHover: '#16171d',
    bgModal: '#141418',
    bgOverlay: 'rgba(8, 8, 10, 0.78)',

    // 2. 品牌与强调色体系
    accent: '#818cf8',
    accentSecondary: '#6366f1',
    accentHover: '#939bf9',
    accentGlow: '0 0 24px rgba(129, 140, 248, 0.35)',
    accentGradient: 'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)',

    // 3. 文本与内容层级体系
    textPrimary: '#f4f4f5',
    textSecondary: '#a1a1aa',
    textMuted: '#71717a',
    textOnAccent: '#ffffff',

    // 4. 边框与分割体系
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderHighlight: 'rgba(129, 140, 248, 0.45)',
    borderSubtle: 'rgba(255, 255, 255, 0.04)',

    // 5. 几何形态与滤镜体系
    borderRadius: 12,
    radiusModal: 16,
    radiusCard: 14,
    radiusInput: 8,
    blurModal: 20,
    blurPanel: 24,
});
