/**
 * 外观与主题专属选项卡视图 (ThemeTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 PresetController<ThemePresetData> 构建：
 * 1. 顶部预设方案工具栏 (PresetToolbarView)；
 * 2. 品牌强调色快捷选择；
 * 3. 界面圆角与毛玻璃虚化滑块微调，实时预览并驱动脏状态。
 */

import type { VNode } from 'preact';
import type { ThemePresetData } from '@types';
import {
    PreactSettingsView,
    CardView,
    FormFieldView,
    SliderControl,
    PresetToolbarView,
} from '../framework';
import { PresetController } from '../viewmodels';
import { settingsStore } from '../../store/settings-store';
import { themeService } from '../theme/theme-service';

const ACCENT_COLOR_PALETTE = [
    { label: '科技蓝', color: '#3b82f6' },
    { label: '极光紫', color: '#8b5cf6' },
    { label: '青空碧', color: '#06b6d4' },
    { label: '翡翠绿', color: '#10b981' },
    { label: '暖杏金', color: '#fbbf24' },
    { label: '蔷薇粉', color: '#fb7185' },
];

export class ThemeTabView extends PreactSettingsView {
    public readonly id = 'theme';
    public readonly title = '外观与主题';

    public readonly presetController: PresetController<ThemePresetData>;

    public constructor() {
        super('da-tab-pane da-view-theme');

        this.presetController = new PresetController<ThemePresetData>({
            category: 'themes',
            idPrefix: 'theme_',
            promptMessageForNew: '请输入新外观方案名称:',
            defaultNewName: '自定义外观',
            promptMessageForSaveAs: '请输入新外观方案名称:',
            promptMessageForRename: '请输入新的外观名称:',
            defaultImportName: '导入外观方案',
            exportFilenamePrefix: 'st-draw-theme-',
            minRemainingOnDelete: 1,
            minRemainingWarning: '至少保留一套基准外观方案，无法删除',
            showToast: true,
            getPresetsOverride: () => themeService.getAvailableThemes(),
            getActiveId: () => (settingsStore.get('themePreset') as string) || 'dark',
            setActiveId: (id) => {
                settingsStore.set('themePreset', id);
            },
            evaluateDirtyFields: (draft, snap) => {
                const dirty = new Set<string>();
                if (draft.accentColor && draft.accentColor !== snap.accentColor) {
                    dirty.add('accentColor');
                }
                if (draft.borderRadius !== undefined && draft.borderRadius !== snap.borderRadius) {
                    dirty.add('borderRadius');
                }
                if (draft.blurModal !== undefined && draft.blurModal !== snap.blurModal) {
                    dirty.add('blurModal');
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

        this.mountPreact();
    }

    protected renderContent(): VNode {
        const activeThemeId = this.presetController.activePresetId.value || 'dark';
        const draft = this.presetController.draftConfig.value;
        const isDirty = this.presetController.isDirty.value;
        const currentAccent = (draft.accentColor || '').toLowerCase();

        return (
            <CardView title="外观配置">
                <PresetToolbarView
                    presets={this.presetController.toolbarItems.value}
                    activePresetId={activeThemeId}
                    dirty={isDirty}
                    onAction={(action, id) => this.presetController.handleAction(action, id)}
                    onImportFile={(file) => this.presetController.handleImportFile(file)}
                />

                <FormFieldView
                    label="强调色"
                    tooltip="选择界面的核心品牌强调高亮色彩"
                    width="auto"
                >
                    <div className="da-color-palette-group">
                        {ACCENT_COLOR_PALETTE.map((item) => {
                            const isActive = currentAccent === item.color.toLowerCase();
                            return (
                                <button
                                    key={item.color}
                                    type="button"
                                    className={`da-color-swatch${isActive ? ' is-active' : ''}`}
                                    data-color={item.color}
                                    title={item.label}
                                    style={{ backgroundColor: item.color }}
                                    onClick={() =>
                                        this.presetController.updateDraft(
                                            'accentColor',
                                            item.color
                                        )
                                    }
                                />
                            );
                        })}
                    </div>
                </FormFieldView>

                <FormFieldView
                    label="界面圆角"
                    tooltip="控制窗口、卡片与输入控件的圆角边缘弧度 (0px ~ 20px)"
                    width="w-240"
                >
                    <SliderControl
                        min={0}
                        max={20}
                        step={1}
                        value={draft.borderRadius ?? 10}
                        unit="px"
                        onChange={(val) =>
                            this.presetController.patchDraft({
                                borderRadius: val,
                                radiusModal: Math.max(12, val + 2),
                                radiusCard: val,
                                radiusInput: Math.min(6, val),
                            })
                        }
                    />
                </FormFieldView>

                <FormFieldView
                    label="毛玻璃虚化"
                    tooltip="调整模态弹窗与浮层背后的高斯虚化半径 (0px ~ 30px)"
                    width="w-240"
                >
                    <SliderControl
                        min={0}
                        max={30}
                        step={2}
                        value={draft.blurModal ?? 18}
                        unit="px"
                        onChange={(val) =>
                            this.presetController.patchDraft({
                                blurModal: val,
                                blurPanel: val + 2,
                            })
                        }
                    />
                </FormFieldView>
            </CardView>
        );
    }

    public override activate(): void {
        const storedId = (settingsStore.get('themePreset') as string) || 'dark';
        this.presetController.applyActivePreset(storedId, { persist: false, silent: true });
    }
}
