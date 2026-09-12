/**
 * @module src/ui/views/theme-tab
 * @description 外观与主题设置面板 (ThemeTab)
 *
 * 遵循规范 (UI_LAYOUT_PREVIEW.md 第六节第 6 条)：
 * 1. Card: 主题预设方案 (挂载 PresetToolbar 8键图标管理方案)；
 * 2. Card: 界面配色方案 (主题强调色, 主背景色, 渐变结束色, 卡片背景色, 主/次文本色, 边框色，ColorPicker 色盘双向强校验)；
 * 3. Card: 视觉质感与圆角 (背景渐变角度, 不透明度, 毛玻璃虚化, 全局圆角半径)；
 * 4. 脏状态变更追踪：结合 createDirtyTracker 实时联动预设保存按钮状态。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard } from '../components/form-field';
import { createColorPicker } from '../components/color-picker';
import { createNumberInput } from '../components/input';
import { createPresetToolbar } from '../composite/preset-toolbar';
import { createDirtyTracker } from '../components/dirty-tracker';
import { getIconSvg } from '../components/icons';
import { ThemeService, ThemeConfig, BUILTIN_THEMES } from '../theme';
import type { SettingsStore } from '../../store/settings';

export interface ThemeTabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

export function renderThemeTab(settingsStore: SettingsStore): ThemeTabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];
    const themeService = ThemeService.getInstance();

    const regDisposer = (item: { dispose(): void }) => {
        disposers.push(() => item.dispose());
    };

    // 当前主题配置初始内存基准
    const initialTheme: ThemeConfig = { ...themeService.getCurrentTheme() };

    // 实例化表单脏状态追踪器
    const dirtyTracker = createDirtyTracker(initialTheme, (isDirty) => {
        toolbar.setDirty(isDirty);
    });
    regDisposer(dirtyTracker);

    // 1. 主题预设方案管理工具栏 (PresetToolbar)
    const presetCard = createCard({
        title: '主题预设方案',
        iconSvg: getIconSvg('palette'),
        collapsible: false
    });
    regDisposer(presetCard);

    // 构造预设列表选项
    const themePresets = Object.keys(BUILTIN_THEMES).map((key) => ({
        id: key,
        name: BUILTIN_THEMES[key].name || key,
        isBuiltin: true
    }));

    let currentThemeConfig = { ...initialTheme };

    const toolbar = createPresetToolbar({
        presets: themePresets,
        activePresetId: settingsStore.get('themePreset') || 'cyberpunk',
        onAction: (action, presetId) => {
            if (action === 'select') {
                const found = BUILTIN_THEMES[presetId];
                if (found) {
                    currentThemeConfig = { ...found };
                    themeService.applyTheme(currentThemeConfig);
                    settingsStore.set('themePreset', presetId);
                    dirtyTracker.setBaseline(currentThemeConfig);
                    syncControlValues(currentThemeConfig);
                }
            } else if (action === 'save') {
                dirtyTracker.setBaseline(currentThemeConfig);
                settingsStore.set('themePreset', presetId);
            } else if (action === 'reset') {
                currentThemeConfig = { ...dirtyTracker.getBaseline() };
                themeService.applyTheme(currentThemeConfig);
                dirtyTracker.setBaseline(currentThemeConfig);
                syncControlValues(currentThemeConfig);
            }
        }
    });
    regDisposer(toolbar);

    presetCard.append(toolbar.element);
    root.appendChild(presetCard.element);

    // 2. 界面配色方案卡片 (ColorPicker)
    const colorCard = createCard({
        title: '界面配色方案',
        iconSvg: getIconSvg('sparkles'),
        collapsible: true
    });
    regDisposer(colorCard);

    // 主题强调色
    const accentPicker = createColorPicker({
        value: currentThemeConfig.accentColor,
        onChange: (val) => {
            currentThemeConfig.accentColor = val;
            themeService.applyTheme({ accentColor: val });
            dirtyTracker.notifyFieldChange('accentColor', val);
        }
    });
    const accentField = createFormField({
        label: '主题强调色',
        helpText: '界面主品牌色，应用于按钮高亮、聚焦光环与激活指示条',
        control: accentPicker
    });
    colorCard.append(accentField);

    // 主背景色
    const bgPrimaryPicker = createColorPicker({
        value: currentThemeConfig.bgPrimary,
        onChange: (val) => {
            currentThemeConfig.bgPrimary = val;
            themeService.applyTheme({ bgPrimary: val });
            dirtyTracker.notifyFieldChange('bgPrimary', val);
        }
    });
    const bgPrimaryField = createFormField({
        label: '主背景色',
        helpText: '设置弹窗与主要内容展示区的底色基调',
        control: bgPrimaryPicker
    });
    colorCard.append(bgPrimaryField);

    // 渐变结束色
    const bgSecondaryPicker = createColorPicker({
        value: currentThemeConfig.bgSecondary,
        onChange: (val) => {
            currentThemeConfig.bgSecondary = val;
            themeService.applyTheme({ bgSecondary: val });
            dirtyTracker.notifyFieldChange('bgSecondary', val);
        }
    });
    const bgSecondaryField = createFormField({
        label: '渐变结束色',
        helpText: '顶部标题栏与侧边栏的融合过渡色',
        control: bgSecondaryPicker
    });
    colorCard.append(bgSecondaryField);

    // 卡片背景色
    const bgCardPicker = createColorPicker({
        value: currentThemeConfig.bgCard,
        onChange: (val) => {
            currentThemeConfig.bgCard = val;
            themeService.applyTheme({ bgCard: val });
            dirtyTracker.notifyFieldChange('bgCard', val);
        }
    });
    const bgCardField = createFormField({
        label: '卡片背景色',
        helpText: '各功能配置卡片容器的表面填充色',
        control: bgCardPicker
    });
    colorCard.append(bgCardField);

    // 主文本颜色
    const textPrimaryPicker = createColorPicker({
        value: currentThemeConfig.textPrimary,
        onChange: (val) => {
            currentThemeConfig.textPrimary = val;
            themeService.applyTheme({ textPrimary: val });
            dirtyTracker.notifyFieldChange('textPrimary', val);
        }
    });
    const textPrimaryField = createFormField({
        label: '主文本颜色',
        helpText: '标题与高权重文字的主要前景色',
        control: textPrimaryPicker
    });
    colorCard.append(textPrimaryField);

    // 次要文本颜色
    const textSecondaryPicker = createColorPicker({
        value: currentThemeConfig.textSecondary,
        onChange: (val) => {
            currentThemeConfig.textSecondary = val;
            themeService.applyTheme({ textSecondary: val });
            dirtyTracker.notifyFieldChange('textSecondary', val);
        }
    });
    const textSecondaryField = createFormField({
        label: '次要文本颜色',
        helpText: '说明提示与次要文字的柔和前景色',
        control: textSecondaryPicker
    });
    colorCard.append(textSecondaryField);

    // 边框线条颜色
    const borderPicker = createColorPicker({
        value: currentThemeConfig.borderColor,
        onChange: (val) => {
            currentThemeConfig.borderColor = val;
            themeService.applyTheme({ borderColor: val });
            dirtyTracker.notifyFieldChange('borderColor', val);
        }
    });
    const borderField = createFormField({
        label: '边框线条颜色',
        helpText: '分割线与卡片边框的高对比轮廓色',
        control: borderPicker
    });
    colorCard.append(borderField);

    root.appendChild(colorCard.element);

    // 3. 视觉质感与圆角规格卡片
    const visualCard = createCard({
        title: '视觉质感与圆角',
        iconSvg: getIconSvg('image'),
        collapsible: true
    });
    regDisposer(visualCard);

    // 背景渐变角度
    const angleInput = createNumberInput({
        value: currentThemeConfig.gradientAngle ?? 160,
        min: 0,
        max: 360,
        step: 5,
        unit: 'deg',
        onChange: (val) => {
            currentThemeConfig.gradientAngle = val;
            themeService.applyTheme({ gradientAngle: val });
            dirtyTracker.notifyFieldChange('gradientAngle', val);
        }
    });
    const angleField = createFormField({
        label: '背景渐变角度',
        helpText: '主视窗背景渐变流光的倾斜旋转角度',
        control: angleInput
    });
    visualCard.append(angleField);

    // 背景不透明度
    const opacityInput = createNumberInput({
        value: currentThemeConfig.opacity ?? 95,
        min: 50,
        max: 100,
        step: 1,
        unit: '%',
        onChange: (val) => {
            currentThemeConfig.opacity = val;
            themeService.applyTheme({ opacity: val });
            dirtyTracker.notifyFieldChange('opacity', val);
        }
    });
    const opacityField = createFormField({
        label: '背景不透明度',
        helpText: '弹窗主视窗的背景遮光不透明度',
        control: opacityInput
    });
    visualCard.append(opacityField);

    // 背景毛玻璃虚化
    const blurInput = createNumberInput({
        value: currentThemeConfig.blur ?? 16,
        min: 0,
        max: 48,
        step: 1,
        unit: 'px',
        onChange: (val) => {
            currentThemeConfig.blur = val;
            themeService.applyTheme({ blur: val });
            dirtyTracker.notifyFieldChange('blur', val);
        }
    });
    const blurField = createFormField({
        label: '背景毛玻璃虚化',
        helpText: 'backdrop-filter 高斯虚化像素半径，0 为完全关闭毛玻璃',
        control: blurInput
    });
    visualCard.append(blurField);

    // 全局圆角半径
    const radiusInput = createNumberInput({
        value: currentThemeConfig.borderRadius ?? 10,
        min: 0,
        max: 24,
        step: 1,
        unit: 'px',
        onChange: (val) => {
            currentThemeConfig.borderRadius = val;
            themeService.applyTheme({ borderRadius: val });
            dirtyTracker.notifyFieldChange('borderRadius', val);
        }
    });
    const radiusField = createFormField({
        label: '全局圆角半径',
        helpText: '弹窗外壳与卡片容器的平滑倒角曲率半径',
        control: radiusInput
    });
    visualCard.append(radiusField);

    root.appendChild(visualCard.element);

    /** 切换预设后同步控件视觉数值 */
    function syncControlValues(theme: ThemeConfig): void {
        accentPicker.setValue(theme.accentColor);
        bgPrimaryPicker.setValue(theme.bgPrimary);
        bgSecondaryPicker.setValue(theme.bgSecondary);
        bgCardPicker.setValue(theme.bgCard);
        textPrimaryPicker.setValue(theme.textPrimary);
        textSecondaryPicker.setValue(theme.textSecondary);
        borderPicker.setValue(theme.borderColor);

        angleInput.setValue(theme.gradientAngle ?? 160);
        opacityInput.setValue(theme.opacity ?? 95);
        blurInput.setValue(theme.blur ?? 16);
        radiusInput.setValue(theme.borderRadius ?? 10);
    }

    return {
        element: root,
        dispose(): void {
            for (const fn of disposers) {
                try {
                    fn();
                } catch {
                    // 异常隔离
                }
            }
            root.remove();
        }
    };
}
