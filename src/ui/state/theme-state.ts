/**
 * 主题设置无 DOM 状态模型 (ThemeState)。
 */

import type { ThemePresetData } from '@types';
import type { Disposable } from '../types';
import { PresetController } from './preset-controller';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { themeService } from '../theme/theme-service';

const THEME_COLOR_KEYS: readonly (keyof ThemePresetData)[] = [
    'accent',
    'accentSecondary',
    'textOnAccent',
    'bgPrimary',
    'bgSecondary',
    'bgCard',
    'bgCardHover',
    'bgInput',
    'borderColor',
    'borderHighlight',
    'textPrimary',
    'textSecondary',
    'textMuted',
];

export class ThemeState implements Disposable {
    public readonly presetController: PresetController<ThemePresetData>;
    private unlistenSettings: (() => void) | null = null;
    private disposed = false;

    public constructor() {
        this.presetController = new PresetController<ThemePresetData>({
            category: 'themes',
            idPrefix: 'theme_',
            promptMessageForNew: '请输入新主题预设名称:',
            defaultNewName: '新建主题预设',
            promptMessageForSaveAs: '请输入另存主题预设名称:',
            promptMessageForRename: '请输入新的主题预设名称:',
            defaultImportName: '导入主题预设',
            exportFilenamePrefix: 'st-draw-theme-',
            minRemainingOnDelete: 1,
            minRemainingWarning: '至少保留一套基准主题预设，无法删除',
            showToast: true,
            getPresetsOverride: () => themeService.getAvailableThemes(),
            getActiveId: () => themeService.getActiveThemeId(),
            setActiveId: (id) => {
                settingsStore.set('activeThemePresetId', id);
            },
            evaluateDirtyFields: (draft, snap) => {
                const dirty = new Set<string>();
                for (const key of THEME_COLOR_KEYS) {
                    if (draft[key] !== snap[key]) {
                        dirty.add(key as string);
                    }
                }
                return dirty;
            },
            onDraftChanged: (draft) => {
                themeService.applyCurrentTheme(draft);
            },
            onPresetApplied: () => {
                themeService.applyCurrentTheme();
            },
        });

        this.unlistenSettings = eventBus.on('settings:updated', (data) => {
            if (this.disposed) return;
            if (
                !data.key ||
                data.isReset ||
                data.key === 'activeThemePresetId' ||
                data.key === 'presets.themes' ||
                data.keys?.includes('activeThemePresetId') ||
                data.keys?.includes('presets')
            ) {
                const storedId = themeService.getActiveThemeId();
                if (!this.presetController.isDirty.value) {
                    if (
                        !data.isReset &&
                        data.key === 'activeThemePresetId' &&
                        this.presetController.activePresetId.value === storedId
                    ) {
                        return;
                    }
                    this.presetController.applyActivePreset(storedId, {
                        persist: false,
                        silent: true,
                    });
                } else {
                    this.presetController.refreshPresets();
                }
            }
        });
    }

    public activate(): void {
        if (this.disposed) return;
        const storedId = themeService.getActiveThemeId();
        if (!this.presetController.isDirty.value) {
            this.presetController.applyActivePreset(storedId, { persist: false, silent: true });
        } else {
            themeService.applyCurrentTheme(this.presetController.draftConfig.value);
        }
    }

    public deactivate(): void {
        themeService.applyCurrentTheme();
    }

    public hasUnsavedChanges(): boolean {
        return this.presetController.isDirty.value;
    }

    public async saveUnsavedChanges(): Promise<boolean> {
        if (!this.presetController.isDirty.value) {
            return true;
        }
        return await this.presetController.handleAction('save');
    }

    public discardUnsavedChanges(): void {
        this.presetController.discardDraft();
        themeService.applyCurrentTheme();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.deactivate();
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
        this.presetController.dispose();
    }
}
