/**
 * @module ui/services/theme-service
 * @description 外观主题服务 (动态管理与注入全局 --da-* 设计变量)
 */

import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, ThemeData } from '../../core/state/store-types';

export type { ThemeData };

export interface IThemeService extends IDisposable {
    applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void;
    getCurrentTheme(): ThemeData;
    setThemePreset(presetId: string): void;
}

/**
 * 系统安全防呆兜底主题 (当未配置任何主题或配置损坏时生效)
 */
export const FALLBACK_SAFE_THEME: ThemeData = {
    bgPrimary: '#0f1014',
    bgSecondary: '#1a1d24',
    bgGradientEnd: '#161920',
    bgGradientAngle: 135,
    bgOpacity: 0.95,
    accentColor: '#00f2fe',
    textPrimary: '#f2f2f7',
    textSecondary: '#8e8e93',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    blurRadius: 20,
    borderRadius: 14
};

/**
 * 将十六进制色值解析为 R, G, B 字符串 (如 "0, 242, 254")
 */
function hexToRgb(hexStr: string): string {
    if (!hexStr || typeof hexStr !== 'string') return '0, 242, 254';
    let hex = hexStr.replace(/^#/, '').trim();
    if (hex.length === 3) {
        hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;
        return `${r}, ${g}, ${b}`;
    }
    return '0, 242, 254';
}

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

    public applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void {
        if (typeof document === 'undefined') return;

        const theme = { ...this.getCurrentTheme(), ...(themeData || {}) };
        const root = targetNode || document.documentElement;

        const accentRgb = hexToRgb(theme.accentColor);
        const borderRadius = theme.borderRadius || 14;
        const blurRadius = theme.blurRadius || 20;
        const angle = theme.bgGradientAngle ?? 135;
        const gradEnd = theme.bgGradientEnd || theme.bgSecondary;

        // 1. 背景与层级
        root.style.setProperty('--da-bg-primary', theme.bgPrimary);
        root.style.setProperty('--da-bg-secondary', theme.bgSecondary);
        root.style.setProperty('--da-bg-input', theme.bgSecondary);
        root.style.setProperty('--da-bg-active', `rgba(${accentRgb}, 0.12)`);
        root.style.setProperty(
            '--da-bg-gradient',
            `linear-gradient(${angle}deg, ${theme.bgPrimary}, ${gradEnd})`
        );

        // 2. 文字与边框
        root.style.setProperty('--da-text-primary', theme.textPrimary);
        root.style.setProperty('--da-text-secondary', theme.textSecondary);
        root.style.setProperty('--da-border-color', theme.borderColor);

        // 3. 强调色与高亮衍生
        root.style.setProperty('--da-accent-color', theme.accentColor);
        root.style.setProperty('--da-accent-rgb', accentRgb);
        root.style.setProperty('--da-accent-hover', theme.accentColor);

        // 4. 滤镜与材质
        root.style.setProperty('--da-blur-radius', `${blurRadius}px`);

        // 5. 圆角半径体系 (与 main.css 完整对齐)
        root.style.setProperty('--da-radius-modal', `${borderRadius + 4}px`);
        root.style.setProperty('--da-radius-card', `${borderRadius}px`);
        root.style.setProperty('--da-radius-input', `${Math.max(6, borderRadius - 4)}px`);
        root.style.setProperty('--da-radius-btn', `${Math.max(6, borderRadius - 4)}px`);
        root.style.setProperty('--da-radius-small', `${Math.max(4, borderRadius - 6)}px`);
        root.style.setProperty('--da-border-radius', `${borderRadius}px`);
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._subPreset?.dispose();
        this._subCustom?.dispose();
    }
}
