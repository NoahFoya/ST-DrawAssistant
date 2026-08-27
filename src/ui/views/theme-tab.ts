/**
 * @module ui/views/theme-tab
 * @description 外观主题定制面板视图 (包含预设主题管理、自定义调色板配置与 CSS 变量实时预览)
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, ThemeData, PresetProfileItem } from '../../core/state/store-types';
import { bindPresetToolbar, PresetToolbarAdapter } from '../components/preset-toolbar';
import { ControlFactory, createFieldRow } from '../components/controls';
import { FALLBACK_SAFE_THEME } from '../services/theme-service';

/**
 * 构建并渲染外观主题定制面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 主题定制面板 DOM 根节点
 */
export function createThemeTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement {
    const controls = new ControlFactory();
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-theme-tab';

    const getProfiles = (): PresetProfileItem<ThemeData>[] => {
        return store.get('customThemes') || [];
    };

    const getActiveThemeId = (): string => {
        return store.get('themePreset') || '';
    };

    const getActiveThemeData = (): ThemeData => {
        const id = getActiveThemeId();
        const profiles = getProfiles();
        const found = profiles.find((p) => p.id === id);
        return found?.data || profiles[0]?.data || FALLBACK_SAFE_THEME;
    };

    let currentThemeData = { ...getActiveThemeData() };

    const applyCSSVariables = (data: ThemeData) => {
        const root = document.documentElement;
        if (data.accentColor) root.style.setProperty('--da-accent-color', data.accentColor);
        if (data.bgPrimary) root.style.setProperty('--da-bg-primary', data.bgPrimary);
        if (data.bgSecondary) root.style.setProperty('--da-bg-secondary', data.bgSecondary);
        if (data.textPrimary) root.style.setProperty('--da-text-primary', data.textPrimary);
        if (data.textSecondary) root.style.setProperty('--da-text-secondary', data.textSecondary);
        if (data.borderColor) root.style.setProperty('--da-border-color', data.borderColor);
        if (data.blurRadius !== undefined) root.style.setProperty('--da-blur-radius', `${data.blurRadius}px`);
        if (data.borderRadius !== undefined) root.style.setProperty('--da-border-radius', `${data.borderRadius}px`);
    };

    // ── 1. 主题方案管理卡片 ──────────────────────────────────────────────────
    const cardScheme = controls.createCard('外观主题方案管理 (Theme Profiles)', (body) => {
        const desc = document.createElement('div');
        desc.className = 'da-section-desc';
        desc.style.marginBottom = '10px';
        desc.textContent = '快速切换或保存不同的外观主题风格，支持导入、导出与自定义配色。';
        body.appendChild(desc);

        const adapter: PresetToolbarAdapter<ThemeData> = {
            label: '外观主题',
            getProfiles,
            getInitialId: getActiveThemeId,
            createProfile: (name, data) => {
                const list = [...getProfiles()];
                const newId = `theme_${Date.now()}`;
                list.push({ id: newId, name, data });
                store.set('customThemes', list);
                store.set('themePreset', newId);
                return newId;
            },
            saveProfile: (id, data) => {
                const list = getProfiles().map((p) => (p.id === id ? { ...p, data } : p));
                store.set('customThemes', list);
            },
            renameProfile: (id, newName) => {
                const list = getProfiles().map((p) => (p.id === id ? { ...p, name: newName } : p));
                store.set('customThemes', list);
            },
            deleteProfile: (id) => {
                const list = getProfiles().filter((p) => p.id !== id);
                store.set('customThemes', list);
                const nextId = list.length > 0 ? list[0].id : '';
                store.set('themePreset', nextId);
                return nextId;
            },
            resetToDefault: () => {
                const defaultList: PresetProfileItem<ThemeData>[] = [
                    { id: 'default-theme', name: '流光黑曜 (标准主题)', data: FALLBACK_SAFE_THEME }
                ];
                store.set('customThemes', defaultList);
                store.set('themePreset', defaultList[0].id);
            },
            onSelect: (id) => {
                store.set('themePreset', id);
            }
        };

        const toolbar = bindPresetToolbar({
            adapter,
            getCurrentData: () => currentThemeData,
            applyData: (id) => {
                const target = getProfiles().find((p) => p.id === id);
                if (target?.data) {
                    currentThemeData = { ...target.data };
                    applyCSSVariables(currentThemeData);
                }
            },
            onRefresh: () => {
                refreshPaletteUI();
            }
        });

        body.appendChild(toolbar);
    });

    // ── 2. 主题调色盘卡片 ───────────────────────────────────────────────────
    const cardPalette = controls.createCard('主题配色与视觉参数 (Theme Palette & Visuals)', (body) => {
        const desc = document.createElement('div');
        desc.className = 'da-section-desc';
        desc.style.marginBottom = '12px';
        desc.textContent = '实时调整界面强调色、背景色彩、边框与毛玻璃圆角效果，修改后请点击上方【保存方案】。';
        body.appendChild(desc);

        // 强调色
        body.appendChild(
            createFieldRow({
                label: '主题强调色 (Accent Color)',
                type: 'text',
                value: currentThemeData.accentColor || '#0a84ff',
                onChange: (val) => {
                    currentThemeData.accentColor = String(val);
                    applyCSSVariables(currentThemeData);
                }
            })
        );

        // 背景主色
        body.appendChild(
            createFieldRow({
                label: '主背景色 (Background Primary)',
                type: 'text',
                value: currentThemeData.bgPrimary || '#12141a',
                onChange: (val) => {
                    currentThemeData.bgPrimary = String(val);
                    applyCSSVariables(currentThemeData);
                }
            })
        );

        // 次级背景色
        body.appendChild(
            createFieldRow({
                label: '次级背景色 (Background Secondary)',
                type: 'text',
                value: currentThemeData.bgSecondary || '#1a1d26',
                onChange: (val) => {
                    currentThemeData.bgSecondary = String(val);
                    applyCSSVariables(currentThemeData);
                }
            })
        );

        // 文本主色
        body.appendChild(
            createFieldRow({
                label: '主文本色 (Text Primary)',
                type: 'text',
                value: currentThemeData.textPrimary || '#f5f7fa',
                onChange: (val) => {
                    currentThemeData.textPrimary = String(val);
                    applyCSSVariables(currentThemeData);
                }
            })
        );

        // 圆角大小
        body.appendChild(
            createFieldRow({
                label: '面板圆角半径 (Border Radius)',
                type: 'number',
                value: currentThemeData.borderRadius ?? 12,
                min: 0,
                max: 32,
                onChange: (val) => {
                    currentThemeData.borderRadius = Number(val);
                    applyCSSVariables(currentThemeData);
                }
            })
        );

        // 毛玻璃模糊
        body.appendChild(
            createFieldRow({
                label: '毛玻璃模糊半径 (Blur Radius)',
                type: 'number',
                value: currentThemeData.blurRadius ?? 16,
                min: 0,
                max: 48,
                onChange: (val) => {
                    currentThemeData.blurRadius = Number(val);
                    applyCSSVariables(currentThemeData);
                }
            })
        );
    });

    const refreshPaletteUI = () => {
        applyCSSVariables(currentThemeData);
    };

    container.appendChild(cardScheme);
    container.appendChild(cardPalette);
    applyCSSVariables(currentThemeData);

    return container;
}
