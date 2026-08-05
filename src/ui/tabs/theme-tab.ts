/**
 * @module ui/tabs/theme-tab
 * @description 样式主题 Tab 组件 (Theme Settings Tab)
 *
 * 职责：
 * - 主题方案管理：切换、新建、保存、重命名、JSON 导入/导出与物理删除
 * - 调色盘与 Live 实时预览：支持 7 大核心 CSS 变量 HEX/RGB 变量双同步
 * - 顶栏下拉框联动：Theme Token 改动即时注入 DOM 并刷动顶栏 #da-quick-theme-select 状态
 */

import { createFieldRow } from '../components/field-row';
import { renderPresetToolbar } from '../components/preset-toolbar';
import { loadSettings, updateSettings } from '../../settings/manager';
import { DEFAULT_THEME_PROFILES } from '../../settings/defaults';
import type { CustomThemeScheme, PresetProfileItem } from '../../settings/types';
import { refreshHeaderThemeSelect } from '../settings-panel';
import { logger } from '../../core/logger';

/**
 * 渲染主题设置 Tab 内容节点
 */
export function renderThemeTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-theme-tab';

    const settings = loadSettings();
    const activeScheme = getActiveScheme(settings.themePreset);
    const currentThemeId = activeScheme.id;

    // 顶部改动提示气泡
    const hintCard = document.createElement('div');
    hintCard.className = 'da-change-hint-badge';
    hintCard.style.display = 'none';
    hintCard.style.marginBottom = '12px';
    hintCard.style.padding = '8px 14px';
    hintCard.style.borderRadius = '8px';
    hintCard.style.background = 'rgba(var(--da-accent-rgb, 0, 242, 254), 0.12)';
    hintCard.style.border = '1px solid var(--da-accent-color, #00f2fe)';
    hintCard.style.color = 'var(--da-accent-color, #00f2fe)';
    hintCard.style.fontSize = '0.85em';
    hintCard.style.fontWeight = '500';
    hintCard.style.transition = 'opacity 0.2s ease';
    hintCard.innerHTML = '<span>配置已即时自动保存并生效</span>';
    container.appendChild(hintCard);

    let changeHintTimer: number | null = null;
    const notifyChange = () => {
        hintCard.style.display = 'block';
        hintCard.style.opacity = '1';
        if (changeHintTimer) clearTimeout(changeHintTimer);
        changeHintTimer = window.setTimeout(() => {
            hintCard.style.opacity = '0';
            setTimeout(() => { hintCard.style.display = 'none'; }, 200);
        }, 2200);
    };

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
        <span class="da-section-desc">选择内置精美预设或自定义专属 UI 配色方案（支持新建、保存、重命名、导入、导出与删除）</span>
    `;
    cardScheme.appendChild(headerScheme);

    // 转换方案格式适应 PresetToolbar
    const themeProfiles: PresetProfileItem[] = (settings.customThemes ?? DEFAULT_THEME_PROFILES).map(c => ({
        id: c.id,
        name: c.name,
        isBuiltIn: false,
        data: c as unknown as Record<string, unknown>,
    }));

    const toolbarTheme = renderPresetToolbar({
        defaultName: themeProfiles[0]?.name ?? '默认主题方案',
        profiles: themeProfiles,
        currentId: currentThemeId,
        onSelect: (id) => {
            applyPluginTheme(id);
            updateSettings({ themePreset: id });
            notifyChange();
            refreshTab();
        },
        onNew: () => {
            const name = prompt('请输入新自定义主题方案名称:', '我的专属风采');
            if (!name) return;
            const newId = `custom_${Date.now()}`;
            const currentScheme = getActiveScheme(currentThemeId);
            const newScheme: CustomThemeScheme = {
                ...currentScheme,
                id: newId,
                name: name.trim(),
                isBuiltIn: false,
            };

            const updated = [...(settings.customThemes ?? DEFAULT_THEME_PROFILES), newScheme];
            updateSettings({ customThemes: updated, themePreset: newId });
            applyPluginTheme(newId);
            notifyChange();
            refreshTab();
        },
        onSave: () => {
            const currentSettings = loadSettings();
            const currentScheme = getActiveScheme(currentThemeId);
            const customThemes = [...(currentSettings.customThemes ?? DEFAULT_THEME_PROFILES)];
            const existingIdx = customThemes.findIndex(c => c.id === currentThemeId);
            if (existingIdx >= 0) {
                customThemes[existingIdx] = { ...currentScheme };
            } else {
                customThemes.push({ ...currentScheme });
            }
            updateSettings({ customThemes });
            applyPluginTheme(currentThemeId);
            notifyChange();
            showToastNotice('当前主题方案已成功保存！', '主题保存成功', true);
        },
        onRename: () => {
            const currentSettings = loadSettings();
            const currentScheme = getActiveScheme(currentThemeId);
            const newName = prompt('请输入新的主题名称:', currentScheme.name);
            if (!newName || !newName.trim()) return;

            const customThemes = [...(currentSettings.customThemes ?? DEFAULT_THEME_PROFILES)];
            const existingIdx = customThemes.findIndex(c => c.id === currentThemeId);
            if (existingIdx >= 0) {
                customThemes[existingIdx].name = newName.trim();
                updateSettings({ customThemes });
                applyPluginTheme(currentThemeId);
                notifyChange();
                refreshTab();
            }
        },
        onImport: (content) => {
            try {
                const parsed = JSON.parse(content) as Partial<CustomThemeScheme>;
                if (!parsed.id || !parsed.name || !parsed.bgPrimary) {
                    showToastNotice('导入失败: 主题 JSON 文件缺少必要的配色字段！', '格式错误', false);
                    return;
                }
                const currentSettings = loadSettings();
                const customThemes = [...(currentSettings.customThemes ?? DEFAULT_THEME_PROFILES)];
                const existingIdx = customThemes.findIndex(c => c.id === parsed.id);
                if (existingIdx >= 0) {
                    customThemes[existingIdx] = parsed as CustomThemeScheme;
                } else {
                    customThemes.push(parsed as CustomThemeScheme);
                }
                updateSettings({ customThemes, themePreset: parsed.id });
                applyPluginTheme(parsed.id);
                notifyChange();
                refreshTab();
                showToastNotice(`主题方案 "${parsed.name}" 导入成功！`, '主题导入成功', true);
            } catch (err) {
                showToastNotice(`导入失败: JSON 格式错误 (${err instanceof Error ? err.message : String(err)})`, '解析失败', false);
            }
        },
        onExport: () => {
            const currentScheme = getActiveScheme(currentThemeId);
            const jsonStr = JSON.stringify(currentScheme, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `theme-${currentScheme.id}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
        onDelete: () => {
            const currentSettings = loadSettings();
            const customThemes = (currentSettings.customThemes ?? DEFAULT_THEME_PROFILES).filter(c => c.id !== currentThemeId);
            if (customThemes.length === 0) {
                showToastNotice('无法删除唯一的最后一个主题方案！', '操作拦截', false);
                return;
            }
            if (!confirm(`确定要删除主题方案 "${getActiveScheme(currentThemeId).name}" 吗？`)) return;

            const fallbackId = customThemes[0].id;
            updateSettings({ customThemes, themePreset: fallbackId });
            applyPluginTheme(fallbackId);
            notifyChange();
            refreshTab();
        },
    });

    cardScheme.appendChild(toolbarTheme);
    container.appendChild(cardScheme);

    // ── 2. 调色盘与外观配置卡片 ─────────────────────────────────────────────
    const cardColors = document.createElement('div');
    cardColors.className = 'da-section-card';
    cardColors.style.marginTop = '15px';

    const headerColors = document.createElement('div');
    headerColors.className = 'da-section-header';
    headerColors.innerHTML = `
        <span class="da-section-title">配色与界面调色盘</span>
        <span class="da-section-desc">调整主背景色、卡片背景、输入框背景、文本颜色、微光边框与强调发光色（拖动即刻 0 毫秒全屏预览）</span>
    `;
    cardColors.appendChild(headerColors);

    const updateSchemeProperty = (key: keyof CustomThemeScheme, val: unknown) => {
        const currentSettings = loadSettings();
        const currentScheme = getActiveScheme(currentThemeId);
        const updatedScheme = { ...currentScheme, [key]: val };

        const customThemes = [...(currentSettings.customThemes ?? DEFAULT_THEME_PROFILES)];
        const idx = customThemes.findIndex(c => c.id === currentThemeId);
        if (idx >= 0) {
            customThemes[idx] = updatedScheme;
        } else {
            customThemes.push(updatedScheme);
        }

        updateSettings({ customThemes, themePreset: currentThemeId });
        applyPluginTheme(currentThemeId);
        notifyChange();
    };

    // 2.1 主背景色 (bgPrimary)
    const inputBgPrimary = document.createElement('input');
    inputBgPrimary.type = 'color';
    inputBgPrimary.value = activeScheme.bgPrimary ?? '#111317';
    inputBgPrimary.className = 'da-input-color';
    inputBgPrimary.addEventListener('input', () => updateSchemeProperty('bgPrimary', inputBgPrimary.value));

    cardColors.appendChild(createFieldRow({
        label: '主背景色 (bgPrimary)',
        helpTooltip: '插件模态框与大部分透光层的基底深沉背景色。',
        control: inputBgPrimary,
    }));

    // 2.2 卡片背景色 (bgSecondary)
    const inputBgSecondary = document.createElement('input');
    inputBgSecondary.type = 'color';
    inputBgSecondary.value = activeScheme.bgSecondary ?? '#15171c';
    inputBgSecondary.className = 'da-input-color';
    inputBgSecondary.addEventListener('input', () => updateSchemeProperty('bgSecondary', inputBgSecondary.value));

    cardColors.appendChild(createFieldRow({
        label: '卡片背景色 (bgSecondary)',
        helpTooltip: '各个功能区块卡片容器与侧边栏的背景暗色。',
        control: inputBgSecondary,
    }));

    // 2.3 输入框背景色 (bgInput)
    const inputBgInput = document.createElement('input');
    inputBgInput.type = 'color';
    inputBgInput.value = activeScheme.bgInput ?? '#1c1f26';
    inputBgInput.className = 'da-input-color';
    inputBgInput.addEventListener('input', () => updateSchemeProperty('bgInput', inputBgInput.value));

    cardColors.appendChild(createFieldRow({
        label: '输入框背景色 (bgInput)',
        helpTooltip: '输入框、下拉框与底栏工具控件的充填背景色。',
        control: inputBgInput,
    }));

    // 2.4 文本主颜色 (textPrimary)
    const inputTextPrimary = document.createElement('input');
    inputTextPrimary.type = 'color';
    inputTextPrimary.value = activeScheme.textPrimary ?? '#f1f5f9';
    inputTextPrimary.className = 'da-input-color';
    inputTextPrimary.addEventListener('input', () => updateSchemeProperty('textPrimary', inputTextPrimary.value));

    cardColors.appendChild(createFieldRow({
        label: '文本主颜色 (textPrimary)',
        helpTooltip: '主要标题、标签文本与控件焦点文字色彩。',
        control: inputTextPrimary,
    }));

    // 2.5 文本次颜色 (textSecondary)
    const inputTextSecondary = document.createElement('input');
    inputTextSecondary.type = 'color';
    inputTextSecondary.value = activeScheme.textSecondary ?? '#94a3b8';
    inputTextSecondary.className = 'da-input-color';
    inputTextSecondary.addEventListener('input', () => updateSchemeProperty('textSecondary', inputTextSecondary.value));

    cardColors.appendChild(createFieldRow({
        label: '文本次颜色 (textSecondary)',
        helpTooltip: '辅助说明文字与次要按钮文本色彩。',
        control: inputTextSecondary,
    }));

    // 2.6 边框颜色 (borderColor)
    const inputBorderColor = document.createElement('input');
    inputBorderColor.type = 'color';
    inputBorderColor.value = activeScheme.borderColor ?? '#282b33';
    inputBorderColor.className = 'da-input-color';
    inputBorderColor.addEventListener('input', () => updateSchemeProperty('borderColor', inputBorderColor.value));

    cardColors.appendChild(createFieldRow({
        label: '边框颜色 (borderColor)',
        helpTooltip: '区块卡片、输入框与分割线的外围微光边框。',
        control: inputBorderColor,
    }));

    // 2.7 强调发光色 (accentColor)
    const inputAccentColor = document.createElement('input');
    inputAccentColor.type = 'color';
    inputAccentColor.value = activeScheme.accentColor ?? '#00f2fe';
    inputAccentColor.className = 'da-input-color';
    inputAccentColor.addEventListener('input', () => updateSchemeProperty('accentColor', inputAccentColor.value));

    cardColors.appendChild(createFieldRow({
        label: '强调发光色 (accentColor)',
        helpTooltip: '按钮、焦点脉冲光晕与主要高亮线色彩。',
        control: inputAccentColor,
    }));

    container.appendChild(cardColors);

    // ── 3. UI 效果实时预览沙盒卡片 ──────────────────────────────────────────
    const cardPreview = document.createElement('div');
    cardPreview.className = 'da-section-card';
    cardPreview.style.marginTop = '15px';

    const headerPreview = document.createElement('div');
    headerPreview.className = 'da-section-header';
    headerPreview.innerHTML = `
        <span class="da-section-title">UI 效果沙盒实时预览</span>
        <span class="da-section-desc">直观查看当前调色盘在控件、按钮、徽章与高亮光效上的综合渲染效果</span>
    `;
    cardPreview.appendChild(headerPreview);
    cardPreview.appendChild(renderThemePreviewSandbox());

    container.appendChild(cardPreview);

    return container;
}

/** 辅助函数：渲染 UI 效果实时预览沙盒 */
function renderThemePreviewSandbox(): HTMLElement {
    const sandbox = document.createElement('div');
    sandbox.style.background = 'var(--da-bg-secondary)';
    sandbox.style.border = '1px solid var(--da-border-color)';
    sandbox.style.borderRadius = '8px';
    sandbox.style.padding = '16px';
    sandbox.style.display = 'flex';
    sandbox.style.flexDirection = 'column';
    sandbox.style.gap = '12px';

    const row1 = document.createElement('div');
    row1.style.display = 'flex';
    row1.style.alignItems = 'center';
    row1.style.gap = '10px';
    row1.style.flexWrap = 'wrap';

    const btnPrimary = document.createElement('button');
    btnPrimary.className = 'da-btn primary';
    btnPrimary.textContent = '主要按钮 (Primary)';

    const btnSecondary = document.createElement('button');
    btnSecondary.className = 'da-btn secondary';
    btnSecondary.textContent = '辅助按钮 (Secondary)';

    const badge = document.createElement('span');
    badge.style.fontSize = '0.75em';
    badge.style.padding = '3px 8px';
    badge.style.borderRadius = '10px';
    badge.style.fontWeight = '600';
    badge.style.color = 'var(--da-accent-color)';
    badge.style.background = 'rgba(var(--da-accent-rgb, 0, 242, 254), 0.15)';
    badge.style.border = '1px solid var(--da-accent-color)';
    badge.textContent = '✨ 强调徽章';

    row1.appendChild(btnPrimary);
    row1.appendChild(btnSecondary);
    row1.appendChild(badge);

    const row2 = document.createElement('div');
    row2.style.display = 'flex';
    row2.style.gap = '10px';

    const sampleInput = document.createElement('input');
    sampleInput.type = 'text';
    sampleInput.className = 'da-input';
    sampleInput.value = '示例文本输入框 (Sample Text Input)';
    sampleInput.style.flex = '1';

    row2.appendChild(sampleInput);

    sandbox.appendChild(row1);
    sandbox.appendChild(row2);
    return sandbox;
}

/** 辅助函数：HEX 转 RGB 字符串 (如 "#00f2fe" -> "0, 242, 254") */
function hexToRgb(hex: string): string {
    let clean = (hex || '').replace('#', '').trim();
    if (clean.length === 3) {
        clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16);
    if (isNaN(num)) return '0, 242, 254';
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `${r}, ${g}, ${b}`;
}

/**
 * 获取指定主题 ID 对应的完整配置方案数据
 */
export function getActiveScheme(themeId?: string): CustomThemeScheme {
    const settings = loadSettings();
    const customThemes = settings.customThemes || [];

    const allThemes: CustomThemeScheme[] = [...DEFAULT_THEME_PROFILES];
    customThemes.forEach(ct => {
        if (ct && ct.id && !allThemes.some(t => t.id === ct.id)) {
            allThemes.push(ct);
        }
    });

    if (themeId) {
        const found = allThemes.find(c => c && c.id === themeId);
        if (found && found.bgPrimary && found.bgSecondary && found.accentColor) {
            return found;
        }
    }

    return allThemes[0] || DEFAULT_THEME_PROFILES[0];
}

/**
 * 全盘应用插件独立主题 Token (包含 --da-accent-rgb 变量与顶栏下拉菜单 rebuild)
 */
export function applyPluginTheme(themeId: string): void {
    const scheme = getActiveScheme(themeId);
    const modalBackdrop = document.getElementById('da-main-modal-backdrop');

    const targetNodes = [
        document.documentElement,
        modalBackdrop,
        document.querySelector<HTMLElement>('.st-da-root'),
        document.querySelector<HTMLElement>('.da-settings-panel'),
    ].filter((n): n is HTMLElement => n !== null);

    const accentRgb = hexToRgb(scheme.accentColor ?? '#00f2fe');

    targetNodes.forEach(node => {
        node.setAttribute('data-da-theme', scheme.id);
        node.style.setProperty('--da-bg-primary', scheme.bgPrimary);
        node.style.setProperty('--da-bg-secondary', scheme.bgSecondary);
        node.style.setProperty('--da-bg-input', scheme.bgInput ?? '#1c1f26');
        node.style.setProperty('--da-bg-hover', scheme.bgHover ?? '#262a34');
        node.style.setProperty('--da-text-primary', scheme.textPrimary ?? '#f1f5f9');
        node.style.setProperty('--da-text-secondary', scheme.textSecondary ?? '#94a3b8');
        node.style.setProperty('--da-border-color', scheme.borderColor ?? '#282b33');
        node.style.setProperty('--da-accent-color', scheme.accentColor ?? '#00f2fe');
        node.style.setProperty('--da-accent-rgb', accentRgb);

        if (scheme.blurRadius !== undefined) {
            node.style.setProperty('backdrop-filter', `blur(${scheme.blurRadius}px)`);
        }
    });

    // 联动刷新顶栏 #da-quick-theme-select 保持全盘装载与选中一致
    refreshHeaderThemeSelect();

    const settings = loadSettings();
    if (settings.themePreset !== scheme.id) {
        updateSettings({ themePreset: scheme.id });
    }
}

/** 辅助函数：显示 ST 全局 Toast 通知 */
function showToastNotice(message: string, title = '主题设置', isSuccess = true): void {
    const win = window as unknown as { toastr?: { success?: (m: string, t?: string) => void; error?: (m: string, t?: string) => void; info?: (m: string, t?: string) => void } };
    if (win.toastr) {
        if (isSuccess && typeof win.toastr.success === 'function') {
            win.toastr.success(message, title);
            return;
        }
        if (!isSuccess && typeof win.toastr.error === 'function') {
            win.toastr.error(message, title);
            return;
        }
    }
    logger.info(`[${title}] ${message}`);
}
