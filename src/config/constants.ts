/**
 * ST-DrawAssistant 全局基础常量定义。
 */

import type { ThemePresetData } from '@types';

export const EXTENSION_TITLE = 'ST-DrawAssistant 绘画助手';
export const EXTENSION_VERSION = '1.5.0';

/** 插件 GitHub 仓库与更新检测配置 */
export const GITHUB_REPO = 'NoahFoya/ST-DrawAssistant';
export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
export const GITHUB_CDN_BASE = 'https://cdn.jsdelivr.net/gh';
export const UPDATE_CHECK_COOLDOWN_MS = 5 * 60 * 1000;
export const INSTALLED_COMMIT_SHA_KEY = 'st_da_installed_sha';
export const PENDING_CHANGELOG_POPUP_KEY = 'st_da_pending_changelog_popup';

/** 默认单任务超时时间（毫秒） */
export const DEFAULT_TASK_TIMEOUT_MS = 120_000;

/** 提示词预设“使用轮询”特殊绑定标识 */
export const PROMPT_POLLING_PRESET_ID = '__polling__';

/**
 * 宿主消息全量扫描防抖延时（毫秒）。
 *
 * @remarks
 * 用于在会话切换、聊天载入或窗口就绪等批量事件触发时，防抖合并扫描流程。
 */
export const MESSAGE_SCAN_DEBOUNCE_DELAY_MS = 250;

/**
 * 插件安全回退主题常数（与默认阅读预设 Catppuccin Mocha 保持一致）。
 *
 * @remarks
 * 仅用于配置异常或未初始化预设时的容错回退，不作为预设注入预设列表。
 */
export const SAFE_FALLBACK_THEME: Readonly<ThemePresetData> = Object.freeze({
    // 1. 背景与表面色值
    bgCanvas: '#11111b',
    bgPrimary: '#1e1e2e',
    bgSecondary: '#181825',
    bgCard: '#28293d',
    bgCardHover: '#313244',
    bgInput: '#161622',
    bgInputHover: '#222235',
    bgModal: '#1e1e2e',
    bgOverlay: 'rgba(17, 17, 27, 0.78)',

    // 2. 品牌与强调色体系
    accent: '#cba6f7',
    accentSecondary: '#89b4fa',
    accentHover: '#d8bdf9',
    accentGlow: '0 0 24px rgba(203, 166, 247, 0.28)',
    accentGradient: 'linear-gradient(135deg, #cba6f7 0%, #89b4fa 100%)',

    // 3. 文本与内容层级体系
    textPrimary: '#cdd6f4',
    textSecondary: '#a6adc8',
    textMuted: '#6c7086',
    textOnAccent: '#11111b',

    // 4. 边框与分割体系
    borderColor: 'rgba(205, 214, 244, 0.10)',
    borderHighlight: 'rgba(203, 166, 247, 0.34)',
    borderSubtle: 'rgba(205, 214, 244, 0.05)',
});
