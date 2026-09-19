/**
 * ST-DrawAssistant 界面主题与个性化外观卡片。
 *
 * @remarks
 * 管理界面主题预设切换、自定义品牌强调色调节，
 * 并与 ThemeService 联动实时响应。
 */

import { CardBase } from './card-base';
import {
    createFormField,
    createSelect,
    createColorPicker,
    createButton,
} from '../components';
import { settingsStore } from '../../store/settings-store';
import { themeService } from '../theme/theme-service';
import { eventBus } from '../../util/event-bus';
import type { PresetItem, ThemePresetData } from '@types';

export class ThemeCard extends CardBase {
    private currentThemeItem: PresetItem<ThemePresetData>;

    constructor() {
        super({
            title: '界面外观与主题风格',
            badge: '视觉个性化',
        });

        const themes = settingsStore.getPresets<ThemePresetData>('themes');
        const activeThemeId = settingsStore.getSettings().themePreset || 'dark';
        this.currentThemeItem = themes.find((t) => t.id === activeThemeId) || themes[0] || {
            id: 'dark',
            name: '深色夜间',
            data: {
                accentColor: '#8b5cf6',
                bgPrimary: '#07080d',
                textPrimary: '#f8fafc',
            },
        };

        this.buildFields();
    }

    private buildFields(): void {
        const themes = settingsStore.getPresets<ThemePresetData>('themes');

        // 1. 主题方案选择下拉框
        const themeSelect = this.registerChild(
            createSelect<string>({
                value: this.currentThemeItem.id,
                options: themes.map((t) => ({ label: t.name, value: t.id })),
                onChange: (themeId) => {
                    const matched = themes.find((t) => t.id === themeId);
                    if (matched) {
                        this.currentThemeItem = matched;
                        settingsStore.update({ themePreset: themeId });
                        themeService.applyTheme(matched);
                        eventBus.emit('settings:theme-changed', matched);
                        colorPicker.setValue(matched.data.accentColor || '#8b5cf6');
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '主题色彩方案',
                description: '切换全局色彩模式与明暗体系',
                control: themeSelect,
                slotWidth: '240',
            }).element
        );

        // 2. 品牌主强调色
        const colorPicker = this.registerChild(
            createColorPicker({
                value: this.currentThemeItem.data.accentColor || '#8b5cf6',
                onChange: (hex) => {
                    this.currentThemeItem.data.accentColor = hex;
                    settingsStore.savePreset('themes', this.currentThemeItem);
                    themeService.applyTheme(this.currentThemeItem);
                    eventBus.emit('settings:theme-changed', this.currentThemeItem);
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '品牌强调色 (Accent)',
                description: '按钮、焦点指示环与高亮标签的主色调',
                control: colorPicker,
                slotWidth: '240',
            }).element
        );

        // 3. 恢复默认主题按钮行
        const actionRow = document.createElement('div');
        actionRow.classList.add('da-card-actions-right');

        const resetBtn = this.registerChild(
            createButton({
                text: '重置回预设主题',
                variant: 'secondary',
                size: 'sm',
                onClick: () => {
                    settingsStore.restoreDefaultPresets('themes');
                    const refreshedThemes = settingsStore.getPresets<ThemePresetData>('themes');
                    const defaultTheme = refreshedThemes.find((t) => t.id === 'dark') || refreshedThemes[0];
                    if (defaultTheme) {
                        this.currentThemeItem = defaultTheme;
                        themeSelect.updateOptions(refreshedThemes.map((t) => ({ label: t.name, value: t.id })));
                        themeSelect.setValue(defaultTheme.id);
                        colorPicker.setValue(defaultTheme.data.accentColor || '#8b5cf6');
                        themeService.applyTheme(defaultTheme);
                        eventBus.emit('settings:theme-changed', defaultTheme);
                        eventBus.emit('toast:show', {
                            type: 'info',
                            message: '已重置回默认推荐主题',
                        });
                    }
                },
            })
        );
        actionRow.appendChild(resetBtn.element);
        this.bodyElement.appendChild(actionRow);
    }
}
