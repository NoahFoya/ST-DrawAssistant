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
import {
    createPreactSettingsView,
    CardView,
    FormFieldView,
    type StatefulSettingsView,
} from '../framework';
import { PresetToolbar } from '../composite';
import { ThemeState } from '../state';
import { themeService } from '../theme/theme-service';

/** 轻量双模拾色组件：支持点击色块调用原生拾色器与输入框键入十六进制/RGBA */
function ColorPickerInput(props: {
    value?: string;
    placeholder?: string;
    onChange: (val: string) => void;
}): VNode {
    const rawVal = props.value || '';
    // 原生 color input 仅识别合法的 6 位十六进制
    const validHex = /^#[0-9a-fA-F]{6}$/.test(rawVal) ? rawVal : '#cba6f7';

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

export function ThemeTab(props: { state: ThemeState }): VNode {
    const { presetController } = props.state;
    const activeThemeId = presetController.activePresetId.value || themeService.getActiveThemeId();
    const draft = presetController.draftConfig.value;
    const isDirty = presetController.isDirty.value;
    const dirtyFields = presetController.dirtyFields.value;

    return (
        <div className="da-settings-stack">
            {/* 1. 主题预设管理 */}
            <CardView title="主题预设">
                <PresetToolbar
                    presets={presetController.toolbarItems.value}
                    activePresetId={activeThemeId}
                    dirty={isDirty}
                    onAction={(action, id) => presetController.handleAction(action, id)}
                    onImportFiles={(files) => void presetController.handleImportFiles(files)}
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
                        placeholder="#cba6f7"
                        onChange={(val) => presetController.updateDraft('accent', val)}
                    />
                </FormFieldView>

                <FormFieldView
                    label="辅助渐变色"
                    width="auto"
                    dirty={dirtyFields.has('accentSecondary')}
                >
                    <ColorPickerInput
                        value={draft.accentSecondary}
                        placeholder="#89b4fa"
                        onChange={(val) => presetController.updateDraft('accentSecondary', val)}
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
                        placeholder="#11111b"
                        onChange={(val) => presetController.updateDraft('textOnAccent', val)}
                    />
                </FormFieldView>
            </CardView>

            {/* 3. 背景颜色 */}
            <CardView title="背景颜色">
                <FormFieldView label="窗口背景" width="auto" dirty={dirtyFields.has('bgPrimary')}>
                    <ColorPickerInput
                        value={draft.bgPrimary}
                        placeholder="#1e1e2e"
                        onChange={(val) => presetController.updateDraft('bgPrimary', val)}
                    />
                </FormFieldView>

                <FormFieldView
                    label="侧边栏背景"
                    width="auto"
                    dirty={dirtyFields.has('bgSecondary')}
                >
                    <ColorPickerInput
                        value={draft.bgSecondary}
                        placeholder="#181825"
                        onChange={(val) => presetController.updateDraft('bgSecondary', val)}
                    />
                </FormFieldView>

                <FormFieldView label="卡片背景" width="auto" dirty={dirtyFields.has('bgCard')}>
                    <ColorPickerInput
                        value={draft.bgCard}
                        placeholder="#28293d"
                        onChange={(val) => presetController.updateDraft('bgCard', val)}
                    />
                </FormFieldView>

                <FormFieldView
                    label="卡片悬停背景"
                    width="auto"
                    dirty={dirtyFields.has('bgCardHover')}
                >
                    <ColorPickerInput
                        value={draft.bgCardHover}
                        placeholder="#313244"
                        onChange={(val) => presetController.updateDraft('bgCardHover', val)}
                    />
                </FormFieldView>

                <FormFieldView label="输入框背景" width="auto" dirty={dirtyFields.has('bgInput')}>
                    <ColorPickerInput
                        value={draft.bgInput}
                        placeholder="#161622"
                        onChange={(val) => presetController.updateDraft('bgInput', val)}
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
                        placeholder="rgba(205, 214, 244, 0.10)"
                        onChange={(val) => presetController.updateDraft('borderColor', val)}
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
                        placeholder="rgba(203, 166, 247, 0.34)"
                        onChange={(val) => presetController.updateDraft('borderHighlight', val)}
                    />
                </FormFieldView>

                <FormFieldView
                    label="正文文字颜色"
                    width="auto"
                    dirty={dirtyFields.has('textPrimary')}
                >
                    <ColorPickerInput
                        value={draft.textPrimary}
                        placeholder="#cdd6f4"
                        onChange={(val) => presetController.updateDraft('textPrimary', val)}
                    />
                </FormFieldView>

                <FormFieldView
                    label="次要文字颜色"
                    width="auto"
                    dirty={dirtyFields.has('textSecondary')}
                >
                    <ColorPickerInput
                        value={draft.textSecondary}
                        placeholder="#a6adc8"
                        onChange={(val) => presetController.updateDraft('textSecondary', val)}
                    />
                </FormFieldView>

                <FormFieldView
                    label="提示文字颜色"
                    width="auto"
                    dirty={dirtyFields.has('textMuted')}
                >
                    <ColorPickerInput
                        value={draft.textMuted}
                        placeholder="#6c7086"
                        onChange={(val) => presetController.updateDraft('textMuted', val)}
                    />
                </FormFieldView>
            </CardView>
        </div>
    );
}

export function createThemeTabView(): StatefulSettingsView<ThemeState> {
    const state = new ThemeState();
    return createPreactSettingsView<ThemeState>({
        id: 'theme',
        title: '主题设置',
        className: 'da-tab-pane da-view-theme',
        state,
        render: () => <ThemeTab state={state} />,
        onActivate: () => state.activate(),
        onDeactivate: () => state.deactivate(),
        onDispose: () => state.dispose(),
        hasUnsavedChanges: () => state.hasUnsavedChanges(),
        saveUnsavedChanges: () => state.saveUnsavedChanges(),
        discardUnsavedChanges: () => state.discardUnsavedChanges(),
    });
}
