/**
 * @module src/ui/theme
 * @description 主题服务运行时 (ThemeService)
 * 职责：
 * 1. 动态向 :root 或 .st-da-root 容器注入 CSS Design Tokens；
 * 2. 自动将 Hex 颜色值计算为 RGB 逗号分量 (r, g, b)，保障 rgba(var(--da-*-rgb), alpha) 渲染；
 * 3. 动态切换 [data-da-mode="light"] / [data-da-mode="dark"] 激活浅色/深色主题适配规则；
 * 4. 提供出厂内置主题预设 (cyberpunk, dark, midnight, sakura, emerald, light) 并支持自定义方案扩展。
 */

import { hexToRgb } from '../util/color';
import type { SettingsStore } from '../store/settings';

/** 主题配色与质感配置接口 */
export interface ThemeConfig {
    readonly id?: string;
    readonly name?: string;
    /** 主题强调色 (Hex, 如 #8b5cf6) */
    accentColor: string;
    /** 主背景色 (Hex, 如 #07080d) */
    bgPrimary: string;
    /** 渐变结束色 (Hex, 如 #0e121e) */
    bgSecondary: string;
    /** 卡片背景色 (Hex, 如 #121522) */
    bgCard: string;
    /** 主文本颜色 (Hex, 如 #f8fafc) */
    textPrimary: string;
    /** 次要文本颜色 (Hex, 如 #94a3b8) */
    textSecondary: string;
    /** 边框线条颜色 (Hex 或 rgba, 如 #ffffff17) */
    borderColor: string;
    /** 背景渐变角度 (deg, 如 140) */
    gradientAngle?: number;
    /** 背景不透明度 (百分比 0-100, 如 95) */
    opacity?: number;
    /** 背景毛玻璃虚化 (px, 如 18) */
    blur?: number;
    /** 界面圆角半径 (px, 如 10) */
    borderRadius?: number;
    /** 主题模式 (dark / light) */
    mode?: 'dark' | 'light';
}

/** 内置出厂主题预设列表 */
export const BUILTIN_THEMES: Record<string, ThemeConfig> = {
    cyberpunk: {
        id: 'cyberpunk',
        name: 'Kinetics Cyberpunk (动力赛博)',
        accentColor: '#8b5cf6',
        bgPrimary: '#07080d',
        bgSecondary: '#0d0f18',
        bgCard: '#121522',
        textPrimary: '#f8fafc',
        textSecondary: '#94a3b8',
        borderColor: '#8b5cf638',
        gradientAngle: 160,
        opacity: 96,
        blur: 16,
        borderRadius: 10,
        mode: 'dark'
    },
    dark: {
        id: 'dark',
        name: 'Classic Dark (经典深色)',
        accentColor: '#3b82f6',
        bgPrimary: '#0f172a',
        bgSecondary: '#1e293b',
        bgCard: '#1e293b',
        textPrimary: '#f8fafc',
        textSecondary: '#94a3b8',
        borderColor: '#3b82f633',
        gradientAngle: 145,
        opacity: 95,
        blur: 14,
        borderRadius: 8,
        mode: 'dark'
    },
    midnight: {
        id: 'midnight',
        name: 'Midnight Purple (午夜暗紫)',
        accentColor: '#a855f7',
        bgPrimary: '#05020c',
        bgSecondary: '#110924',
        bgCard: '#160c2e',
        textPrimary: '#faf5ff',
        textSecondary: '#a855f7',
        borderColor: '#a855f733',
        gradientAngle: 150,
        opacity: 95,
        blur: 18,
        borderRadius: 12,
        mode: 'dark'
    },
    emerald: {
        id: 'emerald',
        name: 'Emerald Matrix (黑客矩阵)',
        accentColor: '#10b981',
        bgPrimary: '#030d0a',
        bgSecondary: '#061a14',
        bgCard: '#0b241c',
        textPrimary: '#ecfdf5',
        textSecondary: '#6ee7b7',
        borderColor: '#10b98133',
        gradientAngle: 135,
        opacity: 95,
        blur: 16,
        borderRadius: 8,
        mode: 'dark'
    },
    sakura: {
        id: 'sakura',
        name: 'Sakura Neon (霓虹樱粉)',
        accentColor: '#ec4899',
        bgPrimary: '#0f050d',
        bgSecondary: '#1a0a18',
        bgCard: '#240d21',
        textPrimary: '#fdf2f8',
        textSecondary: '#f472b6',
        borderColor: '#ec489933',
        gradientAngle: 140,
        opacity: 95,
        blur: 16,
        borderRadius: 10,
        mode: 'dark'
    },
    light: {
        id: 'light',
        name: 'Pure Light (明亮浅色)',
        accentColor: '#6366f1',
        bgPrimary: '#f8fafc',
        bgSecondary: '#f1f5f9',
        bgCard: '#ffffff',
        textPrimary: '#0f172a',
        textSecondary: '#475569',
        borderColor: '#cbd5e1',
        gradientAngle: 135,
        opacity: 98,
        blur: 8,
        borderRadius: 8,
        mode: 'light'
    }
};

export class ThemeService {
    private static _instance: ThemeService | null = null;
    private _targetElement: HTMLElement | null = null;
    private _currentConfig: ThemeConfig;
    private _settingsStore?: SettingsStore;

    private constructor() {
        this._currentConfig = { ...BUILTIN_THEMES.cyberpunk };
    }

    public static getInstance(): ThemeService {
        if (!ThemeService._instance) {
            ThemeService._instance = new ThemeService();
        }
        return ThemeService._instance;
    }

    /**
     * 初始化主题服务
     * @param targetElement 绑定的根容器，默认若在浏览器环境则为 document.documentElement
     * @param settingsStore 可选关联的 SettingsStore
     */
    public init(targetElement?: HTMLElement, settingsStore?: SettingsStore): void {
        if (typeof document !== 'undefined') {
            this._targetElement = targetElement ?? document.documentElement;
        }
        this._settingsStore = settingsStore;

        if (this._settingsStore) {
            const presetId = this._settingsStore.get('themePreset') || 'cyberpunk';
            const theme = BUILTIN_THEMES[presetId] ?? BUILTIN_THEMES.cyberpunk;
            this.applyTheme(theme);
        } else {
            this.applyTheme(this._currentConfig);
        }
    }

    /** 获取当前生效的主题配置 */
    public getCurrentTheme(): Readonly<ThemeConfig> {
        return this._currentConfig;
    }

    /**
     * 应用并注入主题配置
     */
    public applyTheme(config: Partial<ThemeConfig>): void {
        this._currentConfig = {
            ...this._currentConfig,
            ...config
        };

        const target = this._targetElement ?? (typeof document !== 'undefined' ? document.documentElement : null);
        if (!target) return;

        const {
            accentColor,
            bgPrimary,
            bgSecondary,
            bgCard,
            textPrimary,
            textSecondary,
            borderColor,
            gradientAngle = 160,
            opacity = 95,
            blur = 16,
            borderRadius = 10,
            mode = 'dark'
        } = this._currentConfig;

        // 1. 设置模式属性
        target.setAttribute('data-da-mode', mode);
        target.style.setProperty('--da-color-scheme', mode);

        // 2. 注入颜色及对应 RGB 分量
        if (accentColor) {
            target.style.setProperty('--da-accent-color', accentColor);
            const rgb = this._computeRgb(accentColor);
            if (rgb) target.style.setProperty('--da-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
        }

        if (bgPrimary) {
            target.style.setProperty('--da-bg-primary', bgPrimary);
            target.style.setProperty('--da-bg-canvas', bgPrimary);
        }

        if (bgSecondary) {
            target.style.setProperty('--da-bg-secondary', bgSecondary);
            target.style.setProperty('--da-bg-sidebar', bgSecondary);
        }

        if (bgCard) {
            target.style.setProperty('--da-bg-card', bgCard);
        }

        if (textPrimary) {
            target.style.setProperty('--da-text-primary', textPrimary);
        }

        if (textSecondary) {
            target.style.setProperty('--da-text-secondary', textSecondary);
        }

        if (borderColor) {
            target.style.setProperty('--da-border-color', borderColor);
        }

        // 3. 注入动态背景渐变与透明度
        if (bgPrimary && bgSecondary) {
            target.style.setProperty(
                '--da-bg-gradient',
                `linear-gradient(${gradientAngle}deg, ${bgSecondary} 0%, ${bgPrimary} 100%)`
            );
        }

        // 4. 注入质感参数与圆角标度
        const modalAlpha = Math.max(0.7, Math.min(1.0, opacity / 100));
        target.style.setProperty('--da-bg-modal', `rgba(13, 15, 24, ${modalAlpha})`);
        target.style.setProperty('--da-blur-modal', `${blur}px`);
        target.style.setProperty('--da-blur-panel', `${blur}px`);

        target.style.setProperty('--da-radius-modal', `${borderRadius + 2}px`);
        target.style.setProperty('--da-radius-card', `${borderRadius}px`);
        target.style.setProperty('--da-radius-input', `${Math.max(4, borderRadius - 4)}px`);
        target.style.setProperty('--da-radius-btn', `${Math.max(4, borderRadius - 4)}px`);
    }

    /** 快捷切换深色 / 浅色模式 */
    public setMode(mode: 'dark' | 'light'): void {
        const themeKey = mode === 'light' ? 'light' : 'cyberpunk';
        this.applyTheme({ ...BUILTIN_THEMES[themeKey], mode });
    }

    /** 快捷设置强调色 */
    public setAccentColor(accentColor: string): void {
        this.applyTheme({ accentColor });
    }

    /** 安全解析 Hex 颜色到 RGB 分量 */
    private _computeRgb(hexColor: string): { r: number; g: number; b: number } | null {
        try {
            return hexToRgb(hexColor);
        } catch {
            return null;
        }
    }

    /** 销毁实例 */
    public dispose(): void {
        this._targetElement = null;
        this._settingsStore = undefined;
    }
}
