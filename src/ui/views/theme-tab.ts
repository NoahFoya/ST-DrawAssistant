/**
 * @module ui/views/theme-tab
 * @description 外观主题定制面板视图 (ThemeTab) - 规范化 controls 架构版
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, ThemeData, PresetProfileItem } from '../../core/state/store-types';
import {
    createSectionCard,
    createFieldRow,
    createNumberRow
} from '../controls';
import {
    bindPresetToolbar,
    PresetToolbarAdapter,
    PresetToolbarElement
} from '../presets';
import { ThemeService, FALLBACK_SAFE_THEME } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { fetchThemes } from '../../core/config/config-loader';
import { IDisposable } from '../../core/foundation/disposable';

/** 主题控件索引对象类型定义 */
interface ThemeControls {
    accentColor?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgPrimary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgGradientEnd?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgSecondary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    textPrimary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    textSecondary?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    borderColor?: { colorInput: HTMLInputElement; hexInput: HTMLInputElement };
    bgGradientAngle?: { rangeInput: HTMLInputElement; valLabel: HTMLSpanElement };
    bgOpacity?: { rangeInput: HTMLInputElement; valLabel: HTMLSpanElement };
    blurRadius?: { inputEl: HTMLInputElement };
    borderRadius?: { inputEl: HTMLInputElement };
}

/**
 * 构建并渲染外观主题定制面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的主题定制面板 DOM 根节点
 */
export function createThemeTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-theme-tab';

    const getProfiles = (): PresetProfileItem<ThemeData>[] => {
        return store.get('customThemes') || [];
    };

    const getActiveThemeId = (): string => {
        return store.get('themePreset') || '';
    };

    const getActiveThemeData = (): ThemeData => {
        const id = getActiveThemeId();
        const profiles = getProfiles();
        const found = profiles.find((p) => p.id === id);
        return found?.data || profiles[0]?.data || FALLBACK_SAFE_THEME;
    };

    // 内存草稿状态
    let currentThemeData: ThemeData = { ...getActiveThemeData() };
    let toolbarEl: PresetToolbarElement;

    // ── 集中管理所有拾色器、滑块与数值输入控件引用 ──
    const controls: ThemeControls = {};

    const applyDraftTheme = (theme: ThemeData) => {
        ThemeService.applyThemeVariables(theme);
    };

    /**
     * 将当前草稿数据同步回所有 UI 控件
     */
    const syncControls = () => {
        // 1. 同步颜色拾取与十六进制输入框
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
            const ctrl = controls[key] as { colorInput: HTMLInputElement; hexInput: HTMLInputElement } | undefined;
            if (!ctrl) return;
            let val = (currentThemeData[key] as string) || '';
            if (!val) {
                if (key === 'accentColor') val = '#00f2fe';
                else if (key === 'bgPrimary' || key === 'bgGradientEnd') val = '#0f1014';
                else if (key === 'bgSecondary') val = '#1a1d24';
                else if (key === 'textPrimary') val = '#f2f2f7';
                else if (key === 'textSecondary') val = '#8e8e93';
                else if (key === 'borderColor') val = '#282b33';
            }
            ctrl.colorInput.value = val.startsWith('#') && val.length === 7 ? val : '#282b33';
            ctrl.hexInput.value = val;
        });

        // 2. 同步背景渐变角度滑块
        if (controls.bgGradientAngle) {
            const angle = currentThemeData.bgGradientAngle ?? 135;
            controls.bgGradientAngle.rangeInput.value = String(angle);
            controls.bgGradientAngle.valLabel.textContent = `${angle}°`;
        }

        // 3. 同步背景透明度滑块
        if (controls.bgOpacity) {
            const opacity = currentThemeData.bgOpacity ?? 0.95;
            controls.bgOpacity.rangeInput.value = String(opacity);
            controls.bgOpacity.valLabel.textContent = `${Math.round(opacity * 100)}%`;
        }

        // 4. 同步毛玻璃与圆角数值输入框
        if (controls.blurRadius?.inputEl) {
            controls.blurRadius.inputEl.value = String(currentThemeData.blurRadius ?? 20);
        }
        if (controls.borderRadius?.inputEl) {
            controls.borderRadius.inputEl.value = String(currentThemeData.borderRadius ?? 14);
        }
    };

    // ── 1. 主题方案管理卡片 ──────────────────────────────────────────────────
    const cardScheme = createSectionCard({
        title: '主题方案管理',
        description: '快速切换或保存不同的外观主题风格，支持导入、导出与恢复出厂默认方案',
        renderBody: (body) => {
            const adapter: PresetToolbarAdapter<ThemeData> = {
                label: '外观主题',
                getProfiles,
                getInitialId: getActiveThemeId,
                createProfile: (name, data) => {
                    const list = [...getProfiles()];
                    const newId = `theme_${Date.now()}`;
                    list.push({ id: newId, name, data });
                    store.set('customThemes', list);
                    store.set('themePreset', newId);
                    return newId;
                },
                saveProfile: (id, data) => {
                    const list = getProfiles().map((p) => (p.id === id ? { ...p, data } : p));
                    store.set('customThemes', list);
                    store.set('themePreset', id);
                    FeedbackService.toastSuccess('主题方案保存成功！');
                },
                renameProfile: (id, newName) => {
                    const list = getProfiles().map((p) => (p.id === id ? { ...p, name: newName } : p));
                    store.set('customThemes', list);
                },
                deleteProfile: (id) => {
                    const list = getProfiles().filter((p) => p.id !== id);
                    store.set('customThemes', list);
                    const nextId = list.length > 0 ? list[0].id : '';
                    store.set('themePreset', nextId);
                    return nextId;
                },
                resetToDefault: async () => {
                    try {
                        const defaultList = await fetchThemes();
                        if (defaultList.length > 0) {
                            store.set('customThemes', defaultList);
                            store.set('themePreset', defaultList[0].id);
                            currentThemeData = { ...defaultList[0].data };
                            applyDraftTheme(currentThemeData);
                            syncControls();
                            FeedbackService.toastSuccess('已成功恢复出厂默认主题预设！');
                        }
                    } catch (err: any) {
                        FeedbackService.toastError(`恢复默认预设失败: ${err?.message || err}`);
                    }
                },
                onSelect: (id) => {
                    store.set('themePreset', id);
                }
            };

            toolbarEl = bindPresetToolbar({
                adapter,
                getCurrentData: () => currentThemeData,
                applyData: (id) => {
                    const target = getProfiles().find((p) => p.id === id);
                    if (target?.data) {
                        currentThemeData = { ...target.data };
                        applyDraftTheme(currentThemeData);
                        syncControls();
                    }
                },
                onRefresh: () => {
                    applyDraftTheme(currentThemeData);
                }
            });

            body.appendChild(toolbarEl);
        }
    });
    container.appendChild(cardScheme);

    // ── 2. 主题配色与视觉效果卡片 ─────────────────────────────────────────────
    const cardPalette = createSectionCard({
        title: '主题配色与视觉效果',
        description: '实时调节界面核心强调色、渐变背景、文字排版、毛玻璃与几何圆角。修改后可点击上方保存',
        renderBody: (body) => {
            /** 辅助创建颜色拾取与 HEX 双向同步表单行 */
            const createColorRow = (
                label: string,
                initialVal: string,
                helpTooltip: string,
                onUpdate: (hex: string) => void
            ): [HTMLElement, HTMLInputElement, HTMLInputElement] => {
                const wrapper = document.createElement('div');
                wrapper.className = 'da-color-picker-wrapper da-control-fixed-180';

                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.className = 'da-input-color';
                colorInput.value = initialVal.startsWith('#') && initialVal.length === 7 ? initialVal : '#00f2fe';

                const hexInput = document.createElement('input');
                hexInput.type = 'text';
                hexInput.className = 'da-input da-input-hex';
                hexInput.value = initialVal;

                colorInput.oninput = () => {
                    hexInput.value = colorInput.value;
                    onUpdate(colorInput.value);
                };

                hexInput.onchange = () => {
                    let val = hexInput.value.trim();
                    if (!val.startsWith('#')) val = '#' + val;
                    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                        colorInput.value = val;
                        onUpdate(val);
                    }
                };

                wrapper.appendChild(colorInput);
                wrapper.appendChild(hexInput);

                const row = createFieldRow({
                    label,
                    helpTooltip,
                    control: wrapper
                });

                return [row, colorInput, hexInput];
            };

            // 1. 主题强调色
            const [accentRow, aCol, aHex] = createColorRow(
                '主题强调色 (Accent Color)',
                currentThemeData.accentColor || '#00f2fe',
                '控制插件的主要按钮、选中高亮与焦点光晕等核心色彩。',
                (val) => {
                    currentThemeData.accentColor = val;
                    applyDraftTheme(currentThemeData);
                }
            );
            controls.accentColor = { colorInput: aCol, hexInput: aHex };
            body.appendChild(accentRow);

            // 2. 主界面背景色 (起始色)
            const [bgPrimRow, bgCol, bgHex] = createColorRow(
                '主界面背景色 - 起始色 (Primary Background)',
                currentThemeData.bgPrimary || '#0f1014',
                '控制主窗口与浮层的底层渐变起始颜色。',
                (val) => {
                    currentThemeData.bgPrimary = val;
                    applyDraftTheme(currentThemeData);
                }
            );
            controls.bgPrimary = { colorInput: bgCol, hexInput: bgHex };
            body.appendChild(bgPrimRow);

            // 3. 主界面背景色 (终止色)
            const [bgGradRow, bgGCol, bgGHex] = createColorRow(
                '主界面背景色 - 终止色 (Gradient End)',
                currentThemeData.bgGradientEnd || currentThemeData.bgPrimary || '#0f1014',
                '控制背景渐变终止颜色。若与起始色一致则呈现纯色，不同时展现平滑渐变。',
                (val) => {
                    currentThemeData.bgGradientEnd = val;
                    applyDraftTheme(currentThemeData);
                }
            );
            controls.bgGradientEnd = { colorInput: bgGCol, hexInput: bgGHex };
            body.appendChild(bgGradRow);

            // 4. 渐变流向角度
            const angleWrapper = document.createElement('div');
            angleWrapper.className = 'da-slider-wrapper da-control-fixed-180';

            const angleRangeInput = document.createElement('input');
            angleRangeInput.type = 'range';
            angleRangeInput.min = '0';
            angleRangeInput.max = '360';
            angleRangeInput.step = '5';
            angleRangeInput.className = 'da-range-slider';
            angleRangeInput.value = String(currentThemeData.bgGradientAngle ?? 135);

            const angleValLabel = document.createElement('span');
            angleValLabel.className = 'da-slider-value-label';
            angleValLabel.textContent = `${currentThemeData.bgGradientAngle ?? 135}°`;

            angleRangeInput.oninput = () => {
                const angle = parseInt(angleRangeInput.value || '135', 10);
                angleValLabel.textContent = `${angle}°`;
                currentThemeData.bgGradientAngle = angle;
                applyDraftTheme(currentThemeData);
            };

            angleWrapper.appendChild(angleRangeInput);
            angleWrapper.appendChild(angleValLabel);
            controls.bgGradientAngle = { rangeInput: angleRangeInput, valLabel: angleValLabel };

            body.appendChild(
                createFieldRow({
                    label: '背景渐变流向角度 (Gradient Angle)',
                    helpTooltip: '控制背景渐变色彩的流向角度 (0° ~ 360°)。',
                    control: angleWrapper
                })
            );

            // 5. 卡片与侧边栏背景色
            const [bgSecRow, bgSCol, bgSHex] = createColorRow(
                '卡片与侧边栏背景 (Secondary Background)',
                currentThemeData.bgSecondary || '#1a1d24',
                '控制内容卡片、侧边栏及弹窗的背景颜色。',
                (val) => {
                    currentThemeData.bgSecondary = val;
                    applyDraftTheme(currentThemeData);
                }
            );
            controls.bgSecondary = { colorInput: bgSCol, hexInput: bgSHex };
            body.appendChild(bgSecRow);

            // 6. 主要文字颜色
            const [textPRow, tpCol, tpHex] = createColorRow(
                '主要文字颜色 (Text Primary)',
                currentThemeData.textPrimary || '#f2f2f7',
                '控制主标题、选项名称及高亮正文的文字颜色。',
                (val) => {
                    currentThemeData.textPrimary = val;
                    applyDraftTheme(currentThemeData);
                }
            );
            controls.textPrimary = { colorInput: tpCol, hexInput: tpHex };
            body.appendChild(textPRow);

            // 7. 次要文字颜色
            const [textSRow, tsCol, tsHex] = createColorRow(
                '次要说明文字颜色 (Text Secondary)',
                currentThemeData.textSecondary || '#8e8e93',
                '控制表单提示说明、副标题及辅助描述的文字颜色。',
                (val) => {
                    currentThemeData.textSecondary = val;
                    applyDraftTheme(currentThemeData);
                }
            );
            controls.textSecondary = { colorInput: tsCol, hexInput: tsHex };
            body.appendChild(textSRow);

            // 8. 轮廓边框与分割线颜色
            const [borderRow, bCol, bHex] = createColorRow(
                '轮廓边框与分割线颜色 (Border Color)',
                currentThemeData.borderColor || '#282b33',
                '控制卡片外框、输入框边缘及分割线的线条色彩。',
                (val) => {
                    currentThemeData.borderColor = val;
                    applyDraftTheme(currentThemeData);
                }
            );
            controls.borderColor = { colorInput: bCol, hexInput: bHex };
            body.appendChild(borderRow);

            // 9. 界面背景透明度
            const opacityWrapper = document.createElement('div');
            opacityWrapper.className = 'da-slider-wrapper da-control-fixed-180';

            const opacityRangeInput = document.createElement('input');
            opacityRangeInput.type = 'range';
            opacityRangeInput.min = '0.20';
            opacityRangeInput.max = '1.00';
            opacityRangeInput.step = '0.01';
            opacityRangeInput.className = 'da-range-slider';
            opacityRangeInput.value = String(currentThemeData.bgOpacity ?? 0.95);

            const opacityValLabel = document.createElement('span');
            opacityValLabel.className = 'da-slider-value-label';
            opacityValLabel.textContent = `${Math.round((currentThemeData.bgOpacity ?? 0.95) * 100)}%`;

            opacityRangeInput.oninput = () => {
                const opacity = parseFloat(opacityRangeInput.value || '0.95');
                opacityValLabel.textContent = `${Math.round(opacity * 100)}%`;
                currentThemeData.bgOpacity = opacity;
                applyDraftTheme(currentThemeData);
            };

            opacityWrapper.appendChild(opacityRangeInput);
            opacityWrapper.appendChild(opacityValLabel);
            controls.bgOpacity = { rangeInput: opacityRangeInput, valLabel: opacityValLabel };

            body.appendChild(
                createFieldRow({
                    label: '界面背景透明度 (Background Opacity)',
                    helpTooltip: '调节面板与卡片背景的透明程度 (20% ~ 100%)。',
                    control: opacityWrapper
                })
            );

            // 10. 背景毛玻璃模糊度
            const blurRow = createNumberRow({
                label: '背景毛玻璃模糊度 (Blur Radius, px)',
                helpTooltip: '调节面板背后的毛玻璃模糊效果强度 (0 ~ 40px)。',
                value: currentThemeData.blurRadius ?? 20,
                min: 0,
                max: 40,
                step: 1,
                unit: 'px',
                onChange: (num) => {
                    currentThemeData.blurRadius = num;
                    applyDraftTheme(currentThemeData);
                }
            });
            controls.blurRadius = { inputEl: blurRow.querySelector('input') as HTMLInputElement };
            body.appendChild(blurRow);

            // 11. 界面与卡片圆角
            const radiusRow = createNumberRow({
                label: '界面与卡片圆角 (Border Radius, px)',
                helpTooltip: '调节卡片、按钮和输入框边缘的圆角弧度 (0 ~ 24px)。',
                value: currentThemeData.borderRadius ?? 14,
                min: 0,
                max: 24,
                step: 1,
                unit: 'px',
                onChange: (num) => {
                    currentThemeData.borderRadius = num;
                    applyDraftTheme(currentThemeData);
                }
            });
            controls.borderRadius = { inputEl: radiusRow.querySelector('input') as HTMLInputElement };
            body.appendChild(radiusRow);
        }
    });
    container.appendChild(cardPalette);

    // ── 响应式数据同步监听 ──
    const unsubStore = store.subscribe(() => {
        const themeId = getActiveThemeId();
        if (toolbarEl?.refreshPresets) {
            toolbarEl.refreshPresets(getProfiles(), themeId);
        }
    });

    container.dispose = () => {
        unsubStore.dispose();
    };

    return container;
}
