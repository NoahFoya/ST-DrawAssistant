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
    ThemeData,
    FALLBACK_SAFE_THEME
} from '../foundation/theme-service';
import { BUILTIN_PRESET_THEMES } from '../../state/builtin-presets';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

export class ThemeTabView extends BaseTabView {
    private _currentThemeData: ThemeData;
    private _toolbarEl?: PresetToolbarElement;
    private readonly _colorControls = new Map<keyof ThemeData, ColorPickerHandle>();
    private readonly _sliderControls = new Map<keyof ThemeData, SliderHandle>();
    /** 全量主题方案列表：由初始模板与持久化预设加载 */
    private _presets: PresetItem<ThemeData>[] = (BUILTIN_PRESET_THEMES as unknown as PresetItem<ThemeData>[]) || [];

    constructor(
        private readonly _store: SettingsStore,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super();
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
                            accentColor: d.accentColor || FALLBACK_SAFE_THEME.accentColor,
                            bgPrimary: d.bgPrimary || FALLBACK_SAFE_THEME.bgPrimary,
                            bgSecondary: d.bgSecondary || FALLBACK_SAFE_THEME.bgSecondary,
                            bgGradientEnd: d.bgGradientEnd || d.bgPrimary || FALLBACK_SAFE_THEME.bgGradientEnd,
                            bgGradientAngle: Number(d.bgGradientAngle ?? FALLBACK_SAFE_THEME.bgGradientAngle),
                            bgOpacity: Number(d.bgOpacity ?? FALLBACK_SAFE_THEME.bgOpacity),
                            textPrimary: d.textPrimary || FALLBACK_SAFE_THEME.textPrimary,
                            textSecondary: d.textSecondary || FALLBACK_SAFE_THEME.textSecondary,
                            borderColor: d.borderColor || FALLBACK_SAFE_THEME.borderColor,
                            borderRadius: Number(d.borderRadius ?? FALLBACK_SAFE_THEME.borderRadius),
                            blurRadius: Number(d.blurRadius ?? FALLBACK_SAFE_THEME.blurRadius)
                        }
                    };
                });
            } else {
                this._presets = (BUILTIN_PRESET_THEMES as unknown as PresetItem<ThemeData>[]) || [];
            }

            ThemeService.registerThemes(this._presets);
            const currentId = this._getActiveThemeId();
            this._toolbarEl?.refreshPresets?.(this._presets, currentId);

            const activeProfile = this._presets.find((p) => p.id === currentId);
            if (activeProfile?.data) {
                this._currentThemeData = { ...activeProfile.data };
                this._syncControls();
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
                this._checkFieldDirty();
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

                const nextId = this._presets[0]?.id || '';
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
                    accentColor: d.accentColor || FALLBACK_SAFE_THEME.accentColor,
                    bgPrimary: d.bgPrimary || FALLBACK_SAFE_THEME.bgPrimary,
                    bgSecondary: d.bgSecondary || FALLBACK_SAFE_THEME.bgSecondary,
                    bgGradientEnd: d.bgGradientEnd || d.bgPrimary || FALLBACK_SAFE_THEME.bgGradientEnd,
                    bgGradientAngle: Number(d.bgGradientAngle ?? FALLBACK_SAFE_THEME.bgGradientAngle),
                    bgOpacity: Number(d.bgOpacity ?? FALLBACK_SAFE_THEME.bgOpacity),
                    textPrimary: d.textPrimary || FALLBACK_SAFE_THEME.textPrimary,
                    textSecondary: d.textSecondary || FALLBACK_SAFE_THEME.textSecondary,
                    borderColor: d.borderColor || FALLBACK_SAFE_THEME.borderColor,
                    borderRadius: Number(d.borderRadius ?? FALLBACK_SAFE_THEME.borderRadius),
                    blurRadius: Number(d.blurRadius ?? FALLBACK_SAFE_THEME.blurRadius)
                };

                const ok = await PresetStore.save('themes', { id, name, data });
                if (!ok) {
                    FeedbackService.toastError(`导入主题失败：无法写入本地存储`);
                    throw new Error(`导入主题失败: 本地写入异常`);
                }

                this._presets.push({ id, name, data });
                ThemeService.registerThemes(this._presets);
                this._store.set('themePreset', id);
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
            }
        };

        this._toolbarEl = bindPresetToolbar<ThemeData>({
            adapter,
            getCurrentData: () => this._currentThemeData,
            onBeforeSelect: async (_newId) => {
                if (this._toolbarEl?.isDirty?.()) {
                    return await FeedbackService.confirm({
                        title: '未保存修改提示',
                        message: '当前主题方案有未保存的修改，切换方案将放弃这些修改，是否继续？',
                        confirmText: '放弃修改并切换'
                    });
                }
                return true;
            },
            onResetOverride: () => {
                const currentId = this._getActiveThemeId();
                const profile = this._presets.find((p) => p.id === currentId);
                if (profile?.data) {
                    this._currentThemeData = { ...profile.data };
                } else {
                    this._currentThemeData = { ...this._getActiveThemeData() };
                }
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._syncControls();
                this._toolbarEl?.setDirty?.(false);
                this._checkFieldDirty();
            },
            applyData: (id: string) => {
                this._store.set('themePreset', id);
                const profile = this._presets.find((p) => p.id === id);
                if (profile?.data) {
                    this._currentThemeData = { ...profile.data };
                } else {
                    this._currentThemeData = { ...this._getActiveThemeData() };
                }
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._syncControls();
                this._checkFieldDirty();
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
            title: '界面配色方案',
            description: '配置主调强调色、背景色板与文本对比度'
        });
        card.header.appendChild(header);

        const colorFields: Array<{ key: keyof ThemeData; label: string; helpTooltip?: string; def: string }> = [
            {
                key: 'accentColor',
                label: '主题强调色',
                helpTooltip: '控制界面关键操作按钮、单选高亮框与激活态边框的全局主色调。',
                def: FALLBACK_SAFE_THEME.accentColor
            },
            {
                key: 'bgPrimary',
                label: '主背景色',
                helpTooltip: '控制插件主弹窗底层与侧边栏导航的基础背景颜色。',
                def: FALLBACK_SAFE_THEME.bgPrimary
            },
            {
                key: 'bgGradientEnd',
                label: '渐变结束色',
                def: FALLBACK_SAFE_THEME.bgGradientEnd
            },
            {
                key: 'bgSecondary',
                label: '卡片背景色',
                def: FALLBACK_SAFE_THEME.bgSecondary
            },
            {
                key: 'textPrimary',
                label: '主文本颜色',
                def: FALLBACK_SAFE_THEME.textPrimary
            },
            {
                key: 'textSecondary',
                label: '次要文本颜色',
                def: FALLBACK_SAFE_THEME.textSecondary
            },
            {
                key: 'borderColor',
                label: '边框线条颜色',
                def: FALLBACK_SAFE_THEME.borderColor
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
                    this._checkFieldDirty();
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
            title: '质感与圆角调节',
            description: '调节背景渐变、虚化程度、不透明度与界面圆角半径'
        });
        card.header.appendChild(header);

        // 背景渐变角度 (Slider + 数值)
        const angleRow = createRow(['fill', 'auto'], { align: 'center' });
        angleRow.slots[0].appendChild(createFieldLabel({
            title: '背景渐变角度'
        }));
        const angleSlider = createSlider({
            value: Number(this._currentThemeData.bgGradientAngle ?? FALLBACK_SAFE_THEME.bgGradientAngle),
            min: 0,
            max: 360,
            step: 5,
            unit: 'deg',
            onChange: (val) => {
                this._currentThemeData.bgGradientAngle = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._toolbarEl?.setDirty?.(true);
                this._checkFieldDirty();
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
        const rawOpacity = Number(this._currentThemeData.bgOpacity ?? FALLBACK_SAFE_THEME.bgOpacity);
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
                this._checkFieldDirty();
            }
        });
        this._disposables.add(opacitySlider);
        this._sliderControls.set('bgOpacity', opacitySlider);
        opacityRow.slots[1].appendChild(opacitySlider);
        card.body.appendChild(opacityRow.root);

        // 背景虚化 (Slider + 数值)
        const blurRow = createRow(['fill', 'auto'], { align: 'center' });
        blurRow.slots[0].appendChild(createFieldLabel({
            title: '背景毛玻璃虚化',
            helpTooltip: '控制弹窗底层的半透明虚化程度。设为 0 可完全关闭虚化以提升低配设备渲染帧率。'
        }));
        const blurSlider = createSlider({
            value: Number(this._currentThemeData.blurRadius ?? FALLBACK_SAFE_THEME.blurRadius),
            min: 0,
            max: 40,
            step: 1,
            unit: 'px',
            onChange: (val) => {
                this._currentThemeData.blurRadius = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._toolbarEl?.setDirty?.(true);
                this._checkFieldDirty();
            }
        });
        this._disposables.add(blurSlider);
        this._sliderControls.set('blurRadius', blurSlider);
        blurRow.slots[1].appendChild(blurSlider);
        card.body.appendChild(blurRow.root);

        // 全局圆角 (Slider + 数值)
        const radiusRow = createRow(['fill', 'auto'], { align: 'center' });
        radiusRow.slots[0].appendChild(createFieldLabel({
            title: '全局圆角半径'
        }));
        const radiusSlider = createSlider({
            value: Number(this._currentThemeData.borderRadius ?? FALLBACK_SAFE_THEME.borderRadius),
            min: 0,
            max: 24,
            step: 1,
            unit: 'px',
            onChange: (val) => {
                this._currentThemeData.borderRadius = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                this._toolbarEl?.setDirty?.(true);
                this._checkFieldDirty();
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
                const val = String(this._currentThemeData[key] || FALLBACK_SAFE_THEME[key]);
                handle.colorInputElement.value = val.startsWith('#') ? val : '#000000';
                handle.hexInputElement.value = val;
            }
        }

        const angleHandle = this._sliderControls.get('bgGradientAngle');
        if (angleHandle) {
            angleHandle.setValue(Number(this._currentThemeData.bgGradientAngle ?? FALLBACK_SAFE_THEME.bgGradientAngle));
        }

        const opacityHandle = this._sliderControls.get('bgOpacity');
        if (opacityHandle) {
            const raw = Number(this._currentThemeData.bgOpacity ?? FALLBACK_SAFE_THEME.bgOpacity);
            opacityHandle.setValue(Math.round(raw > 1 ? raw : raw * 100));
        }

        const blurHandle = this._sliderControls.get('blurRadius');
        if (blurHandle) {
            blurHandle.setValue(Number(this._currentThemeData.blurRadius ?? FALLBACK_SAFE_THEME.blurRadius));
        }

        const radiusHandle = this._sliderControls.get('borderRadius');
        if (radiusHandle) {
            radiusHandle.setValue(Number(this._currentThemeData.borderRadius ?? FALLBACK_SAFE_THEME.borderRadius));
        }

        this._checkFieldDirty();
    }

    private _checkFieldDirty(): void {
        const currentId = this._getActiveThemeId();
        const activeProfile = this._presets.find((p) => p.id === currentId);
        const baseline = activeProfile?.data || FALLBACK_SAFE_THEME;

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
                const cur = String(this._currentThemeData[key] || '').toLowerCase();
                const base = String(baseline[key] || '').toLowerCase();
                const isDirty = cur !== base;
                handle.classList.toggle('is-dirty', isDirty);
                handle.hexInputElement.classList.toggle('is-dirty', isDirty);
            }
        }

        const sliderKeys: (keyof ThemeData)[] = [
            'bgGradientAngle',
            'bgOpacity',
            'blurRadius',
            'borderRadius'
        ];

        for (const key of sliderKeys) {
            const handle = this._sliderControls.get(key);
            if (handle) {
                const cur = Number(this._currentThemeData[key] ?? 0);
                const base = Number(baseline[key] ?? 0);
                const isDirty = Math.abs(cur - base) > 0.001;
                handle.classList.toggle('is-dirty', isDirty);
            }
        }
    }
}
