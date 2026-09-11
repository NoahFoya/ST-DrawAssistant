/**
 * 外观主题服务
 * 动态计算并注入全局 --da-* CSS 设计变量，支持内置深浅色主题与自定义调色盘
 */

import { IDisposable } from '../../types';
import { SettingsStore } from '../../state';

/** 外观主题色彩、材质与版式全要素配置 */
export interface ThemeData {
    // 1. 品牌与强调色族
    accentColor: string;
    accentHover?: string;
    accentCyan?: string;
    accentGlow?: string;

    // 2. 表面与层叠色阶
    bgPrimary: string;
    bgSecondary: string;
    bgSidebar?: string;
    bgCard?: string;
    bgCardHover?: string;
    bgInput?: string;
    bgInputHover?: string;
    bgGradientEnd: string;
    bgGradientAngle: number;
    bgOpacity: number;

    // 3. 文本与前景色阶
    textPrimary: string;
    textSecondary: string;
    textMuted?: string;
    textOnAccent?: string;

    // 4. 边框、质感与环境光
    borderColor: string;
    borderHighlight?: string;
    borderGlow?: string;
    insetTopLight?: boolean | number | string;
    blurRadius: number;
    blurModal?: number;
    blurPanel?: number;

    // 5. 几何、圆角与阴影
    borderRadius: number;
    radiusModal?: number;
    radiusCard?: number;
    radiusInput?: number;
    radiusBtn?: number;
    shadowIntensity?: number;

    [key: string]: unknown;
}

/**
 * 安全兜底主题数据
 * 用于系统启动保底以及所有预设被删除时的防护；不进入主题列表，仅在无可用预设时加载。
 */
export const FALLBACK_SAFE_THEME: ThemeData = Object.freeze({
    accentColor: '#38bdf8',
    accentCyan: '#06b6d4',
    bgPrimary: '#181b24',
    bgSecondary: '#202430',
    bgSidebar: '#13151c',
    bgCard: '#1f2430',
    bgCardHover: '#262c3a',
    bgInput: '#12141a',
    bgInputHover: '#1c202a',
    bgGradientEnd: '#252b3b',
    bgGradientAngle: 140,
    bgOpacity: 0.95,
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderHighlight: 'rgba(56, 189, 248, 0.45)',
    borderRadius: 10,
    radiusModal: 12,
    radiusCard: 10,
    radiusInput: 6,
    blurRadius: 18,
    blurModal: 18,
    blurPanel: 20
});

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
 * 全局外观主题服务
 * 负责解析当前生效主题配置，计算衍生色彩与渐变，向目标节点注入 --da-* 设计变量
 */
export class ThemeService implements IThemeService {
    private static _instance: ThemeService | null = null;
    /** 运行时主题数据字典（由本地配置与预设加载后注册） */
    private static readonly _themeRegistry = new Map<string, ThemeData>();
    private static readonly _themeNames = new Map<string, string>();

    private readonly _store: SettingsStore;
    private _subPreset?: IDisposable;
    private _isDisposed = false;

    constructor(store: SettingsStore) {
        ThemeService._instance = this;
        this._store = store;
        this.initThemeListener();
    }

    public static getInstance(): ThemeService | null {
        return ThemeService._instance;
    }

    /**
     * 注册/更新外部主题方案池
     * 从本地配置加载或保存新主题后调用，同步更新内存字典并即时应用
     */
    public static registerThemes(themes: Array<{ id: string; name?: string; data?: ThemeData }>): void {
        themes.forEach((t) => {
            if (t.id && t.data) {
                ThemeService._themeRegistry.set(t.id, { ...t.data });
                if (t.name) {
                    ThemeService._themeNames.set(t.id, t.name);
                }
            }
        });
        ThemeService._instance?.applyTheme();
    }

    /**
     * 从主题池中注销指定 ID 的方案
     */
    public static unregisterTheme(id: string): void {
        ThemeService._themeRegistry.delete(id);
        ThemeService._themeNames.delete(id);
    }

    /**
     * 获取当前已注册的主题方案列表（含展示名称）
     * 仅返回注册表中的主题，硬编码兜底安全主题不进入主题列表
     */
    public static getRegisteredThemes(): Array<{ id: string; name: string }> {
        const list: Array<{ id: string; name: string }> = [];
        ThemeService._themeRegistry.forEach((_, id) => {
            const name = ThemeService._themeNames.get(id) || id;
            list.push({ id, name });
        });
        return list;
    }

    private initThemeListener(): void {
        this._subPreset = this._store.subscribeKey('themePreset', () => {
            this.applyTheme();
        });
        this.applyTheme();
    }

    /**
     * 获取当前生效的主题数据
     * 优先从已注册的主题字典中检索；若当前 ID 未命中，尝试使用注册表中的第一个可用主题；
     * 若注册表为空（如用户删除了所有主题），则以硬编码安全主题作为终极兜底直接加载。
     */
    public getCurrentTheme(): ThemeData {
        const presetId = this._store.getState().themePreset || '';

        const registered = ThemeService._themeRegistry.get(presetId);
        if (registered) {
            return { ...registered };
        }

        // 若当前选中的 preset 未在注册表中找到，尝试使用注册表中的第一个主题
        const firstEntry = ThemeService._themeRegistry.values().next();
        if (!firstEntry.done && firstEntry.value) {
            return { ...firstEntry.value };
        }

        // 终极安全兜底：无任何可用主题时加载硬编码安全主题（不进入主题列表）
        return { ...FALLBACK_SAFE_THEME };
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

        const accentHex = theme.accentColor || FALLBACK_SAFE_THEME.accentColor;
        const accentRgb = hexToRgb(accentHex);
        const accentHover = theme.accentHover || deriveAccentHover(accentHex);
        const accentCyan = theme.accentCyan || '#06b6d4';
        const accentCyanRgb = hexToRgb(accentCyan);
        const accentGlow = theme.accentGlow || `0 0 20px rgba(${accentRgb}, 0.45)`;

        const bgPrimary = theme.bgPrimary || FALLBACK_SAFE_THEME.bgPrimary;
        const bgPrimaryRgb = hexToRgb(bgPrimary);
        const bgSecondary = theme.bgSecondary || FALLBACK_SAFE_THEME.bgSecondary;
        const bgSecondaryRgb = hexToRgb(bgSecondary);
        const bgGradientEnd = theme.bgGradientEnd || bgPrimary;
        const bgGradientAngle = theme.bgGradientAngle ?? FALLBACK_SAFE_THEME.bgGradientAngle;
        const computedGradient = `linear-gradient(${bgGradientAngle}deg, ${bgPrimary} 0%, ${bgGradientEnd} 100%)`;

        const opacity = theme.bgOpacity ?? FALLBACK_SAFE_THEME.bgOpacity;
        const bgSecondaryRgba = `rgba(${bgSecondaryRgb}, ${opacity})`;

        const [pR, pG, pB] = hexToRgbArray(bgPrimary);
        const isLightMode = (pR * 299 + pG * 587 + pB * 114) / 1000 > 128;

        const bgSidebar = theme.bgSidebar || (isLightMode ? lerpHex(bgPrimary, '#0f172a', 0.03) : lerpHex(bgPrimary, '#000000', 0.28));
        const bgCard = theme.bgCard || (isLightMode ? 'rgba(255, 255, 255, 0.92)' : lerpHex(bgPrimary, bgSecondary, 0.75));
        const bgCardHover = theme.bgCardHover || (isLightMode ? '#ffffff' : lerpHex(bgPrimary, bgSecondary, 1.0));
        const bgModal = isLightMode ? 'rgba(255, 255, 255, 0.98)' : 'rgba(24, 27, 36, 0.96)';
        const bgOverlayModal = isLightMode ? 'rgba(15, 23, 42, 0.4)' : 'rgba(0, 0, 0, 0.65)';
        const bgInput = theme.bgInput || (isLightMode ? '#f1f5f9' : lerpHex(bgPrimary, '#000000', 0.18));
        const bgInputHover = theme.bgInputHover || (isLightMode ? '#e2e8f0' : lerpHex(bgPrimary, bgSecondary, 0.5));
        const bgHover = isLightMode ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
        const bgSubtle = isLightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)';
        const separator = isLightMode ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.05)';

        const borderColor = theme.borderColor || (isLightMode ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.09)');
        const borderHighlight = theme.borderHighlight || `rgba(${accentRgb}, 0.45)`;
        const borderGlow = theme.borderGlow || `0 0 16px rgba(${accentRgb}, 0.35)`;

        let insetTopLight = `inset 0 1px 0 0 rgba(${accentRgb}, 0.15)`;
        if (theme.insetTopLight === false) {
            insetTopLight = 'none';
        } else if (typeof theme.insetTopLight === 'string') {
            insetTopLight = theme.insetTopLight;
        }

        const statusWarning = isLightMode ? '#d97706' : '#ff9f0a';
        const statusWarningBg = isLightMode ? 'rgba(217, 119, 6, 0.12)' : 'rgba(255, 159, 10, 0.18)';
        const statusWarningBorder = isLightMode ? 'rgba(217, 119, 6, 0.35)' : 'rgba(255, 159, 10, 0.45)';

        const borderRadius = theme.borderRadius ?? FALLBACK_SAFE_THEME.borderRadius ?? 10;
        const radiusModal = theme.radiusModal ?? (borderRadius + 2);
        const radiusCard = theme.radiusCard ?? borderRadius;
        const radiusInput = theme.radiusInput ?? Math.max(4, borderRadius - 4);
        const radiusBtn = theme.radiusBtn ?? radiusInput;

        const blurRadius = theme.blurRadius ?? FALLBACK_SAFE_THEME.blurRadius ?? 18;
        const blurModal = theme.blurModal ?? blurRadius;
        const blurPanel = theme.blurPanel ?? (blurRadius + 2);

        const [aR, aG, aB] = hexToRgbArray(accentHex);
        const isAccentLight = (aR * 299 + aG * 587 + aB * 114) / 1000 > 165;
        const textOnAccent = theme.textOnAccent || (isAccentLight ? '#0f172a' : '#ffffff');

        const textMuted = theme.textMuted || (isLightMode ? '#64748b' : '#686870');

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
            node.style.setProperty('--da-border', borderColor);
            node.style.setProperty('--da-radius', `${borderRadius}px`);

            // 表面与层叠色阶
            node.style.setProperty('--da-color-scheme', isLightMode ? 'light' : 'dark');
            node.style.setProperty('--da-bg-primary', bgPrimary);
            node.style.setProperty('--da-bg-primary-rgb', bgPrimaryRgb);
            node.style.setProperty('--da-bg-secondary', bgSecondary);
            node.style.setProperty('--da-bg-secondary-rgb', bgSecondaryRgb);
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

            // 文本色阶
            node.style.setProperty('--da-text-primary', theme.textPrimary || (isLightMode ? '#0f172a' : '#f8fafc'));
            node.style.setProperty('--da-text-secondary', theme.textSecondary || (isLightMode ? '#475569' : '#94a3b8'));
            node.style.setProperty('--da-text-on-accent', textOnAccent);

            // 边框、顶光与光晕
            node.style.setProperty('--da-border-color', borderColor);
            node.style.setProperty('--da-border-highlight', borderHighlight);
            node.style.setProperty('--da-border-glow', borderGlow);
            node.style.setProperty('--da-inset-top-light', insetTopLight);

            // 品牌强调色与 RGB 通道
            node.style.setProperty('--da-accent-color', accentHex);
            node.style.setProperty('--da-accent-hover', accentHover);
            node.style.setProperty('--da-accent-rgb', accentRgb);
            node.style.setProperty('--da-accent-cyan', accentCyan);
            node.style.setProperty('--da-accent-cyan-rgb', accentCyanRgb);
            node.style.setProperty('--da-accent-glow', accentGlow);

            // 状态反馈色
            node.style.setProperty('--da-status-warning', statusWarning);
            node.style.setProperty('--da-status-warning-bg', statusWarningBg);
            node.style.setProperty('--da-status-warning-border', statusWarningBorder);

            // 模糊与圆角梯度
            node.style.setProperty('--da-blur-radius', `${blurRadius}px`);
            node.style.setProperty('--da-blur-modal', `${blurModal}px`);
            node.style.setProperty('--da-blur-panel', `${blurPanel}px`);
            node.style.setProperty('--da-radius-modal', `${radiusModal}px`);
            node.style.setProperty('--da-radius-card', `${radiusCard}px`);
            node.style.setProperty('--da-radius-input', `${radiusInput}px`);
            node.style.setProperty('--da-radius-btn', `${radiusBtn}px`);
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
        const currentTheme = ThemeService._instance ? ThemeService._instance.getCurrentTheme() : FALLBACK_SAFE_THEME;
        ThemeService.applyThemeVariables(currentTheme, targetNode);
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        if (ThemeService._instance === this) {
            ThemeService._instance = null;
        }
        this._subPreset?.dispose();
    }
}
