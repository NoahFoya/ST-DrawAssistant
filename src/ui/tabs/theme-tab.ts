/**
 * @module ui/tabs/theme-tab
 * @description 样式主题 Tab 组件 (Theme Settings Tab)
 *
 * 职责：
 * - 主题方案管理：切换方案、新建、保存修改、重命名、JSON 导入/导出与方案删除
 * - 调色盘与全屏实时响应：核心 CSS 变量（HEX/透明度/圆角/模糊度）与衍生色双向同步注入
 * - 草稿状态管理：调色盘修改实时驱动 DOM 显示但暂存为草稿，提示未保存状态，需手动保存生效
 * - 全局未保存拦截：注册至 unsavedStateManager，实现切 Tab 与关面板三按键 Modal 守护
 * - 控件同步维护：切换主题方案时自动同步调色盘 UI 控件状态并刷新实时效果预览条
 * - 全景主题覆盖：联动主面板、蓝图编辑器与各类浮层 Modal 样式
 */

import { createFieldRow, bindPresetToolbar } from '../components/controls';
import { showTripleChoiceDialog } from '../components/modals';
import { loadSettings } from '../../settings/manager';
import { patchSettings } from '../../state/app-store';
import { DEFAULT_THEME_PROFILES } from '../../settings/defaults';
import type { ThemeData, PresetProfileItem } from '../../settings/types';
import { refreshHeaderThemeSelect } from '../settings-panel';
import { FeedbackService, unsavedStateManager } from '../feedback-service';
import { logger } from '../../core/logger';

/** 本地工作类型：ThemeData + id/name 元信息，用于 draft/saved scheme */
type ThemeViewData = ThemeData & { id?: string; name?: string };

/**
 * 渲染主题设置 Tab 内容节点
 */
export function renderThemeTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-theme-tab';

    const settings = loadSettings();
    
    // 1. 载入基线持久化方案 (Saved Scheme) 与 内存草稿方案 (Draft Scheme)
    let savedScheme: ThemeViewData = getActiveScheme(settings.themePreset);
    let draftScheme: ThemeViewData = JSON.parse(JSON.stringify(savedScheme));
    let currentThemeId: string = savedScheme.id ?? settings.themePreset ?? '';

    const checkUnsavedStatus = () => {
        unsavedStateManager.notifyStateChange();
    };

    const hasUnsavedThemeChanges = (): boolean => {
        return JSON.stringify(draftScheme) !== JSON.stringify(savedScheme);
    };

    const saveThemeChanges = (): void => {
        const currentSettings = loadSettings();
        const customThemes: PresetProfileItem<ThemeData>[] = [
            ...((currentSettings.customThemes as PresetProfileItem<ThemeData>[] | undefined) ?? DEFAULT_THEME_PROFILES)
        ];
        const existingIdx = customThemes.findIndex(c => c.id === currentThemeId);
        const { id: _id, name: _name, ...colorData } = draftScheme as any;
        const themeData: ThemeData = colorData;
        if (existingIdx >= 0) {
            customThemes[existingIdx] = { ...customThemes[existingIdx], data: themeData };
        } else {
            customThemes.push({ id: currentThemeId, name: draftScheme.name ?? currentThemeId, data: themeData });
        }
        patchSettings({ customThemes: customThemes as any, themePreset: currentThemeId });
        savedScheme = JSON.parse(JSON.stringify(draftScheme));
        applySchemeCSSVariables(themeData);
        checkUnsavedStatus();
        FeedbackService.notifySaved('theme');
    };

    const discardThemeChanges = (): void => {
        draftScheme = JSON.parse(JSON.stringify(savedScheme));
        syncColorPickersFromDraft();
        applySchemeCSSVariables(draftScheme as ThemeViewData);
        checkUnsavedStatus();
    };

    // 注册至全局未保存状态注册中心
    FeedbackService.registerUnsavedProvider({
        tabId: 'theme-tab',
        tabName: '外观主题',
        hasUnsavedChanges: hasUnsavedThemeChanges,
        saveChanges: saveThemeChanges,
        discardChanges: discardThemeChanges,
    });

    const refreshTab = () => {
        const parent = container.parentElement;
        if (parent) {
            parent.innerHTML = '';
            parent.appendChild(renderThemeTab());
        }
    };

    // ── 1. 外观方案管理卡片 ──────────────────────────────────────────────────
    const cardScheme = document.createElement('div');
    cardScheme.className = 'da-section-card';

    const headerScheme = document.createElement('div');
    headerScheme.className = 'da-section-header';
    headerScheme.innerHTML = `
        <span class="da-section-title">主题方案管理</span>
        <span class="da-section-desc">快速切换或保存不同的外观主题风格，支持导入与导出。</span>
    `;
    cardScheme.appendChild(headerScheme);

    // 转换方案格式以供 PresetToolbar 渲染
    const getProfiles = (): PresetProfileItem<ThemeData>[] => {
        const currentSettings = loadSettings();
        return (currentSettings.customThemes as PresetProfileItem<ThemeData>[] | undefined)
            ?? DEFAULT_THEME_PROFILES;
    };

    // ── 2. 配色与界面调色盘卡片 ─────────────────────────────────────────────
    const cardColors = document.createElement('div');
    cardColors.className = 'da-section-card';
    cardColors.style.marginTop = '15px';

    const headerColors = document.createElement('div');
    headerColors.className = 'da-section-header';
    headerColors.innerHTML = `
        <span class="da-section-title">主题配色与视觉效果</span>
        <span class="da-section-desc">自定义调整界面色彩、透明度、毛玻璃与圆角弧度。修改后请点击上方的【保存方案】。</span>
    `;
    cardColors.appendChild(headerColors);

    // 控件定义
    const inputAccentColor = document.createElement('input');
    inputAccentColor.type = 'color';
    inputAccentColor.className = 'da-input-color';

    const inputBgPrimary = document.createElement('input');
    inputBgPrimary.type = 'color';
    inputBgPrimary.className = 'da-input-color';

    const inputBgGradientEnd = document.createElement('input');
    inputBgGradientEnd.type = 'color';
    inputBgGradientEnd.className = 'da-input-color';

    const angleWrapper = document.createElement('div');
    angleWrapper.style.display = 'flex';
    angleWrapper.style.alignItems = 'center';
    angleWrapper.style.gap = '10px';
    angleWrapper.style.width = '180px';

    const inputBgGradientAngle = document.createElement('input');
    inputBgGradientAngle.type = 'range';
    inputBgGradientAngle.min = '0';
    inputBgGradientAngle.max = '360';
    inputBgGradientAngle.step = '5';
    inputBgGradientAngle.style.flex = '1';
    inputBgGradientAngle.style.cursor = 'pointer';

    const angleValLabel = document.createElement('span');
    angleValLabel.style.fontSize = '0.85em';
    angleValLabel.style.fontWeight = '600';
    angleValLabel.style.color = 'var(--da-accent-color)';
    angleValLabel.style.width = '42px';
    angleValLabel.style.textAlign = 'right';

    angleWrapper.appendChild(inputBgGradientAngle);
    angleWrapper.appendChild(angleValLabel);

    const updateAngleLabel = (val: number) => {
        angleValLabel.textContent = `${val}°`;
    };

    const inputBgSecondary = document.createElement('input');
    inputBgSecondary.type = 'color';
    inputBgSecondary.className = 'da-input-color';

    const inputTextPrimary = document.createElement('input');
    inputTextPrimary.type = 'color';
    inputTextPrimary.className = 'da-input-color';

    const inputTextSecondary = document.createElement('input');
    inputTextSecondary.type = 'color';
    inputTextSecondary.className = 'da-input-color';

    const inputBorderColor = document.createElement('input');
    inputBorderColor.type = 'color';
    inputBorderColor.className = 'da-input-color';

    const opacityWrapper = document.createElement('div');
    opacityWrapper.style.display = 'flex';
    opacityWrapper.style.alignItems = 'center';
    opacityWrapper.style.gap = '10px';
    opacityWrapper.style.width = '180px';

    const inputBgOpacity = document.createElement('input');
    inputBgOpacity.type = 'range';
    inputBgOpacity.min = '0.20';
    inputBgOpacity.max = '1.00';
    inputBgOpacity.step = '0.01';
    inputBgOpacity.style.flex = '1';
    inputBgOpacity.style.cursor = 'pointer';

    const opacityValLabel = document.createElement('span');
    opacityValLabel.style.fontSize = '0.85em';
    opacityValLabel.style.fontWeight = '600';
    opacityValLabel.style.color = 'var(--da-accent-color)';
    opacityValLabel.style.width = '42px';
    opacityValLabel.style.textAlign = 'right';

    opacityWrapper.appendChild(inputBgOpacity);
    opacityWrapper.appendChild(opacityValLabel);

    const updateOpacityLabel = (val: number) => {
        opacityValLabel.textContent = `${Math.round(val * 100)}%`;
    };

    const inputBlurRadius = document.createElement('input');
    inputBlurRadius.type = 'number';
    inputBlurRadius.min = '0';
    inputBlurRadius.max = '40';
    inputBlurRadius.step = '1';
    inputBlurRadius.className = 'da-input';
    inputBlurRadius.style.width = '90px';

    const inputBorderRadius = document.createElement('input');
    inputBorderRadius.type = 'number';
    inputBorderRadius.min = '0';
    inputBorderRadius.max = '24';
    inputBorderRadius.step = '1';
    inputBorderRadius.className = 'da-input';
    inputBorderRadius.style.width = '90px';

    /** 核心同步函数：将 draftScheme 中的属性更新回 UI 控件 */
    const syncColorPickersFromDraft = () => {
        inputAccentColor.value = draftScheme.accentColor ?? '#00f2fe';
        inputBgPrimary.value = draftScheme.bgPrimary ?? '#111317';
        inputBgGradientEnd.value = draftScheme.bgGradientEnd ?? (draftScheme.bgPrimary ?? '#111317');
        const currAngle = draftScheme.bgGradientAngle ?? 135;
        inputBgGradientAngle.value = String(currAngle);
        updateAngleLabel(currAngle);

        inputBgSecondary.value = draftScheme.bgSecondary ?? '#15171c';
        inputTextPrimary.value = draftScheme.textPrimary ?? '#f1f5f9';
        inputTextSecondary.value = draftScheme.textSecondary ?? '#94a3b8';
        inputBorderColor.value = draftScheme.borderColor ?? '#282b33';

        const currOpacity = draftScheme.bgOpacity ?? 0.95;
        inputBgOpacity.value = String(currOpacity);
        updateOpacityLabel(currOpacity);

        inputBlurRadius.value = String(draftScheme.blurRadius ?? 20);
        inputBorderRadius.value = String(draftScheme.borderRadius ?? 12);
    };

    syncColorPickersFromDraft();

    /** 属性改动事件：更新草稿态并实时应用 DOM CSS 变量 */
    const onSchemeFieldChange = (key: keyof ThemeData, val: unknown) => {
        (draftScheme as unknown as Record<string, unknown>)[key] = val;
        applySchemeCSSVariables(draftScheme);
        checkUnsavedStatus();
    };

    inputAccentColor.addEventListener('input', () => onSchemeFieldChange('accentColor', inputAccentColor.value));
    inputBgPrimary.addEventListener('input', () => onSchemeFieldChange('bgPrimary', inputBgPrimary.value));
    inputBgGradientEnd.addEventListener('input', () => onSchemeFieldChange('bgGradientEnd', inputBgGradientEnd.value));
    inputBgGradientAngle.addEventListener('input', () => {
        const val = parseInt(inputBgGradientAngle.value || '135', 10);
        updateAngleLabel(val);
        onSchemeFieldChange('bgGradientAngle', val);
    });
    inputBgSecondary.addEventListener('input', () => onSchemeFieldChange('bgSecondary', inputBgSecondary.value));
    inputTextPrimary.addEventListener('input', () => onSchemeFieldChange('textPrimary', inputTextPrimary.value));
    inputTextSecondary.addEventListener('input', () => onSchemeFieldChange('textSecondary', inputTextSecondary.value));
    inputBorderColor.addEventListener('input', () => onSchemeFieldChange('borderColor', inputBorderColor.value));
    
    inputBgOpacity.addEventListener('input', () => {
        const val = Math.max(0.20, Math.min(1.00, parseFloat(inputBgOpacity.value || '0.95')));
        updateOpacityLabel(val);
        onSchemeFieldChange('bgOpacity', val);
    });

    inputBlurRadius.addEventListener('input', () => onSchemeFieldChange('blurRadius', Math.max(0, parseInt(inputBlurRadius.value || '0', 10))));
    inputBorderRadius.addEventListener('input', () => onSchemeFieldChange('borderRadius', Math.max(0, parseInt(inputBorderRadius.value || '0', 10))));

    // 表单行部件挂载：按认知层次（核心色彩 -> 排版与线条 -> 材质与形状）从高频到细致排序，无分割线
    cardColors.appendChild(createFieldRow({
        label: '主题强调色',
        helpTooltip: '控制插件的主要按钮、选中高亮与焦点光晕等核心颜色。',
        control: inputAccentColor,
    }));
    cardColors.appendChild(createFieldRow({
        label: '主界面背景色 (起始色)',
        helpTooltip: '控制插件窗口的最底层渐变起始颜色。',
        control: inputBgPrimary,
    }));
    cardColors.appendChild(createFieldRow({
        label: '界面背景终止色',
        helpTooltip: '控制插件窗口的最底层渐变终止颜色。若与主背景色相同则呈现绝对纯色，设置不同颜色时展现平滑渐变。',
        control: inputBgGradientEnd,
    }));
    cardColors.appendChild(createFieldRow({
        label: '渐变色彩角度 (°)',
        helpTooltip: '控制背景渐变的倾斜流向角度 (0° ~ 360°)。',
        control: angleWrapper,
    }));
    cardColors.appendChild(createFieldRow({
        label: '卡片与侧边栏背景',
        helpTooltip: '控制内容卡片、侧边栏及弹窗的背景颜色。',
        control: inputBgSecondary,
    }));
    cardColors.appendChild(createFieldRow({
        label: '主要文字颜色',
        helpTooltip: '控制标题、主要正文及选项文字的颜色。',
        control: inputTextPrimary,
    }));
    cardColors.appendChild(createFieldRow({
        label: '次要文字颜色',
        helpTooltip: '控制提示说明、次要标签及补充文字的颜色。',
        control: inputTextSecondary,
    }));
    cardColors.appendChild(createFieldRow({
        label: '边框与分割线颜色',
        helpTooltip: '控制卡片轮廓边框及分割线的线条颜色。',
        control: inputBorderColor,
    }));
    cardColors.appendChild(createFieldRow({
        label: '界面背景透明度',
        helpTooltip: '调节面板与卡片背景的透明程度 (20% - 100%)。',
        control: opacityWrapper,
    }));
    cardColors.appendChild(createFieldRow({
        label: '背景毛玻璃模糊度 (px)',
        helpTooltip: '调节面板背后的毛玻璃模糊效果强度 (0 - 40px)。',
        control: inputBlurRadius,
    }));
    cardColors.appendChild(createFieldRow({
        label: '界面圆角大小 (px)',
        helpTooltip: '调节卡片、按钮和输入框边缘的圆角弧度 (0 - 24px)。',
        control: inputBorderRadius,
    }));

    // 绑定主题预设管理工具栏 (支持 CRUD 及未保存拦截)
    const toolbarTheme = bindPresetToolbar({
        category: 'theme',
        getCurrentData: () => ({ ...draftScheme }),
        applyData: (id: string) => {
            const profiles = getProfiles();
            const item = profiles.find(p => p.id === id) ?? profiles[0];
            if (!item) return;
            const themeData: ThemeData = item.data as ThemeData;
            const fullScheme = { ...themeData, id: item.id, name: item.name };
            patchSettings({ themePreset: id });
            savedScheme = fullScheme as any;
            draftScheme = JSON.parse(JSON.stringify(fullScheme));
            currentThemeId = id;
            syncColorPickersFromDraft();
            applySchemeCSSVariables(themeData);
            checkUnsavedStatus();
        },
        onBeforeSelect: async (_id: string) => {
            if (!hasUnsavedThemeChanges()) return true;
            const choice = await showTripleChoiceDialog({
                title: '⚠️ 主题方案未保存提示',
                message: `当前主题方案存在未保存的修改，切换前请选择：`,
                saveText: '保存并切换',
                discardText: '放弃修改',
                cancelText: '取消',
            });
            if (choice === 'cancel') return false;
            if (choice === 'save') saveThemeChanges();
            else discardThemeChanges();
            return true;
        },
        onSaveOverride: () => {
            saveThemeChanges();
        },
        onRefresh: () => refreshTab(),
    });

    cardScheme.appendChild(toolbarTheme);
    container.appendChild(cardScheme);
    container.appendChild(cardColors);

    return container;
}

// ============================================================================
// 内部颜色派生与计算工具函数 (Color Derivation Helpers)
// ============================================================================

/** 辅助函数：HEX 转 [R, G, B] 数组 */
function hexToRgbArr(hex: string): [number, number, number] {
    let clean = (hex || '').replace('#', '').trim();
    if (clean.length === 3) {
        clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16);
    if (isNaN(num)) return [0, 242, 254];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** 辅助函数：HEX 转 RGB 字符串 (如 "#00f2fe" -> "0, 242, 254") */
function hexToRgb(hex: string): string {
    const [r, g, b] = hexToRgbArr(hex);
    return `${r}, ${g}, ${b}`;
}

/** 辅助函数：[R, G, B] 转 HEX 字符串 */
function rgbArrToHex([r, g, b]: [number, number, number]): string {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/**
 * 辅助函数：线性插值两个 HEX 颜色
 * @param t 插值系数（t>1 表示沿着 from->to 的方向进行延伸外插）
 */
function lerpHex(from: string, to: string, t: number): string {
    const [r1, g1, b1] = hexToRgbArr(from);
    const [r2, g2, b2] = hexToRgbArr(to);
    return rgbArrToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/** 辅助函数：HEX 转 HSL [0-360, 0-1, 0-1] */
function hexToHsl(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgbArr(hex).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h * 360, s, l];
}

/** 辅助函数：HSL 转 HEX */
function hslToHex(h: number, s: number, l: number): string {
    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const hN = h / 360;
    if (s === 0) {
        const v = Math.round(l * 255);
        return rgbArrToHex([v, v, v]);
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return rgbArrToHex([
        hue2rgb(p, q, hN + 1 / 3) * 255,
        hue2rgb(p, q, hN) * 255,
        hue2rgb(p, q, hN - 1 / 3) * 255,
    ]);
}

/** 动态派生悬停发光色 (accentHover)：HSL 亮度适当加深/调微调 */
function deriveAccentHover(accentHex: string): string {
    const [h, s, l] = hexToHsl(accentHex);
    return hslToHex(h, s, Math.max(0.05, l - 0.10));
}

/**
 * 获取指定主题 ID 对应的完整配置方案数据
 *
 * 级联顺延规则：
 * 1. 查找指定 themeId 对应的主题；
 * 2. 若未找到，打印 WARN 警告并自动顺延使用已注册主题列表中的首个可用主题；
 * 3. 兜底返回静态预设 DEFAULT_THEME_PROFILES 数组首项。
 */
export function getActiveScheme(themeId?: string): ThemeData & { id?: string; name?: string } {
    const settings = loadSettings();
    const customThemes = (settings.customThemes as PresetProfileItem<ThemeData>[] | undefined) || [];

    const themeMap = new Map<string, ThemeData & { id?: string; name?: string }>();
    DEFAULT_THEME_PROFILES.forEach(t => themeMap.set(t.id, { ...t.data, id: t.id, name: t.name }));
    customThemes.forEach(ct => {
        if (ct && ct.id) {
            const base = themeMap.get(ct.id) || {};
            themeMap.set(ct.id, { ...base, ...ct.data, id: ct.id, name: ct.name });
        }
    });

    const targetId = themeId || settings.themePreset;

    // 1. 匹配目标 themeId 或当前设置中的 themePreset
    if (targetId && themeMap.has(targetId)) {
        return themeMap.get(targetId)!;
    }

    // 2. 目标未找到，显式 Warn 警告并自动顺延
    if (targetId) {
        logger.warn(`未找到目标主题方案 [${targetId}]，自动顺延使用首个可用主题方案`);
    }

    // 3. 自动顺延可用主题
    const allThemes = Array.from(themeMap.values());
    return allThemes[0] || DEFAULT_THEME_PROFILES[0];
}

/**
 * 将指定主题方案中的基础与衍生 CSS 变量组实时注入关键 DOM 节点
 * （作用于根节点 document.documentElement 及挂载在 body 下的独立 Modal / 蓝图浮层）
 *
 * @param scheme 可选的目标主题配置
 * @param singleNode 可选的单个指定 DOM 节点（如动态创建的 Modal backdrop）
 */
export function applySchemeCSSVariables(scheme?: ThemeData & { id?: string; name?: string }, singleNode?: HTMLElement): void {
    const effectiveScheme = scheme ?? getActiveScheme();

    const rawNodes = singleNode
        ? [singleNode]
        : [
            document.documentElement,
            ...Array.from(document.querySelectorAll<HTMLElement>('.da-modal-backdrop')),
            ...Array.from(document.querySelectorAll<HTMLElement>('.st-da-root:not(#extensions_settings)')),
            ...Array.from(document.querySelectorAll<HTMLElement>('.da-settings-panel')),
            ...Array.from(document.querySelectorAll<HTMLElement>('.da-blueprint-container')),
            ...Array.from(document.querySelectorAll<HTMLElement>('.da-blueprint-backdrop')),
            ...Array.from(document.querySelectorAll<HTMLElement>('.da-floating-unsaved-banner')),
            ...Array.from(document.querySelectorAll<HTMLElement>('.da-fab-container')),
            ...Array.from(document.querySelectorAll<HTMLElement>('.da-image-viewer-overlay')),
        ];
    const targetNodes = Array.from(new Set(rawNodes.filter((n): n is HTMLElement => n !== null)));

    const accentRgb = hexToRgb(effectiveScheme.accentColor ?? '#00f2fe');
    const bgSecondaryRgb = hexToRgb(effectiveScheme.bgSecondary ?? '#1a1d26');
    const opacity = effectiveScheme.bgOpacity ?? 0.95;
    const bgSecondaryRgba = `rgba(${bgSecondaryRgb}, ${opacity})`;

    const bgPrimary = effectiveScheme.bgPrimary ?? '#0f1014';
    const bgSecondary = effectiveScheme.bgSecondary ?? '#1a1d26';
    const bgGradientEnd = effectiveScheme.bgGradientEnd ?? bgPrimary;
    const bgGradientAngle = effectiveScheme.bgGradientAngle ?? 135;
    const computedGradient = effectiveScheme.bgGradient || `linear-gradient(${bgGradientAngle}deg, ${bgPrimary} 0%, ${bgGradientEnd} 100%)`;

    const bgInput = lerpHex(bgPrimary, bgSecondary, 2.0);
    const bgHover = lerpHex(bgPrimary, bgSecondary, 3.0);
    const accentHover = deriveAccentHover(effectiveScheme.accentColor ?? '#00f2fe');

    // 判断是否为亮色主题（纯依背景色 RGB 亮度推导，彻底消除 ID 硬编码特判）
    const [pR, pG, pB] = hexToRgbArr(bgPrimary);
    const isLightMode = (pR * 299 + pG * 587 + pB * 114) / 1000 > 128;
    const bgCard = isLightMode ? '#ffffff' : 'rgba(255, 255, 255, 0.04)';
    const bgSubtle = isLightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.05)';
    const statusWarning = isLightMode ? '#d97706' : '#ff9f0a';
    const statusWarningBg = isLightMode ? 'rgba(217, 119, 6, 0.12)' : 'rgba(255, 159, 10, 0.18)';
    const statusWarningBorder = isLightMode ? 'rgba(217, 119, 6, 0.35)' : 'rgba(255, 159, 10, 0.45)';

    targetNodes.forEach(node => {
        node.setAttribute('data-da-theme', effectiveScheme.id ?? '');
        node.setAttribute('data-da-mode', isLightMode ? 'light' : 'dark');
        node.style.setProperty('--da-bg-primary', bgPrimary);
        node.style.setProperty('--da-bg-secondary', bgSecondary);
        node.style.setProperty('--da-bg-secondary-rgba', bgSecondaryRgba);
        node.style.setProperty('--da-bg-gradient-end', bgGradientEnd);
        node.style.setProperty('--da-bg-gradient-angle', `${bgGradientAngle}deg`);
        node.style.setProperty('--da-bg-gradient', computedGradient);
        node.style.setProperty('--da-bg-card', bgCard);
        node.style.setProperty('--da-bg-subtle', bgSubtle);
        node.style.setProperty('--da-bg-input', bgInput);
        node.style.setProperty('--da-bg-hover', bgHover);
        node.style.setProperty('--da-bg-opacity', String(opacity));
        node.style.setProperty('--da-text-primary', effectiveScheme.textPrimary ?? (isLightMode ? '#1e293b' : '#f1f5f9'));
        node.style.setProperty('--da-text-secondary', effectiveScheme.textSecondary ?? (isLightMode ? '#64748b' : '#94a3b8'));
        node.style.setProperty('--da-border-color', effectiveScheme.borderColor ?? (isLightMode ? '#cbd5e1' : '#282b33'));
        node.style.setProperty('--da-accent-color', effectiveScheme.accentColor ?? '#00f2fe');
        node.style.setProperty('--da-accent-hover', accentHover);
        node.style.setProperty('--da-accent-rgb', accentRgb);
        node.style.setProperty('--da-status-warning', statusWarning);
        node.style.setProperty('--da-status-warning-bg', statusWarningBg);
        node.style.setProperty('--da-status-warning-border', statusWarningBorder);

        if (effectiveScheme.borderRadius !== undefined) {
            node.style.setProperty('--da-radius-card', `${effectiveScheme.borderRadius}px`);
            node.style.setProperty('--da-radius-btn', `${Math.max(4, effectiveScheme.borderRadius - 4)}px`);
        }
        if (effectiveScheme.blurRadius !== undefined) {
            node.style.setProperty('--da-blur-radius', `${effectiveScheme.blurRadius}px`);
        }
    });

    refreshHeaderThemeSelect();
}

/**
 * 方便函数：向单独动态创建的 Node 节点同步注入当前系统主题变量
 */
export function applyCurrentThemeToNode(node: HTMLElement): void {
    applySchemeCSSVariables(undefined, node);
}

/**
 * 全盘应用插件独立主题（载入持久化配置并刷新 CSS 变量）
 */
export function applyPluginTheme(themeId: string): void {
    const scheme = getActiveScheme(themeId);
    applySchemeCSSVariables(scheme);
    const settings = loadSettings();
    if (settings.themePreset !== scheme.id) {
        patchSettings({ themePreset: scheme.id });
    }
}
