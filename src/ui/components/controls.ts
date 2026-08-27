/**
 * @module ui/components/controls
 * @description 扩展统一基础 UI 控件与渲染部件库 (Consolidated Controls)
 *
 * 职责：
 * - BLOCK 1: 表单行基础控件 (createFieldRow)
 * - BLOCK 2: 预设方案操作工具栏 (renderPresetToolbar)
 * - BLOCK 3: 设置面板主底栏 (renderFooterBar)
 * - BLOCK 4: 存储容量指示条 (renderStorageBar)
 * - BLOCK 5: 历史生成统计卡片 (renderStatisticsCard)
 * - BLOCK 6: 图像操作栏控件 (openImageActionPanel)
 */

import { logger } from '../../core/logger';
import { VERSION } from '../../core/constants';
import { showToastNotice } from '../../utils/toast';
import { applyCurrentThemeToNode } from '../tabs/theme-tab';
import { StatisticsCollector, exportStatisticsJSON, exportStatisticsCSV } from '../../statistics';
import { globalEventBus, DA_EVENTS } from '../../core/event-bus';
import { driverStore } from '../../state/app-store';
import {
    loadSettings,
    ProfileService,
    getEffectiveList,
    resetCategoryToDefault,
    type ProfileCategory,
} from '../../settings/manager';
import { PRESET_REGISTRY, type RegistryCategory } from '../../settings/preset-registry';
import { FeedbackService } from '../feedback-service';
import {
    getCharacterProfiles,
    upsertCharacterProfile,
    deleteCharacterProfile,
    resetCharacterProfilesToDefault,
    getOutfitProfiles,
    upsertOutfitProfile,
    deleteOutfitProfile,
    resetOutfitProfilesToDefault,
    getEnableSchemes,
    upsertEnableScheme,
    deleteEnableScheme,
    resetEnableSchemesToDefault,
} from '../../extensions/character-manager/storage';

// ============================================================================
// BLOCK 1: 表单行基础控件 (createFieldRow)
// ============================================================================

export interface FieldRowOptions {
    label: string;
    description?: string;
    helpTooltip?: string;
    headerAction?: any;
    isBlock?: boolean;
    type?: 'text' | 'number' | 'password' | 'checkbox' | 'select' | 'textarea' | 'range' | string;
    value?: string | number | boolean;
    placeholder?: string;
    options?: Array<{ label: string; value: string | number }>;
    min?: number;
    max?: number;
    step?: number;
    control?: any;
    onChange?: (value: any) => void;
    [key: string]: any;
}

export type FieldRowResult = HTMLDivElement & {
    element: HTMLElement;
    input: HTMLElement;
    setValue: (val: string | number | boolean) => void;
};

/** 全局独占活动的帮助说明气泡清理函数 */
let activeHelpBubbleCleanup: (() => void) | null = null;

/**
 * 创建标准的设置项表单行节点
 *
 * @param options 表单行类型、标签与回调配置
 * @returns 包含 DOM 根节点、Input 节点与 setValue 方法的复合 Element
 */
export function createFieldRow(options: FieldRowOptions): HTMLElement {
    const row = document.createElement('div');
    const blockClass = options.isBlock ? 'da-field-row--block' : '';
    row.className = `da-field-row ${blockClass} ${options.className ?? ''}`.trim();

    const labelContainer = document.createElement('div');
    labelContainer.className = 'da-field-label';

    const labelHeader = document.createElement('div');
    labelHeader.style.display = 'flex';
    labelHeader.style.alignItems = 'center';
    labelHeader.style.gap = '6px';
    if (options.headerAction) {
        labelHeader.style.justifyContent = 'space-between';
        labelHeader.style.width = '100%';
    }

    const labelLeftGroup = document.createElement('div');
    labelLeftGroup.style.display = 'flex';
    labelLeftGroup.style.alignItems = 'center';
    labelLeftGroup.style.gap = '6px';

    const labelText = document.createElement('span');
    labelText.className = 'da-label-text';
    labelText.textContent = options.label;
    labelLeftGroup.appendChild(labelText);

    if (options.helpTooltip) {
        const helpBtn = document.createElement('button');
        helpBtn.className = 'da-help-btn';
        helpBtn.title = '点击查看字段详细说明';
        helpBtn.innerHTML = '?';

        let bubbleEl: HTMLElement | null = null;
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 若当前已存在打开的气泡，先强制销毁
            if (activeHelpBubbleCleanup) {
                const wasSelf = bubbleEl !== null;
                activeHelpBubbleCleanup();
                if (wasSelf) return; // 如果是点击自己，则完成 Toggle 隐藏动作
            }

            bubbleEl = document.createElement('div');
            bubbleEl.className = 'da-field-help-bubble';
            bubbleEl.innerHTML = `
                <div style="font-weight:600; color:var(--da-accent-color, #00f2fe); margin-bottom:4px; font-size:0.88em;">说明</div>
                <div>${options.helpTooltip}</div>
            `;
            document.body.appendChild(bubbleEl);

            const rect = helpBtn.getBoundingClientRect();
            bubbleEl.style.top = `${rect.bottom + 6}px`;
            bubbleEl.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;

            const dismiss = () => {
                if (bubbleEl) {
                    bubbleEl.remove();
                    bubbleEl = null;
                }
                if (activeHelpBubbleCleanup === dismiss) {
                    activeHelpBubbleCleanup = null;
                }
                window.removeEventListener('pointerdown', onPointerDown, true);
            };

            const onPointerDown = (evt: Event) => {
                const target = evt.target as Node | null;
                if (bubbleEl && target && !bubbleEl.contains(target) && !helpBtn.contains(target)) {
                    dismiss();
                }
            };

            activeHelpBubbleCleanup = dismiss;
            setTimeout(() => {
                if (bubbleEl) {
                    window.addEventListener('pointerdown', onPointerDown, true);
                }
            }, 10);
        });

        labelLeftGroup.appendChild(helpBtn);
    }

    labelHeader.appendChild(labelLeftGroup);
    if (options.headerAction) {
        if (Array.isArray(options.headerAction)) {
            options.headerAction.forEach(item => {
                if (item instanceof HTMLElement) labelHeader.appendChild(item);
            });
        } else if (options.headerAction instanceof HTMLElement) {
            labelHeader.appendChild(options.headerAction);
        }
    }
    labelContainer.appendChild(labelHeader);

    if (options.description) {
        const desc = document.createElement('div');
        desc.className = 'da-label-desc';
        desc.textContent = options.description;
        labelContainer.appendChild(desc);
    }
    row.appendChild(labelContainer);

    const controlContainer = document.createElement('div');
    controlContainer.className = 'da-field-control';

    let inputEl: HTMLElement;

    if (options.control) {
        if (Array.isArray(options.control)) {
            options.control.forEach(ctrl => {
                if (ctrl instanceof HTMLElement) controlContainer.appendChild(ctrl);
            });
            inputEl = (options.control[0] as HTMLElement) || controlContainer;
        } else {
            inputEl = options.control;
            controlContainer.appendChild(inputEl);
        }
    } else if (options.type === 'select') {
        const select = document.createElement('select');
        select.className = 'da-select';
        (options.options || []).forEach(opt => {
            const op = document.createElement('option');
            op.value = String(opt.value);
            op.textContent = opt.label;
            if (String(opt.value) === String(options.value)) {
                op.selected = true;
            }
            select.appendChild(op);
        });
        select.addEventListener('change', () => {
            if (options.onChange) options.onChange(select.value);
        });
        inputEl = select;
    } else if (options.type === 'checkbox') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'da-checkbox';
        checkbox.checked = Boolean(options.value);
        checkbox.addEventListener('change', () => {
            if (options.onChange) options.onChange(checkbox.checked);
        });
        inputEl = checkbox;
    } else if (options.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.className = 'da-textarea';
        textarea.value = String(options.value || '');
        if (options.placeholder) textarea.placeholder = options.placeholder;
        textarea.addEventListener('input', () => {
            if (options.onChange) options.onChange(textarea.value);
        });
        inputEl = textarea;
    } else {
        const input = document.createElement('input');
        input.type = options.type || 'text';
        input.className = 'da-input';
        if (options.value !== undefined) input.value = String(options.value);
        if (options.placeholder) input.placeholder = options.placeholder;
        if (options.min !== undefined) input.min = String(options.min);
        if (options.max !== undefined) input.max = String(options.max);
        if (options.step !== undefined) input.step = String(options.step);

        input.addEventListener('change', () => {
            if (options.onChange) {
                const val = options.type === 'number' || options.type === 'range' ? Number(input.value) : input.value;
                options.onChange(val);
            }
        });
        inputEl = input;
    }

    if (!options.control) {
        controlContainer.appendChild(inputEl);
    }
    row.appendChild(controlContainer);

    const setValue = (val: string | number | boolean) => {
        if (options.type === 'checkbox') {
            (inputEl as HTMLInputElement).checked = Boolean(val);
        } else if (options.type === 'select') {
            (inputEl as HTMLSelectElement).value = String(val);
        } else if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
            inputEl.value = String(val);
        }
    };

    const res = row as FieldRowResult;
    res.element = row;
    res.input = inputEl;
    res.setValue = setValue;

    return res;
}

// ============================================================================
// BLOCK 2: 预设方案操作工具栏 (renderPresetToolbar)
// ============================================================================

/** 预设方案下拉选项条目结构 */
export interface PresetItem {
    id: string;
    name: string;
    isSystemPreset?: boolean;
    data?: any;
}

/**
 * 预设方案工具栏配置接口
 */
export interface PresetToolbarOptions {
    /** 预设方案列表 */
    profiles?: PresetItem[];
    /** 当前选中的预设 ID */
    currentId?: string;
    /** 草稿未保存标记 (Dirty Badge) */
    isDraftDirty?: boolean;
    /** 下拉框选中预设回调 */
    onSelect?: (id: string) => void;
    /** ➕ 新建预设方案回调 */
    onNew?: () => void;
    /** 💾 保存预设方案回调 */
    onSave?: () => void;
    /** ✏️ 重命名预设方案回调 */
    onRename?: () => void;
    /** 📤 导出预设方案回调 */
    onExport?: () => void;
    /** 📥 导入预设方案回调 */
    onImport?: (content: string, fileName: string) => void;
    /** 🔄 重置内置预设方案回调 */
    onReset?: () => void;
    /** 🗑️ 删除预设方案回调 */
    onDelete?: () => void;
}

/**
 * 预设工具栏 DOM 节点，附带控制句柄
 */
export type PresetToolbarElement = HTMLDivElement & {
    /** 获取当前组件表单数据 (由 bindPresetToolbar 绑定注入) */
    getCurrentData?: () => unknown;
    /** 动态刷新预设下拉列表与操作按钮状态 */
    refreshPresets?: (presets: PresetItem[], activeId: string, isDirty?: boolean) => void;
};

/**
 * 渲染纯化后的预设方案下拉选择与操作工具栏组件
 *
 * @param options 预设列表及增删改查导出回调配置
 * @returns 包含工具栏 DOM 根节点与 refreshPresets 刷新方法的 PresetToolbarElement
 */
export function renderPresetToolbar(options: PresetToolbarOptions): PresetToolbarElement {
    const container = document.createElement('div') as PresetToolbarElement;
    container.className = 'da-preset-toolbar';

    const leftPart = document.createElement('div');
    leftPart.className = 'da-preset-toolbar-left';

    const select = document.createElement('select');
    select.className = 'da-select';
    select.style.flex = '1';
    select.style.minWidth = '160px';

    const populateSelect = (presetList: PresetItem[], activeId: string) => {
        select.innerHTML = '';
        if (presetList.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(无可选预设方案)';
            select.appendChild(opt);
        } else {
            presetList.forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === activeId) opt.selected = true;
                select.appendChild(opt);
            });
        }
    };

    const activeId = options.currentId || '';
    const initialProfiles = options.profiles || [];
    populateSelect(initialProfiles, activeId);

    let currentSelectedVal = select.value || activeId;
    select.addEventListener('change', () => {
        const newVal = select.value;
        if (newVal === currentSelectedVal) {
            return;
        }
        currentSelectedVal = newVal;
        if (options.onSelect && newVal) {
            options.onSelect(newVal);
        }
        updateActionButtonsState();
    });

    leftPart.appendChild(select);

    const draftBadge = document.createElement('span');
    draftBadge.className = 'da-badge dirty';
    draftBadge.style.display = options.isDraftDirty ? 'inline-flex' : 'none';
    draftBadge.textContent = '已修改';
    leftPart.appendChild(draftBadge);

    container.appendChild(leftPart);

    const rightPart = document.createElement('div');
    rightPart.className = 'da-preset-toolbar-actions';

    // 用于导入 JSON 预设文件的隐藏 input 节点
    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';

    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file || !options.onImport) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = (ev.target?.result as string) || '';
            options.onImport!(content, file.name);
        };
        reader.readAsText(file, 'UTF-8');
        hiddenFileInput.value = '';
    });
    rightPart.appendChild(hiddenFileInput);

    /** 收集依赖预设选中项的按钮及对应解封/禁用控制逻辑 */
    const selectionDependentBtns: Array<{ btn: HTMLButtonElement; isDanger?: boolean }> = [];

    const createIconButton = (
        iconHtml: string,
        titleText: string,
        onClick: () => void,
        requiresSelection = false,
        isDanger = false
    ) => {
        const btn = document.createElement('button');
        btn.className = `da-icon-btn ${isDanger ? 'danger' : ''}`;
        btn.title = titleText;
        btn.innerHTML = iconHtml;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!btn.disabled) onClick();
        });

        if (requiresSelection) {
            selectionDependentBtns.push({ btn, isDanger });
        }
        return btn;
    };

    const updateActionButtonsState = () => {
        const hasSelection = Boolean(select.value);
        selectionDependentBtns.forEach(({ btn, isDanger }) => {
            btn.disabled = !hasSelection;
            if (isDanger) {
                btn.style.color = hasSelection ? '#ef4444' : 'rgba(239, 68, 68, 0.4)';
                btn.style.borderColor = hasSelection ? 'rgba(239, 68, 68, 0.4)' : 'rgba(239, 68, 68, 0.2)';
            }
            btn.style.opacity = hasSelection ? '1' : '0.35';
            btn.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
        });
    };

    // 新建方案
    if (options.onNew) {
        rightPart.appendChild(createIconButton('<i class="fa-solid fa-plus"></i>', '新建预设方案', options.onNew));
    }

    // 保存方案
    if (options.onSave) {
        rightPart.appendChild(createIconButton('<i class="fa-solid fa-save"></i>', '保存当前方案', options.onSave, true));
    }

    // 重命名方案
    if (options.onRename) {
        rightPart.appendChild(createIconButton('<i class="fa-solid fa-pen"></i>', '重命名当前方案', options.onRename, true));
    }

    // 导出方案
    if (options.onExport) {
        rightPart.appendChild(createIconButton('<i class="fa-solid fa-upload"></i>', '导出方案 JSON', options.onExport, true));
    }

    // 导入方案
    if (options.onImport) {
        rightPart.appendChild(createIconButton('<i class="fa-solid fa-download"></i>', '导入方案 JSON', () => hiddenFileInput.click()));
    }

    // 重置方案
    if (options.onReset) {
        rightPart.appendChild(createIconButton('<i class="fa-solid fa-rotate-left"></i>', '恢复初始配置', options.onReset));
    }

    // 删除方案
    if (options.onDelete) {
        rightPart.appendChild(createIconButton('<i class="fa-solid fa-trash"></i>', '删除当前方案', options.onDelete, true, true));
    }

    container.appendChild(rightPart);
    updateActionButtonsState();

    container.refreshPresets = (presets: PresetItem[], activeId: string, isDirty?: boolean) => {
        populateSelect(presets, activeId);
        draftBadge.style.display = isDirty ? 'inline-flex' : 'none';
        updateActionButtonsState();
    };

    return container;
}

/**
 * 预设方案直接控件绑定配置选项
 */
export interface BoundPresetToolbarOptions {
    /** 预设方案类别标识 */
    category: ProfileCategory;
    /** 获取当前表单内待保存数据的闭包 */
    getCurrentData: () => unknown;
    /** 切换选中预设后的 UI 刷新回调 */
    applyData: (id: string) => void;
    /** CRUD 操作完成后的 Tab 重建/刷新回调 */
    onRefresh: () => void;
    /**
     * 切换选中预设前置拦截回调（支持异步拦截，返回 false 可阻止切换）
     */
    onBeforeSelect?: (id: string) => Promise<boolean>;
    /**
     * 覆盖默认保存行为的自定义扩展回调
     */
    onSaveOverride?: () => void;
}

/**
 * 预设方案直接控件绑定函数
 */
export function bindPresetToolbar(options: BoundPresetToolbarOptions): PresetToolbarElement {
    const { category, getCurrentData, applyData, onRefresh } = options;

    // character / outfit / enable-scheme 不走 PRESET_REGISTRY 路径
    const isRegistryCategory = category in PRESET_REGISTRY;
    const regCategory = isRegistryCategory ? category as RegistryCategory : null;
    const def = regCategory ? PRESET_REGISTRY[regCategory] : null;

    // 获取初始预设列表和当前活跃 ID
    const getProfiles = (): PresetItem[] => {
        if (regCategory) {
            return getEffectiveList(regCategory).map(p => ({ id: p.id, name: p.name, data: p.data }));
        }
        if (category === 'character') {
            return getCharacterProfiles().map(c => ({
                id: c.id,
                name: c.nameCN ? `${c.nameCN} (${c.nameEN || '未命名'})` : c.nameEN || c.id,
                data: c,
            }));
        }
        if (category === 'outfit') {
            return getOutfitProfiles().map(o => ({
                id: o.id,
                name: o.nameCN ? `${o.nameCN} (${o.nameEN || '未命名'})` : o.nameEN || o.id,
                data: o,
            }));
        }
        if (category === 'enable-scheme') {
            return getEnableSchemes().map(s => ({ id: s.id, name: s.name, data: s }));
        }
        return [];
    };

    const getInitialId = (): string => {
        const settings = loadSettings();
        if (regCategory && def) {
            return (settings[def.activeIdKey] as string) ?? getProfiles()[0]?.id ?? '';
        }
        return getProfiles()[0]?.id ?? '';
    };

    // 内部状态维护
    let currentId: string = getInitialId();

    const toolbarEl = renderPresetToolbar({
        profiles: getProfiles(),
        currentId,

        onSelect: async (id: string) => {
            if (options.onBeforeSelect) {
                const canProceed = await options.onBeforeSelect(id);
                if (!canProceed) return;
            }
            currentId = id;
            applyData(id);
            onRefresh();
        },

        onNew: async () => {
            const data = getCurrentData();
            if (!regCategory) {
                // character / outfit / enable-scheme 路径
                const name = prompt('请输入新预设方案名称：');
                if (!name || !name.trim()) return;
                const newId = `${category}_${Date.now()}`;
                if (category === 'character') upsertCharacterProfile({ ...(data as object), id: newId, nameCN: name.trim(), nameEN: name.trim() } as any);
                if (category === 'outfit') upsertOutfitProfile({ ...(data as object), id: newId, nameCN: name.trim(), nameEN: name.trim() } as any);
                if (category === 'enable-scheme') upsertEnableScheme({ ...(data as object), id: newId, name: name.trim() } as any);
                currentId = newId;
                applyData(newId);
                onRefresh();
                FeedbackService.toastSuccess(`新预设 [${name.trim()}] 创建成功！`, '创建预设');
                return;
            }
            // Registry 路径
            const name = await FeedbackService.promptName('new', category as any);
            if (!name?.trim()) return;
            const newId = ProfileService.createProfile(regCategory, name, data);
            currentId = newId;
            applyData(newId);
            onRefresh();
            FeedbackService.toastSuccess(`新预设 [${name.trim()}] 创建成功！`, def!.label);
        },

        onSave: () => {
            if (options.onSaveOverride) {
                options.onSaveOverride();
                return;
            }
            const data = getCurrentData();
            if (!regCategory) {
                // character / outfit / enable-scheme
                if (category === 'character') upsertCharacterProfile({ ...(data as object), id: currentId } as any);
                if (category === 'outfit') upsertOutfitProfile({ ...(data as object), id: currentId } as any);
                if (category === 'enable-scheme') upsertEnableScheme({ ...(data as object), id: currentId } as any);
            } else {
                ProfileService.saveProfile(regCategory, currentId, data);
            }
            FeedbackService.notifySaved(category as any);
        },

        onRename: async () => {
            const profiles = getProfiles();
            const item = profiles.find(p => p.id === currentId);
            const currentName = item?.name ?? '';
            if (!regCategory) {
                const newName = prompt('请输入重命名后的方案名称：', currentName);
                if (newName === null || !newName.trim()) return;
                const rawData = getCurrentData() as any;
                if (category === 'character') upsertCharacterProfile({ ...rawData, id: currentId, nameCN: newName.trim() });
                if (category === 'outfit') upsertOutfitProfile({ ...rawData, id: currentId, nameCN: newName.trim() });
                if (category === 'enable-scheme') upsertEnableScheme({ ...rawData, id: currentId, name: newName.trim() });
            } else {
                const newName = await FeedbackService.promptName('rename', category as any, currentName);
                if (!newName?.trim()) return;
                ProfileService.renameProfile(regCategory, currentId, newName);
            }
            onRefresh();
        },

        onExport: () => {
            const data = getCurrentData();
            if (regCategory) {
                ProfileService.exportProfileJSON(regCategory, currentId, () => data);
            } else {
                const jsonStr = JSON.stringify(data, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${category}-${currentId}.json`;
                a.click();
                URL.revokeObjectURL(url);
            }
        },

        onImport: (content: string, fileName: string) => {
            if (!regCategory) {
                // character / outfit / enable-scheme 手动导入路径
                try {
                    const parsed = JSON.parse(content);
                    const newId = `${category}_${Date.now()}`;
                    const profileName = fileName.replace(/\.json$/i, '');
                    if (category === 'character') {
                        parsed.id = newId;
                        parsed.nameCN = profileName;
                        upsertCharacterProfile(parsed);
                    } else if (category === 'outfit') {
                        parsed.id = newId;
                        parsed.nameCN = profileName;
                        upsertOutfitProfile(parsed);
                    } else if (category === 'enable-scheme') {
                        parsed.id = newId;
                        parsed.name = profileName;
                        upsertEnableScheme(parsed);
                    }
                    currentId = newId;
                    applyData(newId);
                    onRefresh();
                    FeedbackService.toastSuccess(`成功导入预设 [${profileName}]！`, '预设导入');
                } catch (err) {
                    logger.error('预设导入解析失败', err);
                    FeedbackService.toastError('JSON 语法错误，导入失败！', '预设导入');
                }
                return;
            }
            const newId = ProfileService.importProfile(regCategory, content, fileName);
            if (!newId) {
                const def = PRESET_REGISTRY[regCategory];
                FeedbackService.toastError('导入失败：JSON 格式不符合该预设类别的 Schema 要求', def.label);
                return;
            }
            const profileName = fileName.replace(/\.json$/i, '');
            FeedbackService.toastSuccess(`成功导入预设 [${profileName}]！`, '预设导入');
            currentId = newId;
            applyData(newId);
            onRefresh();
        },

        onDelete: async () => {
            if (!regCategory) {
                if (!confirm('⚠️ 确定要删除该预设方案吗？')) return;
                if (category === 'character') deleteCharacterProfile(currentId);
                if (category === 'outfit') deleteOutfitProfile(currentId);
                if (category === 'enable-scheme') deleteEnableScheme(currentId);
                const fresh = getProfiles();
                const next = fresh[0];
                if (next) {
                    currentId = next.id;
                    applyData(next.id);
                }
                onRefresh();
                return;
            }
            const ok = await FeedbackService.confirmDelete(category as any);
            if (!ok) return;
            const fallbackId = ProfileService.deleteProfile(regCategory, currentId);
            currentId = fallbackId;
            applyData(fallbackId);
            onRefresh();
        },

        onReset: async () => {
            const label = def?.label ?? category;
            const ok = await FeedbackService.confirm(
                `重置 ${label}`,
                '确定要将所有方案重置为初始内置配置吗？',
                '确定重置',
                true
            );
            if (!ok) return;
            if (category === 'character') resetCharacterProfilesToDefault();
            else if (category === 'outfit') resetOutfitProfilesToDefault();
            else if (category === 'enable-scheme') resetEnableSchemesToDefault();
            else if (regCategory) {
                resetCategoryToDefault(regCategory);
            }
            onRefresh();
            FeedbackService.toastSuccess('已成功重置为初始配置。', '重置成功');
        },
    });

    const resEl = toolbarEl as PresetToolbarElement;
    resEl.getCurrentData = getCurrentData;
    return resEl;
}

// ============================================================================
// BLOCK 3: 设置面板主底栏 (renderFooterBar)
// ============================================================================

/**
 * 渲染主设置面板的底栏组件
 *
 * @returns 底栏 DOM 根节点
 */
export function renderFooterBar(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'da-footer-bar';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.alignItems = 'center';
    footer.style.padding = '12px 20px';
    footer.style.borderTop = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';
    footer.style.fontSize = '0.85em';

    const statusGroup = document.createElement('div');
    statusGroup.style.display = 'flex';
    statusGroup.style.alignItems = 'center';
    statusGroup.style.gap = '8px';

    const dot = document.createElement('span');
    dot.className = 'da-status-dot';
    dot.style.display = 'inline-block';
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';

    const statusText = document.createElement('span');
    statusText.style.color = 'var(--da-text-secondary)';

    statusGroup.appendChild(dot);
    statusGroup.appendChild(statusText);
    footer.appendChild(statusGroup);

    const updateStatus = () => {
        const dState = driverStore.getState();
        if (dState.isConnected) {
            dot.classList.remove('da-status-error', 'da-status-checking');
            dot.classList.add('da-status-ok');
            statusText.textContent = `已连接后端引擎 (${dState.provider})`;
        } else {
            dot.classList.remove('da-status-ok', 'da-status-checking');
            dot.classList.add('da-status-error');
            statusText.textContent = `未连接后端服务 (${dState.provider})`;
        }
    };

    updateStatus();

    globalEventBus.on(DA_EVENTS.DRIVER_CHANGED, () => {
        updateStatus();
    });

    const versionText = document.createElement('span');
    versionText.style.color = 'var(--da-text-secondary)';
    versionText.textContent = `ST-DrawAssistant v${VERSION}`;
    footer.appendChild(versionText);

    return footer;
}

export function refreshFooterStatus(): void {
    globalEventBus.emit(DA_EVENTS.DRIVER_CHANGED, {});
}

// ============================================================================
// BLOCK 4: 存储容量指示条 (renderStorageBar)
// ============================================================================

/**
 * 渲染 IndexedDB 存储空间与配额占比指示条组件
 *
 * @returns 指示条 DOM 节点
 */
export function renderStorageBar(_options?: any): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-storage-bar';
    container.style.marginTop = '10px';
    container.style.padding = '12px';
    container.style.borderRadius = '8px';
    container.style.background = 'var(--da-bg-secondary, rgba(255,255,255,0.03))';

    const label = document.createElement('div');
    label.style.fontSize = '0.85em';
    label.style.color = 'var(--da-text-secondary)';
    label.style.marginBottom = '6px';
    label.textContent = '本地 IndexedDB 存储使用率估算...';
    container.appendChild(label);

    const track = document.createElement('div');
    track.style.width = '100%';
    track.style.height = '6px';
    track.style.borderRadius = '3px';
    track.style.background = 'var(--da-bg-hover, rgba(255, 255, 255, 0.08))';
    track.style.overflow = 'hidden';

    const fill = document.createElement('div');
    fill.style.width = '0%';
    fill.style.height = '100%';
    fill.style.background = 'var(--da-accent-color, #0a84ff)';
    fill.style.transition = 'width 0.3s ease';
    track.appendChild(fill);
    container.appendChild(track);

    if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then((est) => {
            const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
            const quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
            const pct = est.quota ? (((est.usage || 0) / est.quota) * 100).toFixed(1) : '0';

            label.textContent = `已用空间: ${usedMB} MB / 额度约 ${quotaMB} MB (${pct}%)`;
            fill.style.width = `${pct}%`;
        }).catch(() => {
            label.textContent = '无法获取浏览器 Storage 估算信息';
        });
    }

    return container;
}

// ============================================================================
// BLOCK 5: 历史生成统计卡片 (renderStatisticsCard)
// ============================================================================

export interface StatisticsData {
    totalGenerations: number;
    successfulGenerations: number;
    failedGenerations: number;
    averageTimeMs: number;
    totalTimeMs: number;
}

/**
 * 渲染生图成功率与平均耗时统计卡片组件
 *
 * @param stats 统计数据对象
 * @returns 统计卡片 DOM 节点
 */
export function renderStatisticsCard(stats?: Partial<StatisticsData> | any): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-macro-stats';

    const collector = StatisticsCollector.getInstance();
    const snap = collector.getSnapshot();

    const totalTasks = snap.totalTasks || stats?.totalGenerations || 0;
    const successCount = snap.successCount || stats?.successfulGenerations || 0;
    const successRate = collector.getSuccessRate();
    const avgDurationMs = collector.getAverageDuration() || stats?.averageTimeMs || 0;
    const avgSec = (avgDurationMs / 1000).toFixed(1);

    // 格式化最近活动时间
    let lastTimeStr = '暂无记录';
    if (snap.timeStats.lastTaskAt > 0) {
        const diffMin = Math.floor((Date.now() - snap.timeStats.lastTaskAt) / 60000);
        if (diffMin < 1) lastTimeStr = '刚刚';
        else if (diffMin < 60) lastTimeStr = `${diffMin}分钟前`;
        else if (diffMin < 1440) lastTimeStr = `${Math.floor(diffMin / 60)}小时前`;
        else lastTimeStr = new Date(snap.timeStats.lastTaskAt).toISOString().split('T')[0];
    }

    // 1. 核心指标 4 卡片网格
    const grid = document.createElement('div');
    grid.className = 'da-macro-stats__grid';

    const createCard = (label: string, val: string, sub: string, color?: string) => {
        const card = document.createElement('div');
        card.className = 'da-macro-stats__card';

        const labelEl = document.createElement('div');
        labelEl.className = 'da-macro-stats__card-label';
        labelEl.textContent = label;

        const valEl = document.createElement('div');
        valEl.className = 'da-macro-stats__card-val';
        if (color) valEl.style.color = color;
        valEl.textContent = val;

        const subEl = document.createElement('div');
        subEl.className = 'da-macro-stats__card-sub';
        subEl.textContent = sub;

        card.appendChild(labelEl);
        card.appendChild(valEl);
        card.appendChild(subEl);
        return card;
    };

    grid.appendChild(createCard('累计生图量', `${totalTasks} 张`, `总任务 ${snap.totalTasks} 次`));
    grid.appendChild(createCard('生图成功率', totalTasks > 0 ? `${successRate}%` : '100%', `成功 ${successCount} / 失败 ${snap.errorCount}`, '#30d158'));
    grid.appendChild(createCard('平均生成耗时', `${avgSec} 秒/张`, snap.minDurationMs > 0 ? `最快 ${(snap.minDurationMs / 1000).toFixed(1)}s` : '推理速度', '#00f2fe'));
    grid.appendChild(createCard('最近生图活动', lastTimeStr, '生成活跃度', 'var(--da-text-primary)'));

    container.appendChild(grid);

    // 2. 常用 Checkpoint 大模型分布 Top 3
    const topModels = collector.getTopItems(snap.paramStats.models, 3);
    if (topModels.length > 0) {
        const modelSection = document.createElement('div');
        modelSection.className = 'da-macro-stats__section';

        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'da-macro-stats__section-title';
        sectionTitle.innerHTML = '<span>🎨 常用生图模型占比 (Top Checkpoints)</span>';
        modelSection.appendChild(sectionTitle);

        const modelList = document.createElement('div');
        modelList.className = 'da-macro-stats__model-list';

        topModels.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'da-macro-stats__model-item';

            const infoEl = document.createElement('div');
            infoEl.className = 'da-macro-stats__model-info';

            const nameEl = document.createElement('span');
            nameEl.className = 'da-macro-stats__model-name';
            nameEl.textContent = item.name;
            nameEl.title = item.name;

            const countEl = document.createElement('span');
            countEl.textContent = `${item.percentage}% (${item.count}张)`;

            infoEl.appendChild(nameEl);
            infoEl.appendChild(countEl);

            const trackEl = document.createElement('div');
            trackEl.className = 'da-macro-stats__progress-track';

            const fillEl = document.createElement('div');
            fillEl.className = 'da-macro-stats__progress-fill';
            fillEl.style.width = `${item.percentage}%`;

            trackEl.appendChild(fillEl);
            itemEl.appendChild(infoEl);
            itemEl.appendChild(trackEl);
            modelList.appendChild(itemEl);
        });

        modelSection.appendChild(modelList);
        container.appendChild(modelSection);
    }

    // 3. 近 7 日生图产出趋势微图表
    const dailyTrend = collector.getDailyTrend(7);
    const maxCount = Math.max(...dailyTrend.map(d => d.count), 1);

    const trendSection = document.createElement('div');
    trendSection.className = 'da-macro-stats__section';

    const trendTitle = document.createElement('div');
    trendTitle.className = 'da-macro-stats__section-title';
    trendTitle.textContent = '📈 近 7 日生图产出趋势 (7-Day Output Trend)';
    trendSection.appendChild(trendTitle);

    const chartEl = document.createElement('div');
    chartEl.className = 'da-macro-stats__trend-chart';

    dailyTrend.forEach((item, index) => {
        const col = document.createElement('div');
        col.className = 'da-macro-stats__trend-col';

        const countText = document.createElement('div');
        countText.className = 'da-macro-stats__trend-count';
        countText.textContent = item.count > 0 ? String(item.count) : '';

        const barWrapper = document.createElement('div');
        barWrapper.className = 'da-macro-stats__trend-bar-wrapper';

        const bar = document.createElement('div');
        bar.className = 'da-macro-stats__trend-bar';
        const heightPct = Math.round((item.count / maxCount) * 100);
        bar.style.height = `${Math.max(heightPct, item.count > 0 ? 8 : 4)}%`;
        if (item.count === 0) bar.style.opacity = '0.25';

        barWrapper.appendChild(bar);

        const dateText = document.createElement('div');
        dateText.className = 'da-macro-stats__trend-date';
        dateText.textContent = index === 6 ? '今日' : item.date.substring(5);

        col.appendChild(countText);
        col.appendChild(barWrapper);
        col.appendChild(dateText);
        chartEl.appendChild(col);
    });

    trendSection.appendChild(chartEl);
    container.appendChild(trendSection);

    // 4. 统计数据资产导出与清空按钮行
    const actionsRow = document.createElement('div');
    actionsRow.className = 'da-macro-stats__actions';

    const btnExportJSON = document.createElement('button');
    btnExportJSON.className = 'da-btn secondary';
    btnExportJSON.style.fontSize = '0.78em';
    btnExportJSON.style.padding = '4px 10px';
    btnExportJSON.textContent = '📥 导出 JSON';
    btnExportJSON.onclick = () => {
        exportStatisticsJSON(snap);
        showToastNotice('生图统计报表 JSON 导出就绪', '提示', true);
    };

    const btnExportCSV = document.createElement('button');
    btnExportCSV.className = 'da-btn secondary';
    btnExportCSV.style.fontSize = '0.78em';
    btnExportCSV.style.padding = '4px 10px';
    btnExportCSV.textContent = '📊 导出 CSV';
    btnExportCSV.onclick = () => {
        exportStatisticsCSV(snap);
        showToastNotice('生图趋势报表 CSV 导出就绪', '提示', true);
    };

    const btnReset = document.createElement('button');
    btnReset.className = 'da-btn danger';
    btnReset.style.fontSize = '0.78em';
    btnReset.style.padding = '4px 10px';
    btnReset.textContent = '🗑️ 重置统计';
    btnReset.onclick = () => {
        import('./modals').then(({ showConfirmDialog }) => {
            showConfirmDialog({
                title: '重置生图统计确认',
                message: '确定要清空所有历史生图统计数据吗？此操作无法撤销。',
                isDangerous: true,
            }).then(confirmed => {
                if (confirmed) {
                    void collector.reset().then(() => {
                        showToastNotice('生图历史统计已成功清空', '成功', true);
                        const newDash = renderStatisticsCard();
                        container.replaceWith(newDash);
                    });
                }
            });
        }).catch(err => logger.error('唤起 showConfirmDialog 失败', err));
    };

    actionsRow.appendChild(btnExportJSON);
    actionsRow.appendChild(btnExportCSV);
    actionsRow.appendChild(btnReset);
    container.appendChild(actionsRow);

    return container;
}

export interface ImageActionCallbacks {
    imageSrc?: string;
    mimeType?: string;
    promptText?: string;
    negativePrompt?: string;
    messageIndex?: number;
    buttonIndex?: number;
    uuid?: string;
    onConfirm?: (newPrompt: string, newNegativePrompt?: string) => void;
    onLightbox?: () => void;
    onRegen?: () => void;
    onRegenerate?: () => void;
    onInpaint?: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    onInfo?: () => void;
    [key: string]: any;
}

/**
 * 图像操作栏 控件 (ImageActionPanel Control)
 *
 * 当用户长按 (pointerdown >= 500ms) 或右键单击生图元素时触发唤出。
 * 托管 Tag 锁定/编辑与复制，以及 [🖌️ 局部重绘]、[ℹ️ 元数据]、[💾 下载]、[🗑️ 删除]、[🚀 重新生成] 动作按钮。
 */
export function openImageActionPanel(_e: MouseEvent | PointerEvent, callbacks: ImageActionCallbacks): void {
    logger.debug('调起图像操作栏控件 (ImageActionPanel Control)');

    const overlay = document.createElement('div');
    overlay.className = 'da-modal-backdrop st-da-root';
    overlay.style.zIndex = '100090';
    applyCurrentThemeToNode(overlay);

    const panel = document.createElement('div');
    panel.className = 'da-action-panel st-da-root';
    applyCurrentThemeToNode(panel);

    // 1. Header 顶栏
    const header = document.createElement('div');
    header.className = 'da-action-panel__header';

    const headerTitle = document.createElement('h3');
    headerTitle.className = 'da-action-panel__title';
    headerTitle.textContent = callbacks.messageIndex !== undefined
        ? `图像操作栏 (#${callbacks.messageIndex})`
        : '图像操作栏';

    const btnClose = document.createElement('button');
    btnClose.className = 'da-btn secondary';
    btnClose.style.padding = '2px 10px';
    btnClose.style.fontSize = '0.9em';
    btnClose.textContent = '✕';
    btnClose.onclick = () => overlay.remove();

    header.appendChild(headerTitle);
    header.appendChild(btnClose);
    panel.appendChild(header);

    // 2. 主体 Prompt 卡片区
    const body = document.createElement('div');
    body.className = 'da-action-panel__body';

    const createTagCard = (
        titleLabel: string,
        initialValue: string,
        placeholder: string,
        copySuccessMsg: string
    ) => {
        const card = document.createElement('div');
        card.className = 'da-tag-card';

        const cardHeader = document.createElement('div');
        cardHeader.className = 'da-tag-card__header';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'da-tag-card__label';
        labelSpan.textContent = titleLabel;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'da-tag-card__btn-group';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'da-btn secondary';
        copyBtn.style.fontSize = '0.78em';
        copyBtn.style.padding = '2px 8px';
        copyBtn.textContent = '📋 复制';

        const editBtn = document.createElement('button');
        editBtn.className = 'da-btn secondary';
        editBtn.style.fontSize = '0.78em';
        editBtn.style.padding = '2px 8px';
        editBtn.textContent = '✏️ 编辑';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'da-btn secondary';
        cancelBtn.style.fontSize = '0.78em';
        cancelBtn.style.padding = '2px 8px';
        cancelBtn.style.display = 'none';
        cancelBtn.textContent = '✕ 取消';

        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(cancelBtn);

        cardHeader.appendChild(labelSpan);
        cardHeader.appendChild(btnGroup);
        card.appendChild(cardHeader);

        const textarea = document.createElement('textarea');
        textarea.className = 'da-textarea';
        textarea.style.width = '100%';
        textarea.style.height = '85px';
        textarea.style.resize = 'vertical';
        textarea.style.fontSize = '0.88em';
        textarea.style.lineHeight = '1.45';
        textarea.style.userSelect = 'text';
        textarea.readOnly = true;
        textarea.placeholder = placeholder;
        textarea.value = initialValue || '';
        textarea.style.background = 'var(--da-bg-card, rgba(0, 0, 0, 0.2))';
        textarea.style.border = '1px solid var(--da-border-color)';

        // 状态机变量：追踪当前是否处于解锁编辑状态与上一基线文本备份
        let isEditing = false;
        let backupText = initialValue || '';

        // 动作 1: 一键复制文本到剪贴板
        copyBtn.onclick = () => {
            void navigator.clipboard.writeText(textarea.value).then(() => {
                showToastNotice(copySuccessMsg, '复制成功', true);
            });
        };

        // 动作 2: 解锁编辑 / 锁定基线保存
        editBtn.onclick = () => {
            if (!isEditing) {
                // 阶段 A: 进入编辑模式（解锁 readOnly、记录 backupText 备份、高亮亮色边框）
                isEditing = true;
                backupText = textarea.value;
                textarea.readOnly = false;
                textarea.focus();
                textarea.style.border = '1px solid var(--da-accent-color, #00f2fe)';
                editBtn.textContent = '💾 锁定';
                editBtn.className = 'da-btn primary';
                cancelBtn.style.display = 'inline-block';
            } else {
                // 阶段 B: 锁定模式（保存最新编辑内容为 backupText 新基线，还原 readOnly 锁定）
                isEditing = false;
                backupText = textarea.value;
                textarea.readOnly = true;
                textarea.style.border = '1px solid var(--da-border-color)';
                editBtn.textContent = '✏️ 编辑';
                editBtn.className = 'da-btn secondary';
                cancelBtn.style.display = 'none';
            }
        };

        // 动作 3: 取消编辑（还原 backupText 基线，切回只读）
        cancelBtn.onclick = () => {
            if (isEditing) {
                isEditing = false;
                textarea.value = backupText;
                textarea.readOnly = true;
                textarea.style.border = '1px solid var(--da-border-color)';
                editBtn.textContent = '✏️ 编辑';
                editBtn.className = 'da-btn secondary';
                cancelBtn.style.display = 'none';
            }
        };

        card.appendChild(textarea);
        return { card, textarea };
    };

    const posCard = createTagCard(
        '🔤 提取正向提示词 (Positive Tags)',
        callbacks.promptText || '',
        '输入正向生图提示词...',
        '已成功复制提取的正向提示词！'
    );

    const negCard = createTagCard(
        '🚫 反向提示词 (Negative Tags)',
        callbacks.negativePrompt || '',
        '输入反向过滤提示词...',
        '已成功复制反向提示词！'
    );

    body.appendChild(posCard.card);
    body.appendChild(negCard.card);

    // 若当前未拿到负向提示词，但提供了图像 uuid，从数据库异步补充提取图像存储的真实原生负向提示词
    if (callbacks.uuid && !callbacks.negativePrompt) {
        import('../../storage/image-db').then(({ getImageFromDB }) => {
            getImageFromDB(callbacks.uuid!).then(rec => {
                const rawNeg = rec?.rawNegativePrompt;
                if (rawNeg !== undefined && !negCard.textarea.value) {
                    negCard.textarea.value = rawNeg;
                }
            }).catch(() => { /* ignore */ });
        }).catch(() => { /* ignore */ });
    }

    panel.appendChild(body);

    // 3. Footer 操作按纽行 (局部重绘、元数据、下载、删除、重新生成全量呈列)
    const footer = document.createElement('div');
    footer.className = 'da-action-panel__footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-action-panel__footer-left';

    // 按钮 1: 🖌️ 局部重绘
    const btnInpaint = document.createElement('button');
    btnInpaint.className = 'da-btn secondary';
    btnInpaint.style.fontSize = '0.85em';
    btnInpaint.style.padding = '6px 14px';
    btnInpaint.textContent = '🖌️ 局部重绘';
    btnInpaint.onclick = () => {
        overlay.remove();
        if (callbacks.onInpaint) {
            callbacks.onInpaint();
        } else {
            showToastNotice('当前状态不支持局部重绘', '提示', false);
        }
    };
    footerLeft.appendChild(btnInpaint);

    // 按钮 2: ℹ️ 元数据
    const btnInfo = document.createElement('button');
    btnInfo.className = 'da-btn secondary';
    btnInfo.style.fontSize = '0.85em';
    btnInfo.style.padding = '6px 12px';
    btnInfo.textContent = 'ℹ️ 元数据';
    btnInfo.onclick = () => {
        overlay.remove();
        if (callbacks.onInfo) {
            callbacks.onInfo();
        } else {
            import('./modals').then(({ openImageInfoPanel }) => {
                openImageInfoPanel(callbacks.uuid || callbacks);
            }).catch(err => logger.error('唤起 openImageInfoPanel 失败', err));
        }
    };
    footerLeft.appendChild(btnInfo);

    // 按钮 3: 💾 下载
    const btnDownload = document.createElement('button');
    btnDownload.className = 'da-btn secondary';
    btnDownload.style.fontSize = '0.85em';
    btnDownload.style.padding = '6px 12px';
    btnDownload.textContent = '💾 下载';
    btnDownload.onclick = () => {
        if (callbacks.onDownload) {
            callbacks.onDownload();
        } else if (callbacks.imageSrc) {
            const a = document.createElement('a');
            a.href = callbacks.imageSrc;
            a.download = `image-${callbacks.uuid || Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            showToastNotice('未检测到可下载的图像资源', '提示', false);
        }
    };
    footerLeft.appendChild(btnDownload);

    // 按钮 4: 🗑️ 删除
    const btnDelete = document.createElement('button');
    btnDelete.className = 'da-btn danger';
    btnDelete.style.fontSize = '0.85em';
    btnDelete.style.padding = '6px 12px';
    btnDelete.textContent = '🗑️ 删除';
    btnDelete.onclick = () => {
        overlay.remove();
        if (callbacks.onDelete) {
            callbacks.onDelete();
        } else {
            import('./modals').then(({ showConfirmDialog }) => {
                showConfirmDialog({
                    title: '删除确认',
                    message: '确定要删除该图像吗？',
                    isDangerous: true,
                }).then(confirmed => {
                    if (confirmed) {
                        showToastNotice('图像已从视图中移除', '提示', true);
                    }
                });
            }).catch(err => logger.error('唤起 showConfirmDialog 失败', err));
        }
    };
    footerLeft.appendChild(btnDelete);

    // 按钮 5: 🚀 重新生成
    const btnRegen = document.createElement('button');
    btnRegen.className = 'da-btn primary';
    btnRegen.style.fontSize = '0.88em';
    btnRegen.style.padding = '6px 18px';
    btnRegen.textContent = '🚀 重新生成';
    btnRegen.onclick = () => {
        const newPos = posCard.textarea.value.trim();
        const newNeg = negCard.textarea.value.trim();
        overlay.remove();
        if (callbacks.onConfirm) {
            callbacks.onConfirm(newPos, newNeg);
        } else if (callbacks.onRegenerate) {
            callbacks.onRegenerate();
        }
    };

    footer.appendChild(footerLeft);
    footer.appendChild(btnRegen);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}
