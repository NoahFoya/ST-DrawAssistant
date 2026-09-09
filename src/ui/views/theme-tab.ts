/**
 * 外观主题定制面板视图 (ThemeTabView)
 * 提供预设方案管理与 11 项精细视觉参数（7 色彩 + 4 质感版式）微调
 */

import { CoreEventMap } from '../../types';
import { TypedEventBus } from '../../utils';
import { SettingsStore, PresetStore } from '../../state';
import {
    createCard,
    createCardHeader,
    createRow,
    createFieldLabel
} from '../layout/container-factory';
import {
    createColorPicker,
    createSlider,
    bindPresetToolbar,
    PresetToolbarElement,
    PresetToolbarAdapter,
    PresetItem,
    ColorPickerHandle,
    SliderHandle
} from '../components';
import {
    ThemeService,
    DEFAULT_THEME_DATA,
    DEFAULT_LIGHT_THEME_DATA,
    ThemeData,
    FALLBACK_SAFE_THEME
} from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

export class ThemeTabView extends BaseTabView {
    private _currentThemeData: ThemeData;
    private _toolbarEl?: PresetToolbarElement;
    private readonly _colorControls = new Map<keyof ThemeData, ColorPickerHandle>();
    private readonly _sliderControls = new Map<keyof ThemeData, SliderHandle>();
    /** 全量主题方案列表：由本地配置与预设加载，默认包含深浅基础方案 */
    private _presets: PresetItem<ThemeData>[] = [
        { id: 'dark', name: '深色夜间', data: { ...DEFAULT_THEME_DATA } },
        { id: 'light', name: '明亮日间', data: { ...DEFAULT_LIGHT_THEME_DATA } }
    ];

    constructor(
        private readonly _store: SettingsStore,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super('da-theme-tab');
        ThemeService.registerThemes(this._presets);
        this._currentThemeData = { ...this._getActiveThemeData() };
        this._buildCards();
        this._loadPresets();

        if (this._events) {
            this._disposables.add(
                this._events.on('presets:reset', () => {
                    void this._loadPresets();
                })
            );
            this._disposables.add(
                this._events.on('presets:imported', () => {
                    void this._loadPresets();
                })
            );
        }
    }

    private _getActiveThemeId(): string {
        return this._store.get('themePreset') || 'dark';
    }

    private _getActiveThemeData(): ThemeData {
        const themeService = ThemeService.getInstance();
        if (themeService) {
            return themeService.getCurrentTheme();
        }
        return { ...FALLBACK_SAFE_THEME };
    }

    /** 异步读取预设主题列表 */
    private async _loadPresets(): Promise<void> {
        try {
            const list = await PresetStore.list<ThemeData>('themes');
            if (Array.isArray(list) && list.length > 0) {
                this._presets = list.map((p) => {
                    const d: any = p.data || p;
                    return {
                        id: p.id,
                        name: p.name || p.id,
                        data: {
                            accentColor: d.accentColor || DEFAULT_THEME_DATA.accentColor,
                            bgPrimary: d.bgPrimary || DEFAULT_THEME_DATA.bgPrimary,
                            bgSecondary: d.bgSecondary || DEFAULT_THEME_DATA.bgSecondary,
                            bgGradientEnd: d.bgGradientEnd || d.bgPrimary || DEFAULT_THEME_DATA.bgGradientEnd,
                            bgGradientAngle: Number(d.bgGradientAngle ?? DEFAULT_THEME_DATA.bgGradientAngle),
                            bgOpacity: Number(d.bgOpacity ?? DEFAULT_THEME_DATA.bgOpacity),
                            textPrimary: d.textPrimary || DEFAULT_THEME_DATA.textPrimary,
                            textSecondary: d.textSecondary || DEFAULT_THEME_DATA.textSecondary,
                            borderColor: d.borderColor || DEFAULT_THEME_DATA.borderColor,
                            borderRadius: Number(d.borderRadius ?? DEFAULT_THEME_DATA.borderRadius),
                            blurRadius: Number(d.blurRadius ?? DEFAULT_THEME_DATA.blurRadius)
                        }
                    };
                });

                ThemeService.registerThemes(this._presets);
                const currentId = this._getActiveThemeId();
                this._toolbarEl?.refreshPresets?.(this._presets, currentId);

                const activeProfile = this._presets.find((p) => p.id === currentId);
                if (activeProfile?.data) {
                    this._currentThemeData = { ...activeProfile.data };
                    this._syncControls();
                }
            }
        } catch {
            // 离线或服务未就绪时保持内存安全方案
        }
    }

    private _buildCards(): void {
        this._buildPresetToolbarCard();
        const colorCard = this._buildColorCard();
        const effectsCard = this._buildEffectsCard();
        this._root.appendChild(colorCard);
        this._root.appendChild(effectsCard);
    }

    private _buildPresetToolbarCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '主题预设方案',
            description: '切换、新建、修改或导出界面视觉配色方案，修改实时持久化至本地文件'
        });
        card.header.appendChild(header);

        const adapter: PresetToolbarAdapter<ThemeData> = {
            label: '外观主题',
            getProfiles: () => this._presets,
            getInitialId: () => this._getActiveThemeId(),
            createProfile: async (name: string, data: ThemeData) => {
                const newId = `theme_${Date.now()}`;
                const ok = await PresetStore.save('themes', { id: newId, name, data });
                if (!ok) {
                    FeedbackService.toastError(`创建外观主题失败：无法写入本地存储`);
                    throw new Error(`创建主题失败: 本地存储写入异常`);
                }

                this._presets.push({ id: newId, name, data: { ...data } });
                ThemeService.registerThemes(this._presets);
                this._store.set('themePreset', newId);
                FeedbackService.toastSuccess(`已创建并保存主题：${name}`);
                return newId;
            },
            saveProfile: async (id: string, data: ThemeData) => {
                const preset = this._presets.find((p) => p.id === id);
                const name = preset?.name || id;

                const ok = await PresetStore.save('themes', { id, name, data });
                if (!ok) {
                    FeedbackService.toastError(`保存外观主题失败：无法更新本地存储`);
                    return;
                }

                if (preset) {
                    preset.data = { ...data };
                } else {
                    this._presets.push({ id, name, data: { ...data } });
                }

                ThemeService.registerThemes(this._presets);
                ThemeService.applyThemeVariables(data, document.documentElement);
                FeedbackService.toastSuccess(`已保存主题方案：${name}`);
            },
            renameProfile: async (id: string, newName: string) => {
                const preset = this._presets.find((p) => p.id === id);
                if (preset) {
                    const ok = await PresetStore.save('themes', { id, name: newName, data: preset.data || {} as ThemeData });
                    if (!ok) {
                        FeedbackService.toastError(`重命名主题失败：无法更新本地存储`);
                        return;
                    }
                    preset.name = newName;
                    FeedbackService.toastSuccess(`已重命名主题为：${newName}`);
                }
            },
            deleteProfile: async (id: string) => {
                const ok = await PresetStore.delete('themes', id);
                if (!ok) {
                    FeedbackService.toastError(`删除主题方案失败：无法删除本地预设`);
                    throw new Error(`删除主题失败: 本地操作异常`);
                }

                this._presets = this._presets.filter((p) => p.id !== id);
                ThemeService.unregisterTheme(id);
                FeedbackService.toastSuccess('已删除主题方案');

                const nextId = this._presets[0]?.id || 'dark';
                this._store.set('themePreset', nextId);
                return nextId;
            },
            exportProfile: (id: string, data: ThemeData) => {
                const preset = this._presets.find((p) => p.id === id);
                const exportObj = {
                    id,
                    name: preset?.name || id,
                    data
                };
                const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${preset?.name || id}_主题预设.json`;
                a.click();
                URL.revokeObjectURL(url);
                FeedbackService.toastSuccess(`已导出主题预设文件: ${a.download}`);
            },
            importProfile: async (content: string, fileName: string) => {
                const parsed = JSON.parse(content);
                const name = parsed.name || fileName.replace(/\.json$/i, '');
                const id = `imported_${Date.now()}`;
                const d = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
                const data: ThemeData = {
                    accentColor: d.accentColor || DEFAULT_THEME_DATA.accentColor,
                    bgPrimary: d.bgPrimary || DEFAULT_THEME_DATA.bgPrimary,
                    bgSecondary: d.bgSecondary || DEFAULT_THEME_DATA.bgSecondary,
                    bgGradientEnd: d.bgGradientEnd || d.bgPrimary || DEFAULT_THEME_DATA.bgGradientEnd,
                    bgGradientAngle: Number(d.bgGradientAngle ?? DEFAULT_THEME_DATA.bgGradientAngle),
                    bgOpacity: Number(d.bgOpacity ?? DEFAULT_THEME_DATA.bgOpacity),
                    textPrimary: d.textPrimary || DEFAULT_THEME_DATA.textPrimary,
                    textSecondary: d.textSecondary || DEFAULT_THEME_DATA.textSecondary,
                    borderColor: d.borderColor || DEFAULT_THEME_DATA.borderColor,
                    borderRadius: Number(d.borderRadius ?? DEFAULT_THEME_DATA.borderRadius),
                    blurRadius: Number(d.blurRadius ?? DEFAULT_THEME_DATA.blurRadius)
                };

                const ok = await PresetStore.save('themes', { id, name, data });
                if (!ok) {
                    FeedbackService.toastError(`导入主题失败：无法写入本地存储`);
                    throw new Error(`导入主题失败: 本地写入异常`);
                }

                this._presets.push({ id, name, data });
                ThemeService.registerThemes(this._presets);
                this._store.set('themePreset', id);
                FeedbackService.toastSuccess(`已导入并应用主题: ${name}`);
                return id;
            },
            onSelect: (presetId: string) => {
                this._store.set('themePreset', presetId);
                const profile = this._presets.find((p) => p.id === presetId);
                if (profile?.data) {
                    this._currentThemeData = { ...profile.data };
                } else {
                    this._currentThemeData = { ...this._getActiveThemeData() };
                }
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._syncControls();
                FeedbackService.toastSuccess(`已激活主题：${profile?.name || presetId}`);
            }
        };

        this._toolbarEl = bindPresetToolbar<ThemeData>({
            adapter,
            getCurrentData: () => this._currentThemeData,
            applyData: (id: string) => {
                const profile = this._presets.find((p) => p.id === id);
                if (profile?.data) {
                    this._currentThemeData = { ...profile.data };
                } else {
                    this._currentThemeData = { ...this._getActiveThemeData() };
                }
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._syncControls();
            }
        });

        this._disposables.add({
            dispose: () => {
                this._toolbarEl?.remove();
                this._toolbarEl = undefined;
            }
        });
        card.body.appendChild(this._toolbarEl);
        this._root.appendChild(card.root);
    }

    private _buildColorCard(): HTMLElement {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '界面色彩配置',
            description: '配置主调高光、背景色板与文字对比度'
        });
        card.header.appendChild(header);

        const colorFields: Array<{ key: keyof ThemeData; label: string; helpTooltip?: string; def: string }> = [
            {
                key: 'accentColor',
                label: '主题高光强调色',
                helpTooltip: '控制界面关键操作按钮、单选高亮框与激活态边框的全局主色调。',
                def: DEFAULT_THEME_DATA.accentColor
            },
            {
                key: 'bgPrimary',
                label: '界面主背景色',
                helpTooltip: '控制插件主弹窗底层与侧边栏导航的基础背景颜色。',
                def: DEFAULT_THEME_DATA.bgPrimary
            },
            {
                key: 'bgGradientEnd',
                label: '背景渐变结束色',
                def: DEFAULT_THEME_DATA.bgGradientEnd
            },
            {
                key: 'bgSecondary',
                label: '卡片容器背景色',
                def: DEFAULT_THEME_DATA.bgSecondary
            },
            {
                key: 'textPrimary',
                label: '主文本文字颜色',
                def: DEFAULT_THEME_DATA.textPrimary
            },
            {
                key: 'textSecondary',
                label: '次级说明文字颜色',
                def: DEFAULT_THEME_DATA.textSecondary
            },
            {
                key: 'borderColor',
                label: '边框分界线颜色',
                def: DEFAULT_THEME_DATA.borderColor
            }
        ];

        for (const f of colorFields) {
            const row = createRow(['fill', 'auto'], { align: 'center' });
            const label = createFieldLabel({
                title: f.label,
                helpTooltip: f.helpTooltip
            });
            row.slots[0].appendChild(label);

            const curVal = String(this._currentThemeData[f.key] || f.def);
            const picker = createColorPicker({
                value: curVal,
                onChange: (val) => {
                    (this._currentThemeData as any)[f.key] = val;
                    ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                    this._toolbarEl?.setDirty?.(true);
                }
            });
            this._disposables.add(picker);
            this._colorControls.set(f.key, picker);
            row.slots[1].appendChild(picker);
            card.body.appendChild(row.root);
        }

        return card.root;
    }

    private _buildEffectsCard(): HTMLElement {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '视觉质感与圆角',
            description: '调节界面模糊度、圆角弧度与不透明度'
        });
        card.header.appendChild(header);

        // 背景渐变角度 (Slider + 数值)
        const angleRow = createRow(['fill', 'auto'], { align: 'center' });
        angleRow.slots[0].appendChild(createFieldLabel({
            title: '背景渐变角度'
        }));
        const angleSlider = createSlider({
            value: Number(this._currentThemeData.bgGradientAngle ?? DEFAULT_THEME_DATA.bgGradientAngle),
            min: 0,
            max: 360,
            step: 5,
            unit: 'deg',
            onChange: (val) => {
                this._currentThemeData.bgGradientAngle = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._toolbarEl?.setDirty?.(true);
            }
        });
        this._disposables.add(angleSlider);
        this._sliderControls.set('bgGradientAngle', angleSlider);
        angleRow.slots[1].appendChild(angleSlider);
        card.body.appendChild(angleRow.root);

        // 背景不透明度 (Slider + 数值)
        const opacityRow = createRow(['fill', 'auto'], { align: 'center' });
        opacityRow.slots[0].appendChild(createFieldLabel({
            title: '背景不透明度'
        }));
        const rawOpacity = Number(this._currentThemeData.bgOpacity ?? DEFAULT_THEME_DATA.bgOpacity);
        const opacitySlider = createSlider({
            value: Math.round(rawOpacity > 1 ? rawOpacity : rawOpacity * 100),
            min: 10,
            max: 100,
            step: 1,
            unit: '%',
            onChange: (val) => {
                this._currentThemeData.bgOpacity = val / 100;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._toolbarEl?.setDirty?.(true);
            }
        });
        this._disposables.add(opacitySlider);
        this._sliderControls.set('bgOpacity', opacitySlider);
        opacityRow.slots[1].appendChild(opacitySlider);
        card.body.appendChild(opacityRow.root);

        // 毛玻璃虚化 (Slider + 数值)
        const blurRow = createRow(['fill', 'auto'], { align: 'center' });
        blurRow.slots[0].appendChild(createFieldLabel({
            title: '毛玻璃模糊半径',
            helpTooltip: '控制弹窗底层的半透明虚化程度。设为 0 可完全关闭虚化以提升低配设备渲染帧率。'
        }));
        const blurSlider = createSlider({
            value: Number(this._currentThemeData.blurRadius ?? DEFAULT_THEME_DATA.blurRadius),
            min: 0,
            max: 40,
            step: 1,
            unit: 'px',
            onChange: (val) => {
                this._currentThemeData.blurRadius = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._toolbarEl?.setDirty?.(true);
            }
        });
        this._disposables.add(blurSlider);
        this._sliderControls.set('blurRadius', blurSlider);
        blurRow.slots[1].appendChild(blurSlider);
        card.body.appendChild(blurRow.root);

        // 全局圆角 (Slider + 数值)
        const radiusRow = createRow(['fill', 'auto'], { align: 'center' });
        radiusRow.slots[0].appendChild(createFieldLabel({
            title: '全局界面圆角'
        }));
        const radiusSlider = createSlider({
            value: Number(this._currentThemeData.borderRadius ?? DEFAULT_THEME_DATA.borderRadius),
            min: 0,
            max: 24,
            step: 1,
            unit: 'px',
            onChange: (val) => {
                this._currentThemeData.borderRadius = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._toolbarEl?.setDirty?.(true);
            }
        });
        this._disposables.add(radiusSlider);
        this._sliderControls.set('borderRadius', radiusSlider);
        radiusRow.slots[1].appendChild(radiusSlider);
        card.body.appendChild(radiusRow.root);

        return card.root;
    }

    /** 批量同步所有输入控件的值，避免触发 onChange 造成误标脏 */
    private _syncControls(): void {
        const colorKeys: (keyof ThemeData)[] = [
            'accentColor',
            'bgPrimary',
            'bgGradientEnd',
            'bgSecondary',
            'textPrimary',
            'textSecondary',
            'borderColor'
        ];

        for (const key of colorKeys) {
            const handle = this._colorControls.get(key);
            if (handle) {
                const val = String(this._currentThemeData[key] || DEFAULT_THEME_DATA[key]);
                handle.colorInputElement.value = val.startsWith('#') ? val : '#000000';
                handle.hexInputElement.value = val;
            }
        }

        const angleHandle = this._sliderControls.get('bgGradientAngle');
        if (angleHandle) {
            angleHandle.setValue(Number(this._currentThemeData.bgGradientAngle ?? DEFAULT_THEME_DATA.bgGradientAngle));
        }

        const opacityHandle = this._sliderControls.get('bgOpacity');
        if (opacityHandle) {
            const raw = Number(this._currentThemeData.bgOpacity ?? DEFAULT_THEME_DATA.bgOpacity);
            opacityHandle.setValue(Math.round(raw > 1 ? raw : raw * 100));
        }

        const blurHandle = this._sliderControls.get('blurRadius');
        if (blurHandle) {
            blurHandle.setValue(Number(this._currentThemeData.blurRadius ?? DEFAULT_THEME_DATA.blurRadius));
        }

        const radiusHandle = this._sliderControls.get('borderRadius');
        if (radiusHandle) {
            radiusHandle.setValue(Number(this._currentThemeData.borderRadius ?? DEFAULT_THEME_DATA.borderRadius));
        }
    }
}
