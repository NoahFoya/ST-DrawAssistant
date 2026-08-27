/**
 * @module ui/views/theme-tab
 * @description 主题定制面板视图 (ThemeTabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    ThemeData,
    PresetProfileItem,
    DEFAULT_THEME_DATA
} from '../../core';
import { ProfileService } from '../../domain';
import {
    createCard,
    createCardHeader,
    createRow,
    createFieldLabel
} from '../layout/container-factory';
import {
    createColorPicker,
    createNumberInput,
    bindPresetToolbar,
    PresetToolbarElement,
    createPresetToolbarAdapter
} from '../controls';
import { ThemeService, FALLBACK_SAFE_THEME } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

/** 主题控件索引对象类型定义 */
interface ThemeControls {
    accentColor?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgPrimary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgGradientEnd?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgSecondary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    textPrimary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    textSecondary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    borderColor?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgGradientAngle?: { inputEl: HTMLInputElement };
    bgOpacity?: { inputEl: HTMLInputElement };
    blurRadius?: { inputEl: HTMLInputElement };
    borderRadius?: { inputEl: HTMLInputElement };
}

/**
 * 主题定制面板视图
 */
export class ThemeTabView extends BaseTabView {
    private _currentThemeData: ThemeData;
    private _toolbarEl?: PresetToolbarElement;
    private readonly _controls: ThemeControls = {};
    private _rafHandle: number | null = null;
    private readonly _profileService: ProfileService;

    constructor(private readonly _store: ObservableStore<DrawAssistantSettings>) {
        super('da-theme-tab');
        this._profileService = new ProfileService(_store);
        this._currentThemeData = { ...this._getActiveThemeData() };

        this._buildCards();
        this._setupReactivity();
    }

    private _getProfiles(): PresetProfileItem<ThemeData>[] {
        return this._store.get('customThemes') || [];
    }

    private _getActiveThemeId(): string {
        return this._store.get('themePreset') || '';
    }

    private _getActiveThemeData(): ThemeData {
        const id = this._getActiveThemeId();
        const profiles = this._getProfiles();
        const found = profiles.find((p) => p.id === id);
        return found?.data || profiles[0]?.data || FALLBACK_SAFE_THEME;
    }

    private _applyDraftThemeDebounced(theme: ThemeData): void {
        if (typeof window === 'undefined') {
            ThemeService.applyThemeVariables(theme);
            return;
        }
        if (this._rafHandle !== null) {
            cancelAnimationFrame(this._rafHandle);
        }
        this._rafHandle = requestAnimationFrame(() => {
            ThemeService.applyThemeVariables(theme);
            this._rafHandle = null;
        });
    }

    /**
     * 将当前草稿数据同步回所有 UI 控件
     */
    private _syncControls(): void {
        const colorKeys: (keyof ThemeData & keyof ThemeControls)[] = [
            'accentColor',
            'bgPrimary',
            'bgGradientEnd',
            'bgSecondary',
            'textPrimary',
            'textSecondary',
            'borderColor'
        ];

        colorKeys.forEach((key) => {
            const ctrl = this._controls[key] as { colorInput: HTMLInputElement; hexInput: HTMLInputElement } | undefined;
            if (!ctrl) return;
            let val = (this._currentThemeData[key] as string) || '';
            if (!val) {
                val = (DEFAULT_THEME_DATA as any)[key] || '#282b33';
            }
            ctrl.colorInput.value = val.startsWith('#') && val.length === 7 ? val : '#282b33';
            ctrl.hexInput.value = val.toUpperCase();
        });

        if (this._controls.bgGradientAngle?.inputEl) {
            this._controls.bgGradientAngle.inputEl.value = String(this._currentThemeData.bgGradientAngle ?? 135);
        }

        if (this._controls.bgOpacity?.inputEl) {
            this._controls.bgOpacity.inputEl.value = String(Math.round((this._currentThemeData.bgOpacity ?? 0.95) * 100));
        }

        if (this._controls.blurRadius?.inputEl) {
            this._controls.blurRadius.inputEl.value = String(this._currentThemeData.blurRadius ?? 20);
        }
        if (this._controls.borderRadius?.inputEl) {
            this._controls.borderRadius.inputEl.value = String(this._currentThemeData.borderRadius ?? 14);
        }
    }

    private _buildCards(): void {
        this._root.appendChild(this._buildSpecCard());
        this._root.appendChild(this._buildPaletteCard());
    }

    // ── 1. 主题方案管理卡片 ──────────────────────────────────────────────────
    private _buildSpecCard(): HTMLElement {
        const cardScheme = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '主题预设方案',
            description: '快速切换、导入导出或保存不同的外观视觉方案，支持一键还原出厂默认'
        });
        cardScheme.header.appendChild(header);

        const adapter = createPresetToolbarAdapter(this._profileService, 'theme', {
            onSave: () => {
                FeedbackService.toastSuccess('主题方案保存成功！');
            }
        });

        this._toolbarEl = bindPresetToolbar({
            adapter,
            getCurrentData: () => this._currentThemeData,
            applyData: (id) => {
                const target = this._getProfiles().find((p) => p.id === id);
                if (target?.data) {
                    this._currentThemeData = { ...target.data };
                    this._applyDraftThemeDebounced(this._currentThemeData);
                    this._syncControls();
                }
            },
            onRefresh: () => {
                this._applyDraftThemeDebounced(this._currentThemeData);
            }
        });

        cardScheme.body.appendChild(this._toolbarEl);
        return cardScheme.root;
    }

    // ── 2. 主题配色与视觉效果卡片 ─────────────────────────────────────────────
    private _buildPaletteCard(): HTMLElement {
        const cardPalette = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '主题色彩与视觉效果',
            description: '实时调节插件核心强调色、渐变背景、文字颜色、毛玻璃与圆角。修改后可点击上方工具栏保存'
        });
        cardPalette.header.appendChild(header);

        // 辅助装配颜色行
        const addColorRow = (title: string, val: string, onUpdate: (hex: string) => void) => {
            const row = createRow(['left', 'right'], { align: 'center', divided: true });
            const label = createFieldLabel({ title });
            row.slots[0].appendChild(label);

            const picker = createColorPicker({
                value: val,
                onChange: onUpdate
            });
            row.slots[1].appendChild(picker);
            this._disposables.add(picker);
            cardPalette.body.appendChild(row.root);
            return picker;
        };

        // 辅助装配数值行
        const addNumberRow = (options: { title: string; value: number; min?: number; max?: number; step?: number; unit?: string }, onUpdate: (num: number) => void) => {
            const row = createRow(['left', 'right'], { align: 'center', divided: true });
            const label = createFieldLabel({ title: options.title });
            row.slots[0].appendChild(label);

            const numberControl = createNumberInput({
                value: options.value,
                min: options.min,
                max: options.max,
                step: options.step,
                unit: options.unit,
                onChange: onUpdate
            });
            row.slots[1].appendChild(numberControl);
            this._disposables.add(numberControl);
            cardPalette.body.appendChild(row.root);
            return numberControl;
        };

                // 1. 主题强调色
                const accent = addColorRow('主题强调色', this._currentThemeData.accentColor || '#00f2fe', (val) => {
                    this._currentThemeData.accentColor = val;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.accentColor = { colorInput: accent.colorInputElement, hexInput: accent.hexInputElement };

                // 2. 背景渐变起始色
                const bgPrim = addColorRow('背景渐变起始色', this._currentThemeData.bgPrimary || '#0f1014', (val) => {
                    this._currentThemeData.bgPrimary = val;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.bgPrimary = { colorInput: bgPrim.colorInputElement, hexInput: bgPrim.hexInputElement };

                // 3. 背景渐变结束色
                const bgGrad = addColorRow('背景渐变结束色', this._currentThemeData.bgGradientEnd || this._currentThemeData.bgPrimary || '#0f1014', (val) => {
                    this._currentThemeData.bgGradientEnd = val;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.bgGradientEnd = { colorInput: bgGrad.colorInputElement, hexInput: bgGrad.hexInputElement };

                // 4. 背景渐变角度
                const angleControl = addNumberRow({
                    title: '背景渐变角度',
                    value: this._currentThemeData.bgGradientAngle ?? 135,
                    min: 0,
                    max: 360,
                    step: 5,
                    unit: '°'
                }, (num) => {
                    this._currentThemeData.bgGradientAngle = num;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.bgGradientAngle = { inputEl: angleControl.inputElement };

                // 5. 面板与卡片背景色
                const bgSec = addColorRow('面板与卡片背景色', this._currentThemeData.bgSecondary || '#1a1d24', (val) => {
                    this._currentThemeData.bgSecondary = val;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.bgSecondary = { colorInput: bgSec.colorInputElement, hexInput: bgSec.hexInputElement };

                // 6. 主要文字颜色
                const textP = addColorRow('主要文字颜色', this._currentThemeData.textPrimary || '#f2f2f7', (val) => {
                    this._currentThemeData.textPrimary = val;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.textPrimary = { colorInput: textP.colorInputElement, hexInput: textP.hexInputElement };

                // 7. 次要文字颜色
                const textS = addColorRow('次要文字颜色', this._currentThemeData.textSecondary || '#8e8e93', (val) => {
                    this._currentThemeData.textSecondary = val;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.textSecondary = { colorInput: textS.colorInputElement, hexInput: textS.hexInputElement };

                // 8. 边框与分割线颜色
                const border = addColorRow('边框与分割线颜色', this._currentThemeData.borderColor || '#282b33', (val) => {
                    this._currentThemeData.borderColor = val;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.borderColor = { colorInput: border.colorInputElement, hexInput: border.hexInputElement };

                // 9. 背景不透明度
                const opacityControl = addNumberRow({
                    title: '毛玻璃不透明度',
                    value: Math.round((this._currentThemeData.bgOpacity ?? 0.95) * 100),
                    min: 20,
                    max: 100,
                    step: 1,
                    unit: '%'
                }, (pct) => {
                    this._currentThemeData.bgOpacity = pct / 100;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.bgOpacity = { inputEl: opacityControl.inputElement };

                // 10. 毛玻璃模糊半径
                const blurControl = addNumberRow({
                    title: '毛玻璃模糊度',
                    value: this._currentThemeData.blurRadius ?? 20,
                    min: 0,
                    max: 40,
                    step: 1,
                    unit: 'px'
                }, (num) => {
                    this._currentThemeData.blurRadius = num;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.blurRadius = { inputEl: blurControl.inputElement };

                // 11. 界面圆角大小
                const radiusControl = addNumberRow({
                    title: '界面圆角',
                    value: this._currentThemeData.borderRadius ?? 14,
                    min: 0,
                    max: 24,
                    step: 1,
                    unit: 'px'
                }, (num) => {
                    this._currentThemeData.borderRadius = num;
                    this._applyDraftThemeDebounced(this._currentThemeData);
                });
                this._controls.borderRadius = { inputEl: radiusControl.inputElement };
        return cardPalette.root;
    }

    private _setupReactivity(): void {
        this._disposables.add(
            this._store.subscribe(() => {
                const themeId = this._getActiveThemeId();
                if (this._toolbarEl?.refreshPresets) {
                    this._toolbarEl.refreshPresets(this._getProfiles(), themeId);
                }
            })
        );
    }

    override dispose(): void {
        if (this._rafHandle !== null) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }
        super.dispose();
    }
}

