/**
 * 外观主题定制面板视图 (ThemeTabView)
 * 提供方案预设管理、核心配色微调、渐变质感调节与高级细节微调
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

/** 主题表单字段声明规范 */
interface ThemeFieldConfig {
    key: keyof ThemeData;
    label: string;
    helpTooltip?: string;
    type: 'color' | 'slider';
    group: 'colors' | 'effects' | 'advanced';
    def: string | number;
    sliderOptions?: {
        min: number;
        max: number;
        step?: number;
        unit?: string;
        /** 是否为百分比缩放 (如 bgOpacity: 0.95 -> 95%) */
        scale100?: boolean;
    };
}

/** 规范化主题字段声明表（声明式驱动构建、同步与未保存状态比对） */
const THEME_FIELD_CONFIGS: readonly ThemeFieldConfig[] = [
    // 1. 界面配色方案 (group: 'colors')
    {
        key: 'accentColor',
        label: '主题强调色',
        helpTooltip: '控制关键操作按钮、选中高亮框与激活边框的主色调。',
        type: 'color',
        group: 'colors',
        def: FALLBACK_SAFE_THEME.accentColor
    },
    {
        key: 'bgPrimary',
        label: '主背景色',
        helpTooltip: '控制主弹窗底层与侧边栏导航的基础背景颜色。',
        type: 'color',
        group: 'colors',
        def: FALLBACK_SAFE_THEME.bgPrimary
    },
    {
        key: 'bgCard',
        label: '卡片背景色',
        helpTooltip: '控制内容面板卡片容器的表面底色。',
        type: 'color',
        group: 'colors',
        def: FALLBACK_SAFE_THEME.bgCard || FALLBACK_SAFE_THEME.bgSecondary
    },
    {
        key: 'textPrimary',
        label: '主文本颜色',
        helpTooltip: '控制主要标题、正文与关键标签的文字颜色。',
        type: 'color',
        group: 'colors',
        def: FALLBACK_SAFE_THEME.textPrimary
    },
    {
        key: 'textSecondary',
        label: '次要文本颜色',
        helpTooltip: '控制次级说明、辅助提示与表单标签的文字颜色。',
        type: 'color',
        group: 'colors',
        def: FALLBACK_SAFE_THEME.textSecondary
    },
    {
        key: 'borderColor',
        label: '边框线条颜色',
        helpTooltip: '控制卡片分界线与基础边框的半透明线条颜色。',
        type: 'color',
        group: 'colors',
        def: FALLBACK_SAFE_THEME.borderColor
    },

    // 2. 质感与圆角调节 (group: 'effects')
    {
        key: 'bgGradientEnd',
        label: '渐变结束色',
        helpTooltip: '配合主背景色与角度生成弹窗对角环境渐变。',
        type: 'color',
        group: 'effects',
        def: FALLBACK_SAFE_THEME.bgGradientEnd
    },
    {
        key: 'bgGradientAngle',
        label: '背景渐变角度',
        helpTooltip: '控制背景环境渐变的对角线倾斜角度。',
        type: 'slider',
        group: 'effects',
        def: FALLBACK_SAFE_THEME.bgGradientAngle,
        sliderOptions: { min: 0, max: 360, step: 5, unit: 'deg' }
    },
    {
        key: 'bgOpacity',
        label: '背景不透明度',
        helpTooltip: '控制弹窗背景层的不透明度。',
        type: 'slider',
        group: 'effects',
        def: FALLBACK_SAFE_THEME.bgOpacity,
        sliderOptions: { min: 10, max: 100, step: 1, unit: '%', scale100: true }
    },
    {
        key: 'blurRadius',
        label: '背景毛玻璃虚化',
        helpTooltip: '控制弹窗底层的半透明虚化程度。设为 0 可关闭虚化以提升低配设备流畅度。',
        type: 'slider',
        group: 'effects',
        def: FALLBACK_SAFE_THEME.blurRadius,
        sliderOptions: { min: 0, max: 40, step: 1, unit: 'px' }
    },
    {
        key: 'borderRadius',
        label: '全局圆角半径',
        helpTooltip: '控制界面卡片与容器的基础圆角大小。',
        type: 'slider',
        group: 'effects',
        def: FALLBACK_SAFE_THEME.borderRadius,
        sliderOptions: { min: 0, max: 24, step: 1, unit: 'px' }
    },

    // 3. 高级细节微调 (group: 'advanced', 可折叠卡片，默认收起)
    {
        key: 'bgSidebar',
        label: '侧边栏背景色',
        helpTooltip: '独立配置左侧导航栏的底色；留空时自动计算。',
        type: 'color',
        group: 'advanced',
        def: FALLBACK_SAFE_THEME.bgSidebar || '#13151c'
    },
    {
        key: 'bgSecondary',
        label: '控制栏背景色',
        helpTooltip: '独立配置顶部工具栏与底部状态栏的背景底色。',
        type: 'color',
        group: 'advanced',
        def: FALLBACK_SAFE_THEME.bgSecondary
    },
    {
        key: 'bgInput',
        label: '输入框背景色',
        helpTooltip: '独立配置文本框、数字框与下拉选择器的底色。',
        type: 'color',
        group: 'advanced',
        def: FALLBACK_SAFE_THEME.bgInput || '#12141a'
    },
    {
        key: 'accentCyan',
        label: '辅助强调色',
        helpTooltip: '用于次级重点徽标与特殊状态指示的辅助色。',
        type: 'color',
        group: 'advanced',
        def: FALLBACK_SAFE_THEME.accentCyan || '#06b6d4'
    },
    {
        key: 'borderHighlight',
        label: '高光边框颜色',
        helpTooltip: '输入控件聚焦或悬停时的高亮边框颜色。',
        type: 'color',
        group: 'advanced',
        def: FALLBACK_SAFE_THEME.borderHighlight || 'rgba(56, 189, 248, 0.45)'
    },
    {
        key: 'radiusModal',
        label: '弹窗圆角半径',
        helpTooltip: '主弹窗外壳的大圆角半径。',
        type: 'slider',
        group: 'advanced',
        def: FALLBACK_SAFE_THEME.radiusModal || 12,
        sliderOptions: { min: 0, max: 32, step: 1, unit: 'px' }
    },
    {
        key: 'radiusInput',
        label: '控件圆角半径',
        helpTooltip: '文本输入框、下拉框与操作按钮的圆角半径。',
        type: 'slider',
        group: 'advanced',
        def: FALLBACK_SAFE_THEME.radiusInput || 6,
        sliderOptions: { min: 0, max: 16, step: 1, unit: 'px' }
    }
];

/**
 * 归一化主题数据
 * 以默认主题为基准补齐必选字段，同时通过浅拷贝保留所有主题属性与扩展字段
 */
function normalizeThemePresetData(input: unknown): ThemeData {
    const d = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    return {
        ...FALLBACK_SAFE_THEME,
        ...d,
        accentColor: String(d.accentColor || FALLBACK_SAFE_THEME.accentColor),
        bgPrimary: String(d.bgPrimary || FALLBACK_SAFE_THEME.bgPrimary),
        bgSecondary: String(d.bgSecondary || FALLBACK_SAFE_THEME.bgSecondary),
        bgCard: String(d.bgCard || d.bgSecondary || FALLBACK_SAFE_THEME.bgCard),
        bgGradientEnd: String(d.bgGradientEnd || d.bgPrimary || FALLBACK_SAFE_THEME.bgGradientEnd),
        bgGradientAngle: Number(d.bgGradientAngle ?? FALLBACK_SAFE_THEME.bgGradientAngle),
        bgOpacity: Number(d.bgOpacity ?? FALLBACK_SAFE_THEME.bgOpacity),
        textPrimary: String(d.textPrimary || FALLBACK_SAFE_THEME.textPrimary),
        textSecondary: String(d.textSecondary || FALLBACK_SAFE_THEME.textSecondary),
        borderColor: String(d.borderColor || FALLBACK_SAFE_THEME.borderColor),
        borderRadius: Number(d.borderRadius ?? FALLBACK_SAFE_THEME.borderRadius),
        blurRadius: Number(d.blurRadius ?? FALLBACK_SAFE_THEME.blurRadius)
    };
}

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

    /** 异步读取预设主题列表并激活当前项 */
    private async _loadPresets(): Promise<void> {
        try {
            const list = await PresetStore.list<ThemeData>('themes');
            if (Array.isArray(list) && list.length > 0) {
                this._presets = list.map((p) => ({
                    id: p.id,
                    name: p.name || p.id,
                    data: normalizeThemePresetData(p.data || p)
                }));
            } else {
                this._presets = (BUILTIN_PRESET_THEMES as unknown as PresetItem<ThemeData>[]) || [];
            }

            ThemeService.registerThemes(this._presets);
            const currentId = this._getActiveThemeId();
            this._toolbarEl?.refreshPresets?.(this._presets, currentId);

            const activeProfile = this._presets.find((p) => p.id === currentId);
            const targetData = activeProfile?.data || this._getActiveThemeData();
            this._activateThemeData(targetData);
        } catch {
            // 离线或服务未就绪时保持当前内存配置
        }
    }

    /** 统一激活应用指定主题数据并同步表单与状态检测 */
    private _activateThemeData(data: ThemeData, themeId?: string): void {
        if (themeId) {
            this._store.set('themePreset', themeId);
        }
        this._currentThemeData = { ...data };
        ThemeService.applyThemeVariables(this._currentThemeData);
        this._syncControls();
        this._checkFieldDirty();
    }

    private _buildCards(): void {
        this._buildPresetToolbarCard();
        this._buildColorCard();
        this._buildEffectsCard();
        this._buildAdvancedCard();
    }

    /** 1. 主题预设方案工具栏卡片 */
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
                this._activateThemeData(data);
                FeedbackService.toastSuccess(`主题方案 [${name}] 已保存`);
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

                const nextPreset = this._presets[0];
                const nextId = nextPreset?.id || 'dark';
                this._store.set('themePreset', nextId);
                return nextId;
            },
            exportProfile: (id: string) => {
                const preset = this._presets.find((p) => p.id === id);
                const exportData = preset?.data || this._currentThemeData;
                const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                    type: 'application/json'
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${preset?.name || id}_主题预设.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                FeedbackService.toastSuccess(`已导出主题预设文件: ${a.download}`);
            },
            importProfile: async (content: string, fileName: string) => {
                const parsed = JSON.parse(content);
                const name = parsed.name || fileName.replace(/\.json$/i, '');
                const id = `imported_${Date.now()}`;
                const d = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
                const data: ThemeData = normalizeThemePresetData(d);

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
                const profile = this._presets.find((p) => p.id === presetId);
                const data = profile?.data || this._getActiveThemeData();
                this._activateThemeData(data, presetId);
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
                const data = profile?.data || this._getActiveThemeData();
                this._activateThemeData(data);
            },
            applyData: (id: string) => {
                const profile = this._presets.find((p) => p.id === id);
                const data = profile?.data || this._getActiveThemeData();
                this._activateThemeData(data, id);
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

    /** 2. 核心界面配色卡片 */
    private _buildColorCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '界面配色方案',
            description: '配置主调强调色、背景底色与文本对比度'
        });
        card.header.appendChild(header);

        this._renderFieldsByGroup('colors', card.body);
        this._root.appendChild(card.root);
    }

    /** 3. 质感与圆角调节卡片 */
    private _buildEffectsCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '质感与圆角调节',
            description: '配置环境渐变色与倾斜角度、不透明度、毛玻璃虚化与基础圆角'
        });
        card.header.appendChild(header);

        this._renderFieldsByGroup('effects', card.body);
        this._root.appendChild(card.root);
    }

    /** 4. 高级细节微调卡片 (可折叠卡片，默认收起) */
    private _buildAdvancedCard(): void {
        const card = createCard({
            hoverable: true,
            collapsible: true,
            defaultCollapsed: true
        });
        const header = createCardHeader({
            title: '高级细节微调',
            description: '点击展开调整侧边栏与输入框底色、辅助强调色、高光边框及各级圆角'
        });
        card.header.appendChild(header);

        this._renderFieldsByGroup('advanced', card.body);
        this._root.appendChild(card.root);
    }

    /** 通用分组字段装配纯函数 */
    private _renderFieldsByGroup(group: ThemeFieldConfig['group'], container: HTMLElement): void {
        const fields = THEME_FIELD_CONFIGS.filter((f) => f.group === group);

        for (const field of fields) {
            const row = createRow(['fill', 'auto'], { align: 'center' });
            const label = createFieldLabel({
                title: field.label,
                helpTooltip: field.helpTooltip
            });
            row.slots[0].appendChild(label);

            if (field.type === 'color') {
                const curVal = String(this._currentThemeData[field.key] || field.def);
                const picker = createColorPicker({
                    value: curVal,
                    onChange: (val) => this._onFieldValueChange(field.key, val)
                });
                this._disposables.add(picker);
                this._colorControls.set(field.key, picker);
                row.slots[1].appendChild(picker);
            } else if (field.type === 'slider') {
                const rawVal = Number(this._currentThemeData[field.key] ?? field.def);
                const opts = field.sliderOptions || { min: 0, max: 100 };
                const initialSliderVal = opts.scale100
                    ? Math.round(rawVal > 1 ? rawVal : rawVal * 100)
                    : rawVal;

                const slider = createSlider({
                    value: initialSliderVal,
                    min: opts.min,
                    max: opts.max,
                    step: opts.step ?? 1,
                    unit: opts.unit ?? '',
                    onChange: (val) => {
                        const finalVal = opts.scale100 ? val / 100 : val;
                        this._onFieldValueChange(field.key, finalVal);
                    }
                });
                this._disposables.add(slider);
                this._sliderControls.set(field.key, slider);
                row.slots[1].appendChild(slider);
            }

            container.appendChild(row.root);
        }
    }

    /** 字段变更处理：更新内存配置、应用 CSS 变量并检测未保存修改状态 */
    private _onFieldValueChange(key: keyof ThemeData, val: unknown): void {
        (this._currentThemeData as Record<string, unknown>)[key] = val;
        ThemeService.applyThemeVariables(this._currentThemeData);
        this._checkFieldDirty();
    }

    /** 批量同步所有输入控件的值，消除遍历硬编码 */
    private _syncControls(): void {
        for (const field of THEME_FIELD_CONFIGS) {
            if (field.type === 'color') {
                const handle = this._colorControls.get(field.key);
                if (handle) {
                    const val = String(this._currentThemeData[field.key] || field.def);
                    handle.setValue(val);
                }
            } else if (field.type === 'slider') {
                const handle = this._sliderControls.get(field.key);
                if (handle) {
                    const raw = Number(this._currentThemeData[field.key] ?? field.def);
                    const val = field.sliderOptions?.scale100
                        ? Math.round(raw > 1 ? raw : raw * 100)
                        : raw;
                    handle.setValue(val);
                }
            }
        }
    }

    /**
     * 未保存状态检测
     * 基于 Schema 表遍历比对当前输入值与基准快照，一致时自动清除工具栏保存按钮的高亮标记
     */
    private _checkFieldDirty(): void {
        const currentId = this._getActiveThemeId();
        const preset = this._presets.find((p) => p.id === currentId);
        const baseline = preset?.data || FALLBACK_SAFE_THEME;

        let isAnyFieldDirty = false;

        for (const field of THEME_FIELD_CONFIGS) {
            if (field.type === 'color') {
                const handle = this._colorControls.get(field.key);
                if (handle) {
                    const cur = String(this._currentThemeData[field.key] || field.def).toLowerCase().trim();
                    const base = String(baseline[field.key] || field.def).toLowerCase().trim();
                    const isDirty = cur !== base;
                    if (isDirty) isAnyFieldDirty = true;
                    handle.classList.toggle('is-dirty', isDirty);
                    handle.hexInputElement?.classList.toggle('is-dirty', isDirty);
                }
            } else if (field.type === 'slider') {
                const handle = this._sliderControls.get(field.key);
                if (handle) {
                    const cur = Number(this._currentThemeData[field.key] ?? field.def);
                    const base = Number(baseline[field.key] ?? field.def);
                    const isDirty = Math.abs(cur - base) > 0.001;
                    if (isDirty) isAnyFieldDirty = true;
                    handle.classList.toggle('is-dirty', isDirty);
                }
            }
        }

        this._toolbarEl?.setDirty?.(isAnyFieldDirty);
    }
}
