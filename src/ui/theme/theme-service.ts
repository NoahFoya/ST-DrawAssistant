/**
 * ST-DrawAssistant 主题服务。
 *
 * @remarks
 * 负责解析主题预设数据，动态注入 CSS 变量至目标 DOM 节点或根节点。
 * 派生计算 RGB 分量，支持浅色/深色模式标识切换与主题重置生命周期。
 */

import type { ThemePresetData, PresetItem } from '@types';
import { eventBus } from '../../util/event-bus';

/** 十六进制颜色转 RGB 三元组格式字符串 (例如 "139, 92, 246") */
export function hexToRgbString(hex: string): string | null {
    const cleanHex = hex.trim().replace(/^#/, '');
    if (cleanHex.length === 3) {
        const r = parseInt(cleanHex[0] + cleanHex[0], 16);
        const g = parseInt(cleanHex[1] + cleanHex[1], 16);
        const b = parseInt(cleanHex[2] + cleanHex[2], 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
        return `${r}, ${g}, ${b}`;
    }
    if (cleanHex.length === 6) {
        const r = parseInt(cleanHex.slice(0, 2), 16);
        const g = parseInt(cleanHex.slice(2, 4), 16);
        const b = parseInt(cleanHex.slice(4, 6), 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
        return `${r}, ${g}, ${b}`;
    }
    return null;
}

/** 属性键名与 CSS 变量名映射表 */
const PROPERTY_VAR_MAP: Record<string, string> = {
    accentColor: '--da-accent-color',
    accentCyan: '--da-accent-cyan',
    bgPrimary: '--da-bg-primary',
    bgSecondary: '--da-bg-secondary',
    bgSidebar: '--da-bg-sidebar',
    bgCard: '--da-bg-card',
    bgCardHover: '--da-bg-card-hover',
    bgInput: '--da-bg-input',
    bgInputHover: '--da-bg-input-hover',
    textPrimary: '--da-text-primary',
    textSecondary: '--da-text-secondary',
    borderColor: '--da-border-color',
    borderHighlight: '--da-border-highlight',
    radiusModal: '--da-radius-modal',
    radiusCard: '--da-radius-card',
    radiusInput: '--da-radius-input',
    blurModal: '--da-blur-modal',
    blurPanel: '--da-blur-panel',
};

export class ThemeService {
    private targetElement: HTMLElement | null = null;
    private appliedCustomProperties: Set<string> = new Set();
    private unbindEvent: (() => void) | null = null;

    /**
     * 绑定目标容器或默认根节点
     * @param target 目标元素 (默认 document.documentElement)
     */
    public bindTarget(target?: HTMLElement): void {
        if (target) {
            this.targetElement = target;
        } else if (typeof document !== 'undefined') {
            this.targetElement = document.documentElement;
        }
    }

    /** 获取当前绑定的目标 DOM 元素 */
    public getTarget(): HTMLElement | null {
        if (!this.targetElement && typeof document !== 'undefined') {
            this.targetElement = document.documentElement;
        }
        return this.targetElement;
    }

    /**
     * 开启监听全局设置中的主题变更事件
     */
    public listenSettings(): void {
        if (this.unbindEvent) {
            this.unbindEvent();
        }
        this.unbindEvent = eventBus.on('settings:theme-changed', (themePreset: PresetItem<ThemePresetData>) => {
            this.applyTheme(themePreset);
        });
    }

    /**
     * 应用主题预设数据
     * @param theme 预设项或裸主题数据
     */
    public applyTheme(theme: PresetItem<ThemePresetData> | ThemePresetData): void {
        const target = this.getTarget();
        if (!target) return;

        const data: ThemePresetData = 'data' in theme ? (theme as PresetItem<ThemePresetData>).data : theme;
        if (!data) return;

        // 1. 判断并设置主题模式
        const isLight = (theme as { id?: string }).id === 'light' ||
            (typeof data.textPrimary === 'string' && data.textPrimary.toLowerCase() === '#0f172a');
        const mode = isLight ? 'light' : 'dark';

        target.setAttribute('data-da-mode', mode);
        target.style.setProperty('--da-color-scheme', mode);
        this.appliedCustomProperties.add('--da-color-scheme');

        // 2. 注入颜色与基础变量
        for (const [key, varName] of Object.entries(PROPERTY_VAR_MAP)) {
            const rawVal = data[key];
            if (rawVal === undefined || rawVal === null) continue;

            const strVal = typeof rawVal === 'number' ? `${rawVal}px` : String(rawVal);
            target.style.setProperty(varName, strVal);
            this.appliedCustomProperties.add(varName);

            // 派生计算 RGB 三元组变量
            if (key === 'accentColor' && typeof rawVal === 'string') {
                const rgb = hexToRgbString(rawVal);
                if (rgb) {
                    target.style.setProperty('--da-accent-rgb', rgb);
                    this.appliedCustomProperties.add('--da-accent-rgb');
                }
            } else if (key === 'accentCyan' && typeof rawVal === 'string') {
                const rgb = hexToRgbString(rawVal);
                if (rgb) {
                    target.style.setProperty('--da-accent-cyan-rgb', rgb);
                    this.appliedCustomProperties.add('--da-accent-cyan-rgb');
                }
            }
        }

        // 3. 通用尺寸圆角扩展回退
        if (data.borderRadius !== undefined) {
            const radiusStr = `${data.borderRadius}px`;
            if (data.radiusCard === undefined) {
                target.style.setProperty('--da-radius-card', radiusStr);
                this.appliedCustomProperties.add('--da-radius-card');
            }
            if (data.radiusModal === undefined) {
                target.style.setProperty('--da-radius-modal', `${data.borderRadius + 2}px`);
                this.appliedCustomProperties.add('--da-radius-modal');
            }
        }

        // 4. 背景渐变角度与色值合成
        if (data.bgPrimary && data.bgGradientEnd) {
            const angle = typeof data.bgGradientAngle === 'number' ? data.bgGradientAngle : 140;
            const gradientValue = `linear-gradient(${angle}deg, ${data.bgPrimary} 0%, ${data.bgGradientEnd} 100%)`;
            target.style.setProperty('--da-bg-gradient', gradientValue);
            this.appliedCustomProperties.add('--da-bg-gradient');
        }
    }

    /**
     * 重置清除由本服务注入的所有 CSS 变量并移除 mode 属性
     */
    public resetTheme(): void {
        const target = this.getTarget();
        if (!target) return;

        target.removeAttribute('data-da-mode');
        for (const varName of this.appliedCustomProperties) {
            target.style.removeProperty(varName);
        }
        this.appliedCustomProperties.clear();
    }

    /** 释放资源与事件解绑 */
    public dispose(): void {
        if (this.unbindEvent) {
            this.unbindEvent();
            this.unbindEvent = null;
        }
        this.resetTheme();
        this.targetElement = null;
    }
}

/** 全局主题服务单例 */
export const themeService = new ThemeService();
