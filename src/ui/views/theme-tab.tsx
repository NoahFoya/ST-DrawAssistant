/**
 * 主题设置专属选项卡视图 (ThemeTabView)。
 *
 * @remarks
 * 主题设置面板：
 * 1. 主题预设管理；
 * 2. 重点颜色与渐变配色；
 * 3. 窗口背景、侧边栏背景与卡片背景分层；
 * 4. 边框线与文字颜色对比。
 */

import type { VNode } from 'preact';
import type { ThemePresetData } from '@types';
import {
    PreactSettingsView,
    CardView,
    FormFieldView,
    PresetToolbarView,
} from '../framework';
import { PresetController } from '../viewmodels';
import { settingsStore } from '../../store/settings-store';
import { themeService } from '../theme/theme-service';

/** 轻量双模拾色组件：支持点击色块调用原生拾色器与输入框键入十六进制/RGBA */
function ColorPickerInput(props: {
    value?: string;
    placeholder?: string;
    onChange: (val: string) => void;
}): VNode {
    const rawVal = props.value || '';
    // 原生 color input 仅识别合法的 6 位十六进制
    const validHex = /^#[0-9a-fA-F]{6}$/.test(rawVal) ? rawVal : '#818cf8';

    return (
        <div className="da-color-picker">
            <label
                className="da-color-picker__swatch"
                style={{ backgroundColor: rawVal || 'transparent' }}
                title="点击打开拾色面板"
            >
                <input
                    type="color"
                    className="da-color-picker__native"
                    value={validHex}
                    onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
                />
            </label>
            <input
                type="text"
                className="da-input da-color-picker__text"
                value={rawVal}
                placeholder={props.placeholder}
                onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
            />
        </div>
    );
}

export class ThemeTabView extends PreactSettingsView {
    public readonly id = 'theme';
    public readonly title = '主题设置';

    public readonly presetController: PresetController<ThemePresetData>;

    public constructor() {
        super('da-tab-pane da-view-theme');

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
                const colorKeys: (keyof ThemePresetData)[] = [
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
                for (const key of colorKeys) {
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

        this.mountPreact();
    }

    protected renderContent(): VNode {
        const activeThemeId = this.presetController.activePresetId.value || themeService.getActiveThemeId();
        const draft = this.presetController.draftConfig.value;
        const isDirty = this.presetController.isDirty.value;
        const dirtyFields = this.presetController.dirtyFields.value;

        return (
            <div className="da-settings-stack">
                {/* 1. 主题预设管理 */}
                <CardView title="主题预设">
                    <PresetToolbarView
                        presets={this.presetController.toolbarItems.value}
                        activePresetId={activeThemeId}
                        dirty={isDirty}
                        onAction={(action, id) => this.presetController.handleAction(action, id)}
                        onImportFile={(file) => this.presetController.handleImportFile(file)}
                    />
                </CardView>

                {/* 2. 重点颜色 */}
                <CardView title="重点颜色">
                    <FormFieldView
                        label="主强调色"
                        width="auto"
                        dirty={dirtyFields.has('accent')}
                    >
                        <ColorPickerInput
                            value={draft.accent}
                            placeholder="#818cf8"
                            onChange={(val) => this.presetController.updateDraft('accent', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="辅助渐变色"
                        width="auto"
                        dirty={dirtyFields.has('accentSecondary')}
                    >
                        <ColorPickerInput
                            value={draft.accentSecondary}
                            placeholder="#a78bfa"
                            onChange={(val) => this.presetController.updateDraft('accentSecondary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="主按钮文字颜色"
                        tooltip="主要按钮上的前景文字颜色（强调色偏深时建议白色，偏亮时建议深色）"
                        width="auto"
                        dirty={dirtyFields.has('textOnAccent')}
                    >
                        <ColorPickerInput
                            value={draft.textOnAccent}
                            placeholder="#ffffff"
                            onChange={(val) => this.presetController.updateDraft('textOnAccent', val)}
                        />
                    </FormFieldView>
                </CardView>

                {/* 3. 背景颜色 */}
                <CardView title="背景颜色">
                    <FormFieldView
                        label="窗口背景"
                        width="auto"
                        dirty={dirtyFields.has('bgPrimary')}
                    >
                        <ColorPickerInput
                            value={draft.bgPrimary}
                            placeholder="#141418"
                            onChange={(val) => this.presetController.updateDraft('bgPrimary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="侧边栏背景"
                        width="auto"
                        dirty={dirtyFields.has('bgSecondary')}
                    >
                        <ColorPickerInput
                            value={draft.bgSecondary}
                            placeholder="#101013"
                            onChange={(val) => this.presetController.updateDraft('bgSecondary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="卡片背景"
                        width="auto"
                        dirty={dirtyFields.has('bgCard')}
                    >
                        <ColorPickerInput
                            value={draft.bgCard}
                            placeholder="#22232b"
                            onChange={(val) => this.presetController.updateDraft('bgCard', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="卡片悬停背景"
                        width="auto"
                        dirty={dirtyFields.has('bgCardHover')}
                    >
                        <ColorPickerInput
                            value={draft.bgCardHover}
                            placeholder="#292a34"
                            onChange={(val) => this.presetController.updateDraft('bgCardHover', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="输入框背景"
                        width="auto"
                        dirty={dirtyFields.has('bgInput')}
                    >
                        <ColorPickerInput
                            value={draft.bgInput}
                            placeholder="#0e0f13"
                            onChange={(val) => this.presetController.updateDraft('bgInput', val)}
                        />
                    </FormFieldView>
                </CardView>

                {/* 4. 边框与文字颜色 */}
                <CardView title="边框与文字颜色">
                    <FormFieldView
                        label="边框颜色"
                        width="auto"
                        dirty={dirtyFields.has('borderColor')}
                    >
                        <ColorPickerInput
                            value={draft.borderColor}
                            placeholder="rgba(255, 255, 255, 0.08)"
                            onChange={(val) => this.presetController.updateDraft('borderColor', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="高亮边框颜色"
                        tooltip="控件聚焦及可交互元素悬停时的边框高亮颜色 (borderHighlight)"
                        width="auto"
                        dirty={dirtyFields.has('borderHighlight')}
                    >
                        <ColorPickerInput
                            value={draft.borderHighlight}
                            placeholder="rgba(129, 140, 248, 0.45)"
                            onChange={(val) => this.presetController.updateDraft('borderHighlight', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="正文文字颜色"
                        width="auto"
                        dirty={dirtyFields.has('textPrimary')}
                    >
                        <ColorPickerInput
                            value={draft.textPrimary}
                            placeholder="#f4f4f5"
                            onChange={(val) => this.presetController.updateDraft('textPrimary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="次要文字颜色"
                        width="auto"
                        dirty={dirtyFields.has('textSecondary')}
                    >
                        <ColorPickerInput
                            value={draft.textSecondary}
                            placeholder="#a1a1aa"
                            onChange={(val) => this.presetController.updateDraft('textSecondary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="提示文字颜色"
                        width="auto"
                        dirty={dirtyFields.has('textMuted')}
                    >
                        <ColorPickerInput
                            value={draft.textMuted}
                            placeholder="#71717a"
                            onChange={(val) => this.presetController.updateDraft('textMuted', val)}
                        />
                    </FormFieldView>
                </CardView>
            </div>
        );
    }

    public override activate(): void {
        super.activate();
        if (!this.presetController.isDirty.value) {
            const storedId = themeService.getActiveThemeId();
            this.presetController.applyActivePreset(storedId, { persist: false, silent: true });
        } else {
            themeService.applyCurrentTheme(this.presetController.draftConfig.value);
        }
    }

    public override deactivate(): void {
        super.deactivate();
        // 切出主题选项卡时恢复已持久化主题，保留内存草稿待切回时继续预览
        themeService.applyCurrentTheme();
    }

    public hasUnsavedChanges(): boolean {
        return this.presetController.isDirty.value;
    }

    public saveUnsavedChanges(): Promise<boolean> {
        return this.presetController.handleAction('save');
    }

    public discardUnsavedChanges(): void {
        this.presetController.discardDraft();
    }
}
