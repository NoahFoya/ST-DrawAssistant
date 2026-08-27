/**
 * @module ui/foundation/theme-service
 * @description 外观主题服务 (单一事实来源，负责动态计算并注入全局 --da-* CSS 设计变量)
 */

import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, ThemeData } from '../../core/state/store-types';
import { DEFAULT_THEME_DATA } from '../../core/constants';

export type { ThemeData };

export interface IThemeService extends IDisposable {
    applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void;
    getCurrentTheme(): ThemeData;
    setThemePreset(presetId: string): void;
}

/** 系统备用主题 (直接引用全局默认主题常量) */
export const FALLBACK_SAFE_THEME: ThemeData = { ...DEFAULT_THEME_DATA };

/**
 * 将十六进制色值解析为 [R, G, B] 数字数组
 */
export function hexToRgbArr(hexStr: string): [number, number, number] {
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
    return hexToRgbArr(hexStr).join(', ');
}

/**
 * 将 [R, G, B] 数字数组转换为十六进制 HEX 颜色字符串
 */
export function rgbArrToHex([r, g, b]: [number, number, number]): string {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/**
 * 线性插值两个 HEX 颜色
 * @param t 插值系数 (t > 1 表示延伸外插)
 */
export function lerpHex(from: string, to: string, t: number): string {
    const [r1, g1, b1] = hexToRgbArr(from);
    const [r2, g2, b2] = hexToRgbArr(to);
    return rgbArrToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/**
 * HEX 转 HSL [0-360, 0-1, 0-1]
 */
export function hexToHsl(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgbArr(hex).map((v) => v / 255);
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
        return rgbArrToHex([v, v, v]);
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return rgbArrToHex([
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
    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private _subPreset?: IDisposable;
    private _subCustom?: IDisposable;
    private _isDisposed = false;

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        this._store = store;
        this.initThemeListener();
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
            if (found?.data) return found.data;
        }

        return customThemes[0]?.data || FALLBACK_SAFE_THEME;
    }

    public setThemePreset(presetId: string): void {
        this._store.set('themePreset', presetId);
    }

    /**
     * 静态纯函数：向指定 DOM 或全局节点注入全量主题变量及衍生变量
     */
    public static applyThemeVariables(theme: ThemeData, targetNode?: HTMLElement): void {
        if (typeof document === 'undefined') return;

        const rawNodes = targetNode
            ? [targetNode]
            : [
                document.documentElement,
                ...Array.from(document.querySelectorAll<HTMLElement>('.da-settings-panel')),
                ...Array.from(document.querySelectorAll<HTMLElement>('.st-da-root')),
                ...Array.from(document.querySelectorAll<HTMLElement>('.da-modal-backdrop')),
                ...Array.from(document.querySelectorAll<HTMLElement>('.da-fab-container'))
            ];
        const targetNodes = Array.from(new Set(rawNodes.filter((n): n is HTMLElement => Boolean(n))));

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

        const bgInput = lerpHex(bgPrimary, bgSecondary, 2.0);
        const bgHover = lerpHex(bgPrimary, bgSecondary, 3.0);

        const [pR, pG, pB] = hexToRgbArr(bgPrimary);
        const isLightMode = (pR * 299 + pG * 587 + pB * 114) / 1000 > 128;

        const bgCard = isLightMode ? '#ffffff' : 'rgba(255, 255, 255, 0.04)';
        const bgSubtle = isLightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.05)';
        const statusWarning = isLightMode ? '#d97706' : '#ff9f0a';
        const statusWarningBg = isLightMode ? 'rgba(217, 119, 6, 0.12)' : 'rgba(255, 159, 10, 0.18)';
        const statusWarningBorder = isLightMode ? 'rgba(217, 119, 6, 0.35)' : 'rgba(255, 159, 10, 0.45)';

        const borderRadius = theme.borderRadius ?? DEFAULT_THEME_DATA.borderRadius;
        const blurRadius = theme.blurRadius ?? DEFAULT_THEME_DATA.blurRadius;

        targetNodes.forEach((node) => {
            node.setAttribute('data-da-mode', isLightMode ? 'light' : 'dark');

            node.style.setProperty('--da-bg-primary', bgPrimary);
            node.style.setProperty('--da-bg-secondary', bgSecondary);
            node.style.setProperty('--da-bg-secondary-rgba', bgSecondaryRgba);
            node.style.setProperty('--da-bg-gradient-end', bgGradientEnd);
            node.style.setProperty('--da-bg-gradient-angle', `${bgGradientAngle}deg`);
            node.style.setProperty('--da-bg-gradient', computedGradient);
            node.style.setProperty('--da-bg-card', bgCard);
            node.style.setProperty('--da-bg-subtle', bgSubtle);
            node.style.setProperty('--da-bg-input', bgInput);
            node.style.setProperty('--da-bg-hover', bgHover);
            node.style.setProperty('--da-bg-active', `rgba(${accentRgb}, 0.12)`);
            node.style.setProperty('--da-bg-opacity', String(opacity));

            node.style.setProperty('--da-text-primary', theme.textPrimary || (isLightMode ? '#1e293b' : '#f8fafc'));
            node.style.setProperty('--da-text-secondary', theme.textSecondary || (isLightMode ? '#64748b' : '#94a3b8'));
            node.style.setProperty('--da-border-color', theme.borderColor || (isLightMode ? '#cbd5e1' : 'rgba(255, 255, 255, 0.09)'));

            node.style.setProperty('--da-accent-color', accentHex);
            node.style.setProperty('--da-accent-hover', accentHover);
            node.style.setProperty('--da-accent-rgb', accentRgb);

            node.style.setProperty('--da-status-warning', statusWarning);
            node.style.setProperty('--da-status-warning-bg', statusWarningBg);
            node.style.setProperty('--da-status-warning-border', statusWarningBorder);

            node.style.setProperty('--da-blur-radius', `${blurRadius}px`);
            node.style.setProperty('--da-radius-modal', `${borderRadius + 4}px`);
            node.style.setProperty('--da-radius-card', `${borderRadius}px`);
            node.style.setProperty('--da-radius-input', `${Math.max(4, borderRadius - 4)}px`);
            node.style.setProperty('--da-radius-btn', `${Math.max(4, borderRadius - 4)}px`);
            node.style.setProperty('--da-radius-small', `${Math.max(4, borderRadius - 6)}px`);
            node.style.setProperty('--da-border-radius', `${borderRadius}px`);
        });
    }

    public applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void {
        const theme = { ...this.getCurrentTheme(), ...(themeData || {}) };
        ThemeService.applyThemeVariables(theme, targetNode);
    }

    public static applyCurrentThemeToNode(targetNode: HTMLElement): void {
        ThemeService.applyThemeVariables(DEFAULT_THEME_DATA, targetNode);
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._subPreset?.dispose();
        this._subCustom?.dispose();
    }
}
