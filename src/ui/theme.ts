/**
 * 主题服务运行时 (ThemeService)
 *
 * 功能：
 * 1. 动态向 :root 或 .st-da-root 容器注入 CSS 变量；
 * 2. 自动将 Hex 颜色值计算为 RGB 分量 (r, g, b)，支持 rgba(var(--da-*-rgb), alpha) 渲染；
 * 3. 动态切换 [data-da-mode="light"] / [data-da-mode="dark"] 浅色/深色主题适配规则；
 * 4. 运行时读取预设方案 (themes.json) 与用户自定义主题。
 *
 * Tips：
 * 1. 代码中硬编码安全备用主题 (SAFE_THEME)，仅在无可用预设时作为缺省值回退；
 * 2. 切换预设后自动触发 CSS 变量刷新并广播主题变更通知。
 */

import { hexToRgb } from '../util/color';
import type { SettingsStore } from '../store/settings';
import { PresetManager } from '../store/preset';

/** 主题配色与质感配置接口 */
export interface ThemeConfig {
    readonly id?: string;
    readonly name?: string;
    /** 主题强调色 (Hex, 如 #8b5cf6) */
    accentColor: string;
    accentCyan?: string;
    /** 主背景色 (Hex, 如 #07080d) */
    bgPrimary: string;
    /** 渐变结束色 (Hex, 如 #0e121e) */
    bgSecondary: string;
    bgSidebar?: string;
    /** 卡片背景色 (Hex, 如 #121522) */
    bgCard: string;
    bgCardHover?: string;
    bgInput?: string;
    bgInputHover?: string;
    bgGradientEnd?: string;
    /** 主文本颜色 (Hex, 如 #f8fafc) */
    textPrimary: string;
    /** 次要文本颜色 (Hex, 如 #94a3b8) */
    textSecondary: string;
    textMuted?: string;
    /** 边框线条颜色 (Hex 或 rgba, 如 #ffffff17) */
    borderColor: string;
    borderHighlight?: string;
    /** 背景渐变角度 (deg, 如 140) */
    gradientAngle?: number;
    bgGradientAngle?: number;
    /** 背景不透明度 (百分比 0-100 或 0-1) */
    opacity?: number;
    bgOpacity?: number;
    /** 背景毛玻璃虚化 (px, 如 18) */
    blur?: number;
    blurRadius?: number;
    blurModal?: number;
    blurPanel?: number;
    /** 界面圆角半径 (px, 如 10) */
    borderRadius?: number;
    radiusModal?: number;
    radiusCard?: number;
    radiusInput?: number;
    /** 主题模式 (dark / light) */
    mode?: 'dark' | 'light';
}

/**
 * 唯一的安全备用主题 (Safe Fallback Theme)
 * 仅用于代码内部回退容错，不显示在 UI 预设列表中。
 */
export const SAFE_THEME: ThemeConfig = {
    id: 'safe-fallback',
    name: '安全备用主题',
    accentColor: '#3b82f6',
    bgPrimary: '#181b24',
    bgSecondary: '#202430',
    bgSidebar: '#13151c',
    bgCard: '#1f2430',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    gradientAngle: 140,
    opacity: 95,
    blur: 16,
    borderRadius: 10,
    mode: 'dark'
};

export class ThemeService {
    private static _instance: ThemeService | null = null;
    private _targetElement: HTMLElement | null = null;
    private _currentConfig: ThemeConfig;
    private _settingsStore?: SettingsStore;
    private _unsubs: (() => void)[] = [];

    private constructor() {
        this._currentConfig = { ...SAFE_THEME };
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
        this._cleanupListeners();
        if (typeof document !== 'undefined') {
            this._targetElement = targetElement ?? document.documentElement;
        }
        this._settingsStore = settingsStore;

        if (this._settingsStore) {
            const subPreset = this._settingsStore.onKeyChange('themePreset', (presetId) => {
                this.applyPresetById(presetId);
            });
            const subPresetsList = this._settingsStore.onKeyChange('presets', () => {
                this.applyPresetById(this._settingsStore?.get('themePreset'));
            });
            this._unsubs.push(() => subPreset.dispose(), () => subPresetsList.dispose());

            this.applyPresetById(this._settingsStore.get('themePreset'));
        } else {
            this.applyTheme(this._currentConfig);
        }
    }

    /**
     * 根据主题预设 ID 读取并应用方案
     * 优先从 PresetManager 读取配置预设 (config/presets/themes.json + 自定义主题)，
     * 若未找到或数据为空，则平滑降级至 SAFE_THEME 回退默认值。
     */
    public applyPresetById(presetId?: string): void {
        const id = presetId || (this._settingsStore ? this._settingsStore.get('themePreset') : undefined) || 'dark';
        let foundConfig: ThemeConfig | null = null;

        if (this._settingsStore) {
            const presetManager = new PresetManager(this._settingsStore);
            const presets = presetManager.list<Record<string, any>>('themes');
            const found = presets.find((p) => p.id === id);
            if (found && found.data) {
                foundConfig = {
                    id: found.id,
                    name: found.name,
                    ...(found.data as unknown as ThemeConfig)
                };
            }
        }

        if (!foundConfig) {
            foundConfig = { ...SAFE_THEME };
        }
        this.applyTheme(foundConfig);
    }

    /** 获取当前生效的主题配置 */
    public getCurrentTheme(): Readonly<ThemeConfig> {
        return this._currentConfig;
    }

    /**
     * 应用并注入主题配置至目标节点及所有关联弹窗根节点
     */
    public applyTheme(config: Partial<ThemeConfig>, targetNode?: HTMLElement): void {
        this._currentConfig = {
            ...this._currentConfig,
            ...config
        };

        const target = targetNode ?? this._targetElement ?? (typeof document !== 'undefined' ? document.documentElement : null);
        if (!target) return;

        const theme = this._currentConfig;
        const accentColor = theme.accentColor || SAFE_THEME.accentColor;
        const bgPrimary = theme.bgPrimary || SAFE_THEME.bgPrimary;
        const bgSecondary = theme.bgSecondary || SAFE_THEME.bgSecondary;
        const bgCard = theme.bgCard || SAFE_THEME.bgCard;
        const textPrimary = theme.textPrimary || SAFE_THEME.textPrimary;
        const textSecondary = theme.textSecondary || SAFE_THEME.textSecondary;
        const borderColor = theme.borderColor || SAFE_THEME.borderColor;
        const gradientAngle = theme.gradientAngle ?? theme.bgGradientAngle ?? 140;

        let opacity = theme.opacity ?? theme.bgOpacity ?? 95;
        if (opacity <= 1) opacity = Math.round(opacity * 100);

        const blur = theme.blur ?? theme.blurRadius ?? 16;
        const borderRadius = theme.borderRadius ?? 10;

        const bgRgb = this._computeRgb(bgPrimary);
        const isLightMode = theme.mode
            ? theme.mode === 'light'
            : bgRgb
              ? (bgRgb.r * 299 + bgRgb.g * 587 + bgRgb.b * 114) / 1000 > 128
              : false;
        const mode = isLightMode ? 'light' : 'dark';

        const modalNodes = typeof document !== 'undefined' ? Array.from(document.querySelectorAll<HTMLElement>('.st-da-root')) : [];
        const allNodes = new Set<HTMLElement>([target, ...modalNodes]);

        allNodes.forEach((node) => {
            // 1. 设置模式属性
            node.setAttribute('data-da-mode', mode);
            node.style.setProperty('--da-color-scheme', mode);

            // 2. 注入颜色及对应 RGB 分量
            if (accentColor) {
                node.style.setProperty('--da-accent-color', accentColor);
                const rgb = this._computeRgb(accentColor);
                if (rgb) node.style.setProperty('--da-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
            }

            if (bgPrimary) {
                node.style.setProperty('--da-bg-primary', bgPrimary);
                node.style.setProperty('--da-bg-canvas', bgPrimary);
            }

            if (bgSecondary) {
                node.style.setProperty('--da-bg-secondary', bgSecondary);
                node.style.setProperty('--da-bg-sidebar', theme.bgSidebar || bgSecondary);
            }

            if (bgCard) {
                node.style.setProperty('--da-bg-card', bgCard);
                node.style.setProperty('--da-bg-card-hover', theme.bgCardHover || bgCard);
            }

            if (theme.bgInput) {
                node.style.setProperty('--da-bg-input', theme.bgInput);
                node.style.setProperty('--da-bg-input-hover', theme.bgInputHover || theme.bgInput);
            }

            if (textPrimary) {
                node.style.setProperty('--da-text-primary', textPrimary);
            }

            if (textSecondary) {
                node.style.setProperty('--da-text-secondary', textSecondary);
            }

            if (theme.textMuted) {
                node.style.setProperty('--da-text-muted', theme.textMuted);
            }

            if (borderColor) {
                node.style.setProperty('--da-border-color', borderColor);
                node.style.setProperty('--da-border-highlight', theme.borderHighlight || borderColor);
            }

            // 3. 注入动态背景渐变与透明度
            if (bgPrimary && bgSecondary) {
                node.style.setProperty(
                    '--da-bg-gradient',
                    `linear-gradient(${gradientAngle}deg, ${bgSecondary} 0%, ${theme.bgGradientEnd || bgPrimary} 100%)`
                );
            }

            // 4. 注入质感参数与圆角标度
            const modalAlpha = Math.max(0.7, Math.min(1.0, opacity / 100));
            node.style.setProperty('--da-bg-modal', `rgba(13, 15, 24, ${modalAlpha})`);
            node.style.setProperty('--da-blur-modal', `${theme.blurModal ?? blur}px`);
            node.style.setProperty('--da-blur-panel', `${theme.blurPanel ?? blur}px`);
            node.style.setProperty('--da-blur-radius', `${blur}px`);

            node.style.setProperty('--da-radius-modal', `${theme.radiusModal ?? (borderRadius + 2)}px`);
            node.style.setProperty('--da-radius-card', `${theme.radiusCard ?? borderRadius}px`);
            node.style.setProperty('--da-radius-input', `${theme.radiusInput ?? Math.max(4, borderRadius - 4)}px`);
            node.style.setProperty('--da-radius-btn', `${theme.radiusInput ?? Math.max(4, borderRadius - 4)}px`);
            node.style.setProperty('--da-border-radius', `${borderRadius}px`);
        });
    }

    /** 快捷切换深色 / 浅色模式 */
    public setMode(mode: 'dark' | 'light'): void {
        if (this._settingsStore) {
            const targetId = mode === 'light' ? 'light' : 'dark';
            this._settingsStore.set('themePreset', targetId);
            this.applyPresetById(targetId);
        } else {
            if (mode === 'light') {
                this.applyTheme({
                    mode: 'light',
                    accentColor: '#0284c7',
                    bgPrimary: '#f8fafc',
                    bgSecondary: '#ffffff',
                    bgCard: 'rgba(255, 255, 255, 0.92)',
                    textPrimary: '#0f172a',
                    textSecondary: '#475569',
                    borderColor: 'rgba(15, 23, 42, 0.12)'
                });
            } else {
                this.applyTheme({ ...SAFE_THEME, mode: 'dark' });
            }
        }
    }

    /** 快捷设置强调色 */
    public setAccentColor(accentColor: string): void {
        this.applyTheme({ accentColor });
    }

    /** 释放监听函数 */
    private _cleanupListeners(): void {
        for (const unsub of this._unsubs) {
            unsub();
        }
        this._unsubs = [];
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
        this._cleanupListeners();
        this._targetElement = null;
        this._settingsStore = undefined;
    }
}
