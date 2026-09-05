/**
 * @module ui/foundation/theme-service
 * @description 外观主题服务 (单一事实来源，负责动态计算并注入全局 --da-* CSS 设计变量)
 */

import { IDisposable, ConfigStore } from '../../core';

/** 外观主题色彩与毛玻璃配置 */
export interface ThemeData {
    accentColor: string;
    bgPrimary: string;
    bgSecondary: string;
    bgGradientEnd: string;
    bgGradientAngle: number;
    bgOpacity: number;
    textPrimary: string;
    textSecondary: string;
    borderColor: string;
    borderRadius: number;
    blurRadius: number;
    [key: string]: unknown;
}

/** 默认主题视觉变量兜底 */
export const DEFAULT_THEME_DATA: ThemeData = Object.freeze({
    accentColor: '#38bdf8',
    bgPrimary: '#181b24',
    bgSecondary: '#202430',
    bgGradientEnd: '#252b3b',
    bgGradientAngle: 140,
    bgOpacity: 0.95,
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 10,
    blurRadius: 18
});

export const FALLBACK_SAFE_THEME: ThemeData = { ...DEFAULT_THEME_DATA };

export interface IThemeService extends IDisposable {
    applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void;
    getCurrentTheme(): ThemeData;
    setThemePreset(presetId: string): void;
}

/**
 * 将十六进制色值解析为 [R, G, B] 数字数组
 */
export function hexToRgbArray(hexStr: string): [number, number, number] {
    if (!hexStr || typeof hexStr !== 'string') return [0, 242, 254];
    let hex = hexStr.replace(/^#/, '').trim();
    if (hex.length === 3) {
        hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;
        return [r, g, b];
    }
    return [0, 242, 254];
}

/**
 * 将十六进制色值解析为 R, G, B 字符串 (如 "0, 242, 254")
 */
export function hexToRgb(hexStr: string): string {
    return hexToRgbArray(hexStr).join(', ');
}

/**
 * 将 [R, G, B] 数字数组转换为十六进制 HEX 颜色字符串
 */
export function rgbArrayToHex([r, g, b]: [number, number, number]): string {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/**
 * 线性插值两个 HEX 颜色
 * @param t 插值系数 (t > 1 表示延伸外插)
 */
export function lerpHex(from: string, to: string, t: number): string {
    const [r1, g1, b1] = hexToRgbArray(from);
    const [r2, g2, b2] = hexToRgbArray(to);
    return rgbArrayToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/**
 * HEX 转 HSL [0-360, 0-1, 0-1]
 */
export function hexToHsl(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgbArray(hex).map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h * 360, s, l];
}

/**
 * HSL 转 HEX
 */
export function hslToHex(h: number, s: number, l: number): string {
    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
        return p;
    };
    const hN = h / 360;
    if (s === 0) {
        const v = Math.round(l * 255);
        return rgbArrayToHex([v, v, v]);
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return rgbArrayToHex([
        hue2rgb(p, q, hN + 1 / 3) * 255,
        hue2rgb(p, q, hN) * 255,
        hue2rgb(p, q, hN - 1 / 3) * 255
    ]);
}

/**
 * 动态派生强调色的高光/悬停发光色 (基于 HSL 亮度微调)
 */
export function deriveAccentHover(accentHex: string): string {
    const [h, s, l] = hexToHsl(accentHex);
    return hslToHex(h, s, Math.max(0.05, l - 0.10));
}

/**
 * 全局统一外观主题服务
 */
export class ThemeService implements IThemeService {
    private static _instance: ThemeService | null = null;
    private readonly _store: ConfigStore;
    private _subPreset?: IDisposable;
    private _subCustom?: IDisposable;
    private _isDisposed = false;

    constructor(store: ConfigStore) {
        ThemeService._instance = this;
        this._store = store;
        this.initThemeListener();
    }

    public static getInstance(): ThemeService | null {
        return ThemeService._instance;
    }

    private initThemeListener(): void {
        this._subPreset = this._store.subscribeKey('themePreset', () => {
            this.applyTheme();
        });
        this._subCustom = this._store.subscribeKey('customThemes', () => {
            this.applyTheme();
        });
        this.applyTheme();
    }

    public getCurrentTheme(): ThemeData {
        const presetId = this._store.getState().themePreset;
        const customThemes = this._store.get('customThemes') || [];

        if (presetId) {
            const found = customThemes.find((p) => p.id === presetId);
            if (found && (found as any).data) {
                return (found as any).data;
            }
            if (found && (found as any).tokens) {
                // 如果是新版存储的 tokens 格式，尝试映射
                const tokens = (found as any).tokens;
                return {
                    ...FALLBACK_SAFE_THEME,
                    accentColor: tokens['--da-primary'] || FALLBACK_SAFE_THEME.accentColor,
                    bgPrimary: tokens['--da-bg-base'] || FALLBACK_SAFE_THEME.bgPrimary,
                    bgSecondary: tokens['--da-bg-surface'] || FALLBACK_SAFE_THEME.bgSecondary,
                    textPrimary: tokens['--da-text-base'] || FALLBACK_SAFE_THEME.textPrimary,
                    textSecondary: tokens['--da-text-muted'] || FALLBACK_SAFE_THEME.textSecondary,
                    borderColor: tokens['--da-border'] || FALLBACK_SAFE_THEME.borderColor
                };
            }
        }

        return FALLBACK_SAFE_THEME;
    }

    public setThemePreset(presetId: string): void {
        this._store.set('themePreset', presetId);
    }

    /**
     * 静态纯函数：向目标节点或 document.documentElement 注入全量主题变量及衍生变量
     */
    public static applyThemeVariables(theme: ThemeData, targetNode?: HTMLElement): void {
        if (typeof document === 'undefined') return;

        const root = document.documentElement;

        const accentHex = theme.accentColor || DEFAULT_THEME_DATA.accentColor;
        const accentRgb = hexToRgb(accentHex);
        const accentHover = deriveAccentHover(accentHex);

        const bgPrimary = theme.bgPrimary || DEFAULT_THEME_DATA.bgPrimary;
        const bgSecondary = theme.bgSecondary || DEFAULT_THEME_DATA.bgSecondary;
        const bgGradientEnd = theme.bgGradientEnd || bgPrimary;
        const bgGradientAngle = theme.bgGradientAngle ?? DEFAULT_THEME_DATA.bgGradientAngle;
        const computedGradient = `linear-gradient(${bgGradientAngle}deg, ${bgPrimary} 0%, ${bgGradientEnd} 100%)`;

        const opacity = theme.bgOpacity ?? DEFAULT_THEME_DATA.bgOpacity;
        const bgSecondaryRgb = hexToRgb(bgSecondary);
        const bgSecondaryRgba = `rgba(${bgSecondaryRgb}, ${opacity})`;

        const [pR, pG, pB] = hexToRgbArray(bgPrimary);
        const isLightMode = (pR * 299 + pG * 587 + pB * 114) / 1000 > 128;

        const bgSidebar = isLightMode ? lerpHex(bgPrimary, '#0f172a', 0.03) : lerpHex(bgPrimary, '#000000', 0.28);
        const bgCard = isLightMode ? 'rgba(255, 255, 255, 0.92)' : lerpHex(bgPrimary, bgSecondary, 0.75);
        const bgCardHover = isLightMode ? '#ffffff' : lerpHex(bgPrimary, bgSecondary, 1.0);
        const bgModal = isLightMode ? 'rgba(255, 255, 255, 0.98)' : 'rgba(24, 27, 36, 0.96)';
        const bgOverlayModal = isLightMode ? 'rgba(15, 23, 42, 0.4)' : 'rgba(0, 0, 0, 0.65)';
        const bgInput = isLightMode ? '#f1f5f9' : lerpHex(bgPrimary, '#000000', 0.18);
        const bgInputHover = isLightMode ? '#e2e8f0' : lerpHex(bgPrimary, bgSecondary, 0.5);
        const bgHover = isLightMode ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
        const bgSubtle = isLightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)';
        const separator = isLightMode ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.05)';

        const statusWarning = isLightMode ? '#d97706' : '#ff9f0a';
        const statusWarningBg = isLightMode ? 'rgba(217, 119, 6, 0.12)' : 'rgba(255, 159, 10, 0.18)';
        const statusWarningBorder = isLightMode ? 'rgba(217, 119, 6, 0.35)' : 'rgba(255, 159, 10, 0.45)';

        const borderRadius = theme.borderRadius ?? DEFAULT_THEME_DATA.borderRadius;
        const blurRadius = theme.blurRadius ?? DEFAULT_THEME_DATA.blurRadius;

        const [aR, aG, aB] = hexToRgbArray(accentHex);
        const isAccentLight = (aR * 299 + aG * 587 + aB * 114) / 1000 > 165;
        const textOnAccent = isAccentLight ? '#0f172a' : '#ffffff';

        const textMuted = isLightMode ? '#64748b' : '#686870';

        const modalNodes = typeof document !== 'undefined' ? Array.from(document.querySelectorAll<HTMLElement>('.st-da-root')) : [];
        const allNodes = new Set<HTMLElement>([root, ...(targetNode ? [targetNode] : []), ...modalNodes]);

        allNodes.forEach((node) => {
            node.setAttribute('data-da-mode', isLightMode ? 'light' : 'dark');

            // 基础通用 Token
            node.style.setProperty('--da-primary', accentHex);
            node.style.setProperty('--da-primary-hover', accentHover);
            node.style.setProperty('--da-bg-base', bgPrimary);
            node.style.setProperty('--da-bg-surface', bgSecondary);
            node.style.setProperty('--da-surface-card', bgCard);
            node.style.setProperty('--da-text-base', theme.textPrimary || (isLightMode ? '#0f172a' : '#f8fafc'));
            node.style.setProperty('--da-text-muted', textMuted);
            node.style.setProperty('--da-border', theme.borderColor || (isLightMode ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.09)'));
            node.style.setProperty('--da-radius', `${borderRadius}px`);

            // 旧版与细粒度 Token
            node.style.setProperty('--da-color-scheme', isLightMode ? 'light' : 'dark');
            node.style.setProperty('--da-bg-primary', bgPrimary);
            node.style.setProperty('--da-bg-secondary', bgSecondary);
            node.style.setProperty('--da-bg-sidebar', bgSidebar);
            node.style.setProperty('--da-bg-secondary-rgba', bgSecondaryRgba);
            node.style.setProperty('--da-bg-gradient-end', bgGradientEnd);
            node.style.setProperty('--da-bg-gradient-angle', `${bgGradientAngle}deg`);
            node.style.setProperty('--da-bg-gradient', computedGradient);
            node.style.setProperty('--da-bg-card', bgCard);
            node.style.setProperty('--da-bg-card-hover', bgCardHover);
            node.style.setProperty('--da-bg-modal', bgModal);
            node.style.setProperty('--da-bg-overlay-modal', bgOverlayModal);
            node.style.setProperty('--da-bg-subtle', bgSubtle);
            node.style.setProperty('--da-bg-input', bgInput);
            node.style.setProperty('--da-bg-input-hover', bgInputHover);
            node.style.setProperty('--da-bg-hover', bgHover);
            node.style.setProperty('--da-bg-active', `rgba(${accentRgb}, 0.12)`);
            node.style.setProperty('--da-bg-opacity', String(opacity));
            node.style.setProperty('--da-separator', separator);

            node.style.setProperty('--da-text-primary', theme.textPrimary || (isLightMode ? '#0f172a' : '#f8fafc'));
            node.style.setProperty('--da-text-secondary', theme.textSecondary || (isLightMode ? '#475569' : '#94a3b8'));
            node.style.setProperty('--da-text-on-accent', textOnAccent);
            node.style.setProperty('--da-border-color', theme.borderColor || (isLightMode ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.09)'));

            node.style.setProperty('--da-accent-color', accentHex);
            node.style.setProperty('--da-accent-hover', accentHover);
            node.style.setProperty('--da-accent-rgb', accentRgb);

            node.style.setProperty('--da-status-warning', statusWarning);
            node.style.setProperty('--da-status-warning-bg', statusWarningBg);
            node.style.setProperty('--da-status-warning-border', statusWarningBorder);

            node.style.setProperty('--da-blur-radius', `${blurRadius}px`);
            node.style.setProperty('--da-radius-modal', `${borderRadius + 2}px`);
            node.style.setProperty('--da-radius-card', `${borderRadius}px`);
            node.style.setProperty('--da-radius-input', `${Math.max(4, borderRadius - 4)}px`);
            node.style.setProperty('--da-radius-btn', `${Math.max(4, borderRadius - 4)}px`);
            node.style.setProperty('--da-radius-small', `${Math.max(3, borderRadius - 6)}px`);
            node.style.setProperty('--da-radius-sm', `${Math.max(3, borderRadius - 6)}px`);
            node.style.setProperty('--da-border-radius', `${borderRadius}px`);
        });
    }

    public applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void {
        const theme = { ...this.getCurrentTheme(), ...(themeData || {}) };
        ThemeService.applyThemeVariables(theme, targetNode);
    }

    public static applyCurrentThemeToNode(targetNode?: HTMLElement): void {
        const currentTheme = ThemeService._instance ? ThemeService._instance.getCurrentTheme() : DEFAULT_THEME_DATA;
        ThemeService.applyThemeVariables(currentTheme, targetNode);
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        if (ThemeService._instance === this) {
            ThemeService._instance = null;
        }
        this._subPreset?.dispose();
        this._subCustom?.dispose();
    }
}
