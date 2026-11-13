/**
 * 主题管理服务 (ThemeService)。
 *
 * @remarks
 * 负责管理插件 CSS 变量设计令牌与主题切换监听：
 * 1. 采用声明式 Token 映射注册表 (THEME_TOKEN_RULES)，将规范化主题预设直接精准映射并注入 DOM（:root / document.documentElement）；
 * 2. 具备 WCAG 感知相对亮度算法，自动自适应强调色按钮反色（#ffffff 或 #18181b）；
 * 3. 监听 settingsStore 配置广播，动态平滑切换全局主题。
 */

import type { Disposable } from '../types';
import type { PresetItem, ThemePresetData } from '@types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { SAFE_FALLBACK_THEME } from '../../config/constants';

/** Hex 颜色转 RGB 数值三元组字符串辅助函数 */
export function hexToRgb(hex?: string): string | null {
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

/**
 * 计算颜色的相对感知亮度 (WCAG 2.1 标准公式)
 * 用于自动决定强调色按钮的前景反色是深黑还是纯白，避免在浅底强调色下出现白字对比度不足。
 */
export function getPerceivedLuminance(hex?: string): number {
    if (!hex) return 0.5;
    const rgb = hexToRgb(hex);
    if (!rgb) return 0.5;
    const [r, g, b] = rgb.split(',').map((v) => parseInt(v.trim(), 10) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 声明式设计令牌映射规则定义 */
interface TokenMappingRule {
    cssVar: string;
    resolve: (data: ThemePresetData) => string | undefined;
}

/** 核心设计令牌声明式映射字典 */
const THEME_TOKEN_RULES: TokenMappingRule[] = [
    // 1. 品牌与强调流光体系
    { cssVar: '--da-accent-color', resolve: (d) => d.accent },
    { cssVar: '--da-accent-rgb', resolve: (d) => (d.accent ? hexToRgb(d.accent) ?? undefined : undefined) },
    { cssVar: '--da-accent-secondary', resolve: (d) => d.accentSecondary },
    {
        cssVar: '--da-accent-secondary-rgb',
        resolve: (d) => (d.accentSecondary ? hexToRgb(d.accentSecondary) ?? undefined : undefined),
    },
    { cssVar: '--da-accent-hover', resolve: (d) => d.accentHover || d.accent },
    {
        cssVar: '--da-accent-glow',
        resolve: (d) => {
            const bg = d.bgPrimary || d.bgCanvas || '#141418';
            if (getPerceivedLuminance(bg) > 0.55) {
                return 'none';
            }
            return d.accentGlow || (d.accent ? `0 0 20px rgba(${hexToRgb(d.accent)}, 0.22)` : undefined);
        },
    },
    {
        cssVar: '--da-card-glow',
        resolve: (d) => {
            const bg = d.bgPrimary || d.bgCanvas || '#141418';
            if (getPerceivedLuminance(bg) > 0.55) {
                return 'none';
            }
            const accentRgb = hexToRgb(d.accent) || '129, 140, 248';
            return `0 8px 24px -4px rgba(0, 0, 0, 0.45), 0 0 16px -2px rgba(${accentRgb}, 0.15)`;
        },
    },
    {
        cssVar: '--da-inset-top-light',
        resolve: (d) => {
            const bg = d.bgPrimary || d.bgCanvas || '#141418';
            if (getPerceivedLuminance(bg) > 0.55) {
                return 'none';
            }
            return 'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)';
        },
    },
    { cssVar: '--da-accent-gradient', resolve: (d) => d.accentGradient },

    // 2. 文本与内容层级体系
    { cssVar: '--da-text-primary', resolve: (d) => d.textPrimary },
    { cssVar: '--da-text-secondary', resolve: (d) => d.textSecondary },
    { cssVar: '--da-text-muted', resolve: (d) => d.textMuted },
    {
        cssVar: '--da-text-on-accent',
        resolve: (d) =>
            d.textOnAccent || (d.accent ? (getPerceivedLuminance(d.accent) > 0.6 ? '#18181b' : '#ffffff') : undefined),
    },

    // 3. 表面层级体系 (Surface Ladder)
    { cssVar: '--da-bg-canvas', resolve: (d) => d.bgCanvas || d.bgPrimary },
    { cssVar: '--da-bg-primary', resolve: (d) => d.bgPrimary },
    { cssVar: '--da-bg-secondary', resolve: (d) => d.bgSecondary },
    { cssVar: '--da-bg-sidebar', resolve: (d) => d.bgSecondary },
    { cssVar: '--da-bg-card', resolve: (d) => d.bgCard },
    { cssVar: '--da-surface-card', resolve: (d) => d.bgCard },
    { cssVar: '--da-bg-card-hover', resolve: (d) => d.bgCardHover },
    { cssVar: '--da-surface-card-hover', resolve: (d) => d.bgCardHover },
    { cssVar: '--da-bg-input', resolve: (d) => d.bgInput },
    { cssVar: '--da-bg-input-hover', resolve: (d) => d.bgInputHover },
    { cssVar: '--da-bg-modal', resolve: (d) => d.bgModal || d.bgSecondary || d.bgPrimary },
    { cssVar: '--da-bg-overlay-modal', resolve: (d) => d.bgOverlay },
    { cssVar: '--da-bg-tertiary', resolve: (d) => d.bgSecondary || d.bgInput },
    {
        cssVar: '--da-bg-surface-subtle',
        resolve: (d) => {
            const isLight = getPerceivedLuminance(d.bgPrimary || d.bgCanvas || '#141418') > 0.55;
            return isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)';
        },
    },

    // 4. 边框与分割体系
    { cssVar: '--da-border-color', resolve: (d) => d.borderColor },
    { cssVar: '--da-border-card', resolve: (d) => d.borderColor },
    { cssVar: '--da-border-subtle', resolve: (d) => d.borderSubtle },
    { cssVar: '--da-border-highlight', resolve: (d) => d.borderHighlight },
    { cssVar: '--da-border-card-hover', resolve: (d) => d.borderHighlight },
    {
        cssVar: '--da-border-light',
        resolve: (d) => {
            const isLight = getPerceivedLuminance(d.bgPrimary || d.bgCanvas || '#141418') > 0.55;
            return isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';
        },
    },
    {
        cssVar: '--da-separator',
        resolve: (d) => {
            const isLight = getPerceivedLuminance(d.bgPrimary || d.bgCanvas || '#141418') > 0.55;
            return isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)';
        },
    },
    {
        cssVar: '--da-toggle-track-bg',
        resolve: (d) => {
            const isLight = getPerceivedLuminance(d.bgPrimary || d.bgCanvas || '#141418') > 0.55;
            return isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
        },
    },

    // 5. 几何形态与滤镜体系
    {
        cssVar: '--da-border-radius',
        resolve: (d) => (d.borderRadius !== undefined ? `${d.borderRadius}px` : undefined),
    },
    {
        cssVar: '--da-radius-modal',
        resolve: (d) => (d.radiusModal !== undefined ? `${d.radiusModal}px` : undefined),
    },
    {
        cssVar: '--da-radius-card',
        resolve: (d) => (d.radiusCard !== undefined ? `${d.radiusCard}px` : undefined),
    },
    {
        cssVar: '--da-radius-lg',
        resolve: (d) => (d.radiusCard !== undefined ? `${d.radiusCard}px` : undefined),
    },
    {
        cssVar: '--da-radius-input',
        resolve: (d) => (d.radiusInput !== undefined ? `${d.radiusInput}px` : undefined),
    },
    {
        cssVar: '--da-radius-btn',
        resolve: (d) => (d.radiusInput !== undefined ? `${d.radiusInput}px` : undefined),
    },
    {
        cssVar: '--da-blur-modal',
        resolve: (d) => (d.blurModal !== undefined ? `${d.blurModal}px` : undefined),
    },
    {
        cssVar: '--da-blur-panel',
        resolve: (d) => (d.blurPanel !== undefined ? `${d.blurPanel}px` : undefined),
    },
];

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
     *
     * @remarks
     * 仅从 settingsStore 中读取已持久化的预设列表；
     * 若未初始化或为空，则使用不可变常数 SAFE_FALLBACK_THEME 作为回退默认值。
     */
    public getAvailableThemes(): PresetItem<ThemePresetData>[] {
        const storeThemes = settingsStore.getPresets<ThemePresetData>('themes');
        if (storeThemes && storeThemes.length > 0) {
            return storeThemes;
        }
        return [
            {
                id: 'fallback',
                name: '默认外观',
                data: { ...SAFE_FALLBACK_THEME },
            },
        ];
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
     * 获取当前有效的主题标识符（具备失效自动恢复能力）。
     *
     * @remarks
     * 1. 优先读取配置中心记录的 activeThemePresetId；
     * 2. 若配置值有效存在于可用列表中，则直接返回；
     * 3. 若配置为空或对应预设已被删除，则自动归正为可用列表第一项，并同步写回配置中心。
     */
    public getActiveThemeId(): string {
        const available = this.getAvailableThemes();
        const storedId = (settingsStore.get('activeThemePresetId') as string) || '';

        const matched = available.find((t) => t.id === storedId);
        if (matched) {
            return matched.id;
        }

        const fallbackId = available[0]?.id || 'fallback';
        if (storedId !== fallbackId) {
            settingsStore.set('activeThemePresetId', fallbackId);
        }
        return fallbackId;
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

        const currentThemeId = this.getActiveThemeId();
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

        const theme = this.getThemeById(themeId) ?? this.getAvailableThemes()[0];
        const baseData = theme?.data ?? SAFE_FALLBACK_THEME;

        const merged: ThemePresetData = {
            ...baseData,
            ...overrides,
        };

        const target = this.targetElement;

        // 1. 设置当前主题标识符与明暗模式标识
        const bgSample = merged.bgPrimary || merged.bgCanvas || merged.bgModal || '#141418';
        const isLight = getPerceivedLuminance(bgSample) > 0.55;

        target.setAttribute('data-theme', theme?.id || themeId || 'default');
        target.setAttribute('data-theme-mode', isLight ? 'light' : 'dark');

        // 2. 通过声明式规则字典注入 CSS 变量
        for (const rule of THEME_TOKEN_RULES) {
            const val = rule.resolve(merged);
            if (val !== undefined) {
                target.style.setProperty(rule.cssVar, val);
            }
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
