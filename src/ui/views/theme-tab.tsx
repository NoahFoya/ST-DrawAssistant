/**
 * 主题设置专属选项卡视图 (ThemeTabView)。
 *
 * @remarks
 * 主题设置全功能面板：
 * 1. 主题预设管理与常用配色快捷选择；
 * 2. 重点颜色与渐变流光；
 * 3. 窗口背景、侧边栏背景与卡片背景分层；
 * 4. 边框线与文字颜色对比；
 * 5. 全局圆角、控件圆角与毛玻璃虚化调节。
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
    { label: '深色紫', color: '#818cf8' },
    { label: '暖金色', color: '#f59e0b' },
    { label: '天青蓝', color: '#0ea5e9' },
    { label: '薄荷绿', color: '#10b981' },
    { label: '落日粉', color: '#f43f5e' },
    { label: '极夜灰', color: '#e2e8f0' },
    { label: '纯净靛', color: '#6366f1' },
];

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
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <label
                style={{
                    position: 'relative',
                    width: '26px',
                    height: '26px',
                    borderRadius: '6px',
                    backgroundColor: rawVal || 'transparent',
                    border: '1px solid var(--da-border-color)',
                    cursor: 'pointer',
                    boxShadow: 'var(--da-inset-top-light)',
                    flexShrink: 0,
                    overflow: 'hidden',
                }}
                title="点击打开拾色面板"
            >
                <input
                    type="color"
                    value={validHex}
                    onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
                    style={{
                        position: 'absolute',
                        top: '-10px',
                        left: '-10px',
                        width: '46px',
                        height: '46px',
                        opacity: 0,
                        cursor: 'pointer',
                    }}
                />
            </label>
            <input
                type="text"
                className="da-input"
                style={{
                    width: '130px',
                    height: '28px',
                    textAlign: 'left',
                    padding: '0 8px',
                    fontSize: '12px',
                    fontFamily: 'var(--da-font-mono)',
                }}
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
                const numKeys: (keyof ThemePresetData)[] = [
                    'borderRadius',
                    'radiusModal',
                    'radiusCard',
                    'radiusInput',
                    'blurModal',
                ];
                for (const key of numKeys) {
                    if (draft[key] !== snap[key] && draft[key] !== undefined) {
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
        const currentAccent = (draft.accent || '').toLowerCase();

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
                {/* 1. 主题预设管理 */}
                <CardView title="主题预设">
                    <PresetToolbarView
                        presets={this.presetController.toolbarItems.value}
                        activePresetId={activeThemeId}
                        dirty={isDirty}
                        onAction={(action, id) => this.presetController.handleAction(action, id)}
                        onImportFile={(file) => this.presetController.handleImportFile(file)}
                    />

                    <FormFieldView
                        label="常用配色"
                        tooltip="一键快速应用常用品牌主题色"
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
                                            this.presetController.updateDraft('accent', item.color)
                                        }
                                    />
                                );
                            })}
                        </div>
                    </FormFieldView>
                </CardView>

                {/* 2. 重点颜色 */}
                <CardView title="重点颜色">
                    <FormFieldView
                        label="主强调色"
                        tooltip="按钮与高亮元素的主题颜色 (accent)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.accent}
                            placeholder="#818cf8"
                            onChange={(val) => this.presetController.updateDraft('accent', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="辅助渐变色"
                        tooltip="主要按钮与边框的渐变辅助颜色 (accentSecondary)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.accentSecondary}
                            placeholder="#a78bfa"
                            onChange={(val) => this.presetController.updateDraft('accentSecondary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="主按钮文字颜色"
                        tooltip="主要操作按钮上的文字颜色 (深色背景填白色，浅色背景填深色)"
                        width="auto"
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
                        tooltip="弹窗主界面的背景颜色 (bgPrimary)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.bgPrimary}
                            placeholder="#141418"
                            onChange={(val) => this.presetController.updateDraft('bgPrimary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="侧边栏背景"
                        tooltip="左侧导航栏的背景颜色 (bgSecondary)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.bgSecondary}
                            placeholder="#101013"
                            onChange={(val) => this.presetController.updateDraft('bgSecondary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="卡片背景"
                        tooltip="内容卡片的背景颜色，比窗口背景稍亮可增强层次感 (bgCard)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.bgCard}
                            placeholder="#22232b"
                            onChange={(val) => this.presetController.updateDraft('bgCard', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="卡片悬停背景"
                        tooltip="鼠标滑过卡片时的背景颜色 (bgCardHover)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.bgCardHover}
                            placeholder="#292a34"
                            onChange={(val) => this.presetController.updateDraft('bgCardHover', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="输入框背景"
                        tooltip="文本框与选择框的底色 (bgInput)"
                        width="auto"
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
                        tooltip="卡片与控件的外围边框线颜色 (borderColor)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.borderColor}
                            placeholder="rgba(255, 255, 255, 0.08)"
                            onChange={(val) => this.presetController.updateDraft('borderColor', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="高亮边框颜色"
                        tooltip="卡片悬停与聚焦时的边框高亮颜色 (borderHighlight)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.borderHighlight}
                            placeholder="rgba(129, 140, 248, 0.45)"
                            onChange={(val) => this.presetController.updateDraft('borderHighlight', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="正文文字颜色"
                        tooltip="主标题与正文主要文字颜色 (textPrimary)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.textPrimary}
                            placeholder="#f4f4f5"
                            onChange={(val) => this.presetController.updateDraft('textPrimary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="次要文字颜色"
                        tooltip="副标题与辅助说明文字颜色 (textSecondary)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.textSecondary}
                            placeholder="#a1a1aa"
                            onChange={(val) => this.presetController.updateDraft('textSecondary', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="提示文字颜色"
                        tooltip="输入框占位符与辅助说明文字颜色 (textMuted)"
                        width="auto"
                    >
                        <ColorPickerInput
                            value={draft.textMuted}
                            placeholder="#71717a"
                            onChange={(val) => this.presetController.updateDraft('textMuted', val)}
                        />
                    </FormFieldView>
                </CardView>

                {/* 5. 圆角与毛玻璃 */}
                <CardView title="圆角与毛玻璃">
                    <FormFieldView
                        label="全局圆角"
                        tooltip="统一快速调节全界面的圆角大小 (0px ~ 20px)"
                        width="w-240"
                    >
                        <SliderControl
                            min={0}
                            max={20}
                            step={1}
                            value={draft.borderRadius ?? 12}
                            unit="px"
                            onChange={(val) =>
                                this.presetController.patchDraft({
                                    borderRadius: val,
                                    radiusModal: Math.max(14, val + 4),
                                    radiusCard: Math.max(10, val + 2),
                                    radiusInput: Math.min(8, Math.round(val * 0.65)),
                                })
                            }
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="卡片圆角"
                        tooltip="独立调整卡片容器的圆角弧度 (radiusCard)"
                        width="w-240"
                    >
                        <SliderControl
                            min={0}
                            max={24}
                            step={1}
                            value={draft.radiusCard ?? 14}
                            unit="px"
                            onChange={(val) => this.presetController.updateDraft('radiusCard', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="按钮与输入框圆角"
                        tooltip="独立调整按钮与文本框的圆角弧度 (radiusInput)"
                        width="w-240"
                    >
                        <SliderControl
                            min={0}
                            max={16}
                            step={1}
                            value={draft.radiusInput ?? 8}
                            unit="px"
                            onChange={(val) => this.presetController.updateDraft('radiusInput', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="毛玻璃虚化"
                        tooltip="调整弹窗背景的高斯模糊程度 (blurModal)"
                        width="w-240"
                    >
                        <SliderControl
                            min={0}
                            max={30}
                            step={2}
                            value={draft.blurModal ?? 20}
                            unit="px"
                            onChange={(val) =>
                                this.presetController.patchDraft({
                                    blurModal: val,
                                    blurPanel: val + 4,
                                })
                            }
                        />
                    </FormFieldView>
                </CardView>
            </div>
        );
    }

    public override activate(): void {
        const storedId = themeService.getActiveThemeId();
        this.presetController.applyActivePreset(storedId, { persist: false, silent: true });
    }
}
