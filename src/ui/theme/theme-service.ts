/**
 * 主题管理服务 (ThemeService)。
 *
 * @remarks
 * 负责管理插件 CSS 变量设计令牌与主题切换监听：
 * 1. 动态加载出厂精选主题预设与用户自定义主题列表；
 * 2. 将主题令牌参数精准映射并注入至宿主根节点或目标视窗 DOM（`:root` / `document.documentElement`）；
 * 3. 自动派生 `--da-accent-rgb` 等色彩透明度计算分量，保障高斯模糊与发光描边协调；
 * 4. 监听 `settingsStore` 配置广播，动态切换全局主题。
 */

import type { Disposable } from '../types';
import type { PresetItem, ThemePresetData } from '@types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import recommendedThemesData from '../../../config/presets/themes.json';

/** Hex 颜色转 RGB 数值三元组字符串辅助函数 */
function hexToRgb(hex?: string): string | null {
    if (!hex || typeof hex !== 'string') return null;
    const cleanHex = hex.replace('#', '').trim();
    if (cleanHex.length === 3) {
        const r = parseInt(cleanHex[0] + cleanHex[0], 16);
        const g = parseInt(cleanHex[1] + cleanHex[1], 16);
        const b = parseInt(cleanHex[2] + cleanHex[2], 16);
        return `${r}, ${g}, ${b}`;
    }
    if (cleanHex.length === 6) {
        const r = parseInt(cleanHex.substring(0, 2), 16);
        const g = parseInt(cleanHex.substring(2, 4), 16);
        const b = parseInt(cleanHex.substring(4, 6), 16);
        return `${r}, ${g}, ${b}`;
    }
    return null;
}

export class ThemeService implements Disposable {
    private targetElement: HTMLElement | null = null;
    private unlistenSettingsCallback: (() => void) | null = null;

    /**
     * 绑定应用主题的目标容器元素，默认绑定 document.documentElement。
     *
     * @param target 目标挂载元素
     */
    public bindTarget(target?: HTMLElement): void {
        if (typeof document !== 'undefined') {
            this.targetElement = target ?? document.documentElement;
        }
    }

    /**
     * 获取所有可用主题预设列表。
     * 优先从 settingsStore 中读取，若未配置则读取静态推荐预设。
     */
    public getAvailableThemes(): PresetItem<ThemePresetData>[] {
        const storeThemes = settingsStore.getPresets<ThemePresetData>('themes');
        if (storeThemes && storeThemes.length > 0) {
            return storeThemes;
        }
        return (recommendedThemesData as PresetItem<ThemePresetData>[]) || [];
    }

    /**
     * 根据主题标识符查询主题数据项。
     *
     * @param id 主题标识符
     */
    public getThemeById(id: string): PresetItem<ThemePresetData> | undefined {
        const list = this.getAvailableThemes();
        return list.find((item) => item.id === id);
    }

    /**
     * 应用当前配置中心中保存的主题。
     *
     * @param overrides 额外的局部微调覆盖项（如用户自定义的圆角或主色）
     */
    public applyCurrentTheme(overrides?: Partial<ThemePresetData>): void {
        if (!this.targetElement && typeof document !== 'undefined') {
            this.targetElement = document.documentElement;
        }

        const currentThemeId = (settingsStore.get('themePreset') as string) || 'dark';
        this.applyTheme(currentThemeId, overrides);
    }

    /**
     * 将指定主题的 CSS 变量设计令牌应用到目标容器。
     *
     * @param themeId 主题标识符
     * @param overrides 额外的局部微调覆盖项
     */
    public applyTheme(themeId: string, overrides?: Partial<ThemePresetData>): void {
        if (!this.targetElement && typeof document !== 'undefined') {
            this.targetElement = document.documentElement;
        }
        if (!this.targetElement || !this.targetElement.style) {
            return;
        }

        const theme = this.getThemeById(themeId) ?? this.getThemeById('dark') ?? this.getAvailableThemes()[0];
        if (!theme || !theme.data) {
            return;
        }

        const merged: ThemePresetData = {
            ...theme.data,
            ...overrides,
        };

        const target = this.targetElement;

        // 1. 设置主题标记与深浅配色标识
        const isLight = themeId === 'light' || themeId === 'sky-light';
        target.setAttribute('data-theme', themeId);
        target.style.setProperty('--da-color-scheme', isLight ? 'light' : 'dark');

        // 2. 基础颜色令牌映射
        if (merged.accentColor) {
            target.style.setProperty('--da-accent-color', merged.accentColor);
            const rgb = hexToRgb(merged.accentColor);
            if (rgb) {
                target.style.setProperty('--da-accent-rgb', rgb);
            }
        }
        if (merged.accentCyan) {
            target.style.setProperty('--da-accent-cyan', merged.accentCyan);
            const rgb = hexToRgb(merged.accentCyan);
            if (rgb) {
                target.style.setProperty('--da-accent-cyan-rgb', rgb);
            }
        }
        if (merged.bgPrimary) target.style.setProperty('--da-bg-primary', merged.bgPrimary);
        if (merged.bgSecondary) target.style.setProperty('--da-bg-secondary', merged.bgSecondary);
        if (merged.bgSidebar) target.style.setProperty('--da-bg-sidebar', merged.bgSidebar);
        if (merged.bgCard) target.style.setProperty('--da-bg-card', merged.bgCard);
        if (merged.bgCardHover) target.style.setProperty('--da-bg-card-hover', merged.bgCardHover);
        if (merged.bgInput) target.style.setProperty('--da-bg-input', merged.bgInput);
        if (merged.bgInputHover) target.style.setProperty('--da-bg-input-hover', merged.bgInputHover);
        if (merged.textPrimary) target.style.setProperty('--da-text-primary', merged.textPrimary);
        if (merged.textSecondary) target.style.setProperty('--da-text-secondary', merged.textSecondary);
        if (merged.borderColor) target.style.setProperty('--da-border-color', merged.borderColor);
        if (merged.borderHighlight) target.style.setProperty('--da-border-highlight', merged.borderHighlight);

        // 3. 几何规格与毛玻璃滤镜
        if (merged.borderRadius !== undefined) {
            target.style.setProperty('--da-border-radius', `${merged.borderRadius}px`);
        }
        if (merged.radiusModal !== undefined) {
            target.style.setProperty('--da-radius-modal', `${merged.radiusModal}px`);
        }
        if (merged.radiusCard !== undefined) {
            target.style.setProperty('--da-radius-card', `${merged.radiusCard}px`);
        }
        if (merged.radiusInput !== undefined) {
            target.style.setProperty('--da-radius-input', `${merged.radiusInput}px`);
        }
        if (merged.blurModal !== undefined) {
            target.style.setProperty('--da-blur-modal', `${merged.blurModal}px`);
        }
        if (merged.blurPanel !== undefined) {
            target.style.setProperty('--da-blur-panel', `${merged.blurPanel}px`);
        }
    }

    /**
     * 监听配置变更并联动更新主题。
     */
    public listenSettings(): void {
        if (this.unlistenSettingsCallback) {
            return;
        }

        const handler = () => {
            this.applyCurrentTheme();
        };

        eventBus.on('settings:updated', handler);
        this.unlistenSettingsCallback = () => {
            eventBus.off('settings:updated', handler);
        };
    }

    /**
     * 释放事件监听与容器引用。
     */
    public dispose(): void {
        if (this.unlistenSettingsCallback) {
            this.unlistenSettingsCallback();
            this.unlistenSettingsCallback = null;
        }
        this.targetElement = null;
    }
}

export const themeService = new ThemeService();
